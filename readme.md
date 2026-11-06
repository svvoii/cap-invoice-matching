# Invoice Matching (CAP, Node.js)

CAP app for Maria, an AP clerk who matches incoming supplier invoices to open
purchase orders before releasing payment.

## Run (local dev, SQLite)

```sh
npm install
npm run deploy   # creates db.sqlite from db/ model + db/data CSVs (once / after model changes)
npm run watch    # or: npm start  -> http://localhost:4004
```

Service: `InvoiceMatchingService` at `/odata/v4/matching` (`@path: 'matching'`).

## UI

`app/matching/` is a small React + Vite app (no routing, no state library — plain
`useState`/`fetch`):

```sh
npm run watch                     # CAP on :4004, from the project root
cd app/matching && npm run dev    # UI on :5173, proxies /odata -> :4004
```

Open http://localhost:5173 — left panel: open invoices, right panel: open POs,
below: "Record match" form (once one of each is selected) and "Pending decisions"
with Approve/Reject (the CAP bound actions). `npm run build` in `app/matching`
produces `dist/` for serving via CAP.

## Model

- `db/schema.cds` — domain model (`invoice.matching`):
  - `Suppliers`, `Invoices` (supplier, amount + currency, description, status
    `open|matched|escalated`, `matchedPO`), `PurchaseOrders` (supplier, line item,
    amount, `isOpen`), `MatchDecisions` (invoice, PO, confidence, rationale,
    outcome, `decidedBy` / `decidedAt` via `@cds.on.insert`).
  - Declarative `@assert` constraints (i18n keys in `_i18n/messages.properties`):
    positive amounts, confidence 0–100, rationale min length, referenced
    invoice/PO/supplier must exist, an invoice/PO that already has a non-rejected
    decision cannot be matched again, invoice and PO must belong to the same
    supplier, `matchedPO` only on matched invoices.
- `srv/invoice-matching-service.cds` — projections + `@flow.status` status flow on
  `MatchDecisions.outcome` with bound actions `approve` / `reject` / `escalate`:
  `proposed -> approved | rejected | escalated`, `approved -> escalated` only,
  `rejected`/`escalated` final. Invalid transitions are rejected with `409`.
- `srv/invoice-matching-service.js` — the only custom logic: syncs the invoice
  (`status`, `matchedPO`) and PO (`isOpen`) when a decision outcome changes.
- `db/data/*.csv` — sample data (office furniture and laptops), keys generated via
  `cds add data --keys-only`.

## API examples

```sh
B=http://localhost:4004/odata/v4/matching
# side-by-side view: invoices next to open POs
curl "$B/Invoices?\$expand=supplier,matchedPO"
curl "$B/OpenPurchaseOrders"
# record a match decision (outcome defaults to 'proposed', decidedBy/decidedAt are set automatically)
curl -X POST "$B/MatchDecisions" -H 'Content-Type: application/json' -d '{
  "invoice_ID": "<invoice UUID>", "purchaseOrder_ID": "<PO UUID>",
  "confidence": 95, "rationale": "Amount and line items match the PO."}'
# workflow transitions (enforced by the status flow)
curl -X POST "$B/MatchDecisions(<decision UUID>)/approve"
curl -X POST "$B/MatchDecisions(<decision UUID>)/reject"
curl -X POST "$B/MatchDecisions(<decision UUID>)/escalate"
```
