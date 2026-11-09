import cds from '@sap/cds'

// Semantic-search configuration: the embedding model name is honored on SAP
// HANA; on SQLite, @cap-js/ai uses the local ONNX model (pinned in
// package.json#cds.requires.db.embedding.model).
const EMBEDDING_MODEL = 'SAP_GXY.20250407'
const MIN_SIMILARITY = 0.2
const SIMILARITY_WEIGHT = 0.7
const AMOUNT_WEIGHT = 0.3

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

    // Resolve an invoice or PO identifier (accepts either UUID or invoiceNo/poNo)
    const resolveInvoiceID = async ref => {
      if (!ref) return null
      const byId = await SELECT.one.from(Invoices).columns('ID').where({ ID: ref })
      if (byId) return byId.ID
      const byNo = await SELECT.one.from(Invoices).columns('ID').where({ invoiceNo: ref })
      return byNo?.ID ?? null
    }

    const resolvePOID = async ref => {
      if (!ref) return null
      const byId = await SELECT.one.from(PurchaseOrders).columns('ID').where({ ID: ref })
      if (byId) return byId.ID
      const byNo = await SELECT.one.from(PurchaseOrders).columns('ID').where({ poNo: ref })
      return byNo?.ID ?? null
    }

    // Resolve a MatchDecision by its own UUID, its invoice_ID, or an invoiceNo (e.g. 'INV-2026-007')
    const resolveDecision = async ref => {
      if (!ref) return null
      const byId = await SELECT.one.from(MatchDecisions).where({ ID: ref })
      if (byId) return byId
      const byInvId = await SELECT.one.from(MatchDecisions).where({ invoice_ID: ref })
      if (byInvId) return byInvId
      const invId = await resolveInvoiceID(ref)
      if (invId) return SELECT.one.from(MatchDecisions).where({ invoice_ID: invId })
      return null
    }

    // Unbound actions for @cap-js/mcp and @cap-js/agents (`srv.actions`)
    this.on('proposeMatch', async req => {
      const { invoice, purchaseOrder, confidence, rationale } = req.data
      const invoice_ID = await resolveInvoiceID(invoice)
      if (!invoice_ID) return req.reject(404, `Invoice '${invoice}' not found`)
      const purchaseOrder_ID = await resolvePOID(purchaseOrder)
      if (!purchaseOrder_ID) return req.reject(404, `PurchaseOrder '${purchaseOrder}' not found`)
      const existing = await SELECT.one.from(MatchDecisions).where({ invoice_ID, outcome: { in: ['P', 'A'] } })
      if (existing) return existing
      const entry = {
        ID: cds.utils.uuid(),
        invoice_ID,
        purchaseOrder_ID,
        confidence,
        rationale,
        outcome: 'P',
        decidedBy: req.user?.id || 'agent',
        decidedAt: new Date().toISOString(),
      }
      await INSERT.into(MatchDecisions).entries(entry)
      await syncInvoice(entry)
      return SELECT.one.from(MatchDecisions).where({ ID: entry.ID })
    })

    const transitionUnbound = (targetOutcome, allowedFrom) => async (req, next) => {
      // Bound call on MatchDecisions(ID)/action -> delegate to @flow.status generic handler
      if (req.subject) return next()
      const { decision: ref, rationale } = req.data
      const current = await resolveDecision(ref)
      if (!current) return req.reject(404, `MatchDecision for '${ref}' not found`)
      const ID = current.ID
      if (!allowedFrom.includes(current.outcome)) {
        return req.reject(409, `Cannot transition MatchDecision ${ID} from '${current.outcome}' to '${targetOutcome}'`)
      }
      const patch = {
        outcome: targetOutcome,
        decidedBy: req.user?.id || 'agent',
        decidedAt: new Date().toISOString(),
      }
      if (rationale) patch.rationale = rationale
      await UPDATE(MatchDecisions).set(patch).where({ ID })
      const updated = await SELECT.one.from(MatchDecisions).where({ ID })
      await syncInvoice(updated)
      return updated
    }

    this.on('approve', transitionUnbound('A', ['P']))
    this.on('reject', transitionUnbound('R', ['P']))
    this.on('escalate', transitionUnbound('E', ['P', 'A']))

    this.on('searchMatches', async req => {
      const { query, k } = req.data
      const top = Math.min(Number(k) || 5, 20)
      const [invoices, pos] = await Promise.all([
        SELECT.from(Invoices)
          .columns`ID, invoiceNo, description, amount, currency.code as currency,
              supplier.name as supplier,
              cosine_similarity (embedding, vector_embedding (${query}, 'QUERY', ${EMBEDDING_MODEL})) as similarity`
          .where`embedding is not null`,
        SELECT.from(PurchaseOrders)
          .columns`ID, poNo, lineItem, amount, currency.code as currency,
              supplier.name as supplier,
              cosine_similarity (embedding, vector_embedding (${query}, 'QUERY', ${EMBEDDING_MODEL})) as similarity`
          .where`embedding is not null`,
      ])
      return [...invoices, ...pos]
        .filter(m => m.similarity >= MIN_SIMILARITY)
        .sort((a, b) => b.similarity - a.similarity)
        .slice(0, top)
        .map(m => ({
          entity: m.invoiceNo ? 'Invoices' : 'PurchaseOrders',
          ID: m.ID,
          invoiceNo: m.invoiceNo ?? null,
          poNo: m.poNo ?? null,
          supplier: m.supplier,
          text: m.description ?? m.lineItem,
          amount: m.amount,
          currency: m.currency,
          similarity: m.similarity,
        }))
    })

    this.on('findMatches', async req => {
      const { invoice: invoiceRef, k } = req.data
      const top = Math.min(Number(k) || 5, 20)
      const invoiceID = await resolveInvoiceID(invoiceRef)
      const invoice = invoiceID && await SELECT.one.from(Invoices)
        .columns`ID, invoiceNo, description, amount, currency.code as currency, supplier.ID as supplierID`
        .where({ ID: invoiceID })
      if (!invoice) return req.reject(404, `Invoice ${invoiceRef} unknown`)
      const candidates = await SELECT.from(PurchaseOrders)
        .columns`ID, poNo, lineItem, amount, currency.code as currency, supplier.ID as supplierID, supplier.name as supplier,
            cosine_similarity (embedding, vector_embedding (${invoice.description}, 'QUERY', ${EMBEDDING_MODEL})) as similarity`
        .where`embedding is not null`
      return candidates
        .filter(m => m.similarity >= MIN_SIMILARITY)
        .map(po => {
          const amountProximity = po.currency === invoice.currency
            ? Math.max(0, 1 - Math.abs(po.amount - invoice.amount) / Math.max(po.amount, invoice.amount))
            : 0
          return {
            ID: po.ID,
            poNo: po.poNo,
            supplier: po.supplier,
            lineItem: po.lineItem,
            amount: po.amount,
            currency: po.currency,
            similarity: po.similarity,
            amountProximity,
            supplierMismatch: po.supplierID !== invoice.supplierID,
            score: SIMILARITY_WEIGHT * po.similarity + AMOUNT_WEIGHT * amountProximity,
          }
        })
        .sort((a, b) => b.score - a.score)
        .slice(0, top)
    })

    // Replicate after the server is up, when cds-serve has registered the
    // in-process mock for the (unbound) external service.
    cds.once('listening', () => this._replicateSupplierData())

    return super.init()
  }

  /**
   * Replicates the S/4 Supplier data product (imported under
   * apis/imported/sap-s4com-supplier-v1) into the local persistence tables
   * SupplierData / SupplierCompanyData, so invoices can join S/4 supplier
   * master data in plain SQL. Idempotent full upsert; failures are logged
   * and skipped so the service still starts without the remote service.
   */
  async _replicateSupplierData () {
    try {
      const s4 = await cds.connect.to('sap.s4com.Supplier.v1')
      const { Supplier, SupplierCompanyCode } = cds.entities('sap.s4com.Supplier.v1')
      const { SupplierData, SupplierCompanyData } = cds.entities('invoice.matching')
      const [suppliers, companyData] = await Promise.all([
        s4.run(SELECT.from(Supplier)),
        s4.run(SELECT.from(SupplierCompanyCode)),
      ])
      await UPSERT(suppliers.map(({ Supplier: supplierNo, SupplierName: name, CityName: city, Country: country }) =>
        ({ supplierNo, name, city, country }))).into(SupplierData)
      await UPSERT(companyData.map(({ Supplier: supplierNo, CompanyCode: companyCode, CompanyCodeName: companyCodeName, PaymentTerms: paymentTerms, SupplierIsBlockedForPosting: postingIsBlocked, PaymentBlockingReason: paymentBlockingReason }) =>
        ({ supplierNo, companyCode, companyCodeName, paymentTerms, postingIsBlocked, paymentBlockingReason }))).into(SupplierCompanyData)
      cds.log('invoice-matching').info(
        `Replicated ${suppliers.length} supplier(s) and ${companyData.length} company-code record(s) from sap.s4com.Supplier.v1`)
    } catch (e) {
      cds.log('invoice-matching').warn('Skipping S/4 supplier data replication:', e.message)
    }
  }
}
