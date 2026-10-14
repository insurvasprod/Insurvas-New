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

> **Superseded (2026-10-14).** The spec is the Notion "Module 5 — Retention" doc and the eleven LA-5.x tasks in the Insurvas Sprint database. Their numbering differs from this file's (Notion: 5.1 signals, 5.2 score, 5.3 save queue, 5.4 servicing requests, 5.5 paper-bill campaign, 5.6 reinstatement, 5.7 win-back, 5.8 retention role, 5.9 holdout, 5.10 income capture, 5.11 settings hub). Build from Notion.
>
> **Progress (Notion numbering):**
> - **5.1–5.3 built 2026-10-14.** `lib/retention/` (signals, score, fixes, queue, radarStore, queueStore), `/app/save-queue`, `POST /api/app/retention/save-queue`, the `risk_radar` pipeline stage, and the LA-3.9 `draftTiming` helper. Migration `20261014100000_la_5_1_3_chargeback_radar.sql` also carries the parts of 5.10 (`contact_income`) and 5.11 (`retention_settings`, versioned `risk_weight_set`) that 5.1–5.3 read. **Not applied yet.**
> - **Live 2026-10-14** (verified by the catalog check and a direct read). **Owner decision 2026-10-14, beyond the Notion spec:** a low-confidence score (under half the weight known) stays scored but never reaches the save queue; the page counts the ones held back ("Too little known"). Why: a dry run over Isolation Test A's 1,408 imported policies scored every one on 1–2 of 7 signals and put 1,041 at high or critical, nearly all reading "Month 3."
> - **5.4 built 2026-10-14** (migration `20261014200000_la_5_4_servicing_requests.sql`, **not applied yet**). Book › Servicing (`/app/servicing`, the `payment_repair` feature, replacing the unbuilt "Payment repair"); "Start the fix" on save-queue cards logs the call and opens a linked request; `verify_servicing_requests` (the database, after each policy file and daily by pg_cron) is the only thing that can set *verified in the file* or *failed*; a failure alerts whoever asked and puts the policy back on the save queue first; admin › Servicing instructions holds the per-carrier how-to (none written yet: content for staff). Added `draft_day` as an optional policy layout field, because a draft-date change can only be proven by a file that carries it (Aetna/Aflac/AHL's DRAFTDAY); a field the file doesn't carry waits and says so, never verified and never failed. The radar now takes the draft day from the latest file, then a proven change, then the application.
> - **5.5 built 2026-10-14** (migration `20261014300000_la_5_5_paper_bill_campaign.sql`, **not applied yet**). Servicing › "Paper bill → bank": every in-force `direct_bill` policy, biggest annual premium first (Direct Express excluded). Start conversion opens the 5.4 `bill_to_draft_conversion` request and logs the "yes" with it; it counts as converted only when the file verifies the request. Log call: no answer, call back, said no (reason; back after `bill_decline_cooloff_days`, default 180), no bank account (leaves for good and goes onto the save queue whatever its score). Talk track: the platform's words until an owner writes the agency's own (audited in `retention_setting_change`). "Is it worth the hours?": converted vs still-on-paper lapses (counts below the sample floor) and per-person calls / agreed / converted. **Open:** Lapse risk (LA-4.16) still lists healthy mailed-bill policies as "Mailed bill: convert to bank draft" (prevention); the campaign now owns them — owner to decide whether that reason leaves the call list.
> - **5.6 built 2026-10-14** (migration `20261014400000_la_5_6_reinstatement.sql`, **not applied yet**). Book › Reinstatement (`/app/reinstatement`, the `winback` feature, replacing the unbuilt "Win-back" item; 5.7 will add the win-back list). `sync_reinstatement_cases` (the database; after each policy file and daily by pg_cron) opens a case for every lapse inside the carrier's reinstatement window (lapsed_on from the change log; no window → null deadline, own labelled group, only for a lapse the newest file brought), marks it reinstated when a newer file shows the policy in force, expires closed windows, and alerts at 14/7/3 days (settings) once per threshold. Fewest days first; amber/red/pinned; the amount owed is labelled an estimate until the carrier's figure is entered. Reinstate vs sell new shows the reviving advance and the age difference — **no new premium is shown, because we hold no age rate tables**. "Pinned to the retention dashboard" is a pinned alert on the Save queue (the main dashboard files carry another session's uncommitted work).
> - **5.7 built 2026-10-14** (migration `20261014500000_la_5_7_winback.sql`, **not applied yet**). Reinstatement › "Win-back" view. `sync_winback_candidates` (the database; after each policy file and daily) opens a candidate for every lapse the files showed once it is past reinstatement, classified by the most reliable source — the client's own words on a reinstatement decline, a save call where they agreed to keep it, the carrier's status word, the payment history (inferred: never better than fair), else unknown — into strong / fair / poor / never with a cooling-off per reason (affordability 12 months, platform floor 6). Never-call: a "stop calling" reason or a number already on the internal do-not-call list (and written to it); a death flags the household for a claim (`household_claim_followup`). **Owner decision 2026-10-14:** at its cooling-off date a client goes to the agency's own "Win-back" lead list (vendor "Your own book", created once), as a NEW nurture lead (the old sold lead keeps its list and vendor) tagged `source_type = winback`, with the history as a lead note; the list is then sent back through the scrub gate, so nothing dials until it is scrubbed. The database refuses to release a never-call candidate or one still cooling off. Release runs when the Win-back view opens and after each policy file (no app scheduler).
> - Known gaps: carrier files carry no draft day, so Sign 1 exists only for sales written in the app (an imported book scores without it); the "Start the fix" button waits for 5.4's servicing requests; the settings screens wait for 5.11; nothing schedules the nightly run (the page recomputes when a day has passed).

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
