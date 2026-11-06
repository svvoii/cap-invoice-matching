import cds from '@sap/cds'

export class InvoiceMatchingService extends cds.ApplicationService {
  async init () {
    const { Invoices, PurchaseOrders, MatchDecisions } = this.entities

    /**
     * Side effect (the only custom logic needed): keep the invoice
     * (status, matchedPO) and the PO (isOpen) in sync with the outcome of a
     * match decision. All validation is declarative (@assert in db/schema.cds,
     * @flow.status transitions in invoice-matching-service.cds); flow actions
     * change the decision's outcome via UPDATE, so they are covered here, too.
     */
    const syncInvoice = async decision => {
      if (!decision?.invoice_ID) return
      let status, matchedPO_ID, poIsOpen
      if (decision.outcome === 'A') {
        status = 'M'; matchedPO_ID = decision.purchaseOrder_ID; poIsOpen = false
      } else if (decision.outcome === 'E') {
        status = 'E'; matchedPO_ID = null; poIsOpen = true
      } else {
        const approved = await SELECT.one.from(MatchDecisions).columns('ID')
          .where({ invoice_ID: decision.invoice_ID, outcome: 'A' })
        if (approved) return // an approved decision still stands for this invoice
        status = 'O'; matchedPO_ID = null
      }
      await UPDATE(Invoices).set({ status, matchedPO_ID }).where({ ID: decision.invoice_ID })
      if (poIsOpen !== undefined && decision.purchaseOrder_ID) {
        await UPDATE(PurchaseOrders).set({ isOpen: poIsOpen }).where({ ID: decision.purchaseOrder_ID })
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
