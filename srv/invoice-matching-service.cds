using { invoice.matching as db } from '../db/schema';

@path: 'matching'
service InvoiceMatchingService {

  entity Suppliers as projection on db.Suppliers;

  /** Incoming supplier invoices, incl. the PO they were matched to (if any). */
  entity Invoices as projection on db.Invoices;

  @cds.redirection.target
  entity PurchaseOrders as projection on db.PurchaseOrders;

  /** Convenience view for Maria's side-by-side matching screen: open POs only. */
  entity OpenPurchaseOrders as select from db.PurchaseOrders where isOpen = true;

  /** S/4 supplier master data (replicated from the imported data product). */
  @readonly entity SupplierData as projection on db.SupplierData;

  /** S/4 supplier company-code data: payment terms and block indicators. */
  @readonly entity SupplierCompanyData as projection on db.SupplierCompanyData;

  /**
   * Semantic search across invoice descriptions and PO line items, ranked by
   * cosine similarity of local vector embeddings. Runs over MCP via the
   * `call` tool (unbound function).
   */
  function searchMatches (
    query : String(200) @mandatory,
    k     : Integer default 5,
  ) returns array of {
    entity     : String(20);
    ID         : UUID;
    invoiceNo  : String(20);
    poNo       : String(20);
    supplier   : String(100);
    text       : String(255);
    amount     : Decimal(15,2);
    currency   : String(3);
    similarity : Double;
  };

  /**
   * Potential PO matches for one invoice: semantic similarity of the invoice
   * description vs PO line items, combined with amount proximity. Runs over
   * MCP via the `call` tool (unbound function).
   */
  function findMatches (
    /** Invoice UUID or invoiceNo (e.g. 'INV-TEST-001', 'INV-2026-011') */
    invoice : String(50) @mandatory,
    k       : Integer default 5,
  ) returns array of {
    ID              : UUID;
    poNo            : String(20);
    supplier        : String(100);
    lineItem        : String(255);
    amount          : Decimal(15,2);
    currency        : String(3);
    similarity      : Double;
    amountProximity : Double;
    score           : Double;
    supplierMismatch: Boolean;
  };

  entity MatchDecisions as projection on db.MatchDecisions actions {
    @agent.hitl action approve();
    action reject();
    action escalate();
  };

  /**
   * Unbound service-level actions exposed via @cap-js/mcp and @cap-js/agents
   * (`srv.actions`). Accept either UUIDs or human-readable numbers
   * (e.g. 'INV-2026-007', 'PO-1012'). Bound actions on MatchDecisions remain
   * for the OData V4 React UI.
   */
  action proposeMatch (
    /** Invoice UUID or invoiceNo (e.g. 'INV-2026-011') */
    invoice       : String(50) @mandatory,
    /** PurchaseOrder UUID or poNo (e.g. 'PO-1012') */
    purchaseOrder : String(50) @mandatory,
    confidence    : Integer @mandatory,
    rationale     : String(500) @mandatory,
  ) returns MatchDecisions;

  @agent.hitl
  action approve (
    /** MatchDecision UUID, Invoice UUID, or invoiceNo (e.g. 'INV-2026-007') */
    decision : String(50) @mandatory,
  ) returns MatchDecisions;

  action reject (
    /** MatchDecision UUID, Invoice UUID, or invoiceNo (e.g. 'INV-2026-007') */
    decision  : String(50) @mandatory,
    rationale : String(500),
  ) returns MatchDecisions;

  action escalate (
    /** MatchDecision UUID, Invoice UUID, or invoiceNo (e.g. 'INV-TEST-001') */
    decision  : String(50) @mandatory,
    rationale : String(500),
  ) returns MatchDecisions;
}

/**
 * Status-transition flow for match decisions (cap status-flows):
 * a proposed decision can be approved, rejected, or escalated;
 * an approved decision can only be escalated;
 * rejected and escalated are final.
 * Entry states are validated (409 on invalid transitions) and the target
 * state is applied automatically by CAP's generic flow handlers.
 */
annotate InvoiceMatchingService.MatchDecisions with @flow.status: outcome actions {
  approve  @from: [ #proposed ]            @to: #approved;
  reject   @from: [ #proposed ]            @to: #rejected;
  escalate @from: [ #proposed, #approved ] @to: #escalated;
}

annotate InvoiceMatchingService with @odata @mcp @agent;

