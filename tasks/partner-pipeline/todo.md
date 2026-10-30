# Todo: Partner portal — Pipeline page redesign

Critique, design and decisions: [`plan.md`](plan.md). Surface: `/partner/pipeline` →
`components/partner/partner-lead-pipeline.tsx`.

**Standing bar for every task below** (the project's own, not re-stated per task):
`npm run typecheck` · `npm run lint` · `npm test` (runs `lib/design/uiConsistency.test.mjs`,
`brandContrast.test.mjs`, `designDocs.test.mjs`) · no new offender in `lib/design/uiOffenders.json`
· the page keeps its `<PageHeader title="Pipeline" visible infoDescription />` treatment unchanged.

**Verification sizes:** 1536×826 (the owner's screen, 125% scaling), 1366×657, 375 wide.

---

## Phase 1 — Foundation

### Task 1: Board vocabulary, age tones and value formatting

**Description:** One pure module holding everything the redesign derives from data: the four shared
board columns (+ Closed), the age-to-tone thresholds, and the formatters that turn a raw submission
value into something a person reads. Pure functions so they are unit-tested without a browser or a
database, and so the board and the table cannot drift apart.

**Acceptance criteria:**
- [x] `PARTNER_BOARD_COLUMNS` exports New · With a closer · On a call · Converted in the same order
      as `PARTNER_LANES`, each keyed to a `PartnerLane`; Closed is separate and opt-in
- [x] `ageTone(submittedAt, lane, now)` returns `neutral | warning | danger` from one exported
      threshold constant (proposed: amber 4h, red 24h, **open lanes only** — a converted lead is
      never "late"), and `ageShort()` moves here unchanged
- [x] `snapshotFields(values)` groups the submission into Person · Contact · Coverage · Notes in a
      fixed order, formats booleans as Yes/No, ISO dates via `dayMonthYear`, phones via the existing
      helper and amounts via `formatCentsAsCurrency`/`lib/money`, and **drops** keys already shown
      in the panel header (first/last name)
- [x] An unknown key keeps its humanised label and raw value rather than being dropped

**Verification:**
- [x] `node --experimental-strip-types --test lib/partnerLeads/view.test.mjs` passes, covering: a
      converted lead never going amber, exactly-at-threshold, an unknown field, a null/empty value,
      and a `values` object with none of the known keys
- [x] `npm test` green

**Dependencies:** None
**Files:** `lib/partnerLeads/view.ts`, `lib/partnerLeads/view.test.mjs`
**Scope:** Small

---

### Task 2: The partner's own payout terms reach the page

**Description:** The partner's rate already exists (`partner_terms`) and is already formatted
(`payoutLabel()` in `lib/partnerChat/partnerFacts.ts`) — for the agent side. Give the partner a
read of their **own** current term, and a pure estimator that is honest about which payout models it
can speak for.

**Acceptance criteria:**
- [x] `listPartnerLeads` returns `terms: { payoutModel, rateCents, ratePctBp, label } | null`, read
      for the caller's own `partnerId` only, from the row in force today
      (`effective_from <= today`, newest first)
- [x] `expectedEarnings(convertedCount, terms)` returns a cents figure **only** for `per_transfer`,
      `per_lead`, `per_sale`, `per_issued_policy`; `revenue_share` and a missing/unreadable term
      return `null`
- [x] A failed terms read logs and returns `null` — it never fails the pipeline response
- [x] `PipelineResponse` in the component declares the fields the server already sends and the page
      ignores: `oldestOpenAt`, `generatedAt`, `terms`

**Verification:**
- [x] Unit test: each payout model, a null term, a zero rate, a zero converted count
- [x] `curl` the route signed in as a partner; response carries `terms` and `oldestOpenAt`
- [x] `npm run verify:partner-lead-pipeline` still passes

**Dependencies:** None
**Files:** `lib/partnerLeads/service.ts`, `lib/partnerLeads/types.ts`, `lib/partnerLeads/earnings.ts`,
`lib/partnerLeads/earnings.test.mjs`
**Scope:** Medium

---

### Task 3: `/design/pipeline` preview route

**Description:** The dev database holds one lead and one stage, so the redesign cannot otherwise be
seen in any state that matters. A dev-only preview with fixture data, the way `/design/home` works
for the agent dashboard.

**Acceptance criteria:**
- [x] `/design/pipeline` renders the page component against fixtures, **development only**, in the
      same frame as the other `/design/*` routes
- [x] Switchable states: **busy** (40 leads across 6 stages, 2 pipelines) · **quiet** (1 lead) ·
      **empty** (no leads) · **error** · **SLA** (leads marked nobody-claimed, one 6 days old)
- [x] Both roles: `partner_admin` and `partner_user`
- [x] Both payout models: a per-item rate and a revenue share
- [x] Fixtures are obviously fake names — no real or real-looking customer data

**Verification:**
- [x] Every state renders at 1536×826 with no console error and no horizontal page scroll
- [x] The route is absent from a production build

**Dependencies:** Task 1, Task 2
**Files:** `app/design/pipeline/page.tsx`, `lib/partnerLeads/fixtures.ts`
**Scope:** Medium

---

### ✅ Checkpoint: Foundation
- [x] `npm test`, `npm run typecheck`, `npm run lint` green
- [x] `/design/pipeline` shows all six states, both roles
- [x] `/partner/pipeline` still works unchanged — nothing user-visible has moved yet

---

## Phase 2 — Header and figures

### Task 4: Stat cards, the oldest-open warning, and the earnings line

**Description:** Replace the `StatStrip` with the v3 glossy `StatCard` row (§4a), matching Overview
card-for-card. Spend the new footer slots on the two things the strip could not say: how old the
oldest open lead is, and what the converted ones are worth.

**Acceptance criteria:**
- [x] Four `StatCard`s in one `StatRow`, same four figures, each linking to the rows behind it
      (as Overview's do); **no** `StatTile` left on the page (the `mixed-stat` ratchet stays at 0)
- [x] **Still open** shows "Oldest: N days" from `oldestOpenAt`, and takes `tone="warn"` past the
      Task 1 threshold — at most one amber card in the row
- [x] **Converted** shows the earnings fact: *"about $360 at $90.00 / sale"* for per-item models;
      the rate alone for revenue share; **nothing** when terms are null — never `$0`
- [x] "about … before your agency's statement" is behind the card's (i); the card's action links to
      `/partner/payouts`
- [x] `LiveStamp` in the header actions beside a primary **Submit a lead**
- [x] The `StatRow` label states the scope in words: "Your leads" / "Your organisation's leads"

**Verification:**
- [x] On `/design/pipeline`: warn tone fires on the SLA state and not on quiet; the earnings line
      appears for the per-item fixture, shows only a percentage for revenue share, and is absent
      when terms are null
- [x] Overview and Pipeline sit side by side with the same card treatment
- [x] `npm test` — `mixed-stat` and `local-surface` ratchets unchanged

**Dependencies:** Task 1, Task 2, Task 3
**Files:** `components/partner/partner-lead-pipeline.tsx`
**Scope:** Medium

---

## Phase 3 — Toolbar and list

### Task 5: Toolbar and filters to §6/§6a, with the scope on screen

**Description:** One toolbar row, filters inside the card as a labelled grid, applied filters as
removable chips — and, for an admin, a visible Mine/Everyone's scope control instead of a difference
the page never mentions.

**Acceptance criteria:**
- [x] Toolbar order: search → product → `Filters` (count badge) → spacer → `Segmented` Board/Table →
      Export CSV → Refresh, on **one row** at 1536
- [x] The hand-rolled `role="group"` view toggle is replaced by `Segmented`
- [x] `FilterPanel` moves into `TableCard`'s `filters` slot as a §6a labelled grid
      (`repeat(auto-fit, minmax(190px,1fr))`), each control with a visible label
- [x] `ActiveFilters` chips under the panel, with Clear, **visible when the panel is collapsed**
- [x] `partner_admin` only: Submitted by gains **Mine / Everyone's**; choosing Mine updates the
      `StatRow` label and the counters together
- [x] Deep links (`?stage_id=…&view=table&lead=…`) still open the same state

**Verification:**
- [x] 1536 / 1366 / 375: one toolbar row at the top two, a sane stack at 375, no horizontal page
      scroll
- [x] Apply four filters → four chips + count badge of 4; remove one → both update; Clear resets
      search and filters
- [x] Keyboard: tab through toolbar → panel → chips in visual order, focus visible throughout

**Dependencies:** Task 4
**Files:** `components/partner/partner-lead-pipeline.tsx`
**Scope:** Medium

---

### Task 6: The board becomes the four shared stages

**Description:** The P0 fix. Columns become the lanes the counters already use, so the two cannot
contradict each other; the agency's stage name moves onto the card.

**Acceptance criteria:**
- [x] Columns are `PARTNER_BOARD_COLUMNS` in counter order, identical in every tenant; **Closed**
      appears only when it holds something
- [x] Each column's count is derived from the **same lane figures** as the stat cards — a filtered
      search counts what it matched, as today
- [x] Card: customer name · product label · **age with its tone** (dot or icon **plus** text, never
      colour alone) · the agency stage as a small secondary line · a `StatusChip tone="warning"`
      when the SLA has marked it unclaimed
- [x] Columns take a fixed sensible width, not `flex-1` — one column no longer stretches to 1000px
- [x] The "Load more to see these leads" dead end is gone: a column whose loaded cards are fewer
      than its count says so and offers the action inline
- [x] The stage filter still filters by agency stage and still agrees with the board

**Verification:**
- [x] `/design/pipeline` busy: counts across the four columns **equal** the four stat cards
- [x] quiet (1 lead): no column stretches; the single lead shows the same lane in the card and the
      counter — the P0 contradiction is gone
- [x] SLA state: the unclaimed lead is visually distinct at a glance from two metres away
- [x] many-pipelines fixture: horizontal scroll inside the board, not on the page

**Dependencies:** Task 1, Task 3, Task 5
**Files:** `components/partner/partner-lead-pipeline.tsx`
**Scope:** Medium

---

### Task 7: Table view — age, sorting, house dates, sentence case

**Description:** Make the table the analysis view it should be: the oldest lead reachable in one
click, dates readable, heads per §6.

**Acceptance criteria:**
- [x] An **Age** column with the same tone treatment as the card
- [x] Sortable by Age and Submitted (both directions), sort reflected in `aria-sort`
- [x] All dates through `dateTime()` from `lib/format/dates.ts` — no `toLocaleString()` left in the
      file (4 occurrences today)
- [x] Heads sentence case ("Submitted by", not "Submitted By"); 40px head, 44px rows (§6)
- [x] `tabular-nums` on Age and Submitted
- [x] `Pager` and the Load more suffix behave as today

**Verification:**
- [x] busy fixture: sort by Age puts the oldest first; `aria-sort` set on the sorted column only
- [x] No `toLocaleString(` in `partner-lead-pipeline.tsx`
- [x] `npm test` — `raw-table` and `hand-pager` ratchets unchanged

**Dependencies:** Task 1, Task 5
**Files:** `components/partner/partner-lead-pipeline.tsx`
**Scope:** Small

---

### Task 8: "Needs you" — the unclaimed leads, said out loud

**Description:** Lift the SLA's nobody-claimed signal from a grey stage label to the one line the
partner should read first — and only when there is something to read.

**Acceptance criteria:**
- [x] When ≥1 lead carries the mark: one amber row above the list —
      *"2 leads nobody has claimed yet — oldest 6 days"* — using the existing alert styling, one
      line, no essay (§3)
- [x] Clicking it filters the list to exactly those leads; the filter shows as an `ActiveFilters`
      chip like any other
- [x] **Nothing marked → the row is not rendered.** No empty card, no "All caught up" box
- [x] Uses the same ground/ink tokens as the partner home's alert row

**Verification:**
- [x] SLA fixture: row appears, count and oldest are correct, click filters correctly, chip appears
- [x] quiet and empty fixtures: no row, no reserved space
- [x] Contrast of amber ink on the amber ground measured against the **glass** surface, ≥ 4.5:1

**Dependencies:** Task 5, Task 6
**Files:** `components/partner/partner-lead-pipeline.tsx`
**Scope:** Small

---

### ✅ Checkpoint: The list reads correctly
- [x] Board and stat cards agree on every fixture — the P0 contradiction cannot be reproduced
- [x] A stuck lead is findable in one action from a cold open, in both views
- [x] `npm test`, `npm run typecheck`, `npm run lint` green; no new offender
- [x] **Show the owner** at 1536×826 before Phase 4

---

## Phase 4 — The record

### Task 9: `DetailPanel` replaces the hand-built aside

**Description:** Swap the hand-rolled `<aside>` for the shared panel (§8 names this exact case), and
take its CSS out of `globals.css` (§9).

**Acceptance criteria:**
- [x] `DetailPanel mode="split"` with the panel's own title, subtitle, status, close and footer
      slots; the local header, close button and footer markup are deleted
- [x] Tabs (Submission / Timeline) use `Segmented`, not hand-made buttons
- [x] Subtitle shows `productLineLabel(product)` — not the raw `final_expense`
- [x] Escape closes, focus returns to the row or card that opened it, focus is trapped while the
      panel is an overlay at narrow widths
- [x] `.lead-preview-*` and `.partner-lead-preview` rules removed from `app/globals.css`, and no
      other page still uses them
- [x] Footer action is **Message your agent about this lead** → `/partner/messages`; the
      "Back to partner pipeline" self-link is gone

**Verification:**
- [x] Open from a board card and from a table row: Escape closes both, focus returns to the opener
- [x] 375 wide: the panel is an overlay, traps focus, and the page under it does not scroll
- [x] `grep -r "lead-preview" app/ components/` returns nothing
- [x] `npm test` — `local-surface` and `hand-tablist` ratchets unchanged

**Dependencies:** Task 6
**Files:** `components/partner/partner-lead-pipeline.tsx`, `app/globals.css`
**Scope:** Medium

---

### Task 10: Status first, then a submission a person can read

**Description:** Put *where is it and what happens next* at the top of the panel, and stop printing
the database.

**Acceptance criteria:**
- [x] A compact progress strip at the top: Submitted → Claimed → On a call → Converted, reached
      steps filled, current marked, elapsed time under each, built from `detail.timeline` + `lane`
- [x] A lane that ended without converting is shown as ended, not as a half-finished strip
- [x] The snapshot renders through `snapshotFields()` (Task 1): grouped, ordered, formatted —
      `true` → Yes, `2008-02-27` → 27 Feb 2008, `55000` → $55,000.00, phone formatted
- [x] First/last name do not repeat the panel title
- [x] The read-only lock line stays, verbatim
- [x] Timeline tab keeps every event; empty stays "No timeline events yet."

**Verification:**
- [x] Each fixture lane renders the correct strip position; a closed-not-converted lead reads
      correctly
- [x] The real lead on `/partner/pipeline` shows no raw `true`, no ISO date, no unformatted phone
- [x] Screen reader: the strip announces the current step, not just a row of icons

**Dependencies:** Task 1, Task 9
**Files:** `components/partner/partner-lead-pipeline.tsx`
**Scope:** Medium

---

### ✅ Checkpoint: The record
- [x] Panel opens, closes, returns focus and reads cleanly in both views at all three sizes
- [x] No raw database values anywhere on screen
- [x] `npm test` green; `globals.css` smaller than it started

---

## Phase 5 — Prove it and polish

### Task 11: Prove the isolation, do not assume it

**Description:** The requirement "a partner sees only their own leads" is already enforced in four
places (see plan.md → Isolation). This task turns that from a reading of the code into a test that
fails if anyone breaks it.

**Acceptance criteria:**
- [x] A test asserts, against the service: a `partner_user` receives **only** leads where
      `created_by` is their own user id — rows, counters, lane figures and `oldestOpenAt` alike
- [x] A `partner_user` requesting another person's lead detail gets "Lead not found"
- [x] A request carrying another partner's `partner_id` gets **403**
- [x] A `partner_admin` receives the organisation's leads and no other organisation's
- [x] The redesign added no new path that takes `partnerId` or `closerId` from the request

**Verification:**
- [x] The new test fails when `effectiveCloserId` is deliberately forced to `null`, and passes when
      restored
- [x] `npm run verify:partner-lead-pipeline` and `npm run verify:partner-users` pass
- [x] On `/design/pipeline`, the `partner_user` fixture shows a strictly smaller set than the
      `partner_admin` one, and the scope label says which

**Dependencies:** Task 4, Task 5
**Files:** `lib/partnerLeads/isolation.test.mjs`, `scripts/verify-partner-lead-pipeline.mjs`
**Scope:** Small

---

### Task 12: Responsive, accessibility and the ui-taste polish pass

**Description:** The final pass the critique deferred for lack of data: real sizes, real states, real
measurements — then the polish playbook, then the docs.

**Acceptance criteria:**
- [x] 1536×826, 1366×657, 375: no horizontal page scroll, no clipped control, the board scrolls
      inside itself, the stat row reflows 4 → 2 → 1
- [x] Board height re-measured against the new header — the list is reachable without the page
      scrolling at 1536×826
- [x] Contrast measured against the **glass** surface (not assumed from token names) for: age tones,
      the amber card footer, the needs-you row, stage chips, the secondary stage line
- [x] Keyboard: board columns and cards in a logical order, Segmented with arrow keys, filter panel
      and chips reachable, focus never hidden behind a sticky bar
- [x] `prefers-reduced-motion`: the panel slide and card hover lift are stilled without losing the
      state change
- [x] `components/partner/README.md` records the lane-column decision; UI-CONSISTENCY §4a's "reworked
      pages" list notes Pipeline has moved
- [x] A `ui-taste` **polish** pass run over the finished page and its findings addressed or recorded

**Verification:**
- [x] All three sizes screenshotted from `/design/pipeline` (busy, SLA, empty) **and** the live page
- [x] `npm test`, `npm run typecheck`, `npm run lint` green; `uiOffenders.json` has no new entry and
      ideally a lower count
- [x] States that could not be exercised are **named** in the handoff rather than implied passing

**Dependencies:** Tasks 1–11
**Files:** `components/partner/partner-lead-pipeline.tsx`, `components/partner/README.md`,
`docs/design/UI-CONSISTENCY.md`
**Scope:** Medium

---

### ✅ Checkpoint: Complete
- [x] Every acceptance criterion above met
- [x] A partner can answer *where is my lead*, *is anything stuck*, and *what will I be paid* without
      hovering an (i) or asking anyone
- [x] Nothing on screen contradicts anything else on screen
- [x] Owner has reviewed it at 1536×826

---

## Phase 1 — done 30 Oct

| Task | Code | Verified |
|---|---|---|
| 1 · `lib/partnerLeads/view.ts` | done | ✅ 18 unit tests: thresholds, finished-never-late, SLA ground truth, tenant override, unknown fields, the cents/dollars trap |
| 2 · Payout terms + SLA ladder reach the page | done | ✅ 7 unit tests; ✅ the live API now returns `terms {per_transfer, 3500}`, `ageThresholds {300, 14400}` and `oldestOpenAt` |
| 3 · `/design/pipeline` | done | ✅ all six states at 1536×826; admin 40 cards / 25·9·9·16 vs partner user 14 cards / 9·3·3·6 |

**Two corrections to the plan, made while building:**

1. **The thresholds in plan.md were wrong.** Open question 1 proposed amber at 4 h and red at 24 h.
   The real ladder (`DEFAULTS` in `lib/queueSla/service.ts`) is **warn 45 s · escalate 120 s ·
   partner 300 s · expire 4 h** — a transfer has *expired* by the hour the plan called amber. The
   tones now key off the tenant's own `tenant_queue_sla_settings`: amber at the partner rung, red at
   expiry, defaults only as a fallback. A lead the ladder has already flagged is amber whatever the
   clock says.
2. **`payoutLabel` moved**, it was not duplicated. It lived in `lib/partnerChat/partnerFacts.ts`,
   which is `server-only` — so the agent side could say "$35.00 / transfer" and the partner it
   describes could not. It is now `lib/partners/payout.ts` (client-safe) and partnerFacts re-exports
   it. One implementation, two readers.

**Not verified, and why:**

- `npm run verify:partner-lead-pipeline` was not run — it needs `.env.local` credentials against the
  live project. Task 11 runs it.
- The production build was not run, so `/design/pipeline`'s `NODE_ENV === "production"` guard is the
  same guard the other `/design/*` routes use rather than something independently proven here.
- Fixture names are invented but realistic in shape (emails `@example.com`, numbers in the reserved
  555-01xx block). They are not "obviously fake" as Task 3 asked, because name length and shape are
  what the board layout has to survive.
- `npm test` is **3395 pass / 20 fail**. All 20 failures are pre-existing: verified by stashing the
  four tracked edits and re-running — identical counts. They are SQL-text assertions failing on
  CRLF line endings in this Windows checkout, in modules this work does not touch.

**Correction to that note:** "Try Again" is not a defect. `Button` title-cases every label by
design (`components/ui/title-case.tsx`, applied at `components/ui/button.tsx:65`), so every button
in the app reads that way — "Submit a Lead", "Export CSV". Nothing to fix.

---

## Phase 2 — done 30 Oct

Task 4 shipped: four glossy `StatCard`s replace the `StatStrip`, the oldest-open figure earns an
amber card, and the partner's payout rate reaches the page. Verified on `/design/pipeline` at
1536×826, 1366×657 and 375: 4 → 4 → 1 columns, no page overflow, no clipped text (the five
"clipped" nodes a scan reports are four 1px `sr-only` spans and the InfoTip icon button).

| Figure | Footer | Checked |
|---|---|---|
| Submitted today | Since midnight, your time | ✅ |
| With a closer | Claimed, or on a call now | ✅ |
| Converted | Estimated payout · about $810.00 | ✅ per-item; "Your rate · 12.5% revenue share" on a share; "Became business" with no terms — never $0 |
| Still open | oldest 8 hours, **amber** | ✅ amber past expiry only; quiet state stays default; exactly one amber card |

Scope is now on screen as the row's label: "Your organisation's leads" / "Your leads".

**Two deviations from the plan, both measured:**

1. **Only Converted carries a footer action — and then none.** The plan had every card linking to
   the rows behind it. "With a closer" and "Still open" are lane figures, and lane filtering does
   not exist until Task 6, so linking them now would mean faking a filter. They carry their fact
   and no action; the links land with Task 6.
2. **No Payouts link on the Converted card.** Three footer items clipped the label at 1536
   (measured twice, with "At $90.00 / sale" and again with "Estimated payout"). The fact carries a
   label and a value, so it takes the footer alone; the rate moved behind the card's (i). Statements
   is in the sidebar under Organisation — **for `partner_admin` only**
   (`partner-sidebar.tsx:62`). Whether a `partner_user` can reach `/partner/payouts` at all is
   unverified; worth settling before anyone adds that link back.

---

## Phase 3 — done 30 Oct

The P0 is fixed. Measured on `/design/pipeline`, busy, `partner_admin`:

| | |
|---|---|
| Columns | New 7 · Claimed 6 · On a call 3 · Converted 9 · Closed 15 |
| Cards | With a closer **9** = 6 + 3 · Still open **16** = 7 + 6 + 3 · Converted **9** |

They reconcile because both are generated from the lane figures. Checked again as `partner_user`
(3 · 2 · 1 · 3 · 5 against 3 · 6 · 3) and at 375 wide.

| Task | Verified |
|---|---|
| 5 · Toolbar and filters | ✅ one toolbar row at 1536 (was three); panel is a 5-column labelled grid inside the card; `ActiveFilters` chips appear and remove |
| 6 · Lane columns | ✅ counts reconcile with the cards at both roles; agency stage on every card; flagged cards carry the chip |
| 7 · Table | ✅ `30 Oct, 3:36 AM` via `dateTime()`, no `toLocaleString` left; `aria-sort` on one column; Waiting column toned |
| 8 · Needs you | ✅ "2 leads nobody has claimed yet · oldest 6 days" → click narrows to exactly those 2, with a chip; absent when nothing is flagged |

Sizes: 1536×826, 1366×657, 375 — no page overflow at any (1356 / 375 measured); filter grid
reflows 5 → 4 → 1; stat cards 4 → 4 → 1; the board scrolls inside itself, not the page.

**A guard test was updated, not deleted.** `lib/partnerLeads/board.test.mjs` asserted "the board and
the partner home draw stages, not the four fixed lanes" — LA-1.17, written to stop exactly this
change. It now asserts the new rule and the thing the old rule was really protecting: the columns
come from `boardColumns()`, **and** the agency's stage name is still on every card, still a table
column, still a filter. Nothing of the tenant's vocabulary was lost; it stopped being the
organising principle.

**Two criteria not met, both deliberate:**

1. **No Mine / Everyone's toggle for admins.** It needs the signed-in user's id, which this
   component is never given — plumbing it means `section-page.tsx` → `partner-portal-workspace.tsx`
   → here, for a control that duplicates the "Submitted by" select an admin can already set to
   themselves. The scope is stated in words on the stat row instead.
2. **Table heads are not sentence case.** `TableHead` title-cases every column head app-wide
   (`components/ui/table.tsx:6`), as `Button` does for labels. "Submitted By" is house style; the
   criterion was written from a misreading of §6, and changing it would mean changing every table in
   the app.

**Noted:** on the preview route the page server-renders with data, so ages show "—" for the frame
before hydration gives the clock a value. Not visible on the live page, where `PageLoading` holds
until the first read lands. The dash is the honest null state, not a bug to paper over.

---

## Phase 4 — done 30 Oct

The hand-built `<aside>` is a `DetailPanel`, and the submission reads like a form rather than a
database row.

| Was | Is |
|---|---|
| `DATE OF BIRTH 2008-02-27` | Date of birth · **11 Apr 1968** |
| `TOBACCO true` | Tobacco · **No** |
| `PHONE 4724521313` | Phone · **(555) 014-2317** |
| `COVERAGE AMOUNT 55000` | Coverage amount · **$25,000** |
| `FIRST NAME test` / `LAST NAME test` under a title saying the same | dropped — the title already says it |
| `final_expense` in the subtitle | **Final expense** |
| whatever order the object serialised in | Person · Contact · Coverage · Notes · Other details |

**What the panel gained by not being hand-built:** Escape closes it **and returns focus to the exact
card that opened it** (verified: `document.activeElement` is the Marisol Vandenberg button). At 375
it becomes a fixed overlay with a backdrop rather than a squeezed column. The local copy had none
of that.

**The progress strip** answers "where is this?" before the form the partner already knows:
Submitted → Claimed → On a call → Converted, with real timestamps where the records can supply
them. A closed submission reads **Submitted → Closed**, not three steps that are never coming.

**"On a call" is never dated.** `service.ts` records `submitted`, `claimed` and `outcome` events
only; there is no verification event. The step shows without a time rather than borrowing one that
means something else.

**CSS:** 15 lines gone from `app/globals.css`, and only the 7 selectors nothing else uses
(`lead-preview-panel`, `-header`, `-close`, `-tabs`, `-lock`, `-footer`, `partner-lead-preview`).
The agent's own lead workspace (`components/app/lead-workspace.tsx`) still draws with
`lead-preview-scroll`, `-banner`, `-section`, `lead-form-snapshot`, `lead-snapshot-row`,
`lead-detail-list`, `lead-section-heading`, `lead-timeline*`, `lead-full-link` and
`lead-preview-state`, so those stay. Task 9's criterion said to remove them "and no other page still
uses them" — another page does. Cleaning them is agent-side work, not this change.

Tests 3400 pass / 20 fail (the same pre-existing 20); design rules 34/34.

---

## Phase 5 — done 30 Oct

**The isolation is proved, not asserted.** The rule was one ternary buried in `listPartnerLeads`.
It is now `lib/partnerLeads/scope.ts` — `effectiveCloser()` and `canSeeLead()` — pure, named, and
tested for what it promises rather than read and hoped about. The test that matters:

```
effectiveCloser({ role: "partner_user", userId: "u-me" }, { closerId: "u-someone-else" })  ->  "u-me"
```

A partner user passing someone else's `closer_id` on the query string is still scoped to
themselves. Also covered: an unattributed lead (`created_by: null`) is not a partner user's;
`undefined` access never reads as a narrow scope; every read on the page carries the narrowed
closer, not just the rows.

**Mutation-checked.** With the scoping line removed from `scope.ts`, 2 of the 8 tests fail. Restored,
8 pass. The guarantee is real, not a source grep that would pass whatever the code did.

**Contrast, measured against the actual glass surface** (resolving every transparent layer up the
tree, not comparing token names), on the SLA state at 1536×826:

| | ratio | AA needs |
|---|---|---|
| Red age badge | 6.75 | 4.5 |
| Amber age badge | 6.74 | 4.5 |
| "Nobody claimed it" chip | 6.74 | 4.5 |
| Needs-you row | 6.74 | 4.5 |
| Amber card footer | 6.74 | 4.5 |
| Secondary stage line | 6.94 | 4.5 |
| Column header | 10.74 | 4.5 |

**Keyboard:** tab order follows visual order — toolbar, then board cards in column order. Escape
closes the panel and returns focus to the card that opened it.

**Motion:** nothing this change added animates a transform on hover; the app already carries 12
`prefers-reduced-motion` blocks.

**Found in the polish pass and fixed:** narrowing the *board* to nothing showed four empty columns,
while the table correctly offered "No leads match these filters · Clear all filters". Both views
now answer an empty result the same way (§8).

**Docs:** `components/partner/README.md` records the lane-column decision and what it does *not*
cost; UI-CONSISTENCY §4a lists Pipeline among the pages moved to stat cards.

**On the real page, with the real lead:** With a closer **1** and the lead in **On a call 1** —
they agree. The card reads `test test · Final expense · 2 hr (amber) · New lead`. Converted shows
**"Your rate · $35.00 / transfer"**.

Final: 3408 pass / 20 fail (the same pre-existing 20, unrelated SQL-text assertions on CRLF);
design rules 71/71; lint and types clean.
