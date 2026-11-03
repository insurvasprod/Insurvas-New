# Implementation Plan: Agency dashboard redesign

**Spec:** [SPEC.md](SPEC.md), approved 1 Nov 2026.
**Task list:** [todo.md](todo.md) in this folder. The repo's top-level `tasks/plan.md` and
`tasks/todo.md` belong to the sidebar + Lead Sources round and still hold 120 unchecked items —
untouched by this plan.
**Branch:** a fresh `redesign/agency-dashboard` off `main` is cleanest;
`redesign/partner-pipeline` already carries the partner work and an open PR.
**Status:** planned, not started.

---

## Overview

`/app/agency` answers one question — *which of my producers is actually making me money?* — and
currently answers it as a report: four bare numbers over two stacked tables, no comparison, no
visualisation, and an empty agency that reads as broken. This plan fixes the eleven defects the
spec audits, adding one chart and one lazily-fetched comparison, and changes nothing about what
the page is allowed to show or who may see it.

## Architecture decisions

**D1 — The preview comes first, before any visual change.** The agency this runs against is empty
(the owner's screenshot: one seat, no producers, no ledger). Redesigning against it means
redesigning blind — exactly the gap that let a `$8,450.00`-for-`$84.50` bug through on the partner
page until a test compared a number against what it should be. `/design/agency` with fixtures is
Task 1, not Task 9.

**D2 — Arithmetic goes in pure modules, not the component.** Period-over-period change and the
chart series become `lib/agency/dashboardView.ts` with its own `.test.mjs`, following
`lib/partnerDealFlow/figures.ts`. A percentage change has more edge cases than it looks — zero
previous, null previous, negative-to-positive — and none of them are checkable through a React
component.

**D3 — The previous period is a second, lazy read, and never blocks the strip.** `useAgencyData`
already accepts a nullable URL, so the second call starts as `null` and is given its URL after the
first paint. A failed or slow comparison must leave the page fully usable with no change pills,
never a spinner over the figures.

**D4 — No change to `/api/app/agency/dashboard`.** Both the chart and the deltas are built from
the response the page already receives; the deltas are the same endpoint called for a second
period. The response shape, the gates and `readDashboard` are untouched.

**D5 — The chart is `BarSeries` from the existing kit.** It gained `barMaxWidth` on 1 Nov for
exactly this: a sparse series — an agency with three producers — where uncapped bars look absurd.
No charting dependency.

**D6 — Keep every honesty rule the page already has.** `—` for "not read" and never `0`; the
count-before-percentage rule on placement and month-4; the basis on every money figure;
`ledgerReady` degrading to a sentence rather than a false `$0`. These are the parts of the page
that are already right, and a redesign is the usual way they get lost.

---

## The dependency graph

```
fixtures + /design/agency preview            (T1)
        │   nothing below can be seen without it
        ├─────────────────────────────┬──────────────────────┐
        ▼                             ▼                      ▼
  cheap certain fixes            dashboardView.ts        empty-agency state
  (header, toolbar,              + tests   (T4)          (T8, wants T1)
   info, row wash)  (T2, T3)          │
                                      ├── strip → StatCard  (T5)
                                      │        └── lazy previous period (T6)
                                      └── chart + expiries row (T7)
                                                   │
                                          docs (T9) → verify (T10)
```

Build order: **T1 → T2, T3 → T4 → T5, T7 → T6 → T8 → T9 → T10.**
T2 and T3 are independent of everything after T1 and could be done in parallel with T4.

## Task list

See [todo.md](todo.md) for acceptance criteria, verification and file lists.

### Phase 1: See it
- [ ] Task 1: fixtures and the `/design/agency` preview

### Checkpoint A: every state of this page can be looked at

### Phase 2: The certain fixes (no new data)
- [ ] Task 2: the title names the page
- [ ] Task 3: the empty toolbar, the card description and the row wash

### Checkpoint B: the defects that need no new data are gone

### Phase 3: The analytics substance
**Rescoped 2 Nov** after the owner asked what information belongs here, not only how it looks. The
spec's "What belongs on this page" section is the answer: this page is the agency module's front
door, `/app/book-scorecards` already owns the depth, and the page currently discards six figures
the system computes for it (`leadSpendCents`, `costPerIssued`, `costPerPersisting`,
`chargebackTax`, `m13`, `chargebackCents`). Tasks 5 and 7 change shape accordingly.

- [ ] Task 4: `lib/agency/dashboardView.ts` — change and series, pure and tested
- [ ] Task 5: the strip becomes four `StatCard`s that answer the owner's question — Written,
      Your override, At risk, Needs you — each a door to the page that owns its depth.
      **Seats comes off** (spec question 7)
- [ ] Task 5a: the producers table is a standing (ranked), and gains `m13` beside `m4`
- [ ] Task 6: the previous period, fetched lazily, for the three change pills
- [ ] Task 7: two charts — the ranked producer standing, and a `ShareBar` of where the period's
      carrier money went (override kept · producer share · acquisition spend) — paired with the
      expiries

### Checkpoint C: it reads as an analytics page

### Phase 4: The empty agency
- [ ] Task 8: a new agency reads as new

### Phase 5: Finish
- [ ] Task 9: READMEs and the handoff note
- [ ] Task 10: verified at three widths, both roles, every state

### Checkpoint D: ready for review

---

## Risks and mitigations

| Risk | Impact | Mitigation |
|---|---|---|
| The second read doubles the cost of the app's heaviest page | **High** | D3: lazy, after first paint, never blocking. Measure the first-paint time on the preview before and after T6; if the second read lands while the user is still reading the strip, it is free. If it is not, the deltas go behind the period toggle instead. |
| A percentage change is quietly wrong (zero or null previous, sign flips) | **High** | D2: pure module, tested first. A wrong delta is worse than no delta — it is a number that looks like a fact. |
| The redesign loses one of the honesty rules (basis, `—`, count-before-percentage) | **High** | D6, and Task 10 checks each explicitly. These are easy to drop while moving components. |
| Only the empty state is ever seen, so the populated page ships unverified | **High** | D1: the preview is Task 1 and carries busy, quiet, empty and error, for owner and manager. |
| `uiOffenders.json` goes up — a raw table, a hex colour, a second page header | Medium | `npm test` fails on a new offender. The producers table is inside a `TableCard`, so the `raw-table` ratchet counts 0 there. |
| The 12-column row crowds at 1366 or the sidebar's width | Medium | §4b: container queries, not viewport breakpoints, because the sidebar takes its share. Verified at 1366×657 in Task 10. |
| Line endings flip on edited files | Low | `git diff --stat` after each edit; normalise to LF. |
| The 20 pre-existing test failures mask a real one | Low, but live | Baseline is 3524 / 3504 / **20**. Any task that makes it 21 has broken something. |

## Open questions

1. **Does a manager's scoped view want the chart at all?** A manager sees only their own reports —
   often one or two producers, where a bar chart of two bars says little. Options: show it anyway,
   hide it under a threshold, or show a single-figure panel instead. Recommend: show it, since
   `barMaxWidth` was added for exactly this sparseness — but worth a look on the preview at
   `?role=manager` before deciding.
2. **Should the "Show" action on Licence alerts filter, or scroll?** The expiries list has no
   filter today. Scrolling to it is one line; filtering means giving that card a state it does not
   have. Recommend: scroll, and revisit if agencies ask.
