# Todo: Sidebar legibility + Lead Sources page frame

Plan and critique: `tasks/plan.md`. Branch `redesign/sidebar-and-lead-sources` (off `origin/main`).
Scope decisions are locked — see **Decisions** in `tasks/plan.md`.

## Progress — 29 Oct

| Task | Code | Verified in the browser |
|---|---|---|
| 1 · Remove sidebar elbow lines | done | ✅ `border-left: 0`, `::before: none`, light + dark, collapsed rail |
| 2 · Active trail legible | **no change needed** | ✅ measured: group 14px/550 vs child 13px/400, 51px indent, active 11.6:1 + accent pill. The removal exposed no gap, so nothing was invented. |
| 3 · `blurb` behind an (i) | done | ✅ 29 (i)s, tip opens unclipped, row click still navigates, none in the collapsed rail |
| 4 · Description behind the (i) | done | ✅ seen on `/app/publishers` |
| 5 · `SelectMenu` filters | done | ✅ search panel, groups, counts, dots, zero-count disabled, tint when filtered, Clear resets both |
| 6 · Table grid | done | ✅ name 432px (was 282), Status 220px (was 355); widths identical at 1 and 2 rows; no page overflow (1503 < 1536) |
| 7 · Settings page frame | **already satisfied** | ✅ `pageScrolls: false` at 826px, header and toolbar outside the scroller, pager visible at y645. See note below. |
| 8 · Final verification | **blocked** | ⛔ the dev server's Turbopack cache is corrupt — see below |

## Round 2 — owner's corrections, 29 Oct 21:30

| # | Asked | Done | Verified |
|---|---|---|---|
| R1 | (i)s do **not** belong in the left sidebar — he meant the page title | reverted: `InfoTip` out of `NavItemLink`, `.portal-agent-nav-*` CSS removed | ✅ 0 icons in the rail, lines still gone |
| R2 | The title's (i) should open to the **right**, not below | `page-header.tsx` → `side="right"` | ⛔ not seen yet |
| R3 | Filters: design fine, **panel width must match the trigger** | `panelClassName="w-[var(--radix-popover-trigger-width)]"`, triggers `w-52`. Applied on Partners only — Contracting is out of scope | ⛔ not seen yet |
| R4 | Add-a-lead-source dropdowns unreadable in dark mode | cause found: `bg-transparent` on native `<select>` makes Chrome draw the option popup on its own light background while the text stays light. All 5 native selects on the page replaced | ⛔ not seen yet |
| R5 | "Redesign means everything" | partner type (3 options) is now a `Segmented` with all three on screen and the long sentence as live helper text (§15); country, time zone, payout model and the terms dialog's model are searchable `SelectMenu`s | ⛔ not seen yet |

Native `<select>` count on this page is now **0** (that exact `bg-transparent` class appeared 5 times
app-wide, all in this one file, so the dark-mode bug is fully cleared).

**Round 2 is verified** (29 Oct, in a fresh browser tab):

| Check | Result |
|---|---|
| Title (i) opens to the **right** | ✅ no longer spills across the heading and breadcrumb |
| Dialog dropdowns readable in dark mode | ✅ `rgb(201,214,209)` on `rgb(15,26,23)` = **11.88:1** (AA needs 4.5) |
| Dropdown panel width = trigger width | ✅ 247px = 247px, in the dialog and in the toolbar |
| Panel not clipped by the dialog | ✅ stays inside, stays in the viewport |
| Partner type as a segmented control | ✅ `Live Transfers · Lead Seller · Referrals`, helper line follows the choice |
| Sidebar: no lines, no (i)s | ✅ |

**Correction to the earlier diagnosis.** I twice reported the dev server's Turbopack cache as corrupt
and asked for `rm -rf .next`. That was wrong, and the restart was unnecessary. Turbopack's **dev chunk
URLs are stable** (`_1cvw4ie._.js` never changes name as the file changes), so my browser pane was
serving a cached copy of that URL from before the imports were added — which is why the owner's
Chrome rendered the page correctly while mine showed `SelectMenu is not defined`, then
`Segmented is not defined`, on the same chunk name. Re-fetching the chunk with `cache: "reload"`
showed the server had been serving correct code all along. **Fix for next time: open a fresh tab, or
hard-reload bypassing cache — do not restart the dev server.**

**Still blocked on the same thing.** The dev server's Turbopack cache keeps emitting this file without
its new import bindings — three times now: first `SelectMenu is not defined`, now
`Segmented is not defined`, while the served chunk *does* list `components/ui/view-tabs.tsx` among its
imports. The source is right: `npx tsc --noEmit` is clean, and `pnl-board.tsx` and
`accounting-settings-board.tsx` are both `"use client"` and import `{ Segmented, ViewTabs }` from the
same path and work. Touching both modules to force a re-emit did not clear it.

**Task 7 — why the card still fills the height.** The plan proposed shrinking the card so two rows
leave no blank area. On inspection that blank area is the *approved* house pattern: the owner asked
for exactly this on Contracting ("the step card reaches the bottom of the window", `52fa5886`;
"pages that fit", `37f33899`). Shrinking it here would have broken the "same frame as the other
pages" requirement, so it was deliberately left alone.

**Blocker — the dev server must be restarted with `.next` cleared.** The chunk being served
(`_next/static/chunks/_1qat9ch._.js`) contains the new JSX (`Filter by partner type`) but **not** the
`select-menu` import and **not** `table-fixed` — Turbopack bundled the edits only partially, so
`PartnersWorkspace` throws `SelectMenu is not defined` and the page loops on "Loading". The source is
correct: `npx tsc --noEmit` is clean, the imports are at `partners-workspace.tsx:71` and
`agent-sidebar.tsx:86`, and all 25 UI-consistency guards pass. `.next` also still holds route types
from another branch (`carrier-rules`, `onboarding/about-you`), which is the same staleness.

```bash
# stop the dev server on port 3000, then:
rm -rf .next && npm run dev
```

**Pre-existing, not from this work:** `lib/transferInbox/statusSeek.test.mjs` fails on a CRLF/LF
mismatch while matching two `supabase/migrations/*.sql` files (untouched here), and `npm run lint`
reports ~138k problems repo-wide, which is the existing baseline.
Standing verification for every task: `npm run lint`, `npm run typecheck`, `npm test`.

---

## Phase 1: Sidebar

### Task 1: Remove the sidebar's elbow connector lines

**Description:** Delete the per-child tree connector drawn under each open sidebar group. The indent
and the active pill already carry the hierarchy; the elbow restates it and terminates in mid-air at
the last child, which is what reads as broken. The settings menu dropped the same lines on 29 Oct.

**Acceptance criteria:**
- [ ] No connector line renders under any open sidebar group, at any width
- [ ] Children stay indented under their group and keep their icons
- [ ] The settings menu and the partner portal menu are visually unchanged

**Verification:**
- [ ] `npm test` passes
- [ ] Manual: open Accounting, Partners and Reports at 1536×826 — no lines, no ragged stub
- [ ] Manual: `/app/settings` menu unchanged; `/design/shell` unchanged

**Dependencies:** None

**Files likely touched:**
- `app/globals.css` (the `.portal-agent-nav-section > .portal-agent-nav-sublist` block, ~3732–3751)

**Estimated scope:** XS — 1 file

---

### Task 2: Make the active trail legible without the lines

**Description:** With the connector gone, "which group am I in" must come from the group header and
the active pill alone. Confirm the open group's header reads as a heading (weight/contrast) against
its children, that the active child's pill is unambiguous, and that the indent is enough to group
without the line. Tune only what the removal exposed.

**Acceptance criteria:**
- [ ] The open group's header is visibly distinct from its children (weight and/or colour)
- [ ] The active child is unmistakable at a glance
- [ ] Indent still groups children to their parent without a drawn line
- [ ] Contrast of group label and child label both meet 4.5:1 on the real sidebar background, in
      both themes

**Verification:**
- [ ] `npm test` passes
- [ ] Manual: compare an open group against the settings menu — the two menus agree
- [ ] Manual: check in light and dark

**Dependencies:** Task 1

**Files likely touched:**
- `app/globals.css`
- `components/app/agent-sidebar.tsx` (only if a class is needed)

**Estimated scope:** S — 1–2 files

---

### Task 3: Show each item's existing `blurb` behind an (i)

**Description:** `lib/menu/definition.ts` already carries a one-line `blurb` on most items ("The book
you already have", "Pay publishers from the ledger, not WhatsApp"). The sidebar never renders it.
Surface it behind an (i) beside the label (owner's choice, 29 Oct) so a first-time user can find out
what a destination is without opening it. Use the kit's `InfoTip`. No new copy is written.

**Acceptance criteria:**
- [ ] An item with a `blurb` shows an (i) beside its label; opening it shows the blurb
- [ ] An item without a `blurb` shows no (i) at all — no empty bubble, no placeholder
- [ ] The (i) is reachable by keyboard and by touch, and does not trap focus
- [ ] The (i) does not steal the row's click — clicking the row still navigates
- [ ] The tip is not clipped by the sidebar's scroll container
- [ ] The menu still scans at 826px tall: the (i) is quiet enough not to compete with the label

**Verification:**
- [ ] `npm test` passes
- [ ] Manual: tab through an open group — each (i) opens and dismisses, navigation still works
- [ ] Manual: open an item near the sidebar's bottom edge — the tip is not cut off
- [ ] Manual: collapsed icon rail — no stray (i)

**Dependencies:** Task 1

**Files likely touched:**
- `components/app/agent-sidebar.tsx`
- `lib/menu/definition.ts` (only if the type needs `blurb` surfaced to the sidebar)

**Estimated scope:** S — 1–2 files

---

### Checkpoint: Sidebar
- [ ] `npm run lint`, `npm run typecheck`, `npm test` all pass
- [ ] Sidebar rendered at 1536×826 in both themes, no lines, hints working
- [ ] Settings menu and partner portal menu confirmed unchanged
- [ ] **Screenshot to the owner before starting Phase 2** (manager review 29 Oct, 09:32)

---

## Phase 2: Lead Sources page

> **Unblocked** (owner, 29 Oct): Lead Sources is ours; Rinor takes the other Leads/Partners pages.

### Task 4: Description behind the (i)

**Description:** The page's subtitle takes a full row. `PageHeader` already has `infoDescription`,
added on 29 Oct for exactly this; the page just does not pass it. One prop, and the page matches
every Settings page.

**Acceptance criteria:**
- [ ] The subtitle no longer renders as a line under the title
- [ ] An (i) beside the title opens it, on hover and on click
- [ ] The description is still in the accessible name/`sr-only` path
- [ ] The reclaimed vertical space goes to the table, not to padding

**Verification:**
- [ ] `npm test` passes
- [ ] Manual: `/app/publishers` — title row matches `/app/settings#carriers`

**Dependencies:** None

**Files likely touched:**
- `components/app/partners-workspace.tsx` (~line 730)

**Estimated scope:** XS — 1 file

---

### Task 5: Replace the native `<select>` filters with `SelectMenu`

**Description:** `All types` and `All statuses` are raw `<select>`s rendering the OS dropdown — no
search, no counts, no active tint, different on every machine. Swap both for the kit's `SelectMenu`,
which was built on 29 Oct for this exact complaint and is already used by Contracting. Add per-option
counts so the filter says how much it will leave.

**This is where "a search bar at the top" lands** (owner's decision 1): the search sits at the top of
each dropdown's panel. The page's own `ToolbarSearch` box is not moved and no page-level search bar
is added.

**Acceptance criteria:**
- [ ] Both filters are `SelectMenu`, with a search box at the top of the panel
- [ ] The page's existing "Search lead sources" box stays in the toolbar, unmoved
- [ ] Each option shows its count; the trigger takes the brand tint when not on its default
- [ ] Arrow keys move, Enter picks, Escape closes; the trigger keeps its accessible name
- [ ] Filtering still resets the pager to page 1
- [ ] `Clear filters` still clears both
- [ ] The panel is not clipped by the card's scroll container

**Verification:**
- [ ] `npm test` passes — in particular the `radix-select` ratchet in `lib/design/uiOffenders.json`
- [ ] Manual: filter by type and by status, alone and together; clear them
- [ ] Manual: keyboard-only pass through both filters

**Dependencies:** None

**Files likely touched:**
- `components/app/partners-workspace.tsx` (~lines 813–847)

**Estimated scope:** S — 1 file

---

### Task 6: Fix the table grid

**Description:** `.portal-lead-table` has no `table-layout` and no column widths, so the browser
sizes columns from content — `Lead Source` and `Status` take all the slack and the four numeric
columns crowd the right edge. Give the table an explicit column template following the repo's
existing convention (`table-fixed` + `w-[Npx]` per `<th>`), and make the numeric columns align
consistently.

**Acceptance criteria:**
- [ ] Column widths are stable regardless of how many rows are loaded, and of row content length
- [ ] `This Month`, `Sales` — and `You Pay` where it is a figure — align consistently; no column is
      right-aligned next to a left-aligned sibling without a reason
- [ ] `Lead Source` still truncates with its title attribute rather than pushing the row wide
- [ ] The detail view (`selectedPartner`, 4 columns hidden) is **not** squeezed — check it explicitly
- [ ] No horizontal scroll at 1536px; below the table's min width it scrolls rather than crushing

**Verification:**
- [ ] `npm test` passes — especially *"no table-fixed table squeezes its flexible columns to nothing"*
      (`lib/design/uiConsistency.test.mjs:315`), which requires ≥120px per flexible column
- [ ] Manual: list view with 2 rows and with a full page of rows
- [ ] Manual: detail view open, where four columns are hidden

**Dependencies:** None

**Files likely touched:**
- `components/app/partners-workspace.tsx` (the `<table>` and its `<th>`s, ~856–866)
- `app/globals.css` (`.portal-lead-table`, ~934–942)

**Estimated scope:** S — 2 files

---

### Task 7: Adopt the Settings page frame

**Description:** Give the page the frame the Settings pages got on 29 Oct: the title, the (i), the
breadcrumb and the toolbar stay put while only the rows scroll, with the pager pinned at the foot.
Also stop the card stretching to full height when it holds two rows, which is the blank slab in the
screenshot. The search stays in the toolbar (decision 1) — this task does not move it.

**Acceptance criteria:**
- [ ] Scrolling the rows does not move the title, the (i), the breadcrumb or the toolbar
- [ ] The pager stays visible at the foot without scrolling to it
- [ ] With 2 rows there is no large empty area between the last row and the pager
- [ ] With many rows the inner region scrolls and the page itself does not
- [ ] Nothing is clipped at 1536×826
- [ ] The frame reads as the same page type as `/app/settings#carriers`

**Verification:**
- [ ] `npm test` passes
- [ ] Manual: 2 rows, a full page of rows, empty state, and no-matches state
- [ ] Manual: side by side with Contracting — same frame

**Dependencies:** Tasks 4, 5, 6 — frame last, so it is fitted to the final content

**Files likely touched:**
- `components/app/partners-workspace.tsx`
- `app/globals.css` (only if a shared frame class is needed)

**Estimated scope:** M — 2 files

---

### Checkpoint: Lead Sources
- [ ] `npm run lint`, `npm run typecheck`, `npm test` all pass
- [ ] `npm run build` succeeds
- [ ] All four list states exercised: populated, 2-row, empty, no-matches
- [ ] Detail view exercised — columns not squeezed
- [ ] **Screenshot to the owner** before it goes further

---

## Phase 3: Verify

### Task 8: Render, exercise states, compare

**Description:** Run the real pages and check the result against the critique, not against the
absence of errors. Compare with Contracting, which is the approved reference frame.

**Acceptance criteria:**
- [ ] Sidebar and Lead Sources both rendered at 1536×826 (the owner's screen) in light and dark
- [ ] Keyboard pass: sidebar hints, both filters, the search, the table rows, the pager
- [ ] No console errors, no layout shift on load
- [ ] Every P1 and P2 finding in `tasks/plan.md` is either fixed or recorded as deliberately deferred

**Verification:**
- [ ] Dev server on port 3000
- [ ] Screenshots captured at 1536×826 for the handoff
- [ ] A short written note of what was tested and what was not

**Dependencies:** Tasks 1–7

**Files likely touched:** none (verification only)

**Estimated scope:** S

---

### Checkpoint: Complete
- [ ] All acceptance criteria met
- [ ] Open Questions 1–4 in `tasks/plan.md` answered or explicitly deferred
- [ ] One PR per phase, as the owner asked (manager review 29 Oct, 09:32 and 12:36)
- [ ] Ready for review

---

## Phase 4: A publisher's own page — `/app/publishers/[id]` (round 3)

Critique behind these tasks: **Round 3 critique** in `tasks/plan.md`.

### Results — 29 Oct, R1–R4 done and seen

| Task | Done | Verified at 1536×826 |
|---|---|---|
| R1 figures | 5 hand-rolled tiles → one `StatStrip` of three real figures: Calls/Leads This Month (footnote = last lead), Sales This Month, Approved Products. `PartnerFact` deleted | ✅ one frosted strip, hairline dividers |
| R1 attributes | *You pay* and *Since* moved to the identity line: `Draft · Per lead · $25.00 · Since 28 Oct 2026`. The duplicated `0 portal users` chip removed | ✅ |
| R2 tabs | 6 → **5**. **Activity** dropped: its whole panel was a paragraph saying the audit trail is *not* viewable here plus a generic link — "whatever is not functional, we need to remove" (owner, 29 Oct). `?tab=activity` falls through to Overview, as any unknown tab already did | ✅ Overview · Products · Forms · Commercial Terms · Carrier & States |
| R4 frame | Header, identity line, strip and tab strip hold still; only the open tab scrolls; switching tabs starts at the top (the panel's `key` remounts it) | ✅ `pageScrolls:false`, `panelScrollable:true`, `headerStaysPut:true`, no horizontal scroll, no console errors, light + dark |

**R3 — withdrawn, I was wrong.** My critique called the onboarding row's `Not started` "a non-action
dressed as an action". It is not: `partner-onboarding.tsx` already renders it as a `StatusChip`
(`<span>`), and only a step that *has* somewhere to go renders a `Button`. Measured, the two are
plainly different — the button is 32px tall with an 8px radius, a `rgb(95,122,113)` border and a
tinted fill; the chip is 22px with a 6px radius and a `rgb(34,52,46)` border. I also over-claimed
"the status is said three times": the `Draft` chip is lifecycle, `2 of 4` is progress and the row
chips are per-step — a hierarchy, not a repetition. The one real duplication was the portal-user
count in the header, and that is gone (R1). **No change was made for R3**, deliberately.

**R4 note — why a `dvh` calc and not pure flex.** The flex chain now runs unbroken from the page root
to the panel, but nothing above it caps the height: `.portal-agent` is `min-h-screen`, so the shell
grows to content. Capping it (`h-dvh` + `overflow-hidden`) is a global layout change touching every
page, so the panel is bounded with `max-h-[calc(100dvh-var(--top-bar-h)-385px)]` instead — the same
device the list already uses in this file. If the shell is ever height-capped, that calc can go and
the flex chain will carry it on its own.

### Task R1: Figures into the kit's strip; attributes out of it

**Description:** The record page hand-rolls five tiles and calls three attributes "facts". Move the
two real figures into the kit's `StatStrip` + `StatTile` (UI-CONSISTENCY §4) and re-home the rest:
*You pay* belongs with Commercial Terms, *Since* on the identity line, *Last lead* beside the leads
figure as its "as of".

**Acceptance criteria:**
- [ ] The strip is `StatStrip`/`StatTile` from `components/ui/stat.tsx` — no local tile markup
- [ ] Only figures sit in the strip; no attribute is styled as a metric
- [ ] Nothing that was on the page has been dropped — each moved item has a stated new home
- [ ] The local `PartnerFact` helper is gone, or is left with no callers and removed

**Verification:**
- [ ] `npm test` — `lib/design/uiConsistency.test.mjs` (watch `local-surface` and `mixed-stat`)
- [ ] Manual: a partner with terms and one without; `—` cases still read correctly

**Dependencies:** None
**Files likely touched:** `components/app/partners-workspace.tsx`
**Estimated scope:** S — 1 file

---

### Task R2: Narrow the tab strip to five

**Description:** Six tabs exceeds the §15 cap of five. Fold the two set-up tabs a reader visits once
(*Forms*, *Carrier & States*) so the strip names the jobs people actually come back for. Keep every
destination reachable and keep existing `?tab=` links working.

**Acceptance criteria:**
- [ ] At most five tabs, each named for a job
- [ ] No content is unreachable; folded sections still have a route in
- [ ] Old `?tab=forms` / `?tab=markets` links still land on the right content, not a 404 or a silent Overview
- [ ] The documented "Overview is one scroll, set-up keeps its tabs" intent (`:151-152`) still holds

**Verification:**
- [ ] `npm test` passes
- [ ] Manual: visit each old `?tab=` value and confirm where it lands

**Dependencies:** None
**Files likely touched:** `components/app/partners-workspace.tsx`, `app/app/(shell)/publishers/[id]/page.tsx`
**Estimated scope:** M — 2 files

---

### Task R3: Say the status once

**Description:** The `Draft` chip, the `Onboarding 2 of 4` meter and the per-row chips all answer the
same question, and `0 portal users` repeats an onboarding row. Pick one place for progress and let
the others defer to it. Also fix the fourth row's `Not started`, which is styled as a control but
does nothing while a real button sits right above it.

**Acceptance criteria:**
- [ ] Progress is stated in one place; the others do not restate it
- [ ] `Not started` no longer looks like a control — it is a chip, or it becomes the row's real action
- [ ] Every onboarding row either has a working action or plainly has none
- [ ] The `0 portal users` chip either goes or stops duplicating its onboarding row

**Verification:**
- [ ] `npm test` passes
- [ ] Manual: a Draft partner, a part-onboarded one, and a fully onboarded one
- [ ] Keyboard: nothing non-interactive takes focus

**Dependencies:** None
**Files likely touched:** `components/app/partners-workspace.tsx`, `components/app/partner-onboarding.tsx`
**Estimated scope:** M — 2 files

---

### Task R4: The record page gets the list's frame

**Description:** The list keeps its header and toolbar still and scrolls only its rows. The record
page scrolls whole, so *Quality* is below the fold at 826px and the tab strip scrolls away. Give it
the same frame so the two halves of one feature behave alike.

**Acceptance criteria:**
- [ ] Title, breadcrumb, identity line and tab strip stay put while the panel scrolls
- [ ] At 1536×826 the first screen shows the figures and the start of Overview without scrolling
- [ ] No nested scrollbars and no horizontal page scroll
- [ ] Each tab's panel scrolls independently, and switching tabs returns to that panel's top

**Verification:**
- [ ] `npm test` passes
- [ ] Manual at 1536×826 and at a short viewport, on a long tab (Activity) and a short one

**Dependencies:** R1, R2 — frame last, fitted to the final content
**Files likely touched:** `components/app/partners-workspace.tsx`, `app/globals.css`
**Estimated scope:** M — 2 files

---

### Task R5: Dialog and record pass at 1536×826, light and dark

**Description:** Round 2 replaced every native `<select>` on this page but none of it has been seen
rendered. Exercise the add/edit dialog and the record page properly, in both themes.

**Acceptance criteria:**
- [ ] Every dropdown in the dialog is readable in dark mode — the original complaint
- [ ] The segmented partner-type control reads correctly and its helper line follows the choice
- [ ] Dialog dropdown panels are not clipped by the dialog and close on Escape without closing it
- [ ] The title (i) opens to the right on both the list and the record page
- [ ] Filter panels match their trigger width
- [ ] No console errors; no layout shift on open

**Verification:**
- [ ] Screenshots at 1536×826 in both themes, dialog open and each tab visited
- [ ] Keyboard-only pass through the dialog

**Dependencies:** R1–R4
**Files likely touched:** none (verification only)
**Estimated scope:** S

---

### Task R6: Rename to Publishers — ✅ **DONE** (owner chose B, 29 Oct)

Objections raised and overruled; see **The rename** in `tasks/plan.md` for the record.

**Acceptance criteria:**
- [x] Page title, breadcrumb, sidebar, dialog, search placeholder, empty state, no-matches, table header, pager noun, toasts and the Get set up step all say Publisher(s)
- [x] `lib/dashboard/checklist.ts` label and action match (`Add your publishers` / `Add publishers`)
- [x] No "lead source" left on this page — the only remaining matches in `lib/menu/definition.ts` are comments about **Leads › Lead sources**, a different page
- [x] The setup step **key** stays `lead-sources` (stored per tenant; renaming would lose skipped/done marks)
- [x] `npm test` — 98/98 across menu, checklist, design contract and UI consistency
- [x] Seen rendered: sidebar, breadcrumb, title, `Add Publisher`, `Search publishers`, `Publisher` column, `2 publishers in all`

**Files touched:** `lib/menu/definition.ts`, `lib/dashboard/checklist.ts`, `components/app/partners-workspace.tsx`

---

### Checkpoint: Record page
- [ ] `npm run lint`, `npm run typecheck`, `npm test` pass
- [ ] List, dialog and record page all seen at 1536×826 in both themes
- [ ] **Screenshot to the owner** before anything else (manager review 29 Oct, 09:32)

---

## Round 4 — the Add Publisher dialog, 29 Oct

| Asked | Done | Verified |
|---|---|---|
| "the drop down is going up here" | The kit panel is capped at `min(18rem, --radix-popover-content-available-height)` and its list shrinks instead of fixing `max-h-80`. At 24rem it still did not fit the ~344px under a mid-dialog field, so Radix flipped it | ✅ `data-side: "bottom"`, opens under the trigger, stays in the viewport |
| "we should have all the countries" | 9 curated → **243** ISO 3166-1 countries, named by `Intl.DisplayNames` so there is no name table to go stale. The nine call-centre countries stay on top under a **Common** group | ✅ 243 options, groups render, search finds "Germany" |
| *(found while testing)* the zone did not follow the country | With every zone on offer, the old "is the current zone still valid?" test was always true — picking Germany kept **New York**. Zones now come from `Intl.Locale('und-XX').timeZones` | ✅ Germany → **Berlin · Europe** |

`CURATED_ZONES` keeps the named zones for the nine common countries (so Canada still reads
"Eastern (Toronto)" rather than an IANA id); anywhere else gets its own country's zones.

**Shared-component check.** `SelectMenu` is used by Contracting too. Re-tested there after the
change: opens downward, 224px, search, status dots, counts and tick all intact — no regression.

## Round 5 — simplifying Overview, 29 Oct

Overview was seven stacked sections: Onboarding · Quality · Money · People · **Products** · Contact ·
Notes. Two of them were not earning their place.

| Cut | Why | Verified |
|---|---|---|
| The **products table** (40 lines) | The same list already has its own **Products** tab, and Overview's copy ended in a button whose only job was to open that tab — one list linking to the other. The strip above already carries the figure ("Approved Products 2 of 8"). The tab is also the better of the two: it has real checkboxes and says "Your agency does not sell it", where Overview's copy was read-only chips | ✅ gone from Overview; Products tab unchanged and still editable |
| The **onboarding checklist, once complete** | Four green ticks and a full bar kept at the top of the page for the rest of the partner's life. It now returns `null` when every step is done. Each row is read from the record, not ticked by hand, so it comes back on its own if a step stops holding — terms lapsing, the last product unapproved | ⚠️ the still-onboarding state is verified (shows at 2 of 4); the complete state is a one-line guard I could not stage, as no publisher in this data is fully onboarded |

`ProductChip` was left with no callers by the first cut and has been deleted — the design contract
has a "no component is orphaned" test.

Overview now reads: **Onboarding** (while it still has something to say) → **Quality** → **Money** →
**People** → **Contact** · **Notes**.

Clean load: 0 failed requests of 57, no current console errors. (A 500 shows in the console buffer
from an earlier HMR window; it does not recur on a fresh load.)

**Still open:** nothing from this round. The record page and the list are both done.

---

## Out of scope (ruled on by the owner, 29 Oct)

- **Re-cutting or renaming the 13 sidebar groups.** Scope is the screen in the screenshot.
- **The duplicate "Lead sources" label** on two routes — Rinor's side.
- **The other Leads/Partners pages** — Rinor's side.
- **The accordion closing the previous group** on every move.
- **`Activation check (remove)`** in the demo data — a data cleanup, not a design change.

---

## Extension — SaaS sidebar design parity across roles (29 Oct)

### Task S1: Record role-shell baseline and menu boundaries

**Description:** Inventory the tenant, staff/admin and partner navigation renderers and capture their
current desktop/mobile and light/dark states before changing presentation.

**Acceptance criteria:**
- [ ] Tenant roles are confirmed to use the shared `AgentSidebar` and existing role-filtered menu.
- [ ] Staff/admin and partner roles are mapped to their `AdminSidebar`/`PartnerSidebar` and shared
      `NavRail` sources.
- [ ] Current links, labels, order, role visibility and active-route behavior are recorded as the
      behavior baseline.

**Verification:** Read-only source audit plus screenshots of representative roles and states.

**Dependencies:** None
**Files likely touched:** none (audit only)
**Estimated scope:** S

### Task S2: Align staff and partner sidebar presentation

**Description:** Make the shared desktop `NavRail` match the agent sidebar on `/app/publishers`,
including collapse control placement, inline group pages, and sizing, while retaining role-specific
menu data and access rules.

**Acceptance criteria:**
- [x] Staff/admin and partner desktop navigation use the agreed brand, surface, typography, spacing,
      row, active, hover and focus treatments.
- [x] Role data, route destinations and account-card behavior remain intact; desktop group pages use
      the requested inline disclosures.
- [x] Mobile drawers and the tenant `AgentSidebar` keep their existing behavior and appearance.

**Verification:** Compare the three shells at desktop and mobile widths, light and dark themes.

**Dependencies:** Task S1 and owner approval of the open question in `tasks/plan.md` (approved 29 Oct).
**Files likely touched:** `components/portal/nav-rail.tsx`, `components/admin/admin-sidebar.tsx`,
`components/partner/partner-sidebar.tsx`, `app/globals.css`
**Estimated scope:** M

### Task S3: Check role access and navigation behavior after the visual pass

**Description:** Verify representative tenant, staff/admin and partner roles still expose and operate
the same destinations after the presentation change.

**Acceptance criteria:**
- [ ] No role gains or loses a destination; hrefs, labels, order and access filters are unchanged.
- [ ] Current-page indication and existing click, hover, focus and keyboard navigation still work.
- [ ] Screenshots show the agreed visual parity in both themes without clipped or unreachable items.

**Verification:** Manual role/navigation walkthrough and focused static checks for touched files.

**Dependencies:** Task S2
**Files likely touched:** none (verification only)
**Estimated scope:** S

**Source check (29 Oct):** All role-specific link/group data remains in `AdminSidebar` and
`PartnerSidebar`; only their shared `NavRail` renderer changed. Active matching, hrefs and role
filters remain intact. The desktop group interaction now matches the agent sidebar's inline
disclosure behavior by request. Runtime interaction and screenshot comparison remain pending because
the available partner preview redirects to sign-in without an authenticated session.

### Checkpoint: Sidebar parity
- [x] Owner reviewed and approved the plan's open question before implementation (29 Oct).
- [ ] Visual parity is confirmed across tenant, staff/admin and partner shells.
- [ ] Role-based destinations and navigation behavior are unchanged.

**Implementation note (29 Oct):** The owner clarified exact parity: the collapse control belongs at
the right end of the brand row, and group pages must appear inline. The shared desktop `NavRail` now
uses the same accordion structure and 264px/76px widths as the agent sidebar. Menu builders, role
filters, hrefs, active matching and mobile drawers remain role-specific and intact. Runtime visual
comparison remains pending without an authenticated partner/admin browser session.
