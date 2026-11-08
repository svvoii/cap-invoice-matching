# Invoice Matching (CAP, Node.js)

CAP app for Maria, an AP clerk who matches incoming supplier invoices to open
purchase orders before releasing payment.

## Run (local dev, SQLite)

```sh
npm install
npm run deploy   # creates db.sqlite from db/ model + db/data CSVs (once / after model changes)
npm run watch    # or: npm start  -> http://localhost:4004
```

Both `deploy` and `watch` include `--with-mocks`: the imported S/4 Supplier
service (`apis/imported/sap-s4com-supplier-v1`) has no external binding, so CAP
serves it as an in-process mock backed by `db/data/sap.s4com.Supplier.v1-*.csv`.

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
  `cds add data --keys-only`. The `sap.s4com.Supplier.v1-*.csv` files are the
  mock master data for the imported S/4 Supplier data product: one supplier
  number per local supplier, with "Beta Corp" blocked for posting
  (payment blocking reason `Q` = quality issue / invoice dispute).

### S/4 supplier integration (Calesi)

- `apis/imported/sap-s4com-supplier-v1` — imported data product
  (`sap.s4com.Supplier.v1`) with the `Supplier` and `SupplierCompanyCode`
  entities; connected via `cds.requires` in `package.json` and mocked locally
  with `--with-mocks`.
- `db/schema.cds` — clean consumption views `SupplierData` and
  `SupplierCompanyData` (`@federated @cds.persistence.table`) project the S/4
  entities to domain names. `Suppliers` is extended with a `supplierNo` key and
  associations `s4` (master data) and `companyData` (company-code payment data).
- `srv/invoice-matching-service.js` — replicates the S/4 data into the local
  tables on server start, so invoices can join S/4 master data in plain SQL
  (delegation cannot support SQL joins across service boundaries). The S/4
  entities are exposed read-only as `SupplierData` / `SupplierCompanyData`.
- The React UI expands `supplier($expand=s4,companyData)` and shows the S/4
  supplier name, payment terms, and block warnings (blocked supplier / payment
  block reason) on each invoice and in the match form.

### Semantic search

- `@cap-js/ai` (dev dependency) computes vector embeddings **locally** with an
  ONNX model (`sentence-transformers/all-MiniLM-L6-v2`, pinned via
  `cds.requires.db.embedding.model`) — no external embedding service, and the
  same CQL runs unchanged on SAP HANA's vector engine in production. The model
  is derived from the invoice/PO text via stored calculated elements
  (`embedding : Vector = vector_embedding(...) stored`) in `db/schema.cds`, so
  it is recalculated on CREATE/UPDATE.
- Unbound functions on `InvoiceMatchingService` (also exposed over MCP at
  `/mcp/matching` via the `call` tool, and as OData V4 functions):
  - `searchMatches(query, k)` — semantic top-k across invoice descriptions and
    PO line items, ranked by cosine similarity of the stored embeddings.
  - `findMatches(invoice, k)` — potential PO matches for one invoice:
    `score = 0.7 · semantic similarity + 0.3 · amount proximity`, where
    amount proximity only counts for same-currency POs. Result rows flag
    `supplierMismatch` (for POs with an identical description from a different
    supplier — typically data-entry errors).

```sh
B=http://localhost:4004/odata/v4/matching
# via OData:
curl "$B/searchMatches(query='laptop%20computers')"
# via MCP (POST /mcp/matching):
#   tools/call -> call -> { action: 'searchMatches', parameters: { query: 'laptop computers', k: 5 } }
```

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
