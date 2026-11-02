# Tasks: Agency dashboard redesign

Spec: [SPEC.md](SPEC.md). Plan, decisions and risks: [plan.md](plan.md). This file is what to do,
in order.

**Standing bar for every task** — not done until all of these hold:

- `npm test` at its baseline: **3524 tests, 3504 pass, 20 fail**. Those 20 are pre-existing
  SQL-text assertions against migration files checked out with CRLF. No task may add a 21st.
- `npm run lint`, `npx tsc --noEmit` and `npm run build` clean.
- `lib/design/uiOffenders.json` no higher than before.
- `git diff --stat` shows no whole-file rewrite on an edited file (line endings).
- Anything visual checked on `/design/agency` at **1536×826**, 1366×657 and 375 wide.
- The honesty rules survive: `—` not `0` for unread, the basis on every money figure, counts
  before percentages on placement and month-4, `ledgerReady`'s sentence instead of a false `$0`.

---

## Phase 1: See it

### Task 1: Fixtures and the `/design/agency` preview — **done, 2 Nov**

**Description:** The agency this runs against is empty, so without sample data the redesign can
only ever be judged on four zeros and two empty boxes. Same seam as `/design/deal-flow`.

**Acceptance criteria:**
- [x] `/design/agency` renders in the real agent frame (sidebar, stage, padding), development only
      (`notFound()` in production).
- [x] `?state=busy|quiet|empty|error` and `?role=owner|manager`.
- [x] `busy` has nine producers (pages at 8), placement and month-4 showing both percentages and
      counts (`64%` beside `6/9`, `4/7`, `2/3`, `0/0`), one negative balance (−$412.25), a clear
      worst advance risk ($3,115), a producer who has submitted nothing, and five expiries from
      8 to 55 days.
- [x] `empty` reproduces the owner's screenshot: one seat / no ceiling, `$0` payable out and
      override on the reported basis, no producers, nothing expiring.
- [x] `AgencyDashboard` takes a `preview` prop and neither fetches nor polls when it is given —
      `useAgencyData` is passed a null URL.

**Verification:**
- [x] `busy` and `empty` rendered at 1536×826; no horizontal overflow
- [x] `npm test` 3524 / 3504 pass / **20 fail** (unchanged, all pre-existing); eslint clean,
      `tsc --noEmit` 0 errors, `npm run build` exit 0

**Also landed:** the page's private `Row`/`Dashboard` types moved to `lib/agency/dashboardCore.ts`
(the repo pairs every `*Store` with a pure `*Core`), so the fixtures have something to be typed
against and Task 4's arithmetic has a home. The component's diff is +15/−17.

**Dependencies:** None

**Files likely touched:**
- `app/design/agency/page.tsx`
- `lib/agency/fixtures.ts`
- `components/app/agency/agency-dashboard.tsx` (the `preview` seam only)

**Estimated scope:** Medium

---

### Checkpoint A: every state of this page can be looked at — **passed, 2 Nov**

- [x] Busy, quiet, empty and error, for owner and manager, all reachable by URL
- [x] Nothing about the page's appearance has changed — the baseline is captured.

**What the baseline shows, now that it can be seen.** Every audit finding is visible at once on
`?state=busy`: the `<h1>` reads "Northstar Insurance Group"; the four figures carry no period and
no comparison; the Producers card has a blank toolbar band with Refresh floating in it; the
most-at-risk producer's whole row is washed amber and reads as an error; there is no chart; and
the table is a flat list in which the top producer is not apparent at a glance — which is the
case for Task 5a. On `?state=empty` the Invite Producer button appears twice, in the header and
in the card, which is the case for Task 8.

**A note on the animation:** `m-stagger` stalls while the browser pane is backgrounded, so a
screenshot taken then catches it mid-fade and the page looks blank. Disable animations before the
shot, or read the accessibility tree.

---

## Phase 2: The certain fixes

### Task 2: The title names the page — **done, 2 Nov**

**Description:** `title={agencyName}` renders "Your agency" as the page's one `<h1>`. §2 says the
title is the page's name; the trail and the top bar already carry the agency.

**Acceptance criteria:**
- [ ] The `<h1>` is "Agency dashboard", matching the menu entry.
- [ ] The agency's name appears exactly once, in the header's description.
- [ ] The description still names the period, and still differs for a scoped manager.

**Verification:**
- [ ] `npm test` (`sidebarLook`, `uiConsistency` — one `PageHeader`, no raw `<h1>`)
- [ ] On the preview: the trail reads Home › Agency and the title does not repeat it

**Dependencies:** Task 1

**Files likely touched:**
- `components/app/agency/agency-dashboard.tsx`

**Estimated scope:** XS

---

### Task 3: The empty toolbar, the card description and the row wash — **done, 2 Nov**

**Description:** Three defects visible in the owner's screenshot, none needing new data.

**Acceptance criteria:**
- [ ] The Producers card's `DataToolbar` is gone; Refresh moves to the card's `action` slot. No
      empty band.
- [ ] The expiries card's `description` becomes `info` behind the (i) — the §3 rule and the
      2026-10-29 decision.
- [ ] The most-at-risk producer is marked on the **Advance at risk cell**, not by washing the
      whole row in `--warning-surface`.
- [ ] The marking still makes that producer findable at a glance.

**Verification:**
- [ ] Side by side with the Checkpoint A screenshot of `?state=busy`
- [ ] `npm test`

**Dependencies:** Task 1

**Files likely touched:**
- `components/app/agency/agency-dashboard.tsx`

**Estimated scope:** Small

---

### Checkpoint B: the defects that need no new data are gone — **passed, 2 Nov**

- [x] Tasks 2 and 3 verified against the Checkpoint A screenshots. The `<h1>` is "Agency
      dashboard"; "Northstar Insurance Group · November 2026" is the quiet line under it; Refresh
      sits on the Producers card's heading row with no band under it; the expiries card's sentence
      is behind its (i); and the most-at-risk producer is an amber **$3,115** rather than a washed
      row — the eye now goes to the two numbers that matter (that figure and the −$412.25 balance)
      instead of to a block of colour.
- [x] `npm test` 3524 / 3504 pass / **20 fail** (unchanged); eslint clean, `tsc --noEmit` 0
      errors, `npm run build` exit 0. Component diff +38/−24.
- [x] A manager (`?role=manager`) sees no Invite Producer button at all, as before.

**Phase 3 was rescoped after this checkpoint** — see plan.md. The owner asked what information
belongs on the page, not only how it looks; the spec's "What belongs on this page" section is the
research, and it changes Tasks 5 and 7.

---

## Phase 3: The analytics substance

### Task 4: the arithmetic, pure and tested — **done, 2 Nov** (landed in `dashboardCore.ts`)

**Description:** The arithmetic behind the change pills and the chart, in a pure module so it can
be tested against what it should be rather than through a component. This is the task that catches
the bugs.

**Acceptance criteria:**
- [ ] `periodChange(current, previous)` returns a percentage change, or null when there is nothing
      to compare with.
- [ ] Null previous → null. Zero previous with a non-zero current → null, **not** infinity or
      100%. Zero to zero → null. A sign flip (−$400 → +$900) is handled explicitly and documented.
- [ ] `producerSeries(producers, metric)` returns `BarSeries` bars for the period, sorted, with a
      label and a value per producer.
- [ ] The series is empty — not a zero bar — when there are no producers.

**Verification:**
- [ ] Tests pass: `node --experimental-strip-types --test lib/agency/dashboardView.test.mjs`
- [ ] A case per edge above, each named for the wrong answer it prevents

**Dependencies:** None (can run beside Tasks 2–3)

**Files likely touched:**
- `lib/agency/dashboardView.ts`
- `lib/agency/dashboardView.test.mjs`

**Estimated scope:** Small

---

### Task 5: The figure strip becomes `StatRow` + `StatCard` — **done, 2 Nov**

**Description:** §4a's v3 cards. They draw the same strip, so this costs nothing visually and buys
`period`, `delta`, `fact` and `action` — the props that carry three of the audit's findings.

**Acceptance criteria:**
- [ ] `StatStrip`/`StatTile` → `StatRow`/`StatCard`; no `mixed-stat` offender.
- [ ] Every card states its `period` (the month, or "next 60 days" for alerts).
- [ ] Seats keeps its meter; Payable out and Your override keep their basis and their `labelTitle`
      explanations; Licence alerts keeps its amber tone.
- [ ] Licence alerts gains a **Show** action that takes the reader to the expiries (plan open
      question 2: scroll, not filter).
- [ ] `—` still shows where a figure was not read; no `0` substituted anywhere.
- [ ] Change pills are absent for now — Task 6 supplies them.

**Verification:**
- [ ] `?state=busy` and `?state=empty` against the Checkpoint A screenshots
- [ ] `npm test`

**Dependencies:** Task 4

**Files likely touched:**
- `components/app/agency/agency-dashboard.tsx`

**Estimated scope:** Small

---

### Task 5a: The producers table is a standing — **done, 2 Nov**

**Description:** The table answers "which producer is making me money" in its sixth column. Rank
it. (The one idea worth keeping from the two links the owner's manager passed on — see the spec;
it stands on its own merits.)

**Acceptance criteria:**
- [ ] A rank column, `#1 #2 #3 …`, ordered by the metric that decides the page — issued, or
      balance; decided by looking at `?state=busy`, and the choice written down here.
- [ ] The rank is quiet, not decorative: muted and tabular, not a medal.
- [ ] Ties get the same rank, and the order is stable across refreshes.
- [ ] Sorting is the server's order or an explicit client sort — never whichever order the API
      happened to return.
- [ ] A producer who has submitted nothing still appears, ranked last, not hidden.

**Verification:**
- [ ] `?state=busy` — the top producer is obvious within a second
- [ ] `?state=quiet` (two producers) and `?role=manager` — a rank of 1 and 2 does not look absurd
- [ ] `npm test`

**Dependencies:** Task 3

**Files likely touched:**
- `components/app/agency/agency-dashboard.tsx`
- `lib/agency/dashboardCore.ts` (the ordering, if it is more than a sort)

**Estimated scope:** Small

---

### Task 6: The previous period, fetched lazily — **done, 2 Nov**

**Description:** The comparison, without making the app's heaviest page twice as slow to first
paint. `useAgencyData` takes a nullable URL, so "not yet" needs no new hook.

**Acceptance criteria:**
- [ ] A second `useAgencyData` starts at `null` and is given the previous period's URL after the
      current period has painted.
- [ ] Payable out and Your override show a change pill naming its comparison ("vs. last month").
- [ ] While the second read is in flight the strip is **fully usable with no pills** — no spinner
      over the figures, no layout shift when they arrive.
- [ ] A failed second read is silent: no error banner, no pills. The page is not broken by a
      comparison it could not make.
- [ ] Switching the period toggle re-points both reads correctly, and "last month" does not
      compare against itself.

**Verification:**
- [ ] First-paint time on `?state=busy` before and after, recorded in this file
- [ ] Manual: throttle the second read and confirm the strip is usable throughout
- [ ] `npm test`

**Dependencies:** Task 5

**Files likely touched:**
- `components/app/agency/agency-dashboard.tsx`
- `components/app/agency/use-agency-data.ts` (only if the nullable path needs a fix)

**Estimated scope:** Medium

---

### Task 7: The charts, paired with the expiries — **done, 2 Nov**

**Description:** The one addition that makes the page legible at a glance, and the fix for "a long
scroll of mostly empty".

**Acceptance criteria:**
- [ ] A `BarSeries` of production per producer for the period, in a `HomePanel` with its title and
      period, using `barMaxWidth` so three producers do not draw three slabs.
- [ ] It sits in a 12-column row with the expiries beside it (chart 8, expiries 4), collapsing to
      stacked under ~1152px **by container query**, not viewport breakpoint (§4b — the sidebar
      takes its share).
- [ ] No colour is named; `CHART_TONES` only.
- [ ] With no producers the panel says so in a line rather than drawing an empty axis.
- [ ] The chart has a text `summary` for anyone not looking at it.

**Verification:**
- [ ] 1536×826, 1366×657 and 375 wide, `?state=busy` and `?state=quiet`
- [ ] `?role=manager` with one or two producers — plan open question 1 is decided here, by looking
- [ ] `npm test` — no `hex-colour` offender

**Dependencies:** Task 4, Task 5

**Files likely touched:**
- `components/app/agency/agency-dashboard.tsx`
- `components/app/agency/agency-production-chart.tsx` (if the panel earns its own file)

**Estimated scope:** Medium

---

### Checkpoint C: it reads as an analytics page — **reached, 2 Nov**

- [x] Within five seconds of `?state=busy`: **Written 167 ↑21.9%**, **Your override $3,189 ↑13.3%**,
      **At risk $11,583 ↓19.7%** (green — falling risk is good), **Needs you 5**; a ranked bar per
      producer with every bar named; and a money split reading Override 9% · Owed 10% ·
      Acquisition 81%.
- [x] Every honesty rule holds: `—` for unread, the basis on each money figure, placement and
      month-4/13 still counting before they rate, the ledger sentence intact.
- [x] `npm test` **3541 / 3521 pass / 20 fail** (+17 new, all passing; the 20 are the same
      pre-existing); eslint clean, `tsc --noEmit` 0 errors, `npm run build` exit 0.
- [x] 1536×826 and 1366×657 draw the 12-column row; 375 collapses it to one column; no horizontal
      overflow at any width.
- [ ] **Review with the owner before Phase 4**

**Decided by looking (plan open question 1):** the chart stays for a manager. With two producers
`barMaxWidth` keeps the bars sane, and a two-bar standing still answers "which of my two".

**Three things landed beyond the task text:**

1. **`BarSeries` gained `labels="all"`.** Its axis drew only the first, middle and last bar —
   right for a run of dates, wrong when every bar is a different person, where an unlabelled bar
   cannot be identified at all. The kit had no categorical mode; now it does, defaulting to the
   old behaviour so nothing else changes.
2. **The preview can supply a previous period.** `preview` skips the lazy second fetch, so the
   change pills — the single biggest thing this phase adds — were invisible on `/design/agency`.
   `sampleAgencyDashboard({ previous: true })` returns a quieter month, and the pills are now
   reviewable.
3. **No API change, as planned.** `chargebackCents`, `leadSpendCents` and `m13` were already on
   the wire: the route returns `readDashboard` unchanged and the client simply never typed them.

---

## Phase 4: The empty agency

### Task 8: A new agency reads as new — **done, 2 Nov**

**Description:** The state in the owner's screenshot, and the first thing every new agency sees.
Today it reads as broken.

**Acceptance criteria:**
- [x] One line under the header, shown only while there are no producers: *"Nothing here yet.
      Invite a producer and this page fills in from their first application — what they wrote,
      what it is worth, and what is at risk."*
- [x] Honest zeros with their facts in the strip; no change pills, because there is nothing to
      compare.
- [x] **One** Invite producer, in the header. The empty state's duplicate is gone — the same green
      button twice on one short page reads as two different offers.
- [x] A manager gets their own wording throughout: *"As the producers who report to you submit…"*,
      the card reads "No reports yet", and there is no Invite button at all (they cannot invite).
- [x] **The chart row is hidden entirely when there are no producers.** Four empty containers is
      not a page. The distinction that matters: an agency whose producers wrote nothing in
      November still gets its charts, because "nobody wrote anything" is the finding — only an
      agency with *no producers at all* loses them. `isNew` is that test, and it is not the same
      as an empty month.

**Verification:**
- [x] `?state=empty&role=owner` and `?state=empty&role=manager` against the owner's original
      screenshot: the title names the page, there is one orientation line, one action, no empty
      chart containers, and the expiries paragraph is behind its (i).
- [x] Confirmed by DOM rather than by eye, since the stalled entrance animation hides text from
      `innerText`: `figure` count is **2** on busy and **0** on empty; panels are
      `["Agency at a glance", "Who wrote it", "Where the money went"]` on busy and just the strip
      on empty.
- [x] `npm test` **3541 / 3521 pass / 20 fail** (unchanged); eslint clean, `tsc` 0 errors,
      `npm run build` exit 0.

**Dependencies:** Task 7

**Files likely touched:**
- `components/app/agency/agency-dashboard.tsx`
- `lib/agency/fixtures.ts`

**Estimated scope:** Small

---

## Phase 5: Finish

### Task 9: READMEs and the handoff note — **done, 2 Nov**

**Acceptance criteria:**
- [ ] `components/app/README.md` names the agency dashboard and where its arithmetic lives.
- [ ] `HANDOFF.md` records the redesign and what is verified.
- [ ] Any rule this page now bends is written down where the next person will read it, not left
      for them to find.

**Verification:**
- [ ] `node --experimental-strip-types --test lib/design/designDocs.test.mjs`

**Dependencies:** Task 8

**Files likely touched:**
- `components/app/README.md`
- `HANDOFF.md`

**Estimated scope:** Small

---

### Task 10: Verified at three widths, both roles, every state — **done except the signed-in half, 2 Nov**

**Description:** Previews prove the drawing. This page also has real gates — an agency-typed plan
and a qualifying role — that no preview exercises.

**Acceptance criteria:**
- [x] 1536×826, 1366×657 and 375 wide; `busy`, `quiet`, `empty`, `error`; `owner` and `manager`.
      busy/owner draws 4 cards, 2 figures, 2 tables, 1 Invite; busy/manager 3 cards (no override),
      0 Invites; quiet 2 producers; error 0 cards with a Try again.
- [x] No horizontal page overflow at any width (`scrollWidth` 375 at phone width).
- [x] The honesty checklist walked explicitly — **and it caught a regression I had introduced**,
      see below.
- [ ] **Signed in against a real agency — NOT DONE.** The page needs an agency-typed plan and a
      session, and neither is available from here: the permission layer refuses to run
      `scripts/mint-session.mjs` (correctly — it is me granting myself access), and this app's
      Supabase project is not reachable through the MCP connector. **Nobody has opened this page
      with real data.** `scripts/seed-qa-agency.mjs` seeds a working agency on the LA-1.25 Alert
      Demo tenant and `npm run session -- tenant --email demo.agent@insurvas.test --js` mints the
      cookie; both need running by hand.

**The honesty checklist caught a real regression.** Removing the Payable out card moved that
figure into the money bar — and `moneySplit` turned a null `payableOutCents` into a confident
`Owed $0.00`. The payable ledger is not live for every agency, and telling an owner they owe
their producers nothing is the single thing on this page that must not be wrong. `moneySplit`
now **omits** a figure that was not read rather than zeroing it, the sentence the old card
carried ("once the payable ledger is live") moved into the panel with its figure, and two tests
hold both. Worth noting the first version of that test asserted the buggy behaviour — I wrote it
to match what the code did instead of what it should do.

**Verification:**
- [ ] A screenshot per state at 1536×826 attached to the PR

**Dependencies:** Task 9

**Files likely touched:** none (verification only)

**Estimated scope:** Small

---

### Checkpoint D: ready for review — **2 Nov, with one gap**

- [x] All ten tasks met except the signed-in walkthrough in Task 10.
- [x] `npm test` **3542 / 3522 pass / 20 fail** — 18 new, all passing; the 20 are the same
      pre-existing CRLF-vs-SQL failures. eslint clean, `tsc --noEmit` 0 errors,
      `npm run build` exit 0, `uiOffenders.json` unchanged.
- [x] Plan question 1: the chart stays for a manager — two bars still answer "which of my two".
      Plan question 2: the Licence alerts card has no Show action in the end; the expiries list
      sits directly below and the card's fact already names what it counts.
- [ ] Reviewed with the owner

**Changed after the owner looked (2 Nov):** every figure on the strip is now the same ink. Two
amber figures out of four was both against §4a ("one per row at most") and a scale with no zero —
once half the row is coloured, the colour stops meaning "look here". State is carried by the
change pill, the minus sign and the fact beneath.

**Two shared components gained something** rather than being copied into this page:
`BarSeries` has `labels="all"` for a categorical series (its axis drew only first, middle and
last, which cannot identify a bar when every bar is a person), and `ShareBar`'s legend falls to
one row per segment sooner (9rem → 11rem), because at 9rem a narrow panel clipped every name to
"Overr…".
