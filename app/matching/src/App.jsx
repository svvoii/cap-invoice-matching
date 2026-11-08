import { useCallback, useEffect, useState } from 'react'
import './App.css'

const BASE = '/odata/v4/matching'

// SAP payment-term codes as seeded in the mock data (sap.s4com.Supplier.v1)
const PAYMENT_TERMS = {
  '0001': 'Payable immediately',
  'ZT14': 'Net 14 days',
  'ZT30': 'Net 30 days',
  'ZT60': 'Net 60 days'
}

// Payment block reason codes (company-code supplier master data)
const PAYMENT_BLOCK_REASONS = {
  Q: 'Quality issue - invoice dispute'
}

/**
 * Supplier payment master data from the S/4 Supplier data product, reached
 * via invoice -> supplier -> s4 / companyData (replicated on the server).
 */
function supplierPaymentInfo (inv) {
  const company = inv.supplier?.companyData?.[0]
  if (!company) return null
  return {
    name: inv.supplier?.s4?.name ?? inv.supplier?.name,
    terms: company.paymentTerms && (PAYMENT_TERMS[company.paymentTerms] ?? `Payment terms ${company.paymentTerms}`),
    blockingReason: company.paymentBlockingReason &&
      (PAYMENT_BLOCK_REASONS[company.paymentBlockingReason] ?? `Reason: ${company.paymentBlockingReason}`),
    postingBlocked: company.postingIsBlocked === true
  }
}

async function api (path, options) {
  const res = await fetch(BASE + path, options)
  if (!res.ok) {
    let text = `${res.status} ${res.statusText}`
    try {
      const d = await res.json()
      if (d.error) text = d.error.message + (d.error.code ? ` (${d.error.code})` : '')
    } catch { /* keep status text */ }
    throw new Error(text)
  }
  return res.status === 204 ? null : res.json()
}

export default function App () {
  const [invoices, setInvoices] = useState([])
  const [pos, setPOs] = useState([])
  const [decisions, setDecisions] = useState([])
  const [selectedInvoice, setSelectedInvoice] = useState(null)
  const [selectedPO, setSelectedPO] = useState(null)
  const [confidence, setConfidence] = useState(90)
  const [rationale, setRationale] = useState('Amount, currency and line items match the PO.')
  const [msg, setMsg] = useState(null)

  const refresh = useCallback(async () => {
    try {
      const [inv, po, dec] = await Promise.all([
        api("/Invoices?$filter=status eq 'O'&$select=ID,invoiceNo,description,amount,currency_code&$expand=supplier($expand=s4,companyData)"),
        api("/PurchaseOrders?$filter=isOpen eq true&$select=ID,poNo,lineItem,amount,currency_code&$expand=supplier"),
        api("/MatchDecisions?$filter=outcome eq 'P'&$select=ID,confidence,rationale&$expand=invoice,purchaseOrder")
      ])
      setInvoices(inv.value)
      setPOs(po.value)
      setDecisions(dec.value)
    } catch (e) {
      setMsg({ text: e.message, error: true })
    }
  }, [])

  useEffect(() => { refresh() }, [refresh])

  async function recordMatch () {
    if (!selectedInvoice || !selectedPO) return
    const conf = Number(confidence)
    if (!(Number.isInteger(conf) && conf >= 0 && conf <= 100)) {
      return setMsg({ text: 'Confidence must be an integer between 0 and 100', error: true })
    }
    if (rationale.trim().length < 10) {
      return setMsg({ text: 'Rationale must be at least 10 characters', error: true })
    }
    try {
      // outcome is @readonly and defaults to 'proposed' ('P') on the server
      await api('/MatchDecisions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          invoice_ID: selectedInvoice,
          purchaseOrder_ID: selectedPO,
          confidence: conf,
          rationale
        })
      })
      setMsg({ text: 'Match decision recorded as proposed' })
      setSelectedInvoice(null)
      setSelectedPO(null)
      await refresh()
    } catch (e) {
      setMsg({ text: e.message, error: true })
    }
  }

  async function decide (id, action) {
    try {
      await api(`/MatchDecisions(${id})/${action}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: '{}'
      })
      setMsg({ text: `Decision ${action === 'approve' ? 'approved' : 'rejected'}` })
      await refresh()
    } catch (e) {
      setMsg({ text: e.message, error: true })
    }
  }

  const selInv = invoices.find(i => i.ID === selectedInvoice)
  const selPO = pos.find(p => p.ID === selectedPO)
  const selPay = selInv && supplierPaymentInfo(selInv)
  const selBlocked = selPay && (selPay.postingBlocked || selPay.blockingReason)

  return (
    <>
      <h1>Invoice Matching</h1>
      {msg && <div id="msg" className={msg.error ? 'error' : 'ok'}>{msg.text}</div>}

      <div className="panels">
        <section className="panel">
          <h2>Open invoices</h2>
          <ul>
            {invoices.length === 0 && <li className="dim">No open invoices</li>}
            {invoices.map(inv => {
              const pay = supplierPaymentInfo(inv)
              return (
                <li key={inv.ID}
                    className={inv.ID === selectedInvoice ? 'selected' : ''}
                    onClick={() => setSelectedInvoice(inv.ID === selectedInvoice ? null : inv.ID)}>
                  <strong>{inv.invoiceNo}</strong> &middot; {pay?.name}<br />
                  {inv.amount} {inv.currency_code}<br />
                  {pay?.terms && <span className="dim">Payment terms: {pay.terms}</span>}
                  {pay?.postingBlocked && (
                    <span className="warning">Supplier blocked for posting — do not release payment</span>
                  )}
                  {pay?.blockingReason && (
                    <span className="warning">Payment block: {pay.blockingReason}</span>
                  )}<br />
                  <span className="dim">{inv.description}</span>
                </li>
              )
            })}
          </ul>
        </section>

        <section className="panel">
          <h2>Open purchase orders</h2>
          <ul>
            {pos.length === 0 && <li className="dim">No open purchase orders</li>}
            {pos.map(po => (
              <li key={po.ID}
                  className={po.ID === selectedPO ? 'selected' : ''}
                  onClick={() => setSelectedPO(po.ID === selectedPO ? null : po.ID)}>
                <strong>{po.poNo}</strong> &middot; {po.supplier?.name}<br />
                {po.amount} {po.currency_code}<br />
                <span className="dim">{po.lineItem}</span>
              </li>
            ))}
          </ul>
        </section>
      </div>

      {selectedInvoice && selectedPO && (
        <section id="match-form">
          <h2>Record match</h2>
          <div className="dim">
            Invoice: {selInv?.invoiceNo} &mdash; PO: {selPO?.poNo}
          </div>
          {selBlocked && (
            <div className="warning">
              Supplier {selPay.name} is blocked: {selPay.blockingReason ?? 'posting block'} — consider escalating
            </div>
          )}
          <label htmlFor="confidence">Confidence (0&ndash;100)</label>
          <input id="confidence" type="number" min="0" max="100" step="1"
                 value={confidence} onChange={e => setConfidence(e.target.value)} />
          <label htmlFor="rationale">Rationale (min. 10 characters)</label>
          <textarea id="rationale" value={rationale} onChange={e => setRationale(e.target.value)} />
          <div className="form-actions">
            <button onClick={recordMatch}>Record Match</button>
          </div>
        </section>
      )}

      <section id="pending">
        <h2>Pending decisions</h2>
        <ul>
          {decisions.length === 0 && <li className="dim">No pending decisions</li>}
          {decisions.map(dec => (
            <li key={dec.ID}>
              <span className="dim">{dec.invoice?.description}</span><br />
              &harr; <span className="dim">{dec.purchaseOrder?.lineItem}</span><br />
              Confidence: <strong>{dec.confidence}</strong><br />
              <span className="dim">{dec.rationale}</span>
              <div className="actions">
                <button onClick={() => decide(dec.ID, 'approve')}>Approve</button>
                <button className="secondary" onClick={() => decide(dec.ID, 'reject')}>Reject</button>
              </div>
            </li>
          ))}
        </ul>
      </section>
    </>
  )
}
