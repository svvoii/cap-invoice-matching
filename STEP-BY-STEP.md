# STEP-BY-STEP: SAP TechEd 2026 AD262 on BTP Trial (Local VS Code + Mistral)

## Workspace & Root Environment Layout

```text
/Users/serge/Documents/PROJECTS/SAP/CAP/        # Parent folder (this guide + shared .agents/skills/ if kept as IDE root)
├── Agentic-CAP-AD262/                          # Cloned TechEd reference repo (read-only)
├── invoice-matching/                           # Isolated Track 1 project root (.git, node_modules, .env, .nvmrc)
└── <custom-showcase>/                          # Isolated Track 2 project root (Phase 5)
```

> **IDE Root Tip:** Once you create `invoice-matching/` below, either:
> - **Single-project root (simplest):** Open `/Users/serge/Documents/PROJECTS/SAP/CAP/invoice-matching` directly as your VS Code / AI Agent workspace so `cds-mcp`, `.agents/skills/`, `.env`, and `npx cds` all resolve from the project root automatically.
> - **Multi-project parent root (`/CAP`):** If you keep `/Users/serge/Documents/PROJECTS/SAP/CAP` as your IDE root, install `.agents/skills/` at `/CAP/` (shared across Track 1 & Track 2), run all terminal commands inside `/CAP/invoice-matching`, and set `"cwd"` on `cds-mcp` (shown below).

---

## Phase 0 — Local CLI & Isolated Project Root Setup

1. **Install Cloud Foundry CLI v8** *(standalone OS binary from the official Cloud Foundry tap)*:
   ```bash
   brew trust --formula cloudfoundry/tap/cf-cli
   brew install cloudfoundry/tap/cf-cli@8
   brew link --force cloudfoundry/tap/cf-cli@8
   cf -v
   ```
   *(If Homebrew complains about `/opt/homebrew/Cellar` permissions first, run: `sudo chown -R $(whoami) /opt/homebrew/Cellar /opt/homebrew/var/homebrew /opt/homebrew/Library/Taps`)*

2. **Create isolated `invoice-matching/` root + local CAP CLI + root `.env`**:
   ```bash
   mkdir -p /Users/serge/Documents/PROJECTS/SAP/CAP/invoice-matching
   cd /Users/serge/Documents/PROJECTS/SAP/CAP/invoice-matching

   # Pin Node 22 LTS & initialize isolated git boundary
   echo "22" > .nvmrc
   git init

   # Scaffold CAP project & install latest CAP CLI locally (no global -g needed)
   npx -p @sap/cds-dk@latest cds init --add nodejs,sqlite
   npm add -D @sap/cds-dk@latest
   npm install
   npx cds -v
   ```

3. **Create root `.env` (Mistral API) & update `.gitignore`**:
   - Append local secrets, local agent state, and `*.db` to `.gitignore` *(keeps `.agents/` and `.vscode/` visible in git)*:
     ```bash
     cat << 'EOF' >> .gitignore

     # Local env & AI assistant state
     .env
     .env.*
     .claude/
     .vibe/
     .gemini/
     *.db
     *.sqlite*
     EOF
     ```
   - Create `.env`:
     ```ini
     MISTRAL_API_KEY=<YOUR_MISTRAL_API_KEY>
     MISTRAL_BASE_URL=https://api.mistral.ai/v1
     MISTRAL_MODEL=mistral-large-latest
     ```

4. **Prepare your new BTP Trial Subaccount & log in**:
   - **Entitlements**: Assign **2 units (2 GB)** of **Cloud Foundry Runtime** (`MEMORY`) to your new subaccount *(if all 4 Trial units sit on your default `trial` subaccount, lower that one from 4 -> 2 first)*.
   - **Cloud Foundry**: Click **Enable Cloud Foundry** -> **Create Space** (e.g., `dev`) -> copy the **API Endpoint** *(no service instances needed — SQLite, ONNX embeddings, Mistral, and console audit logs run self-contained)*.
   ```bash
   cf login -a <YOUR_CF_API_ENDPOINT> --sso
   ```

---

## Phase 1 — Core CAP App, React UI & S/4 Data (`Ex 0–2`)

*(Run all commands below from `/Users/serge/Documents/PROJECTS/SAP/CAP/invoice-matching`.)*

### Ex 0: Connect CAP Skills/MCP + Generate Workflow Model
1. **Install CAP Skills + Project-Local `cds-mcp` & Verify Visibility**:
   - **Baseline check (before install)**: If an agent session is open, ask:
     `List all CAP skills and cds-mcp tools currently registered in your session.` *(Expect none yet.)*
   - **Install Skills** *(creates `.agents/skills/` + symlinks `.vibe/skills/` and `.claude/skills/`)*:
     ```bash
     npx skills add https://github.com/capire/skills.git
     ```
   - **Project-local `cds-mcp` config for all 4 tools**:
     - **Mistral Vibe** (`.vibe/config.toml` — includes `skill_paths` above `[[mcp_servers]]`):
       ```toml
       skill_paths = [".agents/skills"]

       [[mcp_servers]]
       name = "cds-mcp"
       transport = "stdio"
       command = "npx"
       args = ["-y", "@cap-js/mcp-server"]
       ```
     - **GitHub Copilot / VS Code** (`.vscode/mcp.json`):
       ```json
       {
         "servers": {
           "cds-mcp": { "command": "npx", "args": ["-y", "@cap-js/mcp-server"] }
         }
       }
       ```
     - **Claude Code** (`.mcp.json` at project root):
       ```bash
       claude mcp add --scope project cds-mcp -- npx -y @cap-js/mcp-server
       ```
     - **Antigravity** (`.agents/plugins/cap-mcp/` — tracked in `.agents/`, zero `.gemini` needed):
       ```bash
       mkdir -p .agents/plugins/cap-mcp
       echo '{ "name": "cap-mcp" }' > .agents/plugins/cap-mcp/plugin.json
       cat << 'EOF' > .agents/plugins/cap-mcp/mcp_config.json
       {
         "mcpServers": {
           "cds-mcp": { "command": "npx", "args": ["-y", "@cap-js/mcp-server"] }
         }
       }
       EOF
       ```
   - **Restart / Start a NEW Agent Session** *(Mandatory!)*:
     Quit your current agent CLI/chat and open a **fresh session from inside `invoice-matching/`** (accepting the directory **trust** prompt in Vibe). Skills and MCP servers are only indexed at session startup — an already-open session will **not** see newly added files.
   - **Post-install visibility check**: In the new session, run `/mcp` (in Vibe/Claude) and ask:
     `Which cap-* skills and cds-mcp tools are registered in your session?`
     *(Why `/` commands don't show `/cap-developer` outside Claude: Mistral Vibe, Copilot, and Antigravity register `.agents/skills/` in their **skill tool/registry**, NOT as `/` CLI slash commands. Omit `/cap-developer` — or explicitly prefix with `"Use the cap-developer skill (.agents/skills/cap-developer/SKILL.md):"` to guarantee it loads.)*

2. Paste this prompt into your AI agent *(omit `/cap-developer` if not using Claude CLI)*:
   ```text
   /cap-developer Build a CAP app for Maria, an AP clerk who matches incoming supplier invoices to open purchase orders before releasing payment.

   She needs to see her invoices and the open POs side by side. Each invoice has a supplier, an amount with currency, a short description, and a status (open, matched, or escalated). She can also see which PO it's been matched to, if any.

   Purchase orders have a supplier, a line item description, an amount, and a flag for whether they're still open.

   When Maria decides on a match she records it as a match decision – linking the invoice and the PO, noting her confidence, a rationale, and the outcome (proposed, approved, rejected, or escalated). The system should track who made the decision and when.

   The decision workflow should enforce valid transitions: a proposed match can be approved, rejected, or escalated; once approved it can only be escalated; rejected and escalated are final.

   Generate realistic sample data that also include data about furniture and laptops. Use SQLite for local dev.
   Ensure cap status-flows are used for the workflow: https://cap.cloud.sap/docs/guides/services/status-flows
   Use assert constraints when possible to avoid custom code: https://cap.cloud.sap/docs/guides/services/constraints#assert-constraint
   Name the service InvoiceMatchingService (with @path: 'matching'), the service definition file srv/invoice-matching-service.cds, and the implementation srv/invoice-matching-service.js.
   ```
   *(Tip: Adding `@path: 'matching'` keeps all URLs consistent at `/odata/v4/matching/` and `/a2a/matching/preview/` across Exercises 1–6.)*

3. **Test**: In a second terminal (`invoice-matching/`), run `npx cds watch` and open `http://localhost:4004`.

---

### Ex 1: React Split-Panel UI
1. Stop `npx cds watch`, scaffold React, and install deps:
   ```bash
   npx cds add react --into matching
   npm --prefix app/matching install
   ```

2. In your AI agent, run:
   ```text
   Build Maria's invoice matching UI in app/matching/ matching our existing db/schema.cds and srv/invoice-matching-service.cds.

   Left panel: list of open invoices (status = 'O', showing supplier.name, amount + currency_code, description). Right panel: list of open purchase orders (isOpen = true, showing supplier.name, amount + currency_code, lineItem).

   When Maria selects an invoice and a PO, show a "Record Match" button (plus confidence 0-100 and rationale >= 10 chars inputs, with sensible defaults). Clicking it POSTs to MatchDecisions (note: outcome is @readonly and defaults to 'P'). Update syncInvoice in srv/invoice-matching-service.js so recording a proposed ('P') match also marks the invoice as matched ('M') and sets PO isOpen to false; rejecting ('R') reopens both ('O' and isOpen = true); approving ('A') or escalating ('E') keeps them closed.

   Below the two panels, show a "Pending decisions" section listing proposed ('P') match decisions with invoice description, PO lineItem, confidence, rationale, and Approve / Reject buttons calling the CAP bound actions. Re-fetch lists after any mutation.

   Fetch data from /odata/v4/matching/ using $expand=supplier,invoice,purchaseOrder as needed. Keep it simple – no routing, no state library.
   ```

3. **Server Commands & Ex 1 Test Checklist**:
   - **Stop detached/background servers** *(anytime an AI agent launched `:4004` or `:5173` in the background)*:
     ```bash
     lsof -tiTCP:4004,5173 -sTCP:LISTEN | xargs kill 2>/dev/null || true
     ```
   - **Start / Restart cleanly in 2 terminals** *(from `invoice-matching/`, stop anytime with `Ctrl+C`)*:
     ```bash
     # Terminal 1 — CAP backend (:4004, auto-reloads on .cds/.js changes)
     npm run watch

     # Terminal 2 — Vite React UI (:5173, proxies /odata -> :4004)
     npm --prefix app/matching run dev
     ```
   - **Reset SQLite back to seed data** *(stop CAP first, then run)*:
     ```bash
     rm -f db.sqlite* && npm run deploy
     ```
   - **Run these 4 UI + API checks at `http://localhost:5173`**:
     1. **Declarative guardrail (`@assert`)**: Pick an invoice and PO from **different** suppliers -> click **Record Match** -> verify CAP blocks it (`ASSERT_SUPPLIER_MISMATCH`).
     2. **Record Match -> Reject (reopen)**: Pick a **same-supplier** pair (e.g., ByteCraft `INV-2026-002` + `PO-1008`) -> **Record Match** -> both leave open lists and appear under *Pending decisions* -> click **Reject** -> both return to open lists.
     3. **Record Match -> Approve (close)**: Pick `INV-2026-001` + `PO-1008` -> **Record Match** -> click **Approve** -> leaves *Pending decisions* and both stay closed.
     4. **Backend OData check**: Open `http://localhost:4004/odata/v4/matching/Invoices?$expand=supplier,matchedPO` to see `status: "M"` and `matchedPO` linked.

---

### Ex 2: Import S/4HANA Supplier Data Product
1. Copy the data product from `Agentic-CAP-AD262` and import it:
   ```bash
   cp ../Agentic-CAP-AD262/sap-s4com-Supplier-v1.json .
   npx cds import --data-product sap-s4com-Supplier-v1.json
   ls apis/imported/
   ```

2. In your AI agent *(in a restarted session inside `invoice-matching/` — replace `/cap-add-remote-service` with `Use the cap-add-remote-service skill (.agents/skills/cap-add-remote-service/SKILL.md):` if not using Claude CLI)*:
   ```text
   /cap-add-remote-service The Supplier data product is imported under apis/imported/. Integrate it with our existing Suppliers / Invoices model so each invoice Maria reviews shows:
   - supplier name (from Supplier record)
   - payment terms, posting block flag, and payment blocking reason (from company-code record)

   Create a clean supplier consumption view over apis/imported/ linked to our Suppliers / Invoices model in db/schema.cds.
   Generate realistic mock CSV data matching the existing invoice suppliers, with at least one blocked supplier (e.g. "Beta Corp" blocked for "Quality issue - invoice dispute"), and display block warnings in the React UI.
   ```

3. **Test**: Redeploy seed data (`rm -f db.sqlite* && npm run deploy`), run `npm run watch` + `npm --prefix app/matching run dev`, and confirm blocked supplier badges appear at `http://localhost:5173`.

---

## Phase 2 — MCP, Semantic Search & Autonomous Agent (`Ex 3–5`)

### Ex 3: Expose CAP Service as an MCP Server
1. Install `@cap-js/mcp`:
   ```bash
   npm add @cap-js/mcp
   ```
2. Add at the bottom of `srv/invoice-matching-service.cds`:
   ```cds
   annotate InvoiceMatchingService with @odata @mcp;
   ```
3. **Restart & Test**:
   - **No DB redeploy needed** (`@mcp` only adds an HTTP protocol). **Restart CAP (`npm run watch`) once** after `npm add @cap-js/mcp` so CAP loads the plugin — you'll see `/mcp/matching` alongside `/odata/v4/matching` in the startup log.
   - *(Note: Opening `http://localhost:4004/mcp/matching` in a browser `GET` returns JSON-RPC `405 Method not allowed` by design — MCP Streamable HTTP only accepts `POST`.)*
   - Register **`http://localhost:4004/mcp/matching`** *(combines `/mcp` protocol prefix + `@path: 'matching'`)* and **restart your AI agent session**:
     - **Mistral Vibe** (`.vibe/config.toml`): append `[[mcp_servers]]` with `name = "invoice-matching"`, `transport = "streamable-http"`, `url = "http://localhost:4004/mcp/matching"`
     - **GitHub Copilot** (`.vscode/mcp.json`): add `"invoice-matching": { "url": "http://localhost:4004/mcp/matching" }` under `"servers"`
     - **Claude CLI**: restart `claude` and check `/mcp` (or add `http://localhost:4004/mcp/matching` to `.mcp.json`)
     - **Antigravity** (`.agents/plugins/cap-mcp/mcp_config.json`): add `"invoice-matching": { "url": "http://localhost:4004/mcp/matching" }` under `"mcpServers"`
   - **Type these directly into your Mistral Vibe CLI chat prompt** *(not the browser — the standalone browser Agent UI comes in Ex 5! Prefixing with "Using the invoice-matching MCP server" ensures Vibe calls live MCP tools `describe`/`query`/`call` instead of reading CSV files on disk)*:
     - `Using the invoice-matching MCP server, show me potential matches`
     - `Using the invoice-matching MCP server, are there any invoices from blocked suppliers?`
     *(Watch your `npm run watch` terminal — you'll see `POST /mcp/matching` tool calls hit CAP live!)*

---

### Ex 4: Local Vector Embeddings & Semantic Search
1. Install AI & SQLite vector packages *( put in `dependencies` so they also deploy to BTP CF later )*:
   ```bash
   npm add @cap-js/ai @cap-js/sqlite@^3.1 @huggingface/hub@^2.15.0 @huggingface/tokenizers@0.1.3 onnxruntime-node
   ```
   *(Gotcha: If `onnxruntime-node` binary install fails on Node `v26`, switch this shell to Node `22 LTS` via `brew install node@22`.)*

2. In your AI agent, run *(omit `/cap-developer` if not using Claude CLI)*:
   ```text
   /cap-developer Add semantic search to InvoiceMatchingService. Invoice descriptions and PO item descriptions should be searchable by meaning using the local embedding model (no HANA). Expose searchMatches / findMatches over MCP as well, combining semantic similarity with amount proximity.
   ```

3. **Test**: Restart `npm run watch` (first run downloads ~25 MB embedding model), restart `vibe`, and ask in your **Mistral Vibe CLI chat**:
   - `Using the invoice-matching MCP server, run search matches for 'laptop computers'`

---

### Ex 5: A2A Agent + Mistral API + Human-in-the-Loop (`@agent.hitl`)
1. Install `@cap-js/agents`:
   ```bash
   npm add @cap-js/agents
   ```

2. **Wire `MISTRAL_*` env vars to CAP's LLM config**:
   - Add under `"cds" -> "requires"` in `package.json`:
     ```json
     "llm": {
       "kind": "openai",
       "model": "mistral-large-latest",
       "credentials": {
         "baseURL": "https://api.mistral.ai/v1"
       }
     }
     ```
   - Create `srv/server.js` *(ESM — matches `"type": "module"` in `package.json`)* so CAP maps `MISTRAL_*` into the OpenAI-compatible adapter and strips `name` from non-`tool` messages (LangChain's `AgentNode` stamps `name: "model"` on assistant messages, which Mistral rejects with `422 extra_forbidden`):
     ```javascript
     import cds from '@sap/cds'

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
     ```

3. In your AI agent, run these 3 prompts one by one *(omit `/cap-developer` if not using Claude CLI)*:
   - **Agent + HITL + Unbound Service Actions (`srv.actions`)**:
     ```text
     /cap-developer Annotate InvoiceMatchingService as an @agent and require human-in-the-loop approval (@agent.hitl) on the approve action.
     Important: Because @cap-js/mcp (getFilteredActions) and @cap-js/agents (buildHitlInterruptMap in hitl.js) only inspect unbound service-level actions (srv.actions) and ignore bound entity actions, keep the bound actions (approve, reject, escalate) on MatchDecisions for the OData V4 React UI, AND also add unbound service-level actions on InvoiceMatchingService:
     - proposeMatch(invoice: String(50), purchaseOrder: String(50), confidence: Integer, rationale: String(500)) returns MatchDecisions
     - @agent.hitl approve(decision: String(50)) returns MatchDecisions
     - reject(decision: String(50), rationale: String(500)) returns MatchDecisions
     - escalate(decision: String(50), rationale: String(500)) returns MatchDecisions
     Also change findMatches(invoice: String(50), k: Integer) so findMatches, proposeMatch, approve, reject, and escalate all resolve either a UUID or a human-readable number (like 'INV-2026-007', 'INV-TEST-001', 'PO-1012') in srv/invoice-matching-service.js.
     ```
     *(Gotcha: If `approve` is only defined as a bound action on `MatchDecisions`, `srv.actions` won't contain `approve`, so the agent won't see it in `describe`/`call` and `@agent.hitl` won't register an interrupt!)*
   - **Edge-case test data**:
     ```text
     /cap-developer Add sample data where invoice and PO amounts diverge by 2-10%, including invoice INV-TEST-001 (from blocked supplier Beta Corp with an exact 4000 EUR match to PO-1011), INV-2026-011 (+2.9% variance vs PO-1012), and INV-2026-012 (+6.0% variance vs PO-1013).
     ```
   - **AP Policy Skill (`AGENTS.md` + `SKILL.md`)**:
     ```text
     /cap-developer Create an AP domain policy skill (both AGENTS.md and skills/ap-match-policy/SKILL.md under srv/agents/invoice-matching/ following @cap-js/agents conventions so createAutoDeepAgent loads the skills middleware) guiding how the agent proposes and confirms matches:
     - Within 2% amount variance: clean match; 2-5%: add price-variance note; >5%: must escalate, never confirm.
     - Weight exact supplier+amount highest, semantic match lower; distrust high semantic similarity if amounts diverge.
     - Blocked supplier: never propose confirm regardless of match quality — flag with blocking reason and escalate.
     - Execute decisions via the `call` tool (proposeMatch, approve, reject, escalate), which accepts invoice numbers like 'INV-2026-007' or UUIDs. When asked to approve an invoice (e.g. 'INV-2026-007'), immediately invoke `call` with `action: "approve"` and `parameters: { "decision": "INV-2026-007" }` (even if Invoices.status is 'M' from a proposed match) and never ask "Should I proceed?" in plain text before calling the tool so the @agent.hitl [Approve]/[Reject] UI card triggers directly.
     - Rationale: 1-2 actionable sentences stating matched signals.
     ```
     *(Gotcha: `@cap-js/agents` only loads `skills/*/SKILL.md` at runtime when `AGENTS.md` also exists in `srv/agents/invoice-matching/`.)*

4. **Test**: Restart `npm run watch`, open `http://localhost:4004/a2a/matching/preview/`, and test the 2-step flow:
   - **Step 1**: `Review INV-TEST-001 and INV-2026-011, and propose PO matches following AP policy` *(refuses `INV-TEST-001` due to Beta Corp block `Q` and notes the `+2.9%` variance on `INV-2026-011`)*
   - **Step 2**: `Approve the match decision for INV-2026-007` *(invokes `approve(decision: "INV-2026-007")` and pauses with the `[Approve] / [Reject]` HITL buttons!)*

---

## Phase 3 — Audit Log & Change Tracking (`Ex 6`)

1. Install governance plugins:
   ```bash
   npx cds add audit-logging
   npm add @cap-js/change-tracking
   ```

2. In your AI agent, run *(omit `/cap-developer` if not using Claude CLI)*:
   ```text
   /cap-developer Add GDPR @PersonalData annotations (Supplier view as DataSubject with ID as DataSubjectID and name as personal data; Invoices as Other referencing the supplier association as DataSubjectID, marking supplier and description as personal data). Enable @changelog on MatchDecisions outcome, confidence, and rationale.
   ```

3. **Redeploy `db.sqlite` *(Required)***:
   Adding `@changelog` on `MatchDecisions` pulls CAP's `com.sap.cds/change-tracking` model (`sap_changelog_Changes`, `sap_changelog_i18nKeys`, `sap_changelog_aspect`) into your schema, and `@cap-js/change-tracking` creates SQLite triggers and indexes on startup. Because `db.sqlite` was deployed before `@changelog` existed, `cds watch` will fail with a missing table error until you redeploy:
   ```bash
   npm run deploy
   # (runs: cds deploy --with-mocks)
   ```
   *(Note: Redeploying recreates `db.sqlite` from the CSV seed data, so any rows created at runtime earlier are reset.)*

4. **Test**: Restart `npm run watch` and verify both features:
   - **Test A — Field-Level Change Tracking (`@changelog`)**:
     1. Trigger a status transition on the seeded pending decision (`INV-2026-007 ↔ PO-1009`, ID `28070124-ce82-40ec-9832-2c6f88502da4`) using any of:
        - **React UI (`http://localhost:5173`)** with `npm --prefix app/matching run dev`: click **Approve** on the pending `INV-2026-007 ↔ PO-1009` decision,
        - **A2A Agent UI (`http://localhost:4004/a2a/matching/preview/`)**: ask `Approve the match decision for INV-2026-007` and click **Yes** on the HITL prompt, or
        - **Terminal (`curl`)**:
          ```bash
          curl -X POST "http://localhost:4004/odata/v4/matching/MatchDecisions(28070124-ce82-40ec-9832-2c6f88502da4)/InvoiceMatchingService.approve" \
            -H "Content-Type: application/json" -d '{}'
          ```
     2. Open either of these exact URLs in your browser (or via `curl`):
        - **All decisions with change history expanded**:
          `http://localhost:4004/odata/v4/matching/MatchDecisions?$expand=changes`
        - **Change history for that single decision only**:
          `http://localhost:4004/odata/v4/matching/MatchDecisions(28070124-ce82-40ec-9832-2c6f88502da4)/changes`
        *(Expect a change entry showing `"attribute": "outcome"`, `"modification": "update"`, `"valueChangedFrom": "P"`, `"valueChangedTo": "A"`, `createdAt`, and `createdBy`.)*
   - **Test B — GDPR Audit Logging (`@PersonalData`)**:
     1. In another terminal, `PATCH` the `description` of seeded invoice `INV-2026-001` (`41652952-6799-46fd-a81b-19cf7dd55d48`):
        ```bash
        curl -X PATCH "http://localhost:4004/odata/v4/matching/Invoices(41652952-6799-46fd-a81b-19cf7dd55d48)" \
          -H "Content-Type: application/json" \
          -d '{"description": "25x Lenovo ThinkPad E16 Gen 2 laptops - updated"}'
        ```
     2. Check your `npm run watch` terminal: verify `[audit-log] - PersonalDataModified:` prints with the linked supplier `data_subject` and the `old` vs `new` `description` values.

---

## Phase 4 — Deploy to SAP BTP Trial (`cf push` + SQLite + Mistral)

1. **Update `invoice-matching/package.json` for Cloud Foundry (`NODE_ENV=production`)**:
   Open `invoice-matching/package.json` and make sure these 4 sections match:
   - **`dependencies` vs `devDependencies`**: Move `@cap-js/sqlite`, `@cap-js/ai`, `@huggingface/hub`, `@huggingface/tokenizers`, and `onnxruntime-node` out of `devDependencies` into `dependencies` (Cloud Foundry skips `devDependencies` in production).
   - **`scripts.start`**: Change `"start": "cds-serve"` to `"start": "cds-serve --with-mocks"` so the imported S/4 Supplier data product (`sap.s4com.Supplier.v1`) runs in-process on Cloud Foundry and replicates `SupplierData` / `SupplierCompanyData` on startup.
   - **`engines`**: Add `"engines": { "node": "22.x" }` at top-level so Cloud Foundry's `nodejs_buildpack` selects Node 22 LTS (required by `onnxruntime-node`).
   - **`cds`**: Enable `"server": { "index": true }` (required so `/a2a/matching/preview/` and `/` stay enabled in `NODE_ENV=production`), `"features": { "with_mocks": true }` (required so `--with-mocks` is honored in production), and place `"audit-log"` and `"auth"` directly under `"cds" -> "requires"` (**not** nested inside `"db"`):
     ```json
     "scripts": {
       "start": "cds-serve --with-mocks",
       "watch": "cds watch --with-mocks",
       "deploy": "cds deploy --with-mocks"
     },
     "engines": {
       "node": "22.x"
     },
     "cds": {
       "server": {
         "index": true
       },
       "features": {
         "with_mocks": true
       },
       "requires": {
         "db": {
           "kind": "sqlite",
           "credentials": {
             "url": "db.sqlite"
           },
           "embedding": {
             "model": "sentence-transformers/all-MiniLM-L6-v2"
           }
         },
         "audit-log": {
           "kind": "audit-log-to-console"
         },
         "auth": {
           "kind": "mocked",
           "restrict_all_services": false
         },
         "sap.s4com.Supplier.v1": {
           "kind": "odata",
           "model": "sap-s4com-supplier-v1"
         },
         "llm": {
           "kind": "openai",
           "model": "mistral-large-latest",
           "credentials": {
             "baseURL": "https://api.mistral.ai/v1"
           }
         }
       }
     }
     ```

2. **Build React UI & pre-seed `db.sqlite`**:
   Run from `invoice-matching/`:
   ```bash
   npm --prefix app/matching run build
   npx cds deploy --to sqlite:db.sqlite
   ```
   *(Optional local sanity check: run `npm start`, open `http://localhost:4004/matching/dist/index.html` and `http://localhost:4004/a2a/matching/preview/`, then stop the server with `Ctrl+C` before running `cf push` so `db.sqlite` has no open WAL/SHM locks.)*

3. **Generate & edit `manifest.yml`, and create `.cfignore`**:
   - **3a. Generate `manifest.yml`** (if not generated yet):
     ```bash
     npx cds add cf-manifest
     ```
   - **3b. Edit `invoice-matching/manifest.yml`**:
     `npx cds add cf-manifest` defaults to `name: invoice-matching-srv` and `path: gen/srv` (which is for HANA MTA builds), and omits `stack:` (which defaults to deprecated `cflinuxfs4`). In addition, on `linux/x64`, `onnxruntime-node`'s postinstall script tries to download a **400 MB+ NVIDIA CUDA GPU NuGet package (`microsoft.ml.onnxruntime.gpu.linux`)**, which hits Cloud Foundry's 1 GB staging memory limit (`npm error code 137 / Killed`). Since the Linux x64 CPU binary is already bundled in the npm package, add `ONNXRUNTIME_NODE_INSTALL: skip` and `ONNXRUNTIME_NODE_INSTALL_CUDA: skip` under `env:`:
     ```yaml
     ---
     applications:
     - name: invoice-matching
       random-route: true
       path: .
       memory: 1G
       disk_quota: 2G
       buildpack: nodejs_buildpack
       stack: cflinuxfs5
       env:
         ONNXRUNTIME_NODE_INSTALL: skip
         ONNXRUNTIME_NODE_INSTALL_CUDA: skip
     ```
   - **3c. Create `invoice-matching/.cfignore` *(New File)***:
     `npx cds add cf-manifest` does **not** create `.cfignore`. When `.cfignore` is missing, `cf push` falls back to `.gitignore` — which contains `*.sqlite*` and would skip uploading `db.sqlite`! Create a new file `invoice-matching/.cfignore` with these exact lines:
     ```gitignore
     node_modules/
     app/*/node_modules/
     .env
     .env.*
     .git/
     .claude/
     .vibe/
     .vscode/
     .DS_Store
     *.sqlite-*
     sap-s4com-Supplier-v1.json
     app/matching/dist/matching.zip
     _DEMO_/
     ```
     *(Notice `*.sqlite` and `dist/` are intentionally **not** listed here, so both `db.sqlite` and `app/matching/dist/` are uploaded to Cloud Foundry.)*

4. **Verify CF authentication, push & inject Mistral secret on BTP Trial**:
   - **4a. Check active CF session** (`cf target` only reads local config and won't catch an expired OAuth token — run `cf apps` to test the live token):
     ```bash
     cf apps
     ```
     If it prints `The token expired, was revoked, or the token ID is incorrect`, re-authenticate (your API endpoint, org, and space are already saved, so no `-a` needed):
     ```bash
     cf login --sso
     # (or `cf login` if using email/password)
     ```
   - **4b. Push app (stopped), set Mistral env vars, and start**:
     Run from `invoice-matching/`:
     ```bash
     cf push --no-start
     cf set-env invoice-matching MISTRAL_API_KEY <YOUR_MISTRAL_API_KEY>
     cf set-env invoice-matching MISTRAL_BASE_URL https://api.mistral.ai/v1
     cf set-env invoice-matching MISTRAL_MODEL mistral-large-latest
     cf start invoice-matching
     ```

5. **Verify Live on BTP Trial**:
   - Find your live URL `<APP_URL>` in the output of `cf start invoice-matching` (or run `cf app invoice-matching` and copy the `routes:` URL, e.g. `https://invoice-matching-...cfapps.<region>.hana.ondemand.com`).
   - Open these exact live URLs in your browser:
     - **CAP Service Index**: `https://<APP_URL>/`
     - **React Matching UI**: `https://<APP_URL>/matching/dist/index.html`
     - **A2A Agent Preview UI**: `https://<APP_URL>/a2a/matching/preview/`
     - **OData MatchDecisions + Changes**: `https://<APP_URL>/odata/v4/matching/MatchDecisions?$expand=changes`
   - Check live container & audit logs from your terminal:
     ```bash
     cf logs invoice-matching --recent
     ```

---

## Phase 5 — Demo Script & SAP Community Blog Assets

- **Silent Screen Recording Storyboard + On-Screen Text Overlays (`~75s`)**: See [`invoice-matching/_DEMO_/DEMO-WALKTHROUGH.md`](./invoice-matching/_DEMO_/DEMO-WALKTHROUGH.md)
- **Full SAP Community Blog Post (5-Part Article + Production Upgrade Blueprint)**: See [`invoice-matching/_DEMO_/SAP-COMMUNITY-BLOG.md`](./invoice-matching/_DEMO_/SAP-COMMUNITY-BLOG.md)
