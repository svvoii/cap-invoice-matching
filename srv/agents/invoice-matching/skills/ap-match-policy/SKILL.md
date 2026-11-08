---
name: ap-match-policy
description: >
  Accounts-payable matching policy for proposing and confirming PO matches
  for supplier invoices. Defines amount-variance rules, ranking order,
  blocked-supplier handling, and the required rationale format.
metadata:
  tags: [invoice-matching, accounts-payable, matching, hitl]
  examples:
    - Propose a PO match for invoice INV-2026-011
    - Which open POs match INV-TEST-001 and may it be approved?
    - Review the match proposal for the invoice from Beta Corp
---

# Skill: AP Match Policy

## When to Use

- The user asks to find, propose, or confirm a PO match for a supplier invoice.
- A match decision is being drafted (CREATE on `MatchDecisions`) or a
  proposed decision is about to be acted on via `approve`, `reject`, or `escalate`.

## Instructions

1. Find candidate POs with `findMatches(invoice=<invoice ID>)`. It returns,
   per candidate: `similarity` (semantic), `amountProximity` (0..1),
   combined `score`, and `supplierMismatch`.

2. **Rank by exact signals first, semantic second.** A candidate with the
   same supplier and a near-identical amount outranks a candidate whose
   only strength is high semantic similarity. Never let high semantic
   similarity outweigh a diverging amount or a different supplier.

3. Apply the amount-variance rules to `|invoice.amount - po.amount|` in the
   invoice's currency:

   | Variance | Classification | Allowed action |
   |---|---|---|
   | ≤ 2% | clean match | propose `approve` |
   | > 2% to 5% | price variance | propose `approve` only with a price-variance note in the rationale |
   | > 5% | material variance | propose `escalate`; never propose `approve` |

4. **Blocked supplier check first.** Before proposing any confirm, look up the
   invoice's supplier in `SupplierCompanyData`
   (`postingIsBlocked` / `paymentBlockingReason`). If the posting is blocked:
   never propose `approve`, regardless of match quality. Set the outcome to
   `escalate` and flag the blocking reason prominently in the rationale
   (that is what echoes back to the human approver in the HITL pause).

5. Record the decision as one proposal (`confidence` 0–100, `outcome`
   `proposed`) and let the human approve it. `approve` is HITL-gated
   (`@agent.hitl`): the task pauses for human confirmation before the
   action runs. Never attempt to bypass or re-submit the action to force it.

6. **Rationale format:** 1–2 actionable sentences stating the matched signals
   — supplier, amount, currency, and line-item similarity, e.g.
   "Supplier and amount match PO-1011 exactly (0 EUR variance); approving
   PO-1011 closes the invoice."
   Do not pad with analysis of rejected candidates.

## Notes

- "Confirm" always means: propose the decision, then (after human approval
  of the HITL pause) the `approve` action transitions the outcome.
- Currency mismatches are a material variance: treat like > 5% and escalate.
- If no candidate passes the variance table, say so and escalate; do not
  invent a match.
- Seeded test data: `INV-TEST-001` (blocked supplier Beta Corp, exact match)
  must escalate; `INV-2026-011` (+2.9%) needs a price-variance note;
  `INV-2026-012` (+6.0%) must escalate.
