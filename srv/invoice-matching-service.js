import cds from '@sap/cds'

export class InvoiceMatchingService extends cds.ApplicationService {
  async init () {
    const { Invoices, PurchaseOrders, MatchDecisions } = this.entities

    /**
     * Side effect (the only custom logic needed): keep the invoice
     * (status, matchedPO) and the PO (isOpen) in sync with the outcome of a
     * match decision:
     *   proposed/approved/escalated ('P'/'A'/'E') -> invoice matched ('M') +
     *     matchedPO set, PO closed (isOpen = false)
     *   rejected ('R')                           -> invoice back to 'O' +
     *     matchedPO cleared, PO reopened (isOpen = true)
     * All validation is declarative (@assert in db/schema.cds, @flow.status
     * transitions in invoice-matching-service.cds); flow actions change the
     * decision's outcome via UPDATE, so they are covered here, too.
     */
    const syncInvoice = async decision => {
      if (!decision?.invoice_ID) return
      const rejected = decision.outcome === 'R'
      await UPDATE(Invoices)
        .set({ status: rejected ? 'O' : 'M', matchedPO_ID: rejected ? null : decision.purchaseOrder_ID })
        .where({ ID: decision.invoice_ID })
      if (decision.purchaseOrder_ID) {
        await UPDATE(PurchaseOrders).set({ isOpen: rejected }).where({ ID: decision.purchaseOrder_ID })
      }
    }

    const syncFromSubject = async req => {
      const decision = await SELECT.one.from(req.subject)
        .columns('ID', 'invoice_ID', 'purchaseOrder_ID', 'outcome')
      if (decision) await syncInvoice(decision)
    }

    this.after('CREATE', MatchDecisions, async (res, req) => {
      const ID = res?.ID ?? req.data?.ID
      if (ID) {
        const decision = await SELECT.one.from(MatchDecisions).where({ ID })
          .columns('ID', 'invoice_ID', 'purchaseOrder_ID', 'outcome')
        if (decision) await syncInvoice(decision)
      }
    })

    this.after('UPDATE', MatchDecisions, async (res, req) => syncFromSubject(req))

    // flow transitions (approve/reject/escalate) update the outcome internally,
    // so hook the actions as well
    for (const action of ['approve', 'reject', 'escalate']) {
      this.after(action, MatchDecisions, async (res, req) => syncFromSubject(req))
    }

    return super.init()
  }
}
