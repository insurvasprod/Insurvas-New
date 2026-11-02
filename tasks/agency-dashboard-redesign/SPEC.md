# Spec: Agency dashboard (`/app/agency`) — make it read as an analytics page

**Status:** **approved 1 Nov 2026** (owner: "your recommendations"). Plan and tasks in
[plan.md](plan.md) and [todo.md](todo.md) in this folder.
**Surface:** `app/app/(shell)/agency/page.tsx` → `components/app/agency/agency-dashboard.tsx`
**Who sees it:** owner, admin, manager (scoped to their reports), bookkeeper — and only on an
agency-typed plan, which is what carries the `agency_dashboard` feature.

---

## Assumptions I am making

Correct me now or the plan proceeds on these.

1. **Visual and structural work only.** No change to what the page is allowed to show, to who may
   see it, or to the numbers themselves. The `/api/app/agency/dashboard` contract stays as it is
   unless an open question below is answered otherwise.
2. **The screenshot is a brand-new agency**, not a bug: one seat, no producers, no ledger, no
   expiries. Every figure on it is a legitimate zero. A large part of "it looks unprofessional" is
   that **the page has nothing to show and does not say so gracefully** — so the empty state is
   first-class work here, not an afterthought.
3. **The frame stays.** Trail, one `PageHeader`, title top-left, actions on the title's line —
   exactly as every other page. You asked for this explicitly; nothing below moves it.
4. **It stays one page, not tabs.** The agent app's Daily deal flow uses `ViewTabs` because it has
   three genuinely different views. This has one subject.
5. **No new dependency.** The chart kit is `components/ui/chart.tsx`; §0 of the design authority
   forbids naming a colour, so a charting library is out of scope for this spec.
6. **Dark is the primary theme** (the screenshot), but both themes must pass
   `lib/design/brandContrast.test.mjs` as always.

---

## Objective

Make `/app/agency` read as the agency owner's analytics page — the one that answers *"which of my
producers is actually making me money?"* — rather than as a form with four numbers above two
tables.

The user is an agency owner or admin opening this page at the start of the week. Success is that
within about five seconds they can say: how the month is going **compared with last month**, who
is carrying the agency, who is at risk, and what needs them today.

### What is wrong with it now — the audit

Each of these is a specific defect, not a matter of taste.

| # | Finding | Where | Why it matters |
|---|---|---|---|
| 1 | **The `<h1>` is the agency's name, not the page's.** `title={agencyName}` renders "Your agency". | `agency-dashboard.tsx:69` | Every other page's title names the page (§2: "the title is the page's one `<h1>`"). The trail already says Home › Agency, and the top bar already names the workspace, so the name is said three times and the page is never named once. |
| 2 | **The figures carry no comparison.** Four bare numbers. | `StatStrip`, lines 78–83 | The page has a This month / Last month toggle, so the comparison is the whole point — and §4a says "the change pill always names its comparison". An analytics page without a delta is a report. **This is the single biggest miss.** |
| 3 | **The figures carry no period.** Nothing on the strip says which month it covers. | same | The period is only in the header's description sentence. `StatCard` has a `period` prop for exactly this. |
| 4 | **Old figure components.** `StatStrip` + `StatTile` rather than `StatRow` + `StatCard`. | line 78 | §4a: a page someone reworks moves to the v3 cards. They draw the same strip now, so this costs nothing visually and buys `period`, `delta`, `fact` and `action` — the props that carry findings 2, 3 and 8. |
| 5 | **An empty toolbar band.** The Producers card's `DataToolbar` holds a Refresh button and nothing else. | line 88 | Visible in the screenshot as a blank 56px strip with one button floating right. A toolbar with no search and no filters is a bar of nothing. |
| 6 | **Explanatory copy on the card face.** "Licences and appointments. An expiry stops that producer from submitting." | line 126 | §3 and the 2026-10-29 decision: why a list exists goes behind the (i) (`TableCard`'s `info`), not across the page. |
| 7 | **No visualisation anywhere.** | whole file | The repo has `BarSeries`, `ShareBar` and `Sparkline`, and every comparable page uses one — the partner Overview, the home dashboard, Daily deal flow. This is the only "analytics" page with no shape to read at a glance. |
| 8 | **The figures are inert.** A licence-alert count of 3 does not take you to the three. | lines 78–83 | Daily deal flow's cards carry a **Show** action that narrows the list. Same pattern applies here. |
| 9 | **A whole row washed amber** for the most-at-risk producer. | line 105 | §12 is about status colour on chips and figures; a full-row fill is the heaviest instrument available and is used here for emphasis, not for state. |
| 10 | **Two stacked full-width tables** make the page a long scroll that is mostly empty. | lines 86–151 | The expiries list is four narrow columns; at full width it is 60% whitespace. |
| 11 | **Empty states are per-card, so an empty agency is four zeros and two empty boxes.** | screenshot | Nothing tells a new owner that this is *new* rather than *broken*. |

### What is already right, and must not regress

- The trail, the single `PageHeader`, the title top-left, `Segmented` + primary action on the
  title's line.
- Every money figure states its basis (`BasisChip`), and `—` is used for "not read", never `0`.
- Placement and month-4 show a **count** until the sample is big enough for a percentage. That is
  a real piece of statistical honesty and it stays exactly as it is.
- `ledgerReady` degrades to "Shows once the payable ledger is live" rather than showing a wrong `$0`.

---

## What belongs on this page — the research (2 Nov)

The owner's instruction was to work out what the *most important information* is, not only to
tidy what is there. Two findings decide it.

### Finding A: this page is a front door, not the analytics

The agency module already has deep analytics, and they are good:

| Page | Its blurb, from the menu | What it owns |
|---|---|---|
| **`/app/agency`** | *"Which of your producers is actually making you money."* | **the summary — one question** |
| `/app/book-scorecards` | — | In-force premium, month-9 persistency, placed, chargeback ratio; book and chargebacks sliced by carrier / product / agent / source; persistency by month; **"true cost per sale = spend ÷ (sales × persistency)"** |
| `/app/producer-scorecards` | *"Who is profitable, not just busy."* | per-producer profitability |
| `/app/hierarchy` | *"Who reports to whom, and what the agency keeps on each producer."* | overrides |
| `/app/producer-payouts`, `/app/ledger`, `/app/producer-reconciliation` | — | money movement |
| `/app/lapse-risk` | — | lapse signals |

So the failure mode to avoid is **moving book-scorecards onto the dashboard**. This page should
answer its one question, and every figure on it should be a door into the page that owns the
depth. A dashboard that tries to be the analytics is how both end up worse.

### Finding B: the page throws away most of what the system computes for it

`producerScores` already returns, per producer, and this page shows **none** of it:

| Computed today | What it is | Where it should live |
|---|---|---|
| `leadSpendCents` | what the agency spent acquiring that producer's leads | the dashboard — it is half of "am I making money" |
| `costPerIssued` | acquisition ÷ issued policies (or the two counts, under the sample) | book-scorecards owns the depth; the agency figure is worth one card |
| `costPerPersisting` | acquisition ÷ policies **still paying** at month N | book-scorecards |
| `chargebackTax` | the gap between the two above — **what lapsing actually costs per policy** | the single most interesting figure the system computes, and nothing displays it |
| `m13` | 13-month persistency (the page shows only `m4`) | the producers table, beside m4 |
| `chargebackCents`, `placed` | money clawed back; policies that paid at least once | the "at risk" story |

### The proposal

Four cards that answer the owner's actual question — *am I making money, and from whom* — each
one a door:

| Card | Figure | Change | Links to |
|---|---|---|---|
| **Written** | issued this period, submitted as the fact | vs. last month | the producers standing below |
| **Your override** | what the agency kept — this is the agency's revenue | vs. last month | `/app/hierarchy` |
| **At risk** | advance at risk + chargebacks, as one figure with the split as its fact | vs. last month | `/app/lapse-risk` |
| **Needs you** | licence and appointment expiries inside 60 days | — | the expiries list below |

**Seats comes off the strip.** It is an administrative fact that changes twice a year, and it is
taking a quarter of the page's headline space. It belongs on `/app/producers`, or as a quiet line
under the title beside the agency name. This is the one deliberate removal, and the owner should
say if it is wanted.

**Payable out moves into the At risk card's neighbourhood** rather than keeping its own: what the
agency owes producers is a liability, not a performance figure, and `/app/producer-payouts` owns it.

### The charts

Two, and only two:

1. **The producer standing** — a ranked `BarSeries` of issued per producer for the period. This is
   the page's headline and the direct answer to its question. Ranked, so the top is obvious.
2. **Where the money went** — a `ShareBar` splitting the period's carrier money into override kept,
   producer share, and acquisition spend. One read, no new query, and it turns four disconnected
   money figures into one composition an owner can read in a second.

### What this leaves open

`chargebackTax` is the most sophisticated figure the system computes and nothing shows it. It may
belong on this page as a fifth card, or it may belong on book-scorecards where its siblings live.
**Open question 6, below.**

---

## The design direction

Distilled to the smallest set of changes that fix the eleven findings. Nothing here invents a new
component; every item names one the repo already has.

### 1. The header

Title becomes **"Agency dashboard"** — the page's name, matching the menu. The agency's own name
moves to the description or a quiet meta line, where it is context rather than the heading.
Everything else on the header row is unchanged.

### 2. The figure strip → `StatRow` + `StatCard`, with comparison

Four cards, same four figures, each gaining the three things that make a figure analytic:

| Card | Value | Period | Fact / action |
|---|---|---|---|
| Seats | `1 of 25` + meter | — | "No seat ceiling", or the meter |
| Payable out | `$12,480.00` | the month | delta vs. last month · basis |
| Your override | `$3,100.00` | the month | delta vs. last month · basis |
| Licence alerts | `3` (amber) | next 60 days | **Show** → scrolls/filters to the expiries |

The delta is the open question below; everything else is available today.

### 3. One chart: the month's production

A `BarSeries` of submissions or issued policies per producer for the period (or per week across
the month — see Open Questions), in a `HomePanel` beside the strip or directly under it. This is
the single addition that makes the page legible at a glance, and it reuses the kit that just
gained `barMaxWidth` for exactly this kind of sparse series.

### 4. The Producers table

- Drop the empty `DataToolbar`; put **Refresh** on the card's `action` slot.
- Replace the full-row amber wash with a chip or a tone on the **Advance at risk** cell only.
- Consider a `Sparkline` per producer if a per-producer series is cheap (Open Questions).

### 5. The expiries list

- `description` → `info` behind the (i).
- Narrow it: it is four short columns and does not need full width. Candidate for sitting beside
  the chart in a 12-column row, the way the home dashboard pairs its panels (§4b).

### 6. The empty agency — treated as a real state, not an absence

When there are no producers, the page should read as *new*, not *broken*: one short line under the
header saying the dashboard fills in as producers submit, the figure strip showing honest zeros
with their periods, and **one** primary action (Invite producer) rather than the same button
repeated in the header and the card. This is the state in your screenshot and the first thing
every new agency sees.

---

## Tech Stack

Next.js (see `node_modules/next/dist/docs/` per `AGENTS.md`), React, TypeScript, Tailwind,
Supabase. No new dependency.

## Commands

```
Dev:        npm run dev                     (already on localhost:3000)
Test:       npm test
Typecheck:  npx tsc --noEmit
Lint:       npm run lint
Build:      npm run build
```

## Project Structure

```
app/app/(shell)/agency/page.tsx         → the route and its two gates
components/app/agency/                  → agency-dashboard.tsx, money.tsx, use-agency-data.ts
components/ui/                          → every shared part this spec draws on
lib/agency/dashboardStore.ts            → readDashboard; the numbers
app/design/agency/page.tsx              → NEW: the dev-only preview (see Boundaries)
lib/agency/fixtures.ts                  → NEW: sample data behind it
docs/design/UI-CONSISTENCY.md           → the authority
```

## Code Style

As the file already is, and as `components/partner/partner-deal-flow.tsx` now is: compose from
`components/ui`, comment the *why* rather than the what, no local colour.

```tsx
<StatCard
  icon={Wallet}
  label="Payable out"
  period={range.label}
  value={data.payableOutCents === null ? "—" : dollars(data.payableOutCents)}
  delta={previous ? { value: pctChange(data.payableOutCents, previous.payableOutCents), goodWhen: "neither" } : undefined}
  fact={{ label: "Reported basis", value: data.negativeCount ? `${data.negativeCount} negative` : undefined }}
/>
```

## Testing Strategy

- `npm test` must stay at its current baseline: **3524 tests, 3504 pass, 20 fail**. Those 20 are
  pre-existing SQL-text assertions against migration files checked out with CRLF; this work adds
  no twenty-first.
- `lib/design/uiConsistency.test.mjs` — `lib/design/uiOffenders.json` must not go up.
- `lib/design/sidebarLook.test.mjs`, `brandContrast.test.mjs`, `designDocs.test.mjs` must pass.
- Any arithmetic added (a percentage change, a chart series) goes in a **pure module with its own
  `.test.mjs`**, not inside the component — the pattern `lib/partnerDealFlow/figures.ts` follows,
  and the reason the `$8,450.00`-for-`$84.50` bug was caught there.
- Visual checks on `/design/agency` at **1536×826**, 1366×657 and 375 wide.

## Boundaries

**Always**
- Keep the trail, the single `PageHeader`, the title top-left and the actions on its line.
- Keep `—` for "not read" and the count-before-percentage rule.
- Keep every money figure's basis visible.
- Compose from `components/ui`; extend a shared component once rather than copying it.
- `git diff --stat` after each edit to an existing file (line endings flip on this machine).

**Ask first**
- Any second read per page load (the delta, a per-producer series) — it doubles the cost of the
  heaviest page in the app.
- Any change to `/api/app/agency/dashboard`'s response shape.
- Removing a column from the producers table.

**Never**
- Change who can see this page, or what the numbers mean.
- Name a colour; use tokens.
- Show `0` where the figure was not read.
- Commit without `npm test`, `lint`, `tsc` and `build` clean.

## Success Criteria

1. The `<h1>` names the page, and the agency name appears once.
2. Every figure states its period, and the two money figures state their change against the
   previous period — or the spec records why they cannot.
3. The page carries at least one visualisation, drawn with `components/ui/chart.tsx`.
4. No empty toolbar band; no explanatory sentence on a card face; no full-row colour wash.
5. A brand-new agency (the screenshot's state) reads as new: one primary action, honest zeros,
   one sentence of orientation — verifiable on `/design/agency?state=empty`.
6. A populated agency reads at a glance: verifiable on `/design/agency?state=busy`, for the owner
   and for a manager's scoped view.
7. `npm test` at 20 failures and no more; lint, typecheck and build clean; `uiOffenders.json` no
   higher.
8. Checked at 1536×826, 1366×657 and 375 wide with no horizontal page overflow.

## Open Questions — **answered 1 Nov**

The owner took the recommendations. The decisions, for the record:

| # | Decision |
|---|---|
| 1 | **Deltas: fetch the previous period lazily, after first paint.** The strip renders immediately on the current period and the change pills arrive a moment later, as the partner Overview does with its 30-day window. `useAgencyData` already takes a nullable URL, so "not yet" is expressible without a second hook. |
| 2 | **The chart is production per producer for the period**, from `producers[]`. No new read, and it answers the page's own question — *which of my producers is making me money* — directly. |
| 3 | **Keep the agency name**, as the header's description. The `<h1>` becomes "Agency dashboard"; the name is said once, as context. |
| 4 | **Pair the expiries beside the chart** in a 12-column row (chart 8, expiries 4), collapsing to stacked under ~1152px by container query, as the home dashboard does (§4b). It is the direct fix for "a long scroll of mostly empty", and the list is paged, so length is already handled. |
| 5 | **No design reference.** Two links were passed on by the owner's manager on 2 Nov; the owner confirmed they were shared as context, not as a brief. The direction stays mine. One idea from them is worth having anyway — see below. |

### The two links, read for what they actually are

`agentcompass.agency/how-it-works` and `powerhours.agency`, looked at on 2 Nov at 1536×826.

**Neither is a dashboard.** Both are marketing sites for products in this market — and they are
related: Agent Compass' own architecture map lists PowerHours as one of its data sources ("dials,
appointments, sits") and "Dashboards — production by agent and team" as something it powers. So
they read as competitive landscape rather than as a design brief, which is how the owner described
them.

Copying them would be a mistake regardless: 72px display headings, full-bleed hero sections and
saturated three-colour figure rows are built to sell on a landing page, and in an operator's
dashboard they would break §14's number rules, the type scale and `brandContrast`.

**One idea is worth taking anyway**, and it would have been worth taking without the links:

| From | The idea | Why it fits this page |
|---|---|---|
| PowerHours' leaderboard (`#1 … #10`, name, apps, APV) | **Rank the producers.** A rank column, ordered by the metric that matters, with the figure and its money stacked right-aligned. | The producers table *is* a standing and does not look like one. It answers the page's own question — *which producer is making me money* — in the first column instead of the sixth. **Promoted into the plan as Task 5a.** |
| Agent Compass' map | **Hierarchy by dimming**: the live path is bright and the rest drops back, rather than the important thing being decorated. | A cleaner answer to audit finding 9 than washing one row amber — quieten the settled rows instead. |

Two smaller observations, not worth tasks: both sites spend their accent colour **once per block**,
which this page does not; and both put the period toggle on the section heading's line, which this
page already does correctly.

What is **not** worth taking: the multi-colour figure row (amber / green / blue side by side) —
§12 fixes status colours and using three accents decoratively would make a genuine warning
unreadable; the display type scale; and the dashed connector graphics, which are a diagram of an
architecture, not a view of data.

**Question 6, new on 2 Nov** — raised by the research above, and the one thing I will not decide
alone: **does `chargebackTax` belong on this page?** It is the gap between what a policy cost to
acquire and what a *surviving* policy cost — in plain terms, what lapsing costs the agency per
policy. Nothing in the product displays it today. It is the most interesting figure the system
computes, and it is also the hardest to read at a glance, which is the argument for leaving it on
`/app/book-scorecards` beside its siblings. **Needs the owner's answer before Phase 3 ships.**

Question 7: **Seats comes off the figure strip** under the proposal above. It is administrative,
it changes twice a year, and it is taking a quarter of the headline space. Say if it is wanted.

The original wording of each question is kept below.

---

1. **The delta — worth a second read?** A month-over-month change is the single biggest
   improvement available, and it needs the previous period's figures. `readDashboard` is an
   expensive call (ledger sync, balances, commission entries). Three options:
   a. **Fetch the previous period lazily after first paint**, as the partner Overview does with its
      30-day window — the strip renders immediately, the deltas arrive a moment later. *My
      recommendation.*
   b. Compute both periods server-side in one call — simpler client, doubles the slowest page's work.
   c. No deltas. The page stays a report.

2. **What should the chart show?** Options, in order of how much new data each needs:
   a. **Submissions or issued per producer for the period** — already in `producers[]`, no new read.
      *My recommendation; it also answers the page's own question directly.*
   b. Production per week across the month — needs a date dimension the store does not return.
   c. A per-producer `Sparkline` — needs a series per producer; the most expensive.

3. **Is the agency name wanted on the page at all?** The top bar already names the workspace. If
   not, the header's description can carry the period instead and the name drops out entirely.

4. **Should the expiries list move beside the chart** in a 12-column row (home-dashboard style), or
   stay a full-width table under the producers? The first is tighter; the second scales better if
   an agency has fifty expiries.

5. **Is there a reference you like?** You mentioned finding something that inspires. If you have a
   dashboard whose density and hierarchy you want, send it and I will match the direction rather
   than choose one.

---

## Next step

**This spec needs your approval before any planning or code.** Answer the open questions — or say
"your recommendations" and I will take 1a, 2a, and keep the name — and I will produce the plan and
task list in `tasks/agency-dashboard-redesign/`.
