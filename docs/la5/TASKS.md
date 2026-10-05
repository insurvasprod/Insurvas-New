# LA-5: Retention

**Module 5.** **Advanced** tier ($449, code `advance`). See the [roadmap](../roadmap/ROADMAP.md).

> Ledger tells Ray he *was* charged back $1,040 last month. Advanced tells him a policy *will* charge back in 40 days unless he acts.

**Phase gate:** on seeded history, the radar flags at least half the policies that later lapsed, 30 or more days before they lapsed, and every flag shows the reasons behind its score.

**Today:**
- `/app/lapse-risk` is a board of manually recorded signals. `lib/lapseRisk/model.ts` says "There is no score".
- The `chargeback_radar` feature is labelled "Predictive lapse scoring".
- `payment_repair` and `winback` are menu items with no code.

**Depends on:** LA-4.7 (reliable lapse dates), LA-4.8 (persistency by carrier and lead source), and the LA-3.9 draft-date optimiser (deposit schedules).

**Status of this file:** written from the product docs. The paths are the expected ones; re-verify them against the code at the start of the phase, as was done for LA-4.

---

## LA-5.1: Lapse-risk score

**Goal:** score every in-force policy still inside its clawback window, explainably, with no ML provider and no AI.

**Scope:** a pure `lib/lapseRisk/score.ts`. Each signal's weight is documented and configurable per tenant. The signals:

| Signal | Why it predicts a lapse |
|---|---|
| Draft day relative to the benefit deposit | Uses `lib/draftDates/optimiser.ts`. The biggest single signal |
| Payment method | Direct Express or a card lapses more than a bank draft |
| Months since issue | Months 2–5 are the danger zone |
| Premium as a share of stated income | From the interview `annual_income` answer |
| Failed or retried drafts | From statements and manual signals |
| Lead-source and carrier persistency | From LA-4.8 |

**Output:** a score from 0–100, a band (low/medium/high) and the contributing reasons, in plain words.

**Acceptance:**
- Deterministic for the same inputs.
- Each reason is shown with its points.
- Every policy outside its clawback window, or not in force, scores none.
- Unit tests cover each signal and the boundaries.
- Until 5.1 ships, `chargeback_radar` is relabelled from "Predictive lapse scoring" to say what it is today.

## LA-5.2: Chargeback radar queue

**Goal:** a work queue ordered by exposure, built on **day 25 of each month**: before the draft, not after the lapse notice.

**Scope:**
- A scheduled job (pg_cron + app side effects, the same pattern as the unclaimed-SLA ladder) snapshots the queue.
- Page `/app/lapse-risk` becomes "At risk — act before {date}".
- Each row shows the score band, dollar exposure, reasons and actions: **Call**, **Change draft date**, **Update bank**, **Switch to bank draft**.
- Alerts go out through the existing notification centre (LA-1.25).

**Acceptance:**
- The queue is ordered by exposure in cents.
- An action taken is logged against the policy.
- The job is idempotent and visible in the job monitor (SA-6.1 when built).
- Assistants can work the queue, but see no dollar amounts.

## LA-5.3: Payment-repair workflow

**Goal:** turn Ray's unstructured 40-minute phone call into a logged 4-minute flow.

**Scope:**
1. Call the customer.
2. Capture updated bank or card details, reusing the LA-3.19 payment form, its validation and its encryption.
3. Optionally move the draft day, using the optimiser's recommendation.
4. Record the change submitted to the carrier.
5. Track it to confirmation: `open` → `submitted` → `confirmed` / `failed`.

**Acceptance:**
- CVV is never stored, and bank numbers are encrypted and masked, as in LA-3.
- Every step is on the policy timeline.
- A repair that is still open after N days appears again in the radar.

## LA-5.4: Win-back

**Goal:** lapsed policies inside the carrier's reinstatement window (often 30–90 days) are put in front of Ray, with a one-click campaign.

**Scope:**
- A reinstatement window on carrier products, editable in Settings › Sales.
- A win-back list.
- One click creates an outbound campaign from the selected policies, reusing the LA-2 campaign, queue and cadence machinery and respecting DNC and calling windows.

**Acceptance:**
- Only policies inside their window are listed, with the days left.
- The campaign goes through the LA-2.3 scrub gate.
- A reinstated policy closes its win-back item.

## LA-5.5: Persistency-linked notifications

**Scope:** additions to the existing alert centre:
- "Policy entered high risk" in a day-25 digest;
- "Draft failed" sent immediately (email, plus SMS when a provider exists);
- an 80%-of-meter warning.

**Acceptance:**
- The rule "anything that costs him money gets through immediately; everything else is a digest" is followed.
- Every notification has a preference toggle.
