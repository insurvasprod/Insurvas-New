# Reports: foundation pass (2026-11-03)

A /ui-taste pass (polish + distill) over every Reports view, measured against
[UI-CONSISTENCY.md](../design/UI-CONSISTENCY.md) (§2, §3, §4, §6, §6a, §6b, §6c, §8, §8a, §11, §17),
the owner's rules for this round and the Notion spec for the module each view reports on. Book of
business and [the Accounting pass](../accounting/FOUNDATION-PASS.md) are the reference for the look and
for how this is written.

The owner's rules used here:

- Tabs and sub-pages sit on the title line.
- The pattern is list page → detail page → tabs.
- No side panels or sheets. Pop-ups only to confirm or to upload.
- No explainer or info cards. Notices go to the bell; a dialog keeps one line.
- A detail header is the title, a status chip and one muted line of facts. It has at most two buttons,
  plus a More menu.
- Figures are one StatStrip, and its tiles are the links.
- Tables come from `TableCard`. Text stays 12/14px. No eyebrows, glows or gradients.

## Inventory

The frame is `components/app/reports/reports-page.tsx` (server) with `reports-rail.tsx` and
`reports-slot.tsx`; the list of views is `lib/reports/views.ts`. Each view keeps its own address and gate.

| View | Address | Tabs (before) | Opens from it (before this pass) |
|---|---|---|---|
| Sales performance | `/app/sales-performance` | Funnel and rates · Timing · Decline reasons · Counteroffers · Premium and commission (title line, in state only) | Range dropdown + custom dates, four filter dropdowns on the toolbar line, Export per tab, Refresh. Timing stacked a second card, "Days a requirement sits open", with its own Export |
| Team activity | `/app/activity` | Agents · Call log · Setters · To review | A "Next step" line ("N things to review"); an agent row opened a **DetailPanel beside the table** (figures, outcome mix bar, latest calls, See calls, Review flags); To review stacked the **appointment close-out card** and a red note over the flagged calls; Export this table; date range + agent + campaign + outcome + flag dropdowns in the toolbar |
| Queue scoring | `/app/scoring` | none: strip, then a hand-built "How the score is divided" section, then the "Next up, and why" table, stacked | Compare-over dropdown, scoring switch, Save (corner); weights, Reset per signal, holdout %; agent dropdown, Next up / Held back chips, Breakdown per row |
| Book scorecards | `/app/book-scorecards` | Overview · Persistency · Scorecards (links) + period dropdown | Overview stacked **five cards**: Today, Book of business, Placement (one row), Chargeback ratio, Net commission by week. Persistency had the sample-size **form inside the toolbar**. Every figure opened `?drill=`, a card with its own title, description and "Back to the scorecards" link |
| True CPA | `/app/true-cpa` | Vendors · Where leads drop off · Compare, with From / To / Filters / Apply on the title line | Two "Next step" lines (uncounted spend; dearest vs cheapest vendor); a tinted pending-update notice; "Rows" buttons under each tile; Where leads drop off stacked **five cards** (funnel, two curves side by side, speed and consent side by side); every count opened a **980px DetailPanel overlay** with the leads |
| Partner quality | `/app/partner-quality` | none (one table) | Period dates, type, With leads only, Export; every count opened a **hand-built side drawer** (a `createPortal` `<aside>`); error as a red line in the toolbar |
| a partner | `/app/partner-quality/[partnerId]` | Leads sent · Outcomes & screening · Team · By agent · Daily volume, with the period + Refresh on the title line | Outcomes & screening held **two tables side by side**; every count opened the same drawer |
| Retention scorecard | `/app/retention-scorecard` | none: strip, the person's reasons table, then (owner) everyone's table, stacked | Period + Person dropdowns, a date sentence in the toolbar; "Save rate" per person |
| Retention results | `/app/retention-results` | Were the predictions right? · Does working it help? | Period dropdown, By band / version / confidence chips, the verdict sentence in the toolbar; the holdout's plain sentences as a block over its table |

The rail had a tinted "Period kept as you switch" box at its foot.

## Critique and fixes, view by view

### The frame (`reports-page.tsx`, `reports-slot.tsx`, `reports-rail.tsx`)

- **Defect.** The frame took no `info`, `chip` or `facts`, so a view's (i) and a record's facts line had
  nowhere to go. That is why explainers sat in toolbars, table descriptions and notes.
  **Fix:** `ReportsPage` takes `info`, `chip` and `facts`, as `AccountingPage` does. A client view that
  only knows its record once its data is in calls `useReportsTitle(title, facts, chip)`. The facts
  `<p>` has the Accounting walk's `lg:min-w-[360px] lg:[contain:inline-size]`, so it cannot squeeze the tabs.
- **Defect.** A client view's tab lived in state only, so a tile, the bell or a reload could not land on
  it. **Fix:** `useUrlTab(keys, fallback, param, alias)` keeps it in the address (`?tab=`, or `?view=` on
  Team activity and Retention results, `?section=` on a partner, whose record page already owns `?tab=`).
  It changes the address in place, with no server round trip, and follows a link to another tab.
- **Defect.** Each view had its own period control: four date-range dropdowns with different options
  and labels, two bare date pairs. **Fix:** `PeriodPicker` (`components/app/reports/period-picker.tsx`):
  one dropdown (Last 7 / 30 / 90 days, 6 / 12 months, Custom dates) with From / To for Custom, first in
  the toolbar. A window the server cut in the agency's time zone still reads as its preset. It is used by
  Sales, True CPA, Partner quality (both pages, on its EST calendar) and an agent's page. Team activity
  keeps its own windows, because its prior-period comparison is built on them, but uses the same labels.
- **Defect.** A framed view's first read drew `PageLoading`, which is a whole page skeleton with a trail
  and title, under the frame's own. **Fix:** `FramedLoading`, a table skeleton in the step column.
- **Info card.** The rail's "Period kept as you switch" box. **Fix:** removed. The period still rides
  in the address to the next view and shows in its toolbar.
- **Trail.** A drill on a view's own address (`?drill=`) lost its third crumb. **Fix:** the Reports
  branch of `page-trail.tsx` adds "› record" whenever the title names one.

### Sales performance

- **Two lists stacked.** Timing had "Days a requirement sits open" as a second card. **Fix:** its own tab,
  Requirements, with the tab's Export.
- **Filters on the toolbar line.** Six controls in one row wrapped at 1280. **Fix:** the period, then one
  Filters button; carrier, product, lead source and producer open in the panel, with Active filters chips
  (§6a).
- **Notices on the page.** The reload error was a red box; the sample preview a tinted notice. **Fix:**
  both are `Callout`s, so they go to the bell.
- **Figures.** Tiles were not links. **Fix:** Submitted → Funnel, Issued → Premium, Declined → Decline
  reasons, Counteroffered → Counteroffers.
- **Hand-made height.** The card carried `min-h-[calc(100dvh-…)]`. **Fix:** removed. `TableCard` fills
  to the foot by itself (§6b).
- **Explainer.** The (i): what the report counts, the rule under 5 cases, and that Placed is partial.

### Team activity

- **Side panel.** An agent opened in a DetailPanel beside the table. **Fix:** a detail page,
  `/app/activity/agent/[agentId]` (`components/app/activity-agent-detail.tsx`).
  - **Title:** the agent's name. **Facts line:** served · dialled · logged · contact rate.
  - **Buttons:** Review N flags (owners and producers, when there are flags) and Export calls.
  - **Figures:** one strip: Served, Contact rate, Logged without a dial, Callbacks, Appointments.
  - **Tabs:** Calls (the log for this agent, paged on the server, searchable) · How the calls ended (the
    disposition mix as a table with one token-colour bar per row; "unlogged" counted apart).
  - The window carries over from Team activity (`?from&to`); the page's Calls link back filters the log
    with `?agent=`.
- **"Next step" line.** "N things to review" over the strip. **Fix:** gone. The counts are on their tabs.
- **Two blocks in one tab.** To review stacked the close-out card and a red note over the flagged calls.
  **Fix:** Close out is its own tab (the shared `AppointmentCloseOutStrip`), with its count; the note is
  the flagged table's one-line description.
- **Notices.** The load error and the setter error were tinted boxes. **Fix:** `Callout`s.
- **Filters.** Agent, campaign, outcome and flag were four dropdowns on the line. **Fix:** the panel.
- **Table too wide.** Agents was 110px wider than its card at 1440. **Fix:** the three "booked / kept"
  headers are two lines; each row has an Open action.
- **Figures.** Tiles link: Leads served → Call log, Dials → To review when there are flags, Contact rate
  and Applications → Agents, Appointments → Close out or Setters.

### Queue scoring

- **Three blocks stacked.** **Fix:** Weights · Next up are the view's tabs on the title line
  (`?tab=`), with the comparison window beside them; the strip stays over both.
- **Hand-built card.** "How the score is divided" was a `<section>` with its own border and `<h2>`.
  **Fix:** a `TableCard`: the bar, then one row per signal (share, what it measures, weight, Default or
  Reset); the holdout % is the card's foot.
- **Notices.** The read-only plan, the open-lead ceiling and a reload error were plain or tinted lines.
  **Fix:** `Callout`s. The load error is an `ErrorState` in a `TableCard`, not a bordered section.
- **Figures.** Not links: no rows sit behind a holdout comparison.

### Book scorecards (LA-4.18)

- **Five cards stacked.** **Fix:** six tabs on the title line, as links: Book · Persistency ·
  Chargebacks · Net by week · Scorecards · Today. `?view=overview` (old links) opens Book.
- **Placement's one-row table.** **Fix:** it is the Placed tile ("279 of 529 issued paid at least once ·
  250 never paid"), whose rows open as one record with three tabs: Placed · Issued · Never paid. The
  "through Insurvas" count is that record's facts line.
- **Figures.** The tiles are the links: In-force premium → the policies in force, Month-9 persistency →
  Persistency, Placed → its rows, Chargeback ratio → Chargebacks. Before, only the figure text was a link.
- **A form in a toolbar.** The sample size was an input and Save inside the Persistency toolbar.
  **Fix:** More › Sample size, a confirm pop-up with its one field (2 to 100); Save waits for a change.
  The toolbar states the rule ("A percentage needs 10 policies").
- **The drill.** A card with its own title, description and "Back to the scorecards" link. **Fix:** the
  figure is the page's title and its count (or a week's lines and total) the facts line; the trail is the
  way back.
- **Explainers.** Placement's and Net by week's descriptions, and the true-cost formula in the toolbar.
  **Fix:** the (i) and the table feet. The persistency counting rule stays in the Persistency foot, in full:
  it is the caveat the owner asked for on 2026-10-13.
- **Today.** A bulleted list in a card. **Fix:** a table, one fact per row with Open; a quiet day is the
  empty state with the summary's own sentence.

### True CPA (LA-2.17)

- **Side panel.** The leads behind a figure opened in a 980px DetailPanel. **Fix:** a page,
  `/app/true-cpa/leads` (`components/app/true-cpa-leads.tsx`, address built by
  `lib/reports/trueCpaLeads.ts`). The figure is the title (with the count); the selection's sums are the
  facts line, so the rows reconcile with the figure; one table, paged on the server.
- **One tab holding four lists.** Where leads drop off. **Fix:** Funnel · Contact rate (by slot or by
  attempt, a toolbar switch) · Speed to lead · Consent certificates are tabs. Speed and consent were
  `<div>` rows; they are tables.
- **The scope on the title line.** From / To / Filters / Apply sat beside the tabs. **Fix:** the period
  and Filters lead every tab's toolbar; the panel opens inside the card (§6a), with Active filters chips.
  The period applies at once; the panel's choices wait for Apply.
- **"Next step" lines.** Uncounted spend, and a "X costs 2.3× Y" insight. **Fix:** the first is a warning
  `Callout` with its link (the bell); the second is gone (§3: an insight banner). The Cheapest / Dearest
  chips on the cards carry it.
- **Notices.** The pending-update notice was a tinted box. **Fix:** a `Callout`.
- **Figures.** "Rows" buttons under each tile. **Fix:** the tiles are the links to the leads pages.
- **Kept:** the vendor cards (owner pick B, 2026-10-26), eight to a page. See "Not done".

### Partner quality (LA-1.18)

- **Side panel.** Every count opened a hand-built drawer (`createPortal` + `<aside role="dialog">`).
  **Fix:** a page, `/app/partner-quality/[partnerId]/leads` (`components/app/partner-quality-leads.tsx`):
  the figure as the title, the period and count as the facts line, Export in the corner. The partner record's
  Quality tab (Partners) opens the same page.
- **Table too wide.** 225px wider than its card at 1440. **Fix:** the type sits under the partner's name,
  "Screening pass" reads "Screening" (with its definition on hover), the bars are narrower.
- **Notices.** The error line in the toolbar. **Fix:** a `Callout`.
- **Hand-made height.** `FILL_CARD` + `min-h-[calc(…)]`. **Fix:** removed (§6b).
- **Figures.** Not links: no endpoint lists leads across every partner. Each row's counts are links.

### A partner (`/app/partner-quality/[partnerId]`)

- **Two tables side by side.** Outcomes & screening. **Fix:** Outcomes and Screening are a tab each.
- **The period on the title line.** **Fix:** every tab's toolbar starts with it and ends with Refresh.
- **Header.** **Fix:** the partner's name, and a facts line: type · the period · against the period before.
- **Figures.** Tiles link: Sent → Leads sent, Conversion → By agent, Screening → Screening, DQ % → Outcomes.

### Retention scorecard (LA-5.8)

- **Two tables stacked.** The person's reasons over everyone's. **Fix:** for an owner with a team,
  "Name's save rate" · "Everyone" are tabs (`?tab=`); a row's Save rate opens that person's reasons.
  A rep sees their own card only, as before.
- **A sentence in the toolbar.** The dates and held-out count. **Fix:** the table foot.

### Retention results (LA-5.9)

- **Text in the toolbar and over the table.** The verdict sentence and the holdout's plain sentences.
  **Fix:** the table feet. The spec requires the sentences on the page; they stay in full.
- **Holdout off.** A muted line with a link inside the card. **Fix:** the empty state, with Open Retention
  settings.
- **Figures.** Predictions checked → the predictions view, Holdout → the holdout view (`?view=`).

## Spec check (Notion)

| Spec item | State |
|---|---|
| LA-3.21: funnel filterable by carrier, product, lead source, producer over a date range | Present; filters now in the panel |
| LA-3.21: every rate with its numerator and denominator; under 5 cases a greyed count | Present, kept |
| LA-3.21: median days a requirement sits open, by kind | Present; now its own tab |
| LA-3.21: Placed labelled partial, never inferred from issued | Present, kept |
| LA-3.21: declines by product tier | **Not built** (noted 2026-10-30): the report has no tier field |
| LA-3.21: CSV of any table | Present, one per tab |
| LA-2.21: log searchable and filterable by agent, campaign, disposition, date | Present; filters in the panel |
| LA-2.21: scorecard per agent with the disposition breakdown | Present; the breakdown is now the agent page's own tab |
| LA-2.21: served, clicked and logged always separate; zero-click flagged; nothing called talk time | Present, kept |
| LA-2.21: every grid exports | Present; **added** Export calls on the agent page |
| LA-2.13: holdout contact rate beside the scored cohort; weights inspectable and adjustable | Present, now the Weights tab |
| LA-4.18: persistency 3/6/9/13 by count and premium; sample threshold configurable | Present; threshold now a confirm under More |
| LA-4.18: placement rate with the gap | Present; **added** the never-paid count on the tile and the three sets as tabs |
| LA-4.18: every figure opens its rows, and they reconcile | Present; the drill's facts line carries the count (and a week's total) |
| LA-4.18: daily summary links every claim, says when nothing is notable | Present; now a table |
| LA-4.18: AI-written summary prose | **Not built** (noted 2026-10-30): the summary is the structured facts |
| LA-2.17: funnel, cost per contact / application / issued policy, speed to lead | Present |
| LA-2.17: attempts-to-contact curve; contact rate by slot | Present, one tab with a switch |
| LA-2.17: contact rate by hour | **Not built**: the report returns slots, not hours |
| LA-2.17: every figure opens the leads behind it | Present; now a page |
| LA-2.17: consent coverage | Present. **Outside LA-2.17** (it is not in that spec); kept |
| LA-1.18: sortable per-partner table, prior-period trend, zero rows for idle partners | Present, kept |
| LA-1.18: any cell opens exactly the leads it counted | Present; now a page |
| LA-1.18: says plainly it does not include cost yet | Present: the Conversion header's hint and the (i) |
| LA-5.8: save rate only per reason; under 10 a count; holdout excluded; unreachable apart | Present, kept |
| LA-5.9: by band, version and confidence; worked vs holdout; sample and period stated | Present, kept |

Added outside the spec (labelled): the Reports period control, URL-kept tabs and the tiles as links (the
owner's foundation rules, not a module's spec); Export calls on an agent's page.

## Checks (2026-11-03)

- **Typecheck:** `npx tsc --noEmit -p .` exits 0.
- **Lint:** eslint on every changed file: 0 errors. Five old unused-variable warnings remain in
  `app/app/(shell)/book-scorecards/page.tsx` (destructured `_members` and similar).
- **Tests:** `npm test` passes 3,780 of 3,780. That includes the new `lib/reports/foundationPass.test.mjs`
  (8 rules) and the updated `retentionFlow`, `metricDirections` and `scorecardConcept` tests. The
  `next-step-strip` and `hand-callout` baselines in `lib/design/uiOffenders.json` were lowered with
  `UI_RATCHET_WRITE=1`.
- **Browser walk.** On :3000 as the demo agent (LA-1.25 Alert Demo), at 1440×900, read-only. Nothing was
  saved. Each table's width was measured against its card.
  - Sales: Funnel, Timing, Requirements, Decline reasons, Counteroffers (through its tile), Premium, and the
    Filters panel.
  - Team activity: Agents and Close out.
  - An agent's page: Calls and How the calls ended.
  - Queue scoring: Weights and Next up.
  - Book scorecards: Book, Persistency, and a Placed drill with its three tabs. The Sample size pop-up was
    opened and cancelled.
  - True CPA: Vendors, Contact rate, Speed to lead, Consent certificates, and a leads page from its tile.
  - Partner quality, a partner's page (Leads sent, Outcomes, Team, Daily volume, all tiles), and a member's
    leads page.
  - Retention scorecard (both tabs) and Retention results (both views).
  - The Browser pane was hidden for part of the walk. Those views were read through the page (text and
    measurements), with the memory notes' animation-frame workaround. Server render was checked with curl
    for every Book scorecards tab and drill and every True CPA tab.
- **Fixed during the walk:**
  - The period picker read "Custom dates" for the server's 90-day window.
  - These tables were wider than their cards at 1440: Team activity › Agents, Partner quality, a partner's
    Team and Leads sent, Sales › Requirements (it showed all 11 carriers; now only those with a met
    requirement), and True CPA › Funnel.
  - An agent's page repeated the Agent column and counted "unlogged" as an outcome.
  - The 30-day window reached the agent page as 31 days.
  - A drill's trail stopped at the view.

## Functional QA follow-up (same day)

The Compliance & Reports QA session reported three readability defects in this pass's files. All three are fixed:

- **True CPA percentages.** They printed the RPC's raw value ("68.75%" beside "20%"). They now show one decimal everywhere.
- **Small samples on Sales.** A rate under 5 cases reads "4 of 26", and a median reads "4 cases". This matches the decline cross-tab (`crossCell`, changed by QA).
- **Period formats.** The views used five formats. `lib/reports/periodText.ts` gives one: "5 Aug – 2 Nov", with the year only when it differs. Sales, True CPA, Scoring, Retention scorecard, Partner quality and Book scorecards use it.

Producer scorecards (AG-1.9) joined Reports the same day, from the Team session. It is not covered by this pass.

## Not done

- **Vendor cards stay cards.** True CPA's Vendors tab is a grid of cards, eight a page, not a `TableCard`
  table with fitted paging. It is the owner's pick B (2026-10-26); turning it into a table is the owner's call.
- **True CPA › Funnel width, not re-measured.** It was 64px wider than its card. Its cells now wrap
  (`whitespace-normal!`, because `.portal-lead-table td` is `nowrap`). The shared dev server kept serving
  the old bundle for that page, so the fix is in the source but not seen.
- **Partner quality and Queue scoring tiles.** They are not links. No endpoint lists leads across every
  partner, and no rows sit behind a holdout comparison.
- **Team activity's windows.** It keeps its own Last 7/30/90 days + Custom dates, because its "vs prior
  N days" comparison is built on them. The labels match the shared control.
- **1280 wide.** Not walked at 1280.
- **Spec gaps that need data.** These are marked Not built in the spec table above: declines by product
  tier (LA-3.21), contact rate by hour (LA-2.17), and AI-written summary prose (LA-4.18).
