# Book of Business, simplified: proposal

Drafted 2026-11-02. This is a plan only. No code or data has changed.

**What it's measured against:**
- the Notion "Module 4 — Book of Business" doc and the 20 LA-4 tasks (all marked Completed in Notion)
- every LA-4 page in the app today
- the friend's "Carrier File Pipeline Blueprint", with every AI step removed

---

## 1. What we have today

All of the engine exists. Each file goes through these steps:

1. Registry
2. Raw rows
3. Layout read
4. Balance gate
5. Status gate
6. Snapshots and the change log
7. Current policy
8. Matching
9. Exception queues
10. Ledger
11. Expected commission
12. Orphans
13. Discrepancies
14. Retention

The problem is the screens. One job is spread over **about 20 agent pages**, and the same thing often appears in three or four places.

| Problem | Where it shows today |
|---|---|
| A file's progress is spread out | The **Runs** tab has every stage. The file page shows only the first failed step. The Files list shows a chip. |
| "What happened to each row, and why?" has no answer | A row says only "Held, or not read". No reason is stored per row. |
| Client links can't be changed where you see them | The file page and the policy page are view-only. You change a link in Policy matching, Exceptions, or Duplicates. |
| The same queue appears more than once | Unmatched commission lines are in Exceptions › orphan_commission, in Ledger › Carrier accounts, and in Statements › Unmatched lines. |
| There are two policy pages | `/policies/[id]` is the older hand-entered record. `/policies/carrier/…` is the carrier-file record. |
| The rate card can be reached from four places | Expected figures show in three. |
| Carrier rules are console-only | The agency page was removed, so an agency can't set its own windows. |
| Pipelines only move on "issued" | `applicationIssueStore` closes the application as issued and moves the card. A missed payment, lapse, chargeback or advance moves nothing. |

---

## 2. What we take from the friend's blueprint, without AI

| Their idea | Our version, no AI |
|---|---|
| **The file is the unit of work.** One page shows each file's stages: Upload → Layout → Parsing → Linking → Mapping. | One stage strip per file, everywhere a file appears. |
| **A per-file results view:** every record, what happened, or why not. | A row outcome on every row, each with a plain reason. |
| **Link once, record how.** Late linking re-runs that policy's events. | We already record the method. Add **Change link** on the file and policy pages. A change re-runs only that policy's later steps. |
| **Expected files per day**, so a missing file shows the same day. | We already have this as missing-file findings from the carrier cadence. Show them as a **Missing** tab on Files. |
| **Rules as data:** a source event plus a from-stage gives a target stage and a note. They have preview, once-only, holds, undo and forecast mode. | **Pipeline rules.** Every check is done by code. There's no AI yes/no step, because our events are already exact facts. |
| **A daily date check.** A missed payment doesn't change the file; the date just passes. | We already refresh `policy_current` daily at 06:15 and compute days past due. The daily date check becomes an event: "first payment missed" and "later payment missed". |
| **Notes are written by people.** Code fills the placeholders. | The same: a note template with `{paid_to_date}`, `{months_paid}` and `{amount}`. |
| **Never relax a check.** A file that doesn't reconcile fails loudly. | Already ours: the balance gate and the status gate. |

**What we leave out:**
- AI name matching
- the AI rule yes/no step
- the AI file summary
- one table set per carrier (our layout maps are better)

---

## 3. The new shape: one area, four steps

```
Book of business
├─ 1 · Files         every file and its journey      → File page (the hub)
├─ 2 · Needs you     one inbox of everything a person must decide
├─ 3 · Policies      the book                        → Policy page
└─ 4 · Setup         rules the engine follows
Money (Commissions frame, already built) stays its own area, slimmer.
Scorecards stay in Reports. Retention pages are LA-5 and out of scope.
```

### Step 1 · Files

- **Tabs:**
  - **Files:** the list, with a stage strip on each row.
  - **Missing:** files that were due but haven't arrived, from the cadence.
  - **How files arrive:** the bucket, email and upload doors on one tab.
- The stage strip has eight stages:
  1. Received
  2. Checked: the carrier, type and layout are known
  3. Read: the rows are read and the totals balance
  4. Statuses: no row is held
  5. History: changes are recorded
  6. Linked: every policy has a client
  7. Pipelines: the cards have moved
  8. Money: lines are posted and expected commission is checked
- Each stage shows done, waiting on a person (with a count), failed, or not needed.

**The file page is the hub.** It has the same strip on top, and each stage is clickable.

| Tab | What it shows | What a person can do |
|---|---|---|
| **Rows** | Every row with its outcome: *"Policy 7269… updated: status Active → Lapsed"*, *"Held: the carrier's word 'Act-Pastdue' isn't mapped yet"*, *"Linked to Jane Doe by policy number"*, *"Moved Jane: Issued → Lapsed (Sales)"*, *"Advance $540 posted. Expected $560, short by $20"*. Filters: all / needs you / changed / held. | **Change link** opens a client picker in a side sheet. Clicking a row opens the row detail as a side panel instead of a separate page. |
| **Needs you** | Only this file's rows that are waiting on a person. | Fix them in place: pick the client, add the missing rate, or send a status word to Insurvas. |
| **Changes** | Each field this file changed, old → new, linked to the policy. | — |
| **Money** | The ledger lines from this file, the statement total, and the balance check. | — |
| **Whole file** | The raw sheets or PDF text, as today. | Download. |

The page also keeps **Read again**, **Who sent this?** and **Download**.

### Step 2 · Needs you

One inbox replaces the queues in:
- Policy matching › To review
- the five Exceptions queues
- Statements › lines waiting
- Unmatched commission lines
- open Discrepancies
- the Attribution queue
- held status words (shown as waiting on Insurvas)

**How it's arranged:**
- Grouped by **what must be decided:**
  - pick a client
  - is this the same person?
  - a sale no carrier has
  - money that doesn't match
  - who gets the credit
- Filtered by **who must act:** mine, agency, or waiting on Insurvas.
- Every item fixes in a side sheet, and the step badge counts what's left.

The queue rules (owners, 5-day no-policy, orphan threshold) don't change. Only where they show changes.

### Step 3 · Policies

- The book list stays as it is.
- **One policy page** for both kinds of record. The hand-entered record opens in the same layout, with the tabs it doesn't have left empty.

**Tabs on the policy page:**
- **Overview:** status, paid-to date, risk, and the next date that matters
- **History:** each field that changed from X to Y, because of which file, on which date
- **Client:** who the policy is linked to and how. **Change link** and **Unlink**.
- **Pipeline:** which card this policy moved and when, with undo
- **Money:** expected, reported and discrepancies, with the rate used and where it came from
- **Notes**

### Step 4 · Setup

| Sub-page | Holds | Today |
|---|---|---|
| Rate card | Rates, bands, levels, advance rules | /app/rate-card |
| Carrier rules | Pay trigger, lag, windows and grace per carrier; agency override on top of the platform's | Console only (the agency branch is unused) |
| **Pipeline rules** | New: see §4 | Only "issued" today |
| Agent codes | Carrier agent code → member | Policy matching › Agent codes |
| Bring your existing book | The onboarding import | /app/book-import |

---

## 4. Pipeline rules: the new piece, no AI

**A rule is made of:**
- the carrier (or every carrier)
- an **event**
- the **from-stages**
- the **target pipeline and stage**
- a **note template**, with a switch to turn the note on or off
- an on/off switch

**The events are precomputed facts.** Code computes all of them, so no AI is needed:

| Event | Comes from |
|---|---|
| Issued | Already built |
| Waiting for first payment | approved_unpaid |
| First payment missed | days past due after the carrier's first-payment grace (daily date check) |
| Later payment missed | Daily date check plus the ongoing window |
| Paid again | paid-to moved forward after a miss |
| Lapsed / not taken / cancelled / declined / withdrawn | Status change |
| Advance received / earned credited / chargeback received | New ledger line |

**Safety rules, taken from the friend:**
- **Once only:** one move per change, rule and version.
- **Preview:** "would move / skipped because…", run with the same checks as apply.
- **Forecast mode** comes first. It records "would move X → Y" and writes nothing until the owner switches it to live.
- **Hold** when two rules disagree.
- **Skip** a lead that a person moved by hand in the last N days.
- **Cap** each run.
- **Every move can be undone.**
- **Late link:** linking a policy later runs its waiting events once.

**Moves go through what we already have:** `moveLead` and stage sync. The rule's outcome shows on the file page's Rows tab and on the policy page's Pipeline tab.

---

## 5. Menu count

| Today (agent side) | Proposed |
|---|---|
| Carrier files (6 tabs) + file + whole + row pages | Files (3 tabs) + file page. The row page becomes a side panel. |
| Import your book | Setup › Bring your existing book |
| Policy matching (3 tabs) | Needs you, Policy page › Client, Setup › Agent codes |
| Exceptions | Needs you |
| Policies + two policy pages | Policies + one policy page |
| Statements, Ledger, Discrepancies, Attribution, Reconciliation, Rate card | Money frame: Statements, Ledger, Discrepancies, Reconciliation. Their queues feed Needs you. Rate card moves to Setup. |
| Commission splits, producer statements (no menu) | Money › Reconciliation |
| Persistency (redirect only) | Removed |
| Runs tab, Agent findings tab | The stage strip replaces Runs. Agent findings is an AI-review surface, so it moves to the admin console. |

Every old address keeps working and opens the right step or tab, the same way Data in and Commissions do.

---

## 6. What it needs underneath

1. **A row outcome, kept per row.** For each row: what it became, why it was held, the match method, the pipeline move, and the ledger line. This needs a new table, written by the existing stages. **A migration for the owner to paste.**
2. **Stage status per file:** read from `pipeline_stage_run` (it exists) and folded into the eight-stage strip. No migration.
3. **Change link:** `record_policy_match` already supersedes a link. Add a call that then re-runs that policy's later steps. No migration.
4. **Pipeline rules:** a rule table, a version table and an evaluation/applied table, plus a forecast switch. **A migration.** This is the only truly new engine.
5. **Agency carrier-rule override:** the store and the `plane="agency"` UI branch exist. It only needs a route.

---

## 7. Owner decisions (2026-11-02)

1. **Needs you is one inbox.** Matching, exceptions, unmatched lines, discrepancies and attribution all go there, and each is fixed in a side sheet.
2. **Pipeline rules come now, with the pages.**
3. **Pipeline rules start in forecast mode.** Each rule records "would move" until the owner switches that rule to live.
4. **Agencies can override carrier rules.** The agency's own dated rule wins over the platform's. Clearing it hands the rule back to the platform's.
5. **Money stays its own area.** Its queues feed Needs you, and the rate card moves to Setup.

## 8. Next step

Mockups on the redesign canvas, before anything is built. They will cover:
- the Files list with stage strips
- the file page and each of its tabs
- the Change link sheet
- the row side panel
- the Needs you inbox and its fix sheets
- the policy page tabs
- Setup › Pipeline rules: list, edit, preview and forecast

Every edit surface and pop-up will be drawn.
