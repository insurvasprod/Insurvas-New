# UX platform: easy to adjust, able to grow

Runs alongside every module phase. See the [roadmap](../roadmap/ROADMAP.md).

**Phase gate:**
- A new module page needs only data (menu item, settings section) plus its own page file.
- The UI-rule offender counts are enforced by tests and only go down.

**Findings (2026-10-02 audit):**
- 339 components and 117 pages. Shared primitives are widely adopted: `TableCard` in 115 places, `PageHeader` in 93.
- **The three design docs disagree:**
  - eyebrow: FOUNDATION §5 says use one; UI-CONSISTENCY says none;
  - figures: metric-card grid vs `StatStrip`;
  - colour identity: blue admin + orange portals vs one identity.
- **Duplicate primitives:** a second `StatTile`, `SearchBox` and `TableToolbar` in `components/app/settings/primitives.tsx` (`TableToolbar` has 0 uses). Three status-chip systems: `StatusChip` 161, `Pill` 220, `Badge` 27.
- **Hand-written navigation:**
  - `components/app/agent-sidebar.tsx` hardcodes module grouping, order, labels and icons;
  - the settings tabs render through a hand-written `switch` (`agent-settings-tabs.tsx:121-145`);
  - adding a page takes about seven edits.
- **Offenders:**
  - 931 arbitrary `text-[Npx]` in 140 files;
  - 20 files with a raw `<table>` outside `TableCard`;
  - 41 hex literals in `.tsx`;
  - 50 `h-10` / `h-11` / `size="lg"`;
  - 75 `btn()` instead of `<Button>`;
  - 3 leftover `eyebrow=`;
  - 8 "Loading…" texts and 8 hand-rolled pagers.
- **Worst files:**
  - `admin/legal-screen.tsx`
  - `app/assignment-workspace.tsx`
  - `app/dialer-workspace.tsx`
  - `settings/primitives.tsx`
  - `app/lead-list-assign-drawer.tsx`
  - `app/disposition-wizard.tsx`
  - `app/transfer-inbox.tsx`
  - `app/deal-flow-funnel.tsx`
  - `app/pipeline-stage-manager.tsx`
  - `app/dashboard-today.tsx`
- **No test enforces any UI-CONSISTENCY rule.**

**Progress:**
- **2026-10-03: UX-1 done.** `UI-CONSISTENCY.md` is the single authority and records the three decisions: no eyebrow, `StatStrip` only, and orange apps with a blue admin console. (Corrected 2026-10-03: the first write-up said "one identity". The admin blue is user decision 1, in `app/admin/admin-plane.css`, which the first search missed.) `00-FOUNDATION.md`, `06-MOCKUP-INDEX.md` and the README point to it. The dead eyebrow on Callbacks is removed.
- **2026-10-03: UX-2 done.** `lib/design/uiConsistency.test.mjs` with baseline `lib/design/uiOffenders.json`, using per-file counts. Comments are ignored, and a few documented exemptions apply (the table primitive and printed documents). Starting totals:

  | Rule | Count |
  |---|---:|
  | raw-table | 24 |
  | tall-control | 27 |
  | hex-colour | 42 |
  | text-px | 933 |
  | hand-pager | 6 |
  | btn-helper | 74 |
  | extra-page-header | 0 |
  | eyebrow | 0 |
  | loading-text | 0 |
- **2026-10-03: UX-3 done.** The sidebar's arrangement is data in `lib/menu/sidebar.ts` (`NAV_MODULES`, `NAV_BUSINESS_GROUPS`, `navLabel` on menu items), and `agent-sidebar.tsx` renders `buildSidebarTree()`. `lib/menu/sidebar.test.mjs` proves the tree is identical to the old hand-written logic for every role across 70+ entitlement sets. A new menu section appears under Business with no code.
- **2026-10-03: UX-4 done.** Settings panels are a registry (`components/app/settings/panels.tsx`) keyed by section id, and short descriptions live on the sections. A test fails if a section has no panel or a panel has no section.
- **2026-10-03: UX-5, first half.**
  - Duplicates: the settings copies of `StatTile`, `SearchBox` and `TableToolbar` are gone (Assignment uses `ToolbarSearch`).
  - One chip: `StatusChip` is now 12px (it was 11px, below the type floor) and accepts a layout `className`. `Pill` is a thin deprecated alias over it. All 17 `Badge` files are converted to tones that say what the state means, and `components/ui/badge.tsx` plus `SUBSCRIPTION_STATUS_BADGE_CLASS` are deleted.
  - Pagers: `Pager` gained `disabled` (for server paging) and a rich `suffix`. All 6 hand-rolled pagers use it, so hand-pager is at 0.
  - Ratchet: new `legacy-chip` rule (220 `Pill` uses to move). Text-px 933 → 925.
- **2026-10-03: UX-5 done.**
  - Raw tables 24 → 0. Each of the 24 was reviewed: the Deal flow funnel's "By agent" card and the admin login table's frame are now `TableCard`. The others are grids inside a dialog, drawer or detail panel (§8: no card in a card), each exempted with its reason in the test. `SettingsTableCard` counts as a table card.
  - Browser pass at 1280px in light and dark mode, and at 375px. It found and fixed four real layout bugs:
    1. Policies: the Customer column was 0px wide (fixed columns took the whole table), so names ran into Carrier.
    2. Partners: names, Type and the month's figures overran their columns (a truncation with no width, and `whitespace-nowrap`).
    3. Shared `PageHeader`: actions never wrapped (`shrink-0`), so on a phone the last action (Policies' Import) was clipped off-screen. This is fixed for every page.
    4. The same squeeze in Vendor returns and TCPA screening, plus three small tables that had no minimum width at phone size.
  - New zero-tolerance test: no `table-fixed` table may leave its flexible columns less than 120px each.
  - Sidebar clicks are verified in the browser (modules, Business groups, Partners, the current-page marker, short labels).
- **2026-10-03: UX-6 done.** The three largest screens are split without changing behaviour. Code was moved verbatim, and the ratchet totals are identical before and after, which proves nothing was rewritten:

  | Screen | Before | After |
  |---|---:|---|
  | Dialer | 1,339 | `dialer-workspace.tsx` 390 + `dialer/use-dialer.ts` (state hook) 619 + `dialer/lead-column.tsx` 316 + `dialer/model.tsx` 164 |
  | Lead assignment | 1,213 | `assignment-workspace.tsx` 455 + `assignment/use-assignment-workspace.ts` 419 + `assignment/rule-editor.tsx` 248 + `assignment/model.ts` 156 |
  | Admin legal | 1,247 | `legal-screen.tsx` 374 + `legal/` (`versions`, `draft-cards`, `dialogs`, `model`) |

  - The dialer's 21 source-reading tests now read the dialer's files together through `lib/dialerScripts/dialerSource.mjs`, and all pass unchanged.
  - Smaller components let React's lint analyse the render, so it flagged `Date.now()` during render. The on-screen clocks now use `useNow()` (refreshed every minute).
  - New ratchet mode `UI_RATCHET_WRITE=move` records offenders moved by a split, and refuses if any total grew.
  - Checked in the browser: the dialer, lead assignment (rules, live routing preview, rule editor opening) and admin legal all render, with no console errors.
  - Seen in passing: `/api/app/dialer/next` hit a database statement timeout when the dialer opened (it serves on open, as before). That is server-side and not from this split. It is worth a performance look.
- **UX-5 left as tracked debt:** 220 `Pill` uses (an alias, one implementation), 74 `btn()` uses, 27 tall controls, 42 hex colours, 923 `text-[Npx]`. All are ratcheted and only go down. The pane would not paint, so nothing hydrated. The server-rendered tree was correct.

---

## UX-1: One design standard

**Scope:**
- Make [UI-CONSISTENCY.md](../design/UI-CONSISTENCY.md) the single authority, and amend FOUNDATION and the mockup index where they disagree. Decide, and write down:
  - **Eyebrow:** none.
  - **Figures:** `StatStrip` only.
  - **Colour identity:** orange for the agent and partner apps, blue for the admin console (user decision 1, `app/admin/admin-plane.css`).
- Add the design-system memory note to the docs README.

**Acceptance:** no two design docs contradict each other on any rule; a reviewer can cite one file.

## UX-2: UI rules enforced by tests (the ratchet)

**Scope:** `lib/design/uiConsistency.test.mjs`. Each rule has a list of known offenders that may only shrink: a new offender fails the build, and fixing one requires removing it from the list. The rules cover:
- a raw `<table>` outside `TableCard`;
- a page without exactly one `PageHeader`;
- `h-10`, `h-11` or `size="lg"` inside the app shell;
- hex colours in `.tsx`;
- `text-[Npx]`;
- `eyebrow=`;
- "Loading…" text;
- a hand-rolled pager;
- `btn(` in new files.

**Acceptance:**
- The test fails on any new offender.
- Today's counts are recorded in the test, and the counts only go down.

## UX-3: Data-driven sidebar

**Scope:**
- Move the module grouping (LA-1 / LA-2 / LA-3 and later modules), order, short labels and icons from `agent-sidebar.tsx` into `lib/menu/definition.ts`: fields `module`, `order`, `navLabel`, and `icon` (already present).
- The sidebar becomes a pure renderer.
- New modules (Book, Retention, Accounting, Team) appear by data.

**Acceptance:**
- The sidebar renders the same tree as today; a snapshot test proves it.
- Adding a module heading needs no sidebar code.
- The existing menu tests stay green.

## UX-4: Data-driven settings

**Scope:**
- Each entry in `lib/settings/sections.ts` names its component through a registry map.
- `agent-settings-tabs.tsx` stops switching on ids.

**Acceptance:**
- Adding a settings section is one entry plus one component.
- Settings search and deep links (`#id`) keep working.

## UX-5: Merge duplicate primitives

**Scope:**
- Remove the settings copies of `StatTile`, `SearchBox` and `TableToolbar` in favour of `components/ui/*`.
- Pick one chip: `StatusChip`. `Pill` and `Badge` become thin aliases, then go away.
- Fix the 20 raw-table files and the 8 hand-rolled pagers, starting with the worst ten files.

**Acceptance:**
- One implementation of each primitive.
- The UX-2 offender lists shrink accordingly.
- No visual regression: screenshot pass in light and dark mode, and at 375px.

## UX-6: Break up the largest screens

**Scope:** split `dialer-workspace.tsx` (1,339 lines), `assignment-workspace.tsx` (1,213) and `legal-screen.tsx` (1,247) into a state hook plus presentational parts, without changing behaviour.

**Acceptance:**
- No file above about 600 lines.
- The behaviour tests and the "Must do" lists in `docs/design/02-AGENT-APP.md` / `04-ADMIN.md` still pass.

## UX-7: Mockups for the uncovered routes

**Scope:** 49 of 93 routes have no mockup, including all 34 admin routes, plus every page added in LA-4 to LA-8. Draw them from the shared primitives before each phase builds them.

**Acceptance:** every new page has a board in `docs/uiux-mockups/` before it is built.
