# Retention: the risk ladder (spec, 2026-11-05)

**Status (2026-11-05): owner picked A (list) + A (case); BUILT, uncommitted. Migration `20261105200000_retention_ladder_cases.sql` is LIVE (pasted by the owner). The first live sync on the demo agency opened 1,029 cases (659 payment problem, 345 pending lapse, 4 lapsed and reinstatable, 2 lost to a chargeback, 19 paperwork for a mailed bill), matching the dry run. Each policy has one ladder case and every case has an owner. Walked live: the list, a case on every step and all four tabs, Ladder rules, the scorecard, and Lapse risk → Cases. No write button was pressed on demo data.** This replaces the predictive Retention module (Notion Module 5, LA-5.1–5.3 and 5.9) as the main Retention work. The rest of Module 5 is kept and reshaped around it: servicing (5.4), reinstatement (5.6), win-back (5.7), the role and scorecard (5.8), income (5.10) and settings (5.11). Notion has not been updated yet.

Sources:
- the call of 2026-11-05 (`docs/meetings/2026-11-05-book-of-business-and-retention-call.md`);
- the owner's ChatGPT write-up on retention cases;
- the owner's follow-up the same day: every case comes straight from the uploaded policy and commission files, the files decide where a policy goes, and the agent must see which policy is at what risk point and exactly what to do;
- the Power Policies spec (PDF), read for background only. Its auto-dealer, call floor, DNC screening and dialer are out of scope.

## 1. What Retention is

Sales gets someone to buy insurance; Retention helps them keep it. A policy needs retention care when a carrier file shows something has gone wrong, or is about to:
- a payment failed;
- the carrier warns it will lapse;
- it lapsed but can still come back;
- the carrier charged the advance back;
- some paperwork is blocking it.

Retention finds those policies **only from the files**, puts each one at its **risk point**, tells the agent **what to do**, and keeps it there until **a later file proves it is fixed**.

It is not a prediction. A policy paying fine today is not in Retention.

## 2. The ladder

Every flagged policy sits on exactly one step. A step is a risk point: the higher the step, the closer the policy is to being gone.

| Step | Key | Put there by (from the files) | The agent's goal | Deadline shown | What to do |
|---|---|---|---|---|---|
| 1 | `payment_problem` | the first draft failed; a later draft failed; a draft bounced (paid-to went backwards, or the carrier's word says returned/NSF); a banking problem | Get the payment through | the end of grace (carrier rule) | Call; fix the bank or the draft date (servicing request); confirm the next draft |
| 2 | `pending_lapse` | the carrier says at risk, conservation or lapse pending; past due inside grace; a lapse notice | Save it now | the end of grace, counting down | Call today; take the payment; fix the draft |
| 3 | `lapsed_reinstatable` | lapsed inside the carrier's reinstatement window | Reinstate it | the reinstatement deadline, counting down | Reinstatement: back premium, forms, health questions; send it to the carrier |
| 4 | `lost` | past the window, cancelled, not taken, or charged back (commission file) | Record why | the win-back date | Close it; it goes to win-back after the cooling-off |
| — | `paperwork` (beside the ladder) | a pending requirement; a pending manual action; a notice; a cancellation request; a payment-date change; a mailed bill (prevention) | Clear it before it blocks the policy | the requirement's due date, when known | Checklist; send to the carrier; or a reason |

How a policy moves:
- **Up** when a newer file shows it worse: 1 → 2 → 3 → 4. Each move is written to its history.
- **Off as saved** when a file proves it: paid-to moved forward and the policy is in force; a servicing change verified in the file; a reinstatement confirmed.
- **Off as lost** when a file shows it lapsed past reinstatement, cancelled or charged back. It is then on step 4 until closed.
- **Off as "closed without a save"** only by a person, with a reason (the client wants to cancel, a duplicate, not ours). This is counted apart from saves.
- **Never off because someone said it was fixed** (Notion 5.4's rule stands).

A policy has at most **one open ladder case** and at most **one open paperwork case per reason** at a time.

## 3. The rules (the facts → a step)

The rules live in code (`lib/retention/cases/rules.ts`), one pure function per reason, and build on the existing `reasonFor()` in `lib/ingestion/retentionBoard.ts` rather than repeating it. Each agency can switch a reason off or change its thresholds in Settings › Retention › Ladder rules.

| Reason | Step | Rule (inputs already in `policy_current`, `policy_change`, `carrier_retention_rule`, `commission_entry`) |
|---|---|---|
| `first_draft_failed` | 1 | in force or approved-unpaid; never paid (no paid-to, or paid-to ≤ effective date); more than grace days past the effective date (`reasonFor` first_payment_missed) |
| `later_draft_failed` | 1 | active or at risk; has paid; days past due > grace (`reasonFor` later_payment_missed) |
| `bounced_draft` | 1 | in force; paid-to moved backwards in the latest file, or the raw status word matches returned/NSF/insufficient/bounced |
| `banking_problem` | 1 | the carrier's status word carries the `banking` flag (new, per carrier, in the status map) |
| `pending_lapse` | 2 | the carrier reports at risk / conservation / lapse pending, or the word carries the `pending_lapse` flag; or past due and still inside grace with ≤ N days left (N default 7) |
| `lapse_notice` | 2 | the word carries the `notice` flag, or the new optional layout field `notice` has text, on an in-force policy past due |
| `lapsed_reinstatable` | 3 | lapsed, with a lapse date, inside the carrier's reinstatement window (`reasonFor` recently_lapsed); linked to its `reinstatement_case` |
| `lapsed_lost` | 4 | lapsed past the window, or not taken |
| `chargeback` | 4 | a commission file line `entry_type = chargeback` on the policy |
| `cancellation_request` | paperwork | the raw word matches a cancellation or surrender request, or carries the `cancellation` flag |
| `pending_requirement` | paperwork | the layout field `requirement` has text, or the word carries `manual_action`; or an open `tenant_application_requirements` row on a pending application |
| `pending_manual_action` | paperwork | the word carries the `manual_action` flag |
| `payment_date_change` | paperwork | manual only: the client asks |
| `mailed_bill` | paperwork | active and paying by mailed bill (prevention; `reasonFor` direct_bill) |

Derived on any open case: **unreachable** after N failed contact attempts (default 4). This is a badge and a filter, not a step.

Deadlines come only from carrier rules and dates in the files. With no carrier window configured, the deadline is empty and says so; it is never guessed.

## 4. When the rules run

- `syncRetentionCases(tenantId, { dryRun })` in `lib/retention/cases/sync.ts`. For every policy in the agency it works out the step and reason, then:
  - opens new cases;
  - moves steps;
  - refreshes deadlines and evidence;
  - closes cases as saved or lost on file proof.
- **When it runs:**
  - at the end of every policy- or commission-file run;
  - daily on pg_cron, for grace running out;
  - when Retention opens, at most once a day.
- `dryRun` returns what it would do, without writing.

## 5. Data (new; a migration file that the owner pastes)

**`retention_case`**
- the policy: tenant, agency, `carrier_id`, `policy_number`, `contact_id`;
- `step` and `reason`;
- `status`: `open`, `working`, `waiting_on_carrier`, `saved`, `lost`, `closed_no_save`;
- `deadline` (nullable);
- `evidence` jsonb (paid-to, days past due, raw word, file id, ledger line);
- owner, `contact_attempts`, `last_contact_at`;
- `servicing_request_id`, `reinstatement_case_id`;
- `outcome_reason`, `opened_at`, `resolved_at`, `resolved_by` (`file` or a user).
- Partial unique indexes: one open ladder case per policy; one open paperwork case per policy and reason.

**`retention_case_event`**
- the timeline: step moved, evidence changed, assigned, call logged, step taken, note, servicing linked, resolved, reopened;
- each event has an actor and a payload.

**`retention_rule`**
- per-agency overrides of the defaults: reason on or off, thresholds.

**`carrier_status_map.retention_flag`**
- one of `banking`, `notice`, `manual_action`, `cancellation`, `pending_lapse`.

**Policy layout fields**
- optional `requirement` and `notice` text.

**Grants**
- RLS on tenant; writes through the server only; insert, update, delete and truncate revoked from `tenant_app`.

## 6. Screens

**Retention (the ladder page, `/app/retention`)**
- **Tiles**, one per step, each a link: Payment problem · Pending lapse · Lapsed, can reinstate · Paperwork, each with its count and the number due this week; plus Saved this month with the premium kept.
- **Tabs on the title line:** All · each step · Lost.
- **Search, and one Filters button:** owner, carrier, reason, unreachable.
- **Each row shows the four things:**
  - the client, phone and policy;
  - where it is on the ladder: a small four-step marker plus the reason in words ("Draft bounced Nov 3");
  - the deadline countdown (red ≤ 3 days, amber ≤ 7);
  - the next action as the row's button.
- **Order:** highest step first, then the nearest deadline, then the most premium.

**A case (`/app/retention/[id]`)**
- **Header:** the client, a step chip, a deadline chip, and one line of facts (policy status now, premium, carrier, owner).
  - The primary button is the step's next action.
  - More holds: Assign, Close without a save (confirm with a reason), Open the policy.
- **Ladder strip:** where the case is, the steps it went through (from the history), and what happens if nothing is done ("Unpaid by Dec 3 → lapses").
- **Tabs:**
  - **What to do:** that step's playbook, in place.
    - Step 1: the servicing form (bank or draft date) and what to say.
    - Step 2: what is due and by when; take the payment; fix the draft.
    - Step 3: the reinstatement steps (the existing form).
    - Step 4: why it was lost, and when win-back starts.
    - Paperwork: a checklist, plus "Sent to the carrier".
  - **Calls:** log one; "what you did" follows "what happened"; unreachable after N.
  - **Policy:** facts from Book of business.
  - **History:** every step change, call, fix and file that touched it.

**Settings › Retention › Ladder rules**
- each reason on or off;
- the number of days that makes a deadline urgent;
- the number of attempts before unreachable;
- the status-word flags per carrier.

**Reports › Retention scorecard**
- per person and per step: opened, saved, lost, closed without a save, unreachable;
- save rate per step (counts under 10);
- premium kept;
- retention rate = saved ÷ (saved + lost).

## 7. What leaves or moves

- **Hidden** (code and tables kept): the predictive Save queue, the Paper bill campaign page (mailed bills become the `mailed_bill` paperwork reason), Retention results / holdout, and the radar run.
- **Lapse risk** (`/app/lapse-risk`): redirects to Retention. Its call history (`retention_action`) shows on the case's Calls tab.
- **Servicing and Reinstatement** pages: reached from their case. Their lists remain.
- **Owner:** the retention role if anyone holds it, else the writing agent (`retention_assignment`, queue type `retention_case`). A manager reassigns by hand. No dealer, no call floor, no DNC screening in this module.

## 8. How it is checked

- **Unit tests:**
  - each reason → the right step and deadline;
  - moving up across files;
  - closing on file proof only;
  - one open ladder case per policy;
  - deadlines never guessed;
  - unreachable after N attempts.
- **A real American Amicable file** (`docs/la4/demo/auto-link-test/*AMAM*`): a dry run lists every policy by step and reason, compared with the file by hand.
- **The demo agency:** a dry run, then a live sync after the migration is pasted, checked with read-only selects.
- **A browser walk** at 1440 and 1280 wide.
