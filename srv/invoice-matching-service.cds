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
    invoice : UUID @mandatory,
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
    action approve();
    action reject();
    action escalate();
  }
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

annotate InvoiceMatchingService with @odata @mcp;

