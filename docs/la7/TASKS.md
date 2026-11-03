# LA-7: Accounting and partners

**Module 7.** **Advanced** tier. Payout runs also come with the Partner Portal add-on. See the [roadmap](../roadmap/ROADMAP.md).

**Phase gate:** Ray pays a publisher through the platform from a statement they both see. The P&L shows **cost per issued policy against cost per persisting policy**, the "chargeback tax" Ray has never seen.

**Already built:**
- True CPA (`/app/true-cpa`).
- Vendor returns (`/app/vendor-returns`).
- Vendor cost and scorecard (LA-2.17).
- Partner quality (LA-1.18).
- Publisher records.

**Not built:** payouts, disputes, P&L and tax. `/app/payouts`, `/app/pnl` and `/app/tax` are ComingSoon menu items.

**Status of this file:** written from the product docs; re-verify paths at the start of the phase.

---

## LA-7.1: The money spine, as one view

**Goal:** "one row per money event": `lead_cost`, `payout`, `advance`, `earned`, `renewal`, `chargeback`, `adjustment`. Each row is tagged with policy, lead source and counterparty.

**Scope:**
- A read-only union (SQL view or service) over the computed ledger, accepted statement lines, campaign and list costs, and payout runs.
- No second stored ledger, to avoid two truths.

**Acceptance:**
- "What did a sale from Publisher A cost me?", "net profit this month" and "which carrier owes me" are each one query over the view.
- Totals equal the source modules' own totals.

## LA-7.2: Publisher contracts and payout runs

**Goal:** what each publisher is owed under their contract, minus disputed transfers, with a statement Ray can send.

**Scope:**
- Contract terms per publisher, in five models from day one, mixable two at a time: per transfer, per record, per sale, per issued policy, revenue share %.
- A payout run for a period: lines, disputed items held back, a total, and a printable statement.
- Mark the run as paid, recording the method and reference. Insurvas does not move money.

**Acceptance:**
- A run equals the sum of its lines.
- Disputed transfers are held back until resolved.
- A paid run is immutable; an adjustment becomes a new line in the next run.
- Partners see their own runs in the partner portal (requires LA-6.3 enforcement).

## LA-7.3: Transfer disputes

**Goal:** rejecting an unqualified transfer is a first-class feature.

**Scope:** a reject reason from the transfer or disposition screen, which:
- reverses the payout line;
- attaches evidence (call attempt, recording when it exists, the qualification criteria it failed);
- adds the transfer to a per-publisher dispute queue, which the partner sees.

**Acceptance:**
- A disputed transfer never appears in a payout run until it is resolved.
- Both sides see the same evidence.
- Every state change is audited.

## LA-7.4: Profit & loss

**Scope:** a monthly P&L with:
- money in: advances, earned and renewals, chargebacks;
- money out: lead spend by publisher and vendor, platform cost;
- net profit, cost per issued policy, and cost per persisting policy (using LA-4.8 persistency).

**Acceptance:**
- Every line drills into the money-spine rows behind it.
- Persisting cost uses the same cohort rule as LA-4.8.
- Bookkeeper and owner only.

## LA-7.5: Tax summaries

**Scope:**
- A year-end summary of commission income by carrier, deductible lead spend by vendor, and 1099-ready totals for publishers paid.
- CSV and PDF export.

**Acceptance:**
- Totals reconcile to the P&L for the same year.
- The export carries a "not tax advice" notice.
