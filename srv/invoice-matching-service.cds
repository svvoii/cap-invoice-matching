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
