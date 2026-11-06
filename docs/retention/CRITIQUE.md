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

## The ladder pages, live (2026-11-05, after the migration was pasted)

The owner asked: "is this how it's supposed to work and look?" Checked against `docs/retention/SPEC.md`, on the demo agency (1,029 live cases), at 1440 wide. The model works as specified: the files open the cases, each policy has one, and every case has an owner. What was wrong was how the pages say it.

**Cases list (`/app/retention`)**
1. **Deadlines that had passed read "Today".** The placement clamped a negative countdown to today, so 333 overdue cases showed "Today" and their date moved every day. *Fixed:* the real date is kept; the list shows "12 days over · Oct 24" (red), the chip "12 days over". Test added. **Not enough (second walk, below, A1):** the countdown is already clamped upstream in `daysLeftFor`, so 298 cases still read "Today".
2. **The tiles said "0 due this week" on 659 cases.** 597 cases have no carrier window at all, and the tile hid that. *Fixed:* each step tile reads "N past due · N this week · N no window".
3. **The reason repeated the step.** "Lapsed, can reinstate" over "Lapsed, inside the reinstatement window · …" pushed the file's fact out of view. *Fixed:* the line under the step is the fact itself ("Carrier says 'Cancelled'").
4. **The policy number was cut off** ("American Amicable 0119…"), and it is what the carrier asks for. *Fixed:* wider column, full text on hover.
5. **Missing: nowhere to see what left Retention.** The Saved tile led nowhere, and saves, losses and closes without a save disappeared. *Added:* a **Closed** tab (last 90 days: how it ended, why, when). Saved this month links to it.
6. **Missing: no way to open the one case a person opens.** The spec's "wants a new payment date" had an API but no page. *Added:* **New case** on the title line opens `/app/retention/new`, a form page (find the policy, say what they asked, Open the case). The policy search is now one shared `PolicyPicker`, also used by Servicing › New request.

**A case (`/app/retention/[id]`)**
7. **The facts line wrapped to three lines beside the tabs.** *Fixed:* the header is who and which policy (phone, carrier and policy, premium, owner, status). The why moved to the strip, and the policy's status is on the Policy tab.
8. **The most important line was the smallest.** "If it is still unpaid on Nov 14, it becomes a pending lapse" was grey 12px text on the right. *Fixed:* the strip's second line is the reason (bold) plus what happens next, in the step's colour, with the file path under it. The step numbers take the step's own colour (amber for a payment problem, not red for every step).
9. **Two primaries for one action.** "Take the payment" in the header only linked to the tab you were on, next to "Payment taken". *Fixed:* on What to do the header keeps only More.
10. *(Fixed in the walk)* "First draft failed" on a policy that pays by mailed bill → **First payment missed**. "If it stays unpaid soon" when no date exists. Paperwork reasons each have their own steps (a mailed bill: offer bank draft).

**Settings › Retention › Ladder rules**
11. **It opened on a bare table**, and the column "Counts" was unclear. *Fixed:* a heading and one line on what the page does, plus "All Retention settings". The column is now "On".
12. **Missing: the status-word flags per carrier (SPEC §6).** `carrier_status_map` is Insurvas's, one per carrier, so an agency can't edit it. *Added, read-only:* "Carrier words that count", which today says none are flagged yet. **Not built:** an editor for Insurvas staff on the admin status-map page.

**Reports › Retention scorecard**
13. The By person / By step tabs were already there. They looked missing only because the browser tab had run out of connections. In a fresh tab they show.
14. **Retention results was still on the Reports rail**, though SPEC §7 hides it and the radar no longer runs, so it only grows stale. *Fixed:* off the rail (`offRail`); its address still answers.

**Servicing and Reinstatement:** no change needed on the pages. One data finding: Reinstatement lists **Maxine Sizemore** (American Amicable 0119990001) as lapsed, yet her latest file says active and paid to Dec 2, so Cases correctly leaves her off. Her reinstatement case was seeded on Nov 2 with a lapse date of Nov 3, after her last file, so no file can close it. This is demo data, not a code fault.

## Can an agent work it? (second walk, 2026-11-05)

The owner asked: "how easy is it for the user to know exactly what to do there?" This pass is read-only: the demo agency at 1440×900, as demo.agent, with no write button pressed. It covers:
- every Cases tab: All, Payment problem, Pending lapse, Lapsed, Paperwork, Lost and Closed;
- a first-payment case through What to do (and its New draft date form, cancelled), Calls, Policy and History;
- a lapsed case through Start reinstatement into the Reinstatement page;
- the Reinstatement and Servicing lists.

**Verdict:** the ladder is right, but the agent is given **three places to work the same client** (the case, the Reinstatement case and the Servicing paper-bill list). The pages also still show **carrier codes and contradictions** where a plain sentence should be.

### A. Wrong or unsafe: fix first
- **A1. 298 of 344 pending lapses still say "Today".** `daysLeftFor` (`lib/ingestion/retentionBoard.ts:103–106`) clamps every countdown with `Math.max(0, …)` before the ladder sees it, so the fix to finding 1 never reached a stored case. Every overdue case reads "Today", and the "333 this week" tile is false. *Fix:* the ladder gets the signed number (the Lapse-risk board keeps its clamp), and the next sync rewrites the dates.
- **A2. "Close · to win-back" on a Lost case closes it in one click.** There is no confirm and no reason, and the close is final (`case-view.tsx:56`). *Fix:* a ConfirmDialog with the reason, like Close without a save.
- **A3. The two lists disagree.** Cases › Lapsed shows 5, and Reinstatement shows 6 (Maxine, see above). An agent working one list misses the other.
- **A4. The page contradicts itself.** Rory Ridealong's case shows all of the following at once:
  - "Terminated";
  - "Paid to Jan 1, 2027";
  - "Days past due 0";
  - "Charged back $276";
  - "Your advance revives: $0" (on the Reinstatement page).

  The future dates are demo data. But a lapsed policy should never show "0 days past due", and "advance revives" should read the chargeback line.

**A1–A4 fixed (2026-11-06; owner: "Fix A1–A4 first"; uncommitted):**
- **A1.** `signedDaysLeftFor` is the unclamped countdown. The board's `daysLeftFor` clamps it, and the ladder sync uses the signed one. Live after the next sync: the Pending lapse tile reads "295 past due · 38 this week · 11 no window", and rows read "N days over · <date>". A case with exactly 0 days left still reads Today. That is correct.
- **A2.** A Lost case's "Close to win-back" opens a confirm: the client and policy, "why it was lost" (prefilled from the reason), and a note (required for Other). It was opened and cancelled live; nothing was closed.
- **A3.** Reinstatement leaves off an open case whose latest file shows the policy in force and paid past the lapse. The Open tile says "1 left off: the latest file says in force". Live: 5 open, matching Cases › Lapsed.
- **A4.** A lapsed or lost case shows "Lapsed on" (filled at its next refresh), never "Days past due 0". Reinstatement reads the newest chargeback: "$276 charged back Dec 4" on the row, and "Charged back $276 on Dec 4: ask the carrier if reinstating returns it" on the case, instead of "advance revives: $0".
- **Tests:** `cases.test.mjs` (A1–A4) and `retentionBoard.test.mjs` (signed countdown). Full `npm test` 3,925/3,925; tsc and eslint clean.

### B. Cases list
- **B1. Only 5 rows fit on All (206 pages).** The five step tiles repeat the counts already on the tabs and take a third of the height. *Fix:* fold the tiles into the tabs (count plus a red "N overdue" badge) and keep one slim line for "Saved this month". The table then shows 10 to 12 rows.
- **B2. Ten identical bright buttons per page.** The row button is a filled primary on every row, so nothing stands out, even though the name already opens the case. *Fix:* use an outline row button, with the filled one only on overdue rows.
- **B3. The button words don't match where they lead.**
  - "Call: First Payment".
  - "Close · To Win-Back".
  - "Start Reinstatement" lands on a page whose buttons are "Open the reinstatement" and "Sent to the carrier".

  The buttons are also Title Cased by the style. *Fix:* use one verb per step that the case page repeats: "Call about the first payment", "Take the payment", "Reinstate", "Switch to bank draft", "Close to win-back".
- **B4. "No phone" rows still say "Call".** Many American Amicable rows have no number. *Fix:* the row reads "No phone · find a number", which opens the contact.
- **B5. The why line shows carrier codes, not meaning.** For example: "First payment missed · carrier says 'Active (Inforce)'" on a pending lapse, "IssNotPaid", or "On the statement of Dec 4, 2026" (a chargeback). *Fix:* use one sentence per fact, such as "Unpaid 44 days. The carrier still lists it active", "Issued, never paid", "Charged back $276 on Dec 4". The raw word moves to the case's "From the files".
- **B6. No "my cases".** A producer sees all 1,029, mostly owned by others, and there is no owner column. *Fix:* producers land on Mine; owners and managers get an Owner column and an owner filter.
- **B7. No premium on the row.** With 659 payment problems, $/mo is how an agent picks first. *Fix:* add $/mo under the deadline.
- **B8. The Lost tab's deadline column says "No carrier window"** and the reason is cut off. *Fix:* the column shows "Win-back from <date>" and the reason gets its full width.

### C. A case: What to do, Calls, Policy, History
- **C1. "owner Ruth Alvarez · Not started" in the header.** "Not started" reads as the policy. *Fix:* "Not worked yet" or "Last call Nov 3", whichever applies.
- **C2. No way to reach the client from the case.** The phone isn't a link and there's no email or contact record. On a no-phone case, step 1 is "Call the client today". *Fix:* a contact line (tap to call, email, open the client), and a different step 1 when there's no phone.
- **C3. "Payment taken" saves at once with nothing captured.** There's no amount, no how, no date and no confirm. *Fix:* three inline fields (amount, how, date) and a one-line confirm, so the next person knows what was promised before the file catches up.
- **C4. The servicing form in What to do has four problems:**
  - "I have sent it to the carrier" is ticked by default, so it's recorded as sent before anything was sent;
  - "No instructions for American Amicable yet" is a dead end;
  - "set it in Draft dates" isn't a link;
  - the title "Payment date" doesn't match the button "New draft date", and the note typed on What to do is lost when the form opens.

  *Fix:* unticked by default, a carrier-phone or portal fallback line, a real link, matching words, and carry the note over.
- **C5. "From the files" shows raw words** ("IssNotPaid", "approved unpaid" on Policy). *Fix:* the plain meaning first and the carrier's word in grey, plus "Next file expected about <date>", so the agent knows when the case can close.
- **C6. Calls tab.** The header primary "Call: First Payment" only links back to What to do, and the phone number isn't next to the form. *Fix:* the number with a tap-to-call link above "Log this call", and no header primary on this tab.
- **C7. Policy tab.** It's missing what a servicing call needs: draft day, bank or card last 4, writing agent, and the client's address and email. *Fix:* add them where the file has them.
- **C8. History tab.** "Who: A carrier file" doesn't name or link the file, and the What column sits far right on a wide empty table. *Fix:* "Policy file of Oct 1 (American Amicable)" as a link, with When, What and Who left-aligned.

### D. Start reinstatement: two trackers for one job
- **D1. A lapsed policy has two progress trackers:**
  - the Retention case (step 3, "Sent to the carrier");
  - the Reinstatement case, with its own steps (Not called yet → Called them → Client agreed → Sent → Back in force) and its own "Called them" button.

  A call logged on one doesn't move the other: both say "Not called yet". The agent can't tell which to update.
- **D2. Three verbs:**
  - the list says Start reinstatement;
  - the case says Open the reinstatement;
  - the Reinstatement page says Called them.
- **D3. Leaving the case loses the way back.** The breadcrumb becomes Retention › Reinstatement, with no link back to the case.
- **D4. The page opens on the wrong tab.** Its first tab is the reinstate-vs-sell-new comparison, mostly "ask the carrier". What the agent needs (back premium, months owed, health questions, signed form) is on the second tab, and it's empty.
- *Fix:* step 3's What to do **is** the reinstatement:
  - one progress strip: Called → Client agreed → Sent → Back in force (from the file);
  - the carrier-needs fields in place;
  - the comparison as a small aside;
  - `/app/reinstatement/[id]` redirects to the case.

### E. Servicing and Reinstatement lists
- **E1. Servicing's "Paper bill → bank" list is the same clients as Cases › Paperwork (mailed bill, 19).** That's two places to work one client. *Fix:* fold it into Paperwork.
- **E2. Its filters wrap to a second line.** The chips plus "Every change" and Refresh plus New request don't fit on one line. "Can't be proven" is jargon. *Fix:* use one Filters button (as on Cases), and "The file doesn't show this change".
- **E3. A request made from a case doesn't point back to it.** *Fix:* "From case: <client>" on the request.
- **E4. The Reinstatement list repeats Cases › Lapsed.** Win-back sits there as a tab, though it comes after Lost.

### The setup: three menu items, two of them duplicates
Today the rail has Cases, Servicing and Reinstatement. Reinstatement is a second copy of step 3, and Servicing holds a second copy of a Paperwork reason. Recommended:

| Rail item | What it is | Comes from |
|---|---|---|
| **Cases** (default: Mine) | The only work list: every step as a tab, with each case's playbook in place, reinstatement included | Cases + the Reinstatement case page |
| **Waiting on the carrier** | Everything sent that the next file must prove (servicing requests, sent reinstatements) and when that file is due. You chase here; you don't work here | Servicing |
| **Win-back** | Lost clients once the cooling-off has passed | the Reinstatement › Win-back tab |

The scorecard stays in Reports. The Reinstatement list and the Paper-bill list go away: their addresses redirect, and their tables are kept.

### B–E built (2026-11-06; owner: "Yes, do B–E"; uncommitted)
Walked live at 1440×900 on the demo agency. Nothing was saved: the payment fields, the payment-date form and the confirms were opened, then cancelled.

| Finding | Built |
|---|---|
| B1 | Step tiles removed. A tab's count turns red when any case in that step is overdue. One line in the table's foot gives "N past due · N due this week · N with no carrier window · Saved this month: N ($/mo kept)", and the "Saved this month" part links to Closed. 10 rows show where 5 did. |
| B2 | Rows use an outline button. A filled button marks only a case past due or within 3 days. |
| B3 | One verb per step: Get the first payment, Take the payment, Fix the draft, Fix the bank, Reinstate, Close to win-back, Keep the policy, Switch to bank draft. Title Case is the Button's own (the design system's). |
| B4 | "No phone on file" in amber. Numbers are plain, copyable text. A `tel:` link is refused by `contract.test` (a call goes through the dialer's gates). |
| B5 | `STATUS_MEANING`: "issued, never paid", "the carrier still lists it active", "Charged back $276 on Dec 4", "N days unpaid". The carrier's word is on the case only. |
| B6 | Filters › Owner › "My cases (N)" (`?owner=me`). The owner gets an Owner column ("You" for their own). |
| B7 | A $/mo column (`CaseRow.monthlyCents`). |
| B8 | The Lost tab's column is "Lost since <date> · win-back after the cooling-off". The why line keeps at least 300px. Lost cases stay out of the urgency line. |
| C1 | The header reads "not worked yet", "last call <date>" or "with the carrier". |
| C2 | The phone leads the header. With no phone, step 1 says where to find one (the application, or the carrier). |
| C3 | Payment taken opens amount, how and when in place, then "Record the payment" (amount_cents, plus how and when in the note). The date is the agent's local day. |
| C4 | The servicing form: "I have sent it" is unticked by default. A carrier with no guide gets a portal or service-line fallback. Draft dates is a link. The case note carries in (`initialNote`). The buttons are titled like the form ("New payment date", "Switch to bank payment"). |
| C5 | From the files: the meaning first, the carrier's word in grey, then "Latest file". |
| C6 | Calls: the number, or the no-phone line, sits beside "Log this call". The header primary is hidden there. |
| C7 | Policy: the meaning, the carrier's word, Written by, Client's state and Draft day (`policy_risk_signals`). |
| C8 | History: When, What, Who. A file reads "<Carrier> file of <date>" and links to the policy's file history. |
| D1–D4 | Step 3's What to do is the reinstatement: its own next step (Called them › Client agreed › Sent) and declines, "What the carrier needs" in place, and the comparison beside it. A reached call on the case moves the reinstatement from "Not called yet" to "Called them". `/app/reinstatement/[id]` redirects an open case to its Retention case. |
| E1 | `/app/servicing?view=campaign` opens Cases › Paperwork › "Paying by mailed bill". `paper-bill-campaign.tsx` is deleted; its call pages still answer. |
| E2 | Servicing's kind-of-change filter sits behind one Filters button, and New request moved to the title line, so the toolbar fits one line. "Can't be proven" is now "The file can't show it". |
| E3 | A request opened from a case says "From a Retention case", as a link, on the list and on its page (`ServicingRow.caseId`). |
| E4 | The rail is Cases · Waiting on the carrier · Win-back. `/app/reinstatement` opens Win-back. The old list answers at `?view=cases` / `?cases=closed`. A retention rep (no win-back calls, LA-5.8) lands on Cases › Lapsed and does not see Win-back on the rail. The sidebar item keeps the role, as LA-5.8's test requires. |

**Checks:** tsc clean; eslint clean on the changed files; full `npm test` 3,926/3,926; graphify updated.

### Round 3 built (2026-11-06; owner picked header A + table B, rejected every in-table edit surface; uncommitted)
Mockups: the "Retention round 2" canvas (https://claude.ai/artifact/BHddaAR4Axnw38RhRi6Zgv).
- **The risk cards** (`components/app/retention/risk-cards.tsx`) sit on top of all three lists, each card heavier than the last:
  - **Cases:** Fixable › Act now › Last chance › Gone. Each card has its count, money at stake and a past-due / this-week / later / no-window bar. Paperwork and Closed sit beside them. A card is the step.
  - **Waiting on the carrier:** Waiting › Send it › Check it › Failed, with Proven and Cancelled beside them.
  - **Win-back:** Resting › Soon › Call now › Needs you, with Never call and Possible claims beside them.
  - Tags are sentence case on a flat tint (§17 forbids eyebrows and gradients).
- **Tables grouped by urgency** inside the chosen card:
  - **Cases:** past due, due this week, later, no carrier window. Columns: client and policy (with product and face), risk point and why, $/mo with what is due and the advance or chargeback at stake, deadline, last touch, next.
  - **Waiting on the carrier:** check it, send it, waiting. Columns: change asked, sent and show-by, what the latest file shows, days waiting.
  - **Win-back:** stuck, on the list, soon, cooling off. Columns: phone, age and state; what they had; why it ended; when to call; chance.
- **Nothing opens inside a table:**
  - Filters is a `FilterPopover`, and applied filters are `ActiveFilters inline` chips on the toolbar line (UI-CONSISTENCY §6a updated).
  - A read-only `HoverPeek` sits on the Cases name.
  - Each Win-back client has a page (`/app/reinstatement/winback/[id]`): why, what to say, what they had, and Open the lead. Calls stay in the dialer's Win-back list.
- **Title line:** All / Mine.
- **Checks:** walked live at 1440 with no sideways scroll on any of the three pages. The pop-over and the peek were checked; nothing was saved. `npm test` 3,928/3,928; tsc and eslint clean.

**Left as they are:**
- On step 3 the reinstatement's own More (declines) sits beside the header's More.
- The facts line wraps to two lines on long owner names.
