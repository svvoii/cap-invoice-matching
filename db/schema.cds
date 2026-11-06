using {
  Currency,
  User,
  cuid
} from '@sap/cds/common';

namespace invoice.matching;

/**
 * Lifecycle of a supplier invoice in the matching process.
 * Driven by match decisions (see MatchDecisions).
 */
type InvoiceStatus : String enum {
  open      = 'O';
  matched   = 'M';
  escalated = 'E';
}

/**
 * Outcome of a match decision. Flow-controlled via @flow.status
 * in srv/invoice-matching-service.cds:
 * proposed -> approved | rejected | escalated, approved -> escalated only,
 * rejected and escalated are final.
 */
type DecisionOutcome : String enum {
  proposed  = 'P';
  approved  = 'A';
  rejected  = 'R';
  escalated = 'E';
}

entity Suppliers : cuid {
  name    : String(100) @mandatory;
  email   : String      @mandatory;
  country : String(2);
}

entity Invoices : cuid {
  invoiceNo   : String(20)      @mandatory;
  supplier    : Association to Suppliers @mandatory
                  @assert: (case
                    when not exists supplier then 'ASSERT_SUPPLIER_UNKNOWN'
                  end);
  description : String(255)     @mandatory;
  amount      : Decimal(15, 2)  @mandatory @assert.range: [ (0), _ ];
  currency    : Currency        @mandatory;
  status      : InvoiceStatus   @readonly default #open;
  matchedPO   : Association to PurchaseOrders
                  @assert: (case
                    when status <> #matched and matchedPO is not null
                      then 'ASSERT_MATCHED_PO_REQUIRES_MATCHED'
                  end);
}

entity PurchaseOrders : cuid {
  poNo     : String(20)     @mandatory;
  supplier : Association to Suppliers @mandatory
               @assert: (case
                 when not exists supplier then 'ASSERT_SUPPLIER_UNKNOWN'
               end);
  lineItem : String(255)    @mandatory;
  amount   : Decimal(15, 2) @mandatory @assert.range: [ (0), _ ];
  currency : Currency       @mandatory;
  isOpen   : Boolean        @mandatory default true;
}

entity MatchDecisions : cuid {
  invoice : Association to Invoices @mandatory
              @assert: (case
                when not exists invoice then 'ASSERT_INVOICE_UNKNOWN'
                when exists invoice [ status <> #open ] then 'ASSERT_INVOICE_NOT_OPEN'
              end);
  purchaseOrder : Association to PurchaseOrders @mandatory
              @assert: (case
                when not exists purchaseOrder then 'ASSERT_PO_UNKNOWN'
                when exists purchaseOrder [ isOpen = false ] then 'ASSERT_PO_CLOSED'
                when purchaseOrder.supplier <> invoice.supplier then 'ASSERT_SUPPLIER_MISMATCH'
              end);
  confidence : Integer @mandatory @assert.range: [ 0, 100 ];
  rationale  : String(1000) @mandatory
              @assert: (case
                when length(rationale) < 10 then 'ASSERT_RATIONALE_TOO_SHORT'
              end);
  outcome    : DecisionOutcome @readonly default #proposed;
  decidedBy  : User      @cds.on.insert: $user;
  decidedAt  : Timestamp @cds.on.insert: $now;
}
