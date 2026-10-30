# Implementation Plan: Partner portal — Pipeline page redesign

**Surface:** `/partner/pipeline` → `components/partner/partner-lead-pipeline.tsx` (269 lines)
**Branch:** `redesign/sidebar-and-lead-sources` (current). This plan does not touch the in-progress
sidebar / Lead Sources work in `tasks/plan.md` and `tasks/todo.md`.
**Tasks:** `tasks/partner-pipeline/todo.md`
**Status:** planned, not started. Critique below is evidence-backed from the running page.

---

## Overview

The Pipeline page is the partner's answer to three questions, and today it answers none of them
cleanly:

1. **Did my leads arrive, and is anyone working them?**
2. **Is anything stuck?**
3. **What am I going to get paid?**

The page is built as a CRM work board. But a partner **cannot act on these leads** — they submit,
then wait; the agency's closers do the work. The right model is a **status tracker**, not a work
queue. Every decision below follows from that.

The second, larger problem is that the page speaks **two vocabularies at once** and they contradict
each other on screen.

---

## Design critique

Inspected on `http://localhost:3000/partner/pipeline` at 1536×826 (the owner's screen), signed in as
`Rion Test` (`partner_admin`), in board view, table view, with the filter panel open and with the
lead preview open. Source read in full. Severity: **P0** blocks the task · **P1** materially impairs
use · **P2** friction with a workaround · **P3** polish.

### P0 — the counters and the board contradict each other on screen

Captured live, same viewport, same second:

> **CLAIMED 1** … **STILL OPEN 1** — while the only lead on the board sits in a column titled
> **"New lead"**.

The counters speak the **shared lane** vocabulary (`lib/partnerLeads/lanes.ts`: New · Claimed ·
Verification · Converted). The board's columns are the **agency's own configured pipeline stages**
(`lib/partnerLeads/board.ts`, decision LA-1.17). Both are correct in their own language; together
they tell the partner their lead is simultaneously claimed and new.

This is the single biggest comprehension failure on the page, and it gets worse the more a tenant
customises its stage names. A partner cannot learn a vocabulary that changes per agency.

### P1 — the board affords an interaction it does not have

Kanban columns say *drag me*. These cannot be dragged: the partner has no authority to move
anything, and there is no drop handler. The layout also collapses against real data — each stage is
`flex-1`, so with one configured stage the single column stretches the full ~1000px of the card to
hold one 60px card (observed).

### P1 — nothing says how long anything has been waiting

The card prints `ageShort(submittedAt)` — "45 min" — with no threshold, no tone, no sort, and no
way to bring the oldest to the top. Meanwhile the server already computes `oldestOpenAt` and returns
it; the client's `PipelineResponse` type **does not even declare the field**. The one signal that
answers "is anything stuck?" is computed, serialised, and thrown away.

Vendor practice converges here: days-in-stage / no-activity indicators are the standard way to
surface stalled leads (see Research notes).

### P1 — "Nobody claimed it" is a whisper

When the SLA ladder decides a submission has gone unclaimed long enough to tell the partner
(`sla_partner_notified_at`), the result is that the stage column's **text changes** to
"Nobody claimed it". It gets a `warning` chip and otherwise the same visual weight as every other
row. The one row that needs the partner's attention looks like all the others.

### P1 — the detail panel is a raw database dump

Verified on screen, in this order:

```
AGE 18 · EMAIL tetttttt@gmail.com · PHONE 4724521313 · STATE IN · TOBACCO true ·
LANGUAGE English · LAST NAME test · FIRST NAME test · HEALTH NOTES test ·
DATE OF BIRTH 2008-02-27 · COVERAGE AMOUNT 55000 · EXISTING COVERAGE true ·
BENEFICIARY RELATIONSHIP Sibling
```

`Object.entries(detail.values)` with `key.replaceAll("_", " ")`, uppercased by CSS, in whatever
order the object serialised. No grouping, no ordering, no formatting: `true` instead of Yes,
`2008-02-27` instead of 27 Feb 2008, `55000` instead of $55,000.00, an unformatted phone number, and
`FIRST NAME test` / `LAST NAME test` repeating the panel's own title. On a page whose entire job is
to earn the partner's trust, this reads as unfinished.

### P1 — the panel is hand-built, against an explicit rule

`<aside className="lead-preview-panel">` with its own header, close button, tab strip and footer.
UI-CONSISTENCY §8 names this case directly: *"never hand-build an `<aside>` for this"* —
`DetailPanel` owns the header, Close, Escape, focus return and the slide-in. The hand-built one has
none: no Escape, no focus return, no focus trap on the narrow width where it covers the page. Its
`.lead-preview-*` rules live in `app/globals.css`, which §9 forbids for new screens.

### P1 — the partner cannot tell whose leads they are looking at

A `partner_user` is scoped to leads they created; a `partner_admin` sees the whole organisation's
(`service.ts:338`, `service.ts:469`). The page shows the two scopes **with identical chrome**. The
only thing that distinguishes them is the `description` string — which, because the header passes
`infoDescription`, is **behind an (i) icon** and invisible until hovered. A partner admin reading
"Submitted today 1" has nothing on screen telling them whether that is their own figure or their
team's.

The isolation itself is sound (see Isolation below). What is missing is *saying so*.

### P1 — the page never tells the partner what they will earn

"Converted 0 · last 30 days" is a dead end. The partner's payout terms already exist as data
(`partner_terms`: `payout_model`, `rate_cents`, `rate_pct_bp`, `effective_from`) and there is
already a formatter that renders them — `payoutLabel()` in `lib/partnerChat/partnerFacts.ts`
produces "$90.00 / transfer" and "12.5% revenue share". It is used for the agent-side chat facts and
never shown to the partner it describes.

### P2 — four departures from the kit, one click from pages that follow it

1. **Figures.** `StatStrip`/`StatTile` (§4, the old pattern) while the sibling **Overview** page it
   links to already uses the glossy `StatCard` (§4a). The same four numbers, two different looks,
   one click apart.
2. **View toggle.** A hand-rolled `role="group"` of buttons. `Segmented` exists
   (`components/ui/view-tabs.tsx:170`).
3. **Filters.** The `FilterPanel` is a **sibling of** `DataToolbar`, not in `TableCard`'s `filters`
   slot, and it is a flat `flex-wrap` row rather than §6a's labelled grid
   (`repeat(auto-fit, minmax(190px,1fr))`). There is no `ActiveFilters` chip row at all, so with
   five filters applied the toolbar shows a count badge and nothing else.
4. **Dates.** Raw `toLocaleString()` in four places — `10/30/2026, 1:50:02 AM`, seconds and all.
   `dateTime()` in `lib/format/dates.ts` is the house formatter.

### P2 — the page polls every 5 seconds and never says so

`setInterval(poll, 5000)` while visible. Numbers change under the user's eyes with no explanation.
`generatedAt` is in the response and `LiveStamp` is already on Overview.

### P2 — dead and misleading affordances

- The panel footer links **"Back to partner pipeline"** → `/partner/pipeline`, the page you are on.
- The panel subtitle prints the raw key `final_expense`; the table one column away says
  "Final expense" (`productLineLabel` is applied in one place, not the other).
- A board column can show a count of 5 with no cards under it and the text
  "Load more to see these leads" — the count is the server's `stage.leadCount`, the cards come from
  a paged `rows` array, so the two legitimately disagree and the user is sent to find a button in
  the card footer.

### P2 — table affordances

Head is title-cased ("Submitted By") against §6's sentence-case rule, and no column sorts — so the
oldest lead cannot be brought to the top in either view.

### P3 — the toolbar wraps to three rows at 1536

Observed: search alone on row one; product select + Filters on row two; the filter panel on row
three. Fourteen controls stacked above a single lead.

### What is already right — keep it

`EmptyState` with a real action, `NoMatches` with Clear, `SectionLoading` inside the card,
visibility-aware polling that never stacks a tick on a slow one, the deep-link state reader
(`?stage_id=…&view=table&lead=…`) that lets Overview's figures open the rows behind them, and the
read-only lock line on the form snapshot. None of that changes.

---

## Isolation — already enforced, three layers

The requirement "a partner sees only their own leads" is **met in the data layer today**. The
redesign must not weaken it, and must now also make it legible.

| Layer | Where | What it does |
|---|---|---|
| Organisation | `requirePartner.ts:86` | `partnerId` and `tenantId` come from the **signed session**, never from the request |
| Request | `app/api/partner/leads/pipeline/route.ts` | a `partner_id` query param that is not the caller's → **403** "You cannot access another partner pipeline" |
| Person | `service.ts:338` | `effectiveCloserId = role === "partner_user" ? userId : …` — a plain partner user's rows, counters, lanes and oldest-open are all scoped to leads **they** created |
| Record | `service.ts:469` | a `partner_user` opening another person's lead detail gets **"Lead not found"** |

So: no partner ever sees another organisation's leads; inside an organisation a plain user sees only
their own, and an admin sees the team's. Task 11 proves this with a test rather than restating it,
and Task 4/5 put the scope on screen.

---

## The design

### Thesis

**A tracker, not a work queue.** Everything the partner cannot do gets out of the way; the three
things they came for get the space: *where is it*, *is it stuck*, *what is it worth*.

### Structure, top to bottom

**1 · Page header — unchanged.**
`<PageHeader title="Pipeline" visible infoDescription />`, exactly as every other partner page
(owner instruction: the title treatment stays). Added to `actions`: a `LiveStamp` (the page polls;
say so) and the primary **Submit a lead**, mirroring Overview.

**2 · Four glossy stat cards replacing the strip** (§4a), matching Overview card-for-card so the two
pages agree:

| Card | Period | Footer fact | Action |
|---|---|---|---|
| Submitted today | today | Since midnight, your time | → list filtered to today |
| With a closer | — | Claimed or on a call | → list |
| **Converted** | 30 days | **the earnings line** (below) | → **Payouts** |
| **Still open** | — | **"Oldest: 6 days"** from `oldestOpenAt` | → oldest-first |

**Still open** takes `tone="warn"` when the oldest open lead crosses the attention threshold — the
one amber card per row §4a allows, and the page's answer to *"is anything stuck?"*.

**3 · The earnings line — honest, or absent.** Read the partner's own current `partner_terms` row
and render it with the existing `payoutLabel()`:

- **Per-item models** (`per_transfer`, `per_lead`, `per_sale`, `per_issued_policy`): each converted
  lead is worth exactly `rate_cents`, so *"4 converted · about $360 at $90.00 / sale"* is a true
  statement, not a guess. Labelled **about**, with "before your agency's statement" behind the (i).
- **`revenue_share`**: the amount depends on agency revenue the partner cannot see, so **no
  per-lead number is honest**. Show the rate ("12.5% revenue share") and send them to Payouts.
- Terms missing or unreadable → the fact is left out entirely. A figure that was not read is never
  drawn as 0 (the §4b rule, applied here).

Settled money stays where it belongs: `/partner/payouts`. This card is an estimate and says so.

**4 · "Needs you" — conditional, and only when real.** When any lead carries the SLA's
nobody-claimed mark, one amber line above the list: *"2 leads nobody has claimed yet — oldest 6
days"*, clicking filters the list to exactly those. Nothing waiting → **the row is not there**; no
empty card, no "All caught up" box (the §4b pattern from the agent home).

**5 · The list, in one `TableCard`.**

- **Toolbar, §6 order, one row at 1536:** search → product → `Filters` (count badge) → spacer →
  `Segmented` Board/Table → Export CSV → Refresh.
- **`filters` slot (§6a):** `FilterPanel` as a labelled grid + `ActiveFilters` removable chips with
  Clear. For a `partner_admin`, the "Submitted by" control gains **Mine / Everyone's** so an admin
  can narrow to their own submissions — and the scope is then stated in the stat row's label
  ("Your leads" / "Your organisation's leads") instead of hiding behind the (i).

- **Board view — the four shared stages** *(owner decision, this plan)*:

  ```
  ┌ New ──────── 3 ┐ ┌ With a closer ─ 2 ┐ ┌ On a call ── 1 ┐ ┌ Converted ── 4 ┐
  │ Maria Lopez    │ │ John Carter       │ │ Ann Diaz       │ │ …              │
  │ Final expense  │ │ Final expense     │ │ Medicare       │ │                │
  │ ● 12 min       │ │ ▲ 2 days          │ │ ● 9 min        │ │                │
  │ ▸ New lead     │ │ ▸ Dialing         │ │ ▸ Transferred  │ │                │
  └────────────────┘ └───────────────────┘ └────────────────┘ └────────────────┘
  ```

  Fixed columns, identical in every tenant, **in the same order as the counters above them**, so the
  two can never disagree again. A fifth **Closed** column appears only when it holds something.
  The agency's own stage name rides on each card as a small secondary line (`▸ Dialing`) — the
  tenant's vocabulary is kept, it just stops being the organising principle. Columns get a fixed
  sensible width instead of `flex-1`, so one stage no longer stretches to fill 1000px.

- **Card anatomy** (customer · product · age · owner · state — the vendor-consistent set):
  name 15/600 · product · **age with a tone**, grey → amber → red by threshold, always a dot or
  icon plus text per §12, never colour alone · the agency stage line · a
  `StatusChip tone="warning"` when the SLA has marked it unclaimed.

- **Table view:** Lead · Product · Stage · Submitted by *(admin)* · **Age** · Submitted · action.
  Sentence-case heads, `dateTime()` dates, `tabular-nums`, **sortable** by age and submitted.

**6 · The record — `DetailPanel mode="split"`**, replacing the hand-built aside. Escape, focus
return, the slide-in and the narrow-width overlay come for free; `.lead-preview-*` leaves
`globals.css`.

- **Header:** customer name · `productLineLabel(product)` (not the raw key) · the shared stage chip.
- **Status first — a compact progress strip:** Submitted → Claimed → On a call → Converted, reached
  steps filled, current one marked, elapsed time under each, built from `detail.timeline` + `lane`.
  This is the *"what happens next"* the research says partners come for.
- **Submission, grouped and formatted:** Person · Contact · Coverage · Notes, in that order, with
  `true` → Yes, ISO dates → 27 Feb 2008, phones formatted, amounts as money (§14). Fields already in
  the header do not repeat. The read-only lock line stays — that is a fact the partner must know.
- **Footer:** a real action — **Message your agent about this lead** → `/partner/messages` —
  instead of a link to the page you are already on.

**7 · States.** `EmptyState` → "Submit a lead"; `NoMatches` → Clear; `SectionLoading` in the card;
the inline error with Try again. Already right; carried over.

### `/design/pipeline`

The dev database holds **one** lead, so none of the above is verifiable on the live page. A dev-only
preview route with sample data — busy (40 leads, 6 stages) · quiet · empty · error · many pipelines ·
both roles — the way `/design/home` works for the agent dashboard.

### What does not change

The `PageHeader` treatment, the API's shape and auth, the lane definitions, which leads a partner may
see, the deep-link parameters, and the fact that a partner can edit nothing here.

---

## Architecture decisions

| Decision | Rationale |
|---|---|
| Board columns become the four shared lanes, agency stage on the card | One vocabulary per page. Counters and board are generated from the same source, so the P0 contradiction becomes structurally impossible. Reverses LA-1.17's column choice; **nothing is hidden** — the agency stage stays on every card and in the table's Stage column. |
| Age tone from `submittedAt`, not "days in stage" | There is **no `stageEnteredAt`** in the data. Days-in-stage would need a migration; `updatedAt` is *last touched*, not *entered stage*, and using it would be a plausible-looking lie. Total age is true and answers the same question. |
| Earnings read from `partner_terms`, per-item models only | The rate and the formatter already exist. Revenue-share cannot be estimated without agency revenue, so it is not estimated. |
| `DetailPanel`, not the aside | §8 names this exact case. Also buys Escape, focus return and the narrow-width overlay. |
| Preview route before the redesign, not after | One lead in the dev DB. Without it, "verified" would mean "the happy path with a single card". |
| No drag-and-drop | The partner has no authority to move a lead. An affordance without a capability is a lie. |

---

## Risks and mitigations

| Risk | Impact | Mitigation |
|---|---|---|
| Lane columns lose a tenant's stage detail | Med | Agency stage on every card and in the table's Stage column; the stage filter is untouched |
| Reversing LA-1.17 surprises whoever decided it | Med | Decision recorded here and in `components/partner/README.md`; the data contract does not change, so it is reversible in one component |
| An estimated payout read as a promise | **High** | "about", the rate named inline, "before your agency's statement" in the (i), revenue-share excluded, Payouts one click away |
| Attention thresholds are a product guess | Med | Proposed defaults (amber 4h, red 24h unclaimed) in one exported constant, flagged below for the owner |
| Board height `h-[max(420px,calc(100vh-380px))]` breaks as the header changes | Low | Re-measure at 1536×826, 1366×657 and 375 in Task 12 |
| `oldestOpenAt` is null whenever any filter is applied (by design) | Low | The fact is omitted, never shown as 0 — same rule as §4b |

---

## Open questions for the owner

1. **Attention thresholds.** Proposed: amber at **4 h** unclaimed, red at **24 h**. These should
   match the SLA ladder's own rungs if those are configurable per tenant — worth confirming against
   `scripts/run-unclaimed-sla.mjs` before Task 1 hard-codes them.
2. **Days in stage.** Genuinely useful and genuinely unavailable — it needs a `stage_entered_at`
   column. Out of scope here; worth its own task if stall-by-stage matters.
3. **Closed column.** Shown only when non-empty. Alternative: never on the board, table only (its
   behaviour today). Current plan shows it, since "what happened to the ones that didn't convert" is
   a fair partner question.

---

## Research notes

Practitioner guidance, not usability research — treated as convergent vendor practice:

- Lead cards converge on name, company, value, contact, and **time since last update**, with
  configurable key fields and an assignee + overdue indicator — [Growlio](https://growlio.helpscoutdocs.com/article/19-leads-kanban-board), [Twenty](https://www.mintlify.com/twentyhq/twenty/user-guide/views/kanban-views).
- **Aging is the standard stall signal**: days-in-stage indicators, no-activity-for-X-days markers,
  and red past-due indicators — [Pipelinq design references](https://pipelinq.conduction.nl/nl/docs/DESIGN-REFERENCES), [FieldCamp](https://docs.fieldcamp.ai/clients/sales-pipeline-kanban-board-for-field-service-leads-fieldcamp) ("cards that sit in one stage too long are often your biggest revenue leak"), and an open [GoHighLevel feature request](https://ideas.gohighlevel.com/dashboard/p/visual-lead-aging-indicators-in-pipelines) showing it is still a gap elsewhere.
- A board should expose **age or blocked state**, not rely on card count alone — [SaaSFrame](https://www.saasframe.io/patterns/kanban-board).
- **Board for daily work, table for analysis** — keep both — [FieldCamp](https://docs.fieldcamp.ai/clients/sales-pipeline-kanban-board-for-field-service-leads-fieldcamp), [Pipeline CRM](https://pipelinecrm.com/blog/kanban-sales-pipelines).
- Referral/partner portals converge on **stage label + last updated + who owns it + an explicit next
  step**, with a **per-referral status timeline** — [RiseKit](https://intercom.help/risekit/en/articles/15305712-how-to-use-the-external-referrer-portal), [Adyen partner portal](https://help.adyen.com/knowledge/partners/partner-portal/how-do-i-keep-up-to-date-with-a-referrals-status-once-i-have-submitted-it), [Lead Docket](https://support.leaddocket.com/hc/en-us/articles/360045900831-The-Referral-Dashboard).
- Partners want to know **when to follow up versus when to wait** — [Flexxbuy](https://articles.flexxbuy.com/partner-info/how-do-i-track-the-status-of-my-leads-), [Cashflow.io](https://support.cashflow.io/track-referral-status).

No formal usability studies or accessibility findings surfaced for either pattern; the colour-plus-
icon rule for the age tones comes from UI-CONSISTENCY §12, not from these sources.

---

## Coverage and limits of this critique

- **Inspected:** `/partner/pipeline` at 1536×826 (emulated), Chromium in the Claude browser pane,
  signed in as `partner_admin`; board view, table view, filter panel open, lead preview open;
  accessibility tree and page text read; full source of the component, its API route, service,
  lanes, counters and types.
- **Not inspected:** the `partner_user` role, a busy board, many pipelines, the error state, narrow
  widths, and the SLA-marked "Nobody claimed it" row — the dev database holds one lead and one
  stage. This is exactly what `/design/pipeline` (Task 3) exists to fix before Task 12 claims
  verification.
- **Not measured:** contrast ratios against the glass surface, keyboard order through the board, and
  animation frame stability. Deferred to Task 12 with the preview route in place.
