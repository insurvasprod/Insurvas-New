# Retention: page critique (2026-11-05)

A /ui-taste pass (polish + distill) over every Retention page, walked live on the demo agency at 1440×900, measured
against [UI-CONSISTENCY.md](../design/UI-CONSISTENCY.md) (§3, §4, §6, §6a, §6b, §8a, §11, §14, §17) and the owner's
rules for the foundation passes (Accounting, Compliance, Reports, Book of business):

- tabs and sub-pages on the title line;
- list page → detail page → tabs;
- no side panels or sheets, and pop-ups only to confirm or to upload;
- no explainer or notice cards (notices go to the bell, a dialog keeps one line);
- compact detail headers (title, status chip, one muted line of facts, at most two buttons plus More);
- one StatStrip whose tiles are links;
- TableCard tables that fit at 1440 and 1280, with 12/14px text, composed from `components/ui`.

Functional results are in [docs/qa/RETENTION-QA.md](../qa/RETENTION-QA.md). Mockups for the pages marked
**→ mockups** are on the redesign canvas, page "M5 · Retention". Nothing here has been built. It waits for the owner's pick.

## Scorecard

| Page | What the user is there to do | Next action obvious? | Rule breaks | Verdict |
|---|---|---|---|---|
| Save queue | Call the policies most likely to stop paying, most money first, and start the fix | **No.** "Log call" is the row's button; the real job, "Start the fix", is a small text link inside the Why column | form pop-ups ×4, inline row editor, 3 selects + chips in the toolbar, tiles aren't links | **→ mockups** |
| Servicing · Requests | Push each change to its next step, and see which ones the file proved or contradicted | Yes, one button per row | **side panel** (request detail), form pop-ups, two-step "New request" pop-up | **→ mockups** |
| Servicing · Paper bill → bank | Work down the mailed-bill list until it is done | Mostly. Two buttons per row; 207 of 292 rows have no phone | "Worth the hours?" is a report in a pop-up; the talk-track editor duplicates Settings | **→ mockups** (shares the call page with Save queue) |
| Reinstatement · Cases | Bring a lapsed policy back before its window shuts | Yes ("Work the case"), but that opens a 600px pop-up with 9 fields | form pop-up holding the whole record | **→ mockups** |
| Reinstatement · Win-back | See who is cooling off and when they can be called | **No action here.** The calls happen on the Win-back lead list, and nothing links to it | a second TableCard (Possible claims) under the first; tiles aren't links | tidy (one direction) |
| Reports › Retention scorecard | Owner: how each rep is doing, by reason. Rep: their own card | Unclear **whose** numbers the table shows once rep chips are picked | tiles aren't links | **→ mockups** |
| Reports › Retention results | Owner: is the radar worth paying for? | The answer ("The bands separate…") is the last line on the page | none serious | small fix (one direction) |
| Settings › Retention | Change thresholds, owners, cool-offs, holdout | Yes | a "What this changes:" sentence under every field (§3) | leave. Redesigned 2026-11-03 (pick A); only the copy trim below |

## Save queue (`/app/save-queue`)

**What works.** The prediction looks like a prediction. A dashed pill reads "82 · Critical", "predicted · 4 of 7
signals" sits under it, and the sentence gives the opening line for the call. The phone is on the row. The default sort is
risk × money. Need chips ("No income 13") find the cards that still lack something.

**What's confusing**
1. **The primary action is upside down.** The outline button on every row is *Log call*, while *Start the fix* is
   12px underlined text inside the Why cell, and the second fix is behind ⋯. Spec card: `[ Call ] [ Start the fix ]`.
2. **The tiles disagreed with the list.** "Critical 309" sat beside "In the queue 13" (fixed: now "2 · 309 across the
   book"). "Advance at risk $0" with "11 with no advance on file" still reads as "nothing at stake". When most of the
   queue is unknown, the tile should lead with the unknown count.
3. **"Income known 0 of 1,106"** measures data quality, not the queue. It is worth one tile at most, and it should link to
   the "No income" chip.
4. **Every edit is a pop-up:** Log call, Snooze or dismiss, Start the fix (a 560px form), plus an inline income row
   that pushes the table down. The owner's rule is pop-ups only to confirm. The work belongs on a card page.
5. **Log call allows contradictions.** You can pick "Reached, said no" together with "Agreed to switch to bank payment".
   The "What you did" list should follow the outcome.
6. **The toolbar** has a sort select, a band select, a carrier select and chips in one row (§6a: search plus one
   Filters button, with active filters as chips).
7. **None of the tiles are links.** Critical should filter to critical, Too little known should open Settings ›
   Retention, and Income known should select the "No income" chip.

**Directions (canvas)**
- **SqA · Queue → call page.** The list keeps one row per card with `Start the fix` as its button. The client name
  opens `/app/save-queue/[carrier]/[policy]`, a compact header (name, risk pill, phone, one facts line, buttons
  *Start the fix* and *Log call*, More: snooze, dismiss). The page has tabs: **Why** (the sentence, the 7 signals with
  points, what's missing), **Fix** (the request form inline, prefilled), **Calls** (log plus history), and **Income**.
- **SqB · Work in place.** The row expands in place to show the why, the two fixes as buttons and the call log.
  There are no pop-ups. A snooze or dismiss asks one confirm.
- **SqC · Call mode.** "Start calling" walks the queue one card at a time: the card, the script line, the fix, and
  *Next card*. It suits a rep's afternoon, and the list stays as the overview.

Recommended: **SqA**. It follows list → detail → tabs, gives the income editor and the call history a home, and
the Paper bill call can reuse the same page.

## Servicing · Requests (`/app/servicing`)

**What works.** The views are chips with counts. Each row has one next-step button, and *Cancel* is under ⋯. "Can't be
proven" says why in plain words ("…file doesn't show the draft day"). The status ladder follows the spec.

**What's confusing**
1. **Request detail is a side panel** (`DetailPanel` overlay). By the owner's rule that is a detail page.
2. **New request** is a pop-up asking you to *type a policy number*, then a second pop-up with the form. A wrong
   number fails late. Pick the policy by search, on a page.
3. **The step pop-ups** (Mark sent: how, reference, form, takes effect by) are edits to the record and belong on
   its page.
4. **"Waiting on the file 1 · 1 not sent yet"** next to "Open 2" makes you add the numbers yourself. And the tiles aren't
   links (Not in the file and Verified both match chips).
5. **"Try again"** on a failed request opens the empty form again. It should be prefilled from the failed request.

**Directions (canvas)**
- **SvA · Request page with a timeline.** `/app/servicing/[id]`. The header has the client, a status chip, one facts line
  and the next step as the primary button. The page has tabs: **Progress** (the ladder as a vertical timeline, each
  step's facts, the file check), **Change** (from → to) and **Notes**. *New request* is a page with a policy search.
- **SvB · Stage columns.** The list grouped by stage (Not sent · With the carrier · Carrier says done · Not in
  the file · Verified), with each group a section of the same TableCard. The next step stays on the row, and the record
  opens as SvA's page.

## Servicing · Paper bill → bank (`/app/servicing?view=campaign`)

**What works.** "292 to go" gives the job an end. It is biggest premium first, the conversion counts only when the file shows
it, and there is a *Has a phone* chip.

**What's confusing**
1. 207 of 292 rows can't be called today (no phone). They crowd the default view. Start with *Has a phone* on when
   any row has one, and give a "No phone" count to fix.
2. **"Worth the hours?"** is a small report (converted vs paper, calls per person) in a pop-up. It belongs in
   Reports › Retention scorecard (conversions are already a column there) or a "Results" tab here.
3. **The talk track** can be edited here *and* in Settings › Retention › Campaigns. Keep one edit place (Settings) and
   show it read-only on the call page.
4. **Log call vs Start conversion.** Agreeing means Start conversion, any other answer means Log call. That is the
   same call split into two buttons. One *Call* page (SqA) would ask "what happened" once.

**Direction (canvas):** **PbA** is the same call page as SqA, opened from the campaign, with the talk track on top.

## Reinstatement · Cases (`/app/reinstatement`)

**What works.** The countdown is the biggest thing on the row. The no-window group says it has no date and never
guesses one. The "Ask the carrier what is owed" line shows an empty value as an instruction.

**What's confusing**
1. **"Work the case"** opens a 600px pop-up holding the reinstate-vs-sell comparison, a step select, owed, months,
   health, form, reference, needs and a note. That is the whole record in a modal.
2. The step select starts with "No change of step", so saving a note looks the same as moving the case.
3. **Duplicate rows** when a lapse date moved (fixed in this pass, see QA).
4. The "No reinstatement window yet · Insurvas sets it per carrier" row tells the agent something they can't act
   on. A link to the carrier rule (or "ask Insurvas") would make it useful.

**Directions (canvas)**
- **RiA · Case page.** `/app/reinstatement/[id]`. The header has the client, the countdown chip ("12 days left · closes
  Dec 3") and the next step as its button (*Called them* → *Client agreed* → *Sent to the carrier*). The page has tabs:
  **Reinstate or sell new** (the comparison), **What the carrier needs** (owed, months, health, form, reference,
  edited in place) and **Notes**. *Declined* goes under More, with a confirm that asks why.
- **RiB · Countdown lanes.** The list grouped under *Closes this week* / *Within 14 days* / *Later* / *No window*,
  with the next step on the row. The record opens as RiA's page.

## Reinstatement · Win-back (`/app/reinstatement?view=winback`)

**What's confusing.** Nothing on this view can be done here: the people "On the list" are called from the
Win-back lead list, and nothing links to it. The Possible-claims table sits under the main table, so it is easy to
miss.

**Direction (canvas): WbA.** The "On the Win-back list" tile links to the campaign. *Possible claims* becomes a chip
with a danger count beside the other views. A claim opens its own row action, *Mark handled*, which keeps its confirm.

## Reports › Retention scorecard (`/app/retention-scorecard`)

**What's confusing.** The owner sees rep chips (Demo Agent, Devin Okafor, Marisol Vance), and the table shows one
set of numbers with nothing saying whose they are. Comparing reps means clicking each chip in turn.
The tiles aren't links.

**Directions (canvas)**
- **ScA · Reps → rep page.** One row per rep (worked, contact rate, saved, lost, unreachable, too soon, premium
  protected). The name opens the rep's page, with tabs *By reason* (today's table) and *Cases*. A rep lands on their own page.
- **ScB · Reason × rep grid.** Reasons down the side, reps across the top, each cell "8 of 8" or a rate. The blended
  column comes last.

## Reports › Retention results (`/app/retention-results`)

**What's confusing.** The answer to the page's question comes last, as a line under the table ("The bands
separate…"). It should lead as the first tile ("Bands separate · yes") linking to the band table, with the holdout
verdict beside it.

**Direction (canvas): ReA**, verdict first. This is a small change, so one board.

## Settings › Retention (`/app/retention-settings`)

Redesigned in the money & compliance settings round (owner picked A, 2026-11-03), so there is no new direction. One trim: every field
carries a "What this changes:" sentence, which §3 treats as explainer copy. Fold each into the field's own hint
(12px, muted), or into the section (i).

## Where each edit happens (recommended directions)

| Edit | Today | Recommended | Why |
|---|---|---|---|
| Log a save call | pop-up | Call page › Calls tab, in place | it's the record's history |
| Start a fix (servicing request) | 560px pop-up | Call page › Fix tab, in place; saving opens the request page | a form with carrier instructions needs room |
| Snooze / dismiss | pop-up with reason | More › confirm dialog with one reason field | a loss of visibility, so a confirm |
| Add / change income | inline row under the card | Call page › Income tab | access-logged; one place |
| Mark sent / carrier on it / says done | pop-up | Request page header button → inline fields under Progress | edits to the record |
| Cancel a request | pop-up | More › ConfirmDialog ("Cancel the request" / "Keep it") | destructive |
| New request | two pop-ups | page with policy search | picking a policy needs search |
| Paper-bill call / start conversion | two pop-ups | Call page (shared with Save queue) | one call, one answer |
| Talk track edit | pop-up here + Settings | Settings only; read-only on the call page | one edit place |
| Work a reinstatement case | 600px pop-up | Case page, tabs, fields in place | the whole record |
| Decline a case | step select | More › ConfirmDialog with "why" | final |
| Mark a claim handled | pop-up | row action › ConfirmDialog with a note | final |
| Settings fields | in place, one save bar | unchanged | owner's pick A |
| Saved / errors | toast / one line in the dialog | toast; errors next to the field | §11 |

## Built (2026-11-05, owner: "Build the recommended")

SqA, SvA, RiA, PbA, WbA, ScA and ReA are built. Nothing is committed.

| Direction | Where | What changed |
|---|---|---|
| SqA | `/app/save-queue` and `/app/save-queue/[carrierId]/[policyNumber]` | The row button is *Start the fix*; the name opens the card's page with the tabs Why, Fix, Calls and Income. Filters sit behind one Filters button and live in the address. Every tile is a link. Snooze or dismiss is a confirm. "What you did" follows the outcome (`lib/retention/callLog.ts`). |
| SvA | `/app/servicing/[id]` and `/app/servicing/new` | No side panel and no step pop-ups. The request page has a Progress timeline with the next step's fields beside it, and Change and Notes tabs. New request finds the policy by name, phone or number (in force only) and uses the inline form. Cancel is a confirm. |
| RiA | `/app/reinstatement/[id]` | The case page has the countdown chip, the next step as its button, and Decline under More as a confirm that asks why. Its tabs are Reinstate or sell new, What the carrier needs (in place, with a leave guard) and Notes. |
| PbA | `/app/servicing/campaign/[carrierId]/[policyNumber]` | One call with one set of answers. The talk track is read-only (edited in Settings). Next policy walks the list. "Worth the hours?" is now the Results view, and the list opens on "Has a phone". |
| WbA | `/app/reinstatement?view=winback` | The title line has "Open the Win-back list", Possible claims is a view chip, and the tiles are links. |
| ScA | Reports › Retention scorecard | The owner lands on Everyone (saved, lost, unreachable and too-soon counts). A name opens that person's reasons. |
| ReA | Reports › Retention results | The first two tiles answer "Do the bands come true?" and "Does working beat the holdout?". |

The old `components/app/servicing-request-dialog.tsx` is replaced by `components/app/retention/servicing-request-form.tsx`. Every page was walked on :3000 at 1440×900, read-only: no write button was pressed on the demo data. The writes go through the same APIs as before and are covered by tests (`savePages`, `servicingPages`, `reinstatementPages`).
