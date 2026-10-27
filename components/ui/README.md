# components/ui

The shared building blocks every page uses. A change here changes every screen, so make it once,
deliberately, for all of them.

**Rules:** [UI-CONSISTENCY.md](../../docs/design/UI-CONSISTENCY.md), all of it. Start with §0 (the
v3 foundation and the status of each rule).
**Visual reference:** [foundation-v3/mockup.html](../../docs/design/foundation-v3/mockup.html).

What lives here and which rule owns it:

| Component | File | Rule |
|---|---|---|
| Page header | `page-header.tsx` | §2 |
| Stat cards for new and reworked pages: `StatRow`, `StatCard` | `stat-card.tsx` | §4a |
| Stat strip and tiles on pages not yet reworked: `StatStrip`, `StatTile`, `DeltaChip`, `Meter` | `stat.tsx` | §4 |
| Button, Input, Select | `button.tsx`, `input.tsx`, `select.tsx` | §5, §5a |
| Table card, toolbar, pager | `table-card.tsx`, `data-toolbar.tsx`, `pager.tsx` | §6 |
| Inline filters: `FilterButton`, `FilterPanel`, `ActiveFilters`, `TableCard`'s `filters` slot | `data-toolbar.tsx`, `table-card.tsx` | §6a |
| Loading, empty and error states | `page-states.tsx`, `page-loading.tsx` | §7 |
| Side panel, tabs, info tip | `detail-panel.tsx`, `view-tabs.tsx`, `info-tip.tsx` | §8 |
| Dialog, menu, toast, search | `dialog.tsx`, `dropdown-menu.tsx`, `sonner.tsx`, `search-command.tsx` | §11 |
| Status chip | `status-chip.tsx` | §12 |

Do not: add a second component that does what one of these does, name a colour (use tokens), or
add page-specific styling. Extend the component instead.
