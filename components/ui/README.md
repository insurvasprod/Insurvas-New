# components/ui

The shared building blocks every page uses. A change here changes every screen, so make it once,
deliberately, for all of them.

**Rules:** [UI-CONSISTENCY.md](../../docs/design/UI-CONSISTENCY.md), all of it. Start with §0 (the
v3 foundation and the status of each rule).
**Visual reference:** [foundation-v3/mockup.html](../../docs/design/foundation-v3/mockup.html).

What lives here and which rule owns it:

| Component | File | Rule |
|---|---|---|
| Page header (`tabs`: the sub-page bar, on the title's line between the title and the buttons; `lead`: a status or step bar, never tabs) | `page-header.tsx` | §2, §8b |
| **The sub-page bar** — every page's sub-pages and views, the Appointments & setters underline tabs: `ViewTabs` (server-safe, `href` link tabs) or `UnderlineTabs` (client state, arrow keys). Put it in `PageHeader tabs` / a frame's `tabs`; counts and `tone: "danger"` as before | `view-tabs.tsx`, `tab-track.tsx` | §8b |
| Stat cards for new and reworked pages: `StatRow`, `StatCard` | `stat-card.tsx` | §4a |
| Stat strip and tiles on pages not yet reworked: `StatStrip`, `StatTile`, `DeltaChip`, `Meter` | `stat.tsx` | §4 |
| Button, Input | `button.tsx`, `input.tsx` | §5, §5a |
| Select: the native `<select>` with `control` / `inputControl` (or `toolbarControl` in a toolbar). The radix select was retired 2026-10-28 | `field.tsx`, `data-toolbar.tsx` | §5 |
| Card and its surface classes (`cardSurface`, `cardHead`, `cardInset`, `glass`) | `card.tsx` | §5b |
| Fields: `Field`, `control`, `textareaControl`, `checkboxControl`, `Switch`, `ToggleRow`; `DateTimePicker` | `field.tsx`, `date-time-picker.tsx` | §5b |
| Unsaved changes: `LeaveGuard` | `leave-guard.tsx` | §5b |
| Choice and removable chips: `ToggleChip` | `toggle-chip.tsx` | §5b, §12 |
| The page ground: `DashboardStage` (drawn by the shell layouts, never by a page) | `dashboard-stage.tsx` | §5b |
| Table card, toolbar, pager | `table-card.tsx`, `data-toolbar.tsx`, `pager.tsx` | §6 |
| Inline filters: `FilterButton`, `FilterPanel`, `ActiveFilters`, `TableCard`'s `filters` slot | `data-toolbar.tsx`, `table-card.tsx` | §6a |
| Filters in a pop-over (`FilterPopover`, `ActiveFilters inline`) and a read-only row peek (`HoverPeek`) | `data-toolbar.tsx`, `hover-peek.tsx` | §6a |
| One record's facts as a label/value table (`FactTable`); dictating into a note (`DictateButton`) | `fact-table.tsx`, `dictate-button.tsx` | §6, §5 |
| Loading, empty and error states | `page-states.tsx`, `page-loading.tsx` | §7 |
| Side panel, info tip | `detail-panel.tsx`, `view-tabs.tsx`, `info-tip.tsx` | §8 |
| Compact icon switch for dense page views | `view-tabs.tsx` (`IconViewSwitch`) | §6 |
| The "Table · Chart" switch (`?show=table\|chart`, every other parameter kept): `ViewSwitch`, `useShow`; a server page reads it with `showOf` from `lib/reports/show.ts`. On Reports, pass `show` to `ReportsPage` | `view-switch.tsx` | §5b |
| Charts, one kit: `LineSeries`, `BarSeries`, `BarList` (horizontal bars), `ShareBar`, `ChartLegend`, `Sparkline`/`SparkLine`, `ChartHeading`; each animates in once on load. No new `DonutChart` | `chart.tsx` | §5b |
| Moving between views without a reload: `IntentLink` (a tab or rail link: hover prefetch, pending mark), `useNavTransition` + `NavPending` (a control that needs the server), `setParamsInPlace` (a pure view toggle: no round trip). The content dims (`data-page-content`) and arrives in the one 150ms `m-content-in` | `nav-pending.tsx` | §8 |
| Searchable select (one choice, search at the top; a quick filter beside a search): `SelectMenu` | `select-menu.tsx` | §5, §6a |
| Dialog, confirm, sheet, popover, menu, toast, search | `dialog.tsx`, `confirm-dialog.tsx`, `sheet.tsx`, `popover.tsx`, `dropdown-menu.tsx`, `toaster.tsx` (raise toasts with `lib/notify`), `search-command.tsx` | §11 |
| Status chip | `status-chip.tsx` | §12 |
| Layered text (the sign-in panel's word staircase, 21st.dev): `LayeredText` | `layered-text.tsx` | §0, auth doors |
| A page's own menu in the Settings look (filter box, bold groups, small items, a foot): `MenuCard`. Docs and Get set up use it | `menu-card.tsx` | §8 |
| Steps in order on one numbered line (`NumberedSteps`), and a few figures in one strip (`FactsStrip`) | `numbered-steps.tsx` | §5b |
| Motion: overlay enter/exit, the panel's exit, the sub-page bar's sliding line (`tab-track.tsx`), page turns (`paged.tsx`), chart tweens, page transitions (`components/portal/portal-page-transition.tsx`), links that prefetch and show pending (`nav-pending.tsx`) | the motion layer in `app/globals.css`; see `/app/motion-lab` | §18 |

Do not: add a second component that does what one of these does, name a colour (use tokens), or
add page-specific styling. Extend the component instead.
