import cds from '@sap/cds'

// Touch cds.env first so @sap/cds loads .env before checking MISTRAL_* vars.
const prev = cds.env.requires.llm

const mistralFetch = async (url, init) => {
  if (typeof init?.body === 'string' && String(url).split('?')[0].endsWith('/chat/completions')) {
    try {
      const body = JSON.parse(init.body)
      if (Array.isArray(body.messages)) {
        for (const m of body.messages) {
          if (!m) continue
          if (m.role !== 'tool') delete m.name
          if (
            m.role === 'assistant' &&
            m.tool_calls?.length &&
            (m.content === '' || (Array.isArray(m.content) && m.content.length === 0))
          ) {
            m.content = null
          }
          if (
            m.role === 'tool' &&
            Array.isArray(m.content) &&
            m.content.every((c) => c?.type === 'text' && typeof c.text === 'string')
          ) {
            m.content = m.content.map((c) => c.text).join('')
          }
        }
        init = { ...init, body: JSON.stringify(body) }
      }
    } catch { /* leave non-JSON bodies untouched */ }
  }
  return fetch(url, init)
}

if (process.env.MISTRAL_API_KEY) {
  const baseURL = process.env.MISTRAL_BASE_URL || 'https://api.mistral.ai/v1'
  cds.env.requires.llm = {
    ...prev,
    kind: 'openai',
    model: process.env.MISTRAL_MODEL || prev?.model || 'mistral-large-latest',
    credentials: {
      ...prev?.credentials,
      baseURL,
      apiKey: process.env.MISTRAL_API_KEY,
      fetch: mistralFetch,
    },
  }
  delete cds.env.requires.llm.credentials.baseUrl
  process.env.OPENAI_API_KEY ??= process.env.MISTRAL_API_KEY
  process.env.OPENAI_BASE_URL ??= baseURL
}

export default cds.server
