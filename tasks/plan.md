# Implementation Plan: Sidebar legibility + Lead Sources page frame

**Branch:** `redesign/sidebar-and-lead-sources` (off `origin/main` @ `6d118f7b`, 0 commits ahead)
**Scope:** the left sidebar's connector lines, and **all of** `/app/publishers` — the list, the
add/edit dialog, **and the record page** at `/app/publishers/[id]` (owner, 29 Oct: "fully redesign
and simplify and make it UI/UX perfect… I mean even these parts").
**Status:** rounds 1–2 written and partly verified; round 3 planned, not started.

---

## Overview

Two surfaces, one complaint behind both: **a first-time user cannot tell what they are looking at.**
The sidebar decorates a hierarchy it has already made obvious and hides the explanations it already
has written. The Lead Sources page spends a row on a sentence, ships OS-default dropdowns next to a
custom kit, and lets the browser decide its column widths — which is why the grid looks lopsided.

Most of this is **adoption, not invention.** The kit already contains every part needed:
`PageHeader({ infoDescription })`, `SelectMenu`, `Pager`, `TableCard`, `HoverHint`, and a settings
frame that already solves the scroll problem. Partners is simply the page that never adopted them.

---

## Design critique

Asked for explicitly: *"question the design, critique it."* Findings are P0–P3 per the audit playbook.
Scope inspected: source on `6d118f7b`, plus the two supplied screenshots (Chrome, `localhost:3000`,
~1536×826, dark theme, `/app/publishers` with 2 records). **Not** inspected: a live render at other
viewports, light theme, keyboard traversal, or the Partners detail view — those are verification
tasks, not claims.

### Sidebar

**P1 — The connector lines carry no information.**
`app/globals.css:3732-3751` draws a rounded elbow per child via `li::before` with
`border-left` + `border-bottom`. A tree line earns its place when hierarchy is ambiguous. Here it is
not: only one group is open at a time (`openGroup: string | null`, `agent-sidebar.tsx:265`), the
children are indented, and the parent sits directly above them. The line restates the indent.
Worse, it reads as a *defect*: it is drawn per item from `top: -.3rem` to `bottom: 50%`, so at the
last child it terminates in mid-air — visible in the screenshot, which is exactly what got circled.
The same lines were already removed from the settings menu on 29 Oct (`969faf67`). The sidebar is
the last place they survive.

**P1 — Two different pages are both called "Lead sources".**
`lib/menu/definition.ts:113` → `leads.lists`, "Lead sources", `/app/lead-sources` (under **Leads**).
`lib/menu/definition.ts:224` → `partners.publishers`, navLabel "Lead sources", `/app/publishers`
(under **Partners**). Two identical labels, two routes, two groups. No newcomer can predict which
one they want, and the screenshot's breadcrumb (`Partners › Lead Sources`) does not disambiguate it
either. This is the single biggest obstacle to *"somebody that never has been here knows what's
going on."*

**P2 — Every item already has a one-line explanation, and the sidebar throws it away.**
`lib/menu/definition.ts` carries `blurb` on most items — "The book you already have", "Who you buy
from, what each batch cost, and what a dialable lead really costs", "Pay publishers from the ledger,
not WhatsApp." This is good, already-written, already-reviewed copy. `agent-sidebar.tsx` never
renders it. The kit has `components/ui/hover-hint.tsx`. Surfacing it is free legibility.

**P2 — The groups are cut by internal domain, not by the user's job.**
Thirteen top-level groups. **Data In**, **Book**, **Commissions** and **Accounting** all read as
"money and records" to a newcomer. **Today** vs **Leads** vs **Sales** gives no rule for predicting
that the Dialer lives in *Today*. This is a real problem, but re-cutting the groups is a product
decision, not a styling one — see Open Questions. It is deliberately **not** planned as work below.

**P2 — The accordion discards context on every move.**
One group open at a time. A task spanning Leads → Commissions re-navigates the chrome each time.

**P3 — Settings is the item that gets clipped.**
At 826px tall, 13 collapsed groups plus one open group overflow; the screenshot shows **Settings**
cut off at the bottom edge, partly behind the floating bubble. The most-visited destination in these
reviews is the one that scrolls away.

### Lead Sources page

**P1 — Native `<select>` filters next to a custom kit.**
`partners-workspace.tsx:821` and `:834` are raw `<select>` elements. They render the operating
system's dropdown: unstyleable options, no search, no counts, no active tint, and a different look
on every machine. The kit's `SelectMenu` (`components/ui/select-menu.tsx`) was built on 29 Oct for
precisely this — its own docstring records the reason: *"the native dropdowns were 'so plain', and a
long list needs a search at the top."* Contracting adopted it (`10056e5c`); Partners did not.

**P2 — The description eats a row that the page needs.**
`PageHeader` has had an `infoDescription` prop since the 29 Oct review (`page-header.tsx:38-43`,
added for *"remove this text, put it into an info icon right here"*). `partners-workspace.tsx:733`
passes `description` without the flag, so it renders as a full line. The fix is one prop, and it
makes the page match every Settings page.

**P2 — The grid is lopsided because nothing sizes it.**
`.portal-lead-table` (`globals.css:934`) is `width: 100%; min-width: 700px` with **no**
`table-layout` and no column widths — so `table-layout: auto` sizes columns from content. With two
short rows, `Lead Source` and `Status` absorb all the slack and the four numeric columns bunch
against the right edge. That is the "more space somewhere, less somewhere else" complaint, exactly.
Alignment is inconsistent too: `This Month` and `Sales` are right-aligned, `Last Lead` and `You Pay`
are not, so the eye has no column to run down.
The repo already has the correct pattern and a test that enforces it — `table-fixed` with `w-[Npx]`
per `<th>`, guarded by *"no table-fixed table squeezes its flexible columns to nothing"*
(`lib/design/uiConsistency.test.mjs:315`), which requires ≥120px per flexible column.

**P2 — The card stretches past its content.**
`min-h-[calc(100dvh-var(--top-bar-h)-260px)]` with `FILL_CARD` holds the card at nearly full height.
With two rows that is a large empty slab between the last row and the pager — the other half of the
"too much space" complaint.

**P3 — The page does not use the frame the Settings pages now have.**
Settings got a fixed title/menu/tab area with an inner scroll on 29 Oct (`969faf67`). Lead Sources
still scrolls as a whole page. Matching it is what *"a page layout like how we have the other"* means.

**P3 — Demo data is visible in review.**
The first row is literally named `Activation check (remove)`. Not a design defect; it should not be
in the data the owner reviews.

### Worth preserving

- Whole-row click to open, with the name kept as a real `<button>` for the keyboard
  (`partners-workspace.tsx:878`) — correct, and commented with the reason.
- `Pager` + `FILL_CARD` + `TableCard` are already the kit's parts.
- `EmptyState` and `NoMatches` are both handled, and distinguished.

---

## Architecture decisions

1. **Delete the elbow CSS; do not replace it with a different line.** Indent plus the active pill is
   the hierarchy signal. This matches what the settings menu already does, so the two menus stop
   disagreeing.
2. **Spend no new copy on legibility.** `blurb` already exists in `lib/menu/definition.ts`. Render
   it; do not write a second explanation layer that can drift from the first.
3. **Adopt the kit, don't extend it.** `SelectMenu`, `infoDescription`, `Pager` all exist. No new
   shared component is introduced by this plan.
4. **Size the table explicitly**, following the repo's existing `table-fixed` + `w-[Npx]` convention
   so the existing squeeze guard covers it.
5. **Leave the group taxonomy alone.** Ruled on by the owner (decision 2): the request is the screen
   in the screenshot, not a navigation re-cut.

---

## Task List

Tasks are recorded in `tasks/todo.md`.

### Phase 1: Sidebar
- [ ] Task 1: Remove the sidebar's elbow connector lines
- [ ] Task 2: Make the active trail legible without the lines
- [ ] Task 3: Show each item's existing `blurb` behind an (i)

### Checkpoint: Sidebar

### Phase 2: Lead Sources page
- [ ] Task 4: Description behind the (i)
- [ ] Task 5: Replace the native `<select>` filters with `SelectMenu`
- [ ] Task 6: Fix the table grid
- [ ] Task 7: Adopt the Settings page frame (fixed header, inner scroll)

### Checkpoint: Lead Sources

### Phase 3: Verify
- [ ] Task 8: Render, exercise states, compare against Contracting

### Phase 4: The record page (round 3)
- [ ] Task R1: Figures into the kit's StatStrip; attributes out of it
- [ ] Task R2: Narrow the tab strip to five
- [ ] Task R3: Say the status once
- [ ] Task R4: The record page gets the list's frame
- [ ] Task R5: Dialog and record pass at 1536×826, light and dark
- [ ] Task R6: Rename to Publishers — **held, needs the owner's word**

### Checkpoint: Complete

---

## Risks and Mitigations

| Risk | Impact | Mitigation |
|---|---|---|
| Elbow CSS is shared with the settings menu or the partner portal | Med | The rules are scoped to `.portal-agent-nav-section > .portal-agent-nav-sublist`. Grep `portal-settings`/`portal-partner` before deleting; render both menus after. |
| `table-fixed` breaks the detail view, which hides 4 columns (`!selectedPartner`) | **High** | The column set differs between list and detail. Widths must be derived from the same condition, or the detail view keeps `auto`. Exercise both before calling it done. |
| The squeeze guard fails (`uiConsistency.test.mjs:315`) | Med | It needs ≥120px per flexible column against the table's `min-w-[Npx]`. Budget the columns on paper first, then run `npm test`. |
| The UI ratchet (`lib/design/uiOffenders.json`) counts a new offender | Low | `radix-select` and `section-help` are tracked keys. Run `npm test` after each task; the ratchet records fixes as well as regressions. |
| ~~Rinor is merging Lead Sources into one Leads page~~ | — | **Resolved** (owner, 29 Oct): Lead Sources is ours, Rinor takes the other pages. Phase 2 is unblocked. |
| An (i) per sidebar row adds chrome to an already-dense 13-group menu | Med | The owner chose the (i) over a hover-only hint. Keep it quiet (muted, small, appears on row hover/focus) and check the menu still scans at 826px tall. |
| Go-live is Mon 2 Nov 2026 | **High** | Phase 1 is CSS-only and safe. Phase 2 touches one 1,523-line component — keep each task separately revertible and PR them page by page, as the owner asked. |

---

## Round 3 critique — the record page (`/app/publishers/[id]`)

Read from source on this branch plus the owner's screenshot (1536×826, dark). Not yet rendered in my
own browser pane — see the note at the end of `tasks/todo.md`.

**P1 — Five "facts" in a figure strip, three of which are not figures.**
`partners-workspace.tsx:1015-1019` draws five hand-rolled tiles
(`m-glass rounded-xl border border-border px-3.5 py-3` + a local `PartnerFact`). Two are metrics
(*Leads this month*, *Approved products*); three are attributes — *You pay* `Per lead · $25.00`,
*Since* `28 Oct 2026`, *Last lead* `None yet`. A strip that mixes "how many" with "what kind"
teaches the eye to skip all five. UI-CONSISTENCY §4 already settles the form: one `StatStrip` of
`StatTile` from `components/ui/stat.tsx`, which this page does not use.

**P2 — Six tabs.** Overview · Products · Forms · Commercial Terms · Carrier & States · Activity
(`:153-160`). §15 caps a section at five tabs "named for the job". *Forms* and *Carrier & States*
are set-up concerns a reader visits once; *Commercial Terms* is already summarised by the *You pay*
fact and by Overview's onboarding row.

**P2 — The same status is stated three times.** The `Draft` chip, the `Onboarding 2 of 4` meter, and
the per-row `Done` / `Not started` chips all answer "how far along is this partner?". The
`0 portal users` chip beside the title repeats Overview's *Portal users invited — Nobody invited yet*.

**P2 — A non-action dressed as an action.** The fourth onboarding row ends in `Not started`, styled
as a control but doing nothing, sitting directly under a real `Invite People` button. A reader
cannot tell which rectangles are clickable.

**P3 — The record page never got the list's frame.** The list now holds its header and toolbar still
and scrolls only its rows; the record page scrolls whole, so *Quality* sits below the fold at 826px
and the tab strip scrolls away with it.

### Worth preserving
- Overview as one scroll with its set-up sections kept as tabs is a deliberate, documented choice
  (`:151-152`) — this plan narrows the tab strip, it does not undo that.
- `PartnerOnboarding` reads in plain language and each row names its next action.

---

## The rename — **done**: option B, on the owner's decision (29 Oct)

The owner was shown the objections below and chose **Publishers** anyway. Built: the sidebar, page
title, breadcrumb, add/edit dialog, search placeholder, table header, empty state, no-matches, pager
noun, toasts and the Get set up step all say Publisher(s). The step **key** stays `lead-sources`,
because it is stored against every tenant's skipped/done marks and renaming it would lose them.

It also ends the duplicate-label clash by itself: **Leads › Lead sources** keeps its name, and the
two menu items no longer read the same.

Left alone deliberately, and worth a later word:
- `components/app/partner-quality-workspace.tsx:139` (Reports › Partner Quality) still says *"How
  good each lead source's leads are"*. Different page, different group — not "this particular page".
- `lib/signup/constants.ts:53` `LEAD_SOURCE_SETUP_STEP` is a **matching key** against what the user
  ticked at sign-up, not a label. Renaming it would break that match.

The objections, kept on the record since they were raised and overruled:

1. **The owner renamed it the other way one day ago.** `afbcf221` (28 Oct 15:57) is titled *"Lead
   sources, page 2 of the UX review: one name, plain types, pay asked up front"*, and its item **L1**
   reads: *"'Lead sources' on the page, sidebar, form, search, counters, table and the step banner."*
   Renaming back to Publishers reverses his own decision, and he reviews from the deployed build.
2. **"Publishers" is right for one of the three kinds this page holds.** The types are `publisher`
   (live transfers), `marketing` (sells you leads) and `affiliate` (refers clients). Calling the page
   Publishers mislabels two thirds of its rows — the opposite of "somebody that never has been here
   knows what's going on".
3. **The problem the rename would solve is real, but it is the other page's fault.** Two menu items
   carry the identical label `Lead sources`: `leads.lists` → `/app/lead-sources` (under **Leads**) and
   `partners.publishers` → `/app/publishers` (under **Partners**). The first one's own code calls it
   *"step 4 · Lists of the one Leads page"* — it is a list of **leads**, not of companies.

**Recommendation:** rename the *other* one to **Lead Lists**, which is what it is. One line in
`lib/menu/definition.ts:113`, it removes the collision, it keeps plain English on both, and it
reverses nobody. Rinor is merging that page, so it needs a word with him first.

If the owner wants **Publishers** anyway, it is a bigger job than a label: page title, breadcrumb,
sidebar, the add/edit dialog, search placeholder, empty states, the pager's noun, the Get set up step
and `lib/dashboard/checklist.ts` — the same list `afbcf221` had to touch. Task R6 covers it, held
until he says so.

---

## Decisions (owner, 29 Oct — all four answered)

1. **"A search bar at the top" means inside the dropdowns.** The search box sits at the top of each
   dropdown panel so a long list can be typed down — which is what `SelectMenu` already does. The
   page's existing `ToolbarSearch` stays exactly where it is, in the card's toolbar. **No page-level
   search bar is added**, and Task 7 does not move the search.
2. **Do not re-cut the sidebar groups.** Scope is the screen in the screenshot: remove the lines and
   make the items understandable. Renaming or regrouping navigation is out.
3. **Lead Sources is ours; Rinor takes the other pages.** Phase 2 is unblocked — `/app/publishers`
   is not going anywhere. The duplicate "Lead sources" label is therefore **not** our change.
4. **The `blurb` surfaces behind an (i) beside the label**, not a hover-only hint — so it is visible,
   tappable and keyboard-reachable.

## Explicitly out of scope

- Re-cutting or renaming the 13 sidebar groups (decision 2).
- Fixing the duplicate "Lead sources" label on two routes (decision 3) — Rinor's side.
- The other Leads/Partners pages (decision 3).
- The accordion closing the previous group on every move.
- `Activation check (remove)` in the demo data — a data cleanup, not a design change.

---

## Extension — SaaS sidebar design parity across roles (requested 29 Oct)

### Current architecture

- Tenant workspaces (`/app/*`) all render `AgentSidebar`. Its menu data is filtered for the tenant's
  role, so Owner, Producer, Assistant, Bookkeeper, Setter and Retention already share the design on
  `/app/publishers`.
- Staff workspaces (`/admin/*`) render `AdminSidebar`; partner workspaces (`/partner/*`) render
  `PartnerSidebar`. Their mobile drawers already use the full labelled navigation, but their desktop
  menus use `NavRail`: a compact icon rail with hover, focus and click flyouts. Those are the visible
  differences from the open Publishers reference.
- The design target is the current labelled agent sidebar: brand row, deep olive surface, readable
  group labels and nested links, active row treatment, and the existing responsive shell.

### Scope and architecture decisions

1. Include every authenticated SaaS shell: all tenant roles, staff/admin roles, and partner roles.
   Exclude public/marketing and sign-in pages.
2. Keep role-specific menu builders, item order and labels, access filtering, URLs, active-route
   matching, mobile drawer behavior and top-bar placement unchanged. Match the desktop collapse
   control and inline group disclosure presentation to the agent sidebar, as the owner clarified on
   29 Oct.
3. Reuse the current nav tokens and shared shell styles. Prefer changing `NavRail` presentation and
   its styles once for both staff and partner shells; do not copy a third sidebar implementation.
4. Owner clarified on 29 Oct that the sidebar should be exactly the same design across roles: the
   collapse control sits at the right end of the brand row, and group pages appear inline under
   disclosure headings. Keep role-specific routes and access rules intact.

### Ordered tasks

1. Capture the current agent, staff and partner sidebar states and map representative allowed roles
   to their menu sources. Record desktop, collapsed/mobile, active, expanded and theme states.
2. Apply the agreed visual treatment to the shared staff/partner `NavRail`, reusing the agent
   sidebar's structure and tokens while keeping each role's menu data and access filters intact.
3. Compare all three shells across representative roles and verify destinations, role visibility,
   current-page indication, inline disclosures, collapse behavior and keyboard operation.

### Acceptance and verification

- Every role renders the same sidebar visual system in both themes and at desktop/mobile widths.
- No role gains or loses a link; link destinations, labels, ordering and access remain identical.
- Inline disclosures and collapse behavior match the agent sidebar; all destinations stay reachable.
- The tenant shell remains visually unchanged; staff/admin and partner shells are checked against
  the Publishers reference after the shared presentation update.

### Risks and open question

| Risk | Impact | Mitigation |
|---|---|---|
| Staff and partner roles currently reveal groups in flyouts while the reference shows them inline | Med | Owner explicitly requested inline disclosure pages; preserve destination access and verify keyboard use |
| `NavRail` is shared by two different role/menu models | Med | Keep menu construction and access checks in their current callers; change only shared presentation |
| Different shell accents or theme tokens drift | Low | Use existing design tokens and compare light/dark states in each shell |

**Resolved 29 Oct:** The owner requested the exact inline layout and right-aligned collapse control.
This supersedes the earlier recommendation to keep the submenu flyouts.
