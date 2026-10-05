# UI consistency standard (2026-09-28)

Written after a manager review of the app: screens were built differently from one another —
filters in one place here and another there, tables drawn three ways, titles repeated, explanatory
cards everywhere, buttons of different heights. This is the one way a page is built from now on.
Every rule points at a shared component; if a page needs something the components cannot do, extend
the component, do not hand-roll a local copy.

**This file is the single authority (UX-1, 2026-10-03).** Where `00-FOUNDATION.md`, a page prompt in
`01`–`04`, a mockup or `06-MOCKUP-INDEX.md` says otherwise, this file wins; those files carry a note
pointing here. Three questions they used to answer differently are settled:

| Question | Decision | What it replaces |
|---|---|---|
| Eyebrow above the title | **None.** `PageHeader` ignores the prop. Auth and onboarding cards (`AuthCard`) may show a step label ("Step 1 of 3"). | FOUNDATION's "eyebrow is the menu section" rule |
| Figures | **`StatStrip` + `StatTile` only**, at most one strip, under the header (§4) | the 3–5 metric-card grid in FOUNDATION and the page prompts |
| Colour identity | **Two, by plane.** Orange (`app/globals.css`) for the agent and partner apps and the public site. Blue for the admin console only (user decision 1), applied as token overrides in `app/admin/admin-plane.css`, so components never name a colour. | FOUNDATION §1's split, whose blue marketing/legal pages and old hex values are out of date |

**The rules are enforced.** `lib/design/uiConsistency.test.mjs` counts each mechanically checkable
rule per file (raw tables, extra headers, tall controls, hex colours, `text-[Npx]`, eyebrows,
"Loading…" text, hand-rolled pagers, `btn()`), against today's counts in
`lib/design/uiOffenders.json`. A new offender fails the build; a fix must lower the baseline (see the
top of the test). The numbers only go down.

## 1. Chrome (done centrally — do not re-add)
- No workspace/context strip under the top bar. The top bar and the sidebar brand block are one band
  (same 56px height, same `--nav-*` colours).
- Do not add page-level strips, ribbons or context bars of any kind.

## 2. One header per page — `components/ui/page-header.tsx`
```tsx
<PageHeader title="Partners" description="One short sentence." actions={<>…buttons…</>} />
```
- The title appears **once**. No eyebrow (the prop is ignored now — remove it when you touch a file),
  no breadcrumb row on list pages, no second heading repeating the title, no "section" label above it.
- Detail pages may keep a single back link ("← Partners") instead of a breadcrumb trail.
- Description: one sentence, optional. It must not list what the stat strip or table already shows.
- Actions: `<Button>` at the default size only (see §5), primary action last.

## 3. No explanatory, design-note or insight cards
Remove every card/callout whose job is to explain the design or editorialise, e.g.
"An automatic update is a record of fact…", "Why this tab still exists", "How this works",
"Front-loaded on purpose…", insight banners like "X drops 25% of what it transfers… Pause them".
Keep only messages a user must act on right now: errors, a blocked state ("Scrubbing failed —
dialing is blocked"), a read-only notice. Those use the existing alert styling, one line, no essay.
Helper text belongs in a field's `hint`, a tooltip, or nowhere.

## 4. Figures: one compact strip — `StatStrip` + `StatTile` from `components/ui/stat.tsx`
```tsx
<StatStrip label="Partner totals">
  <StatTile label="Publishers" value={10} footnote="10 of 20 active" />
  <StatTile label="Marketing" value={2} />
</StatStrip>
```
- Never a grid of separate stat boxes; never custom KPI cards. Replace any `grid … gap-3` of
  `StatTile`s (or hand-made figure cards) with `<StatStrip>`.
- At most one strip per page, directly under the header. 3–6 tiles. Footnotes short.

## 5. Buttons and controls — one height
- `<Button>` default size (h-9 / 36px) for every page and toolbar action. Do not pass `h-10`, `h-11`,
  `size="lg"`, `px-…` overrides. `size="sm"` only inside table rows; `size="icon"` for icon-only.
- Native selects, date inputs and number inputs in a toolbar use `toolbarControl` from
  `components/ui/data-toolbar.tsx` so they are exactly as tall as the buttons.
- Form fields are 36px too: the shared `Input`, and `control` / `btn("primary" | "ghost")` in
  `components/app/settings/primitives.tsx` (brought down from 44px/40px on 2026-09-28). Prefer
  `<Button>` over `btn()` in new code.

## 6. Lists: `TableCard` + `DataToolbar` — the Partner quality table is the model
```tsx
<TableCard
  toolbar={
    <DataToolbar actions={<><Button variant="outline">Export</Button><RefreshButton onClick={reload} refreshing={loading} /></>}>
      <ToolbarSearch value={q} onChange={setQ} placeholder="Search partners" />
      <select className={toolbarControl} …>…</select>
      <FilterButton open={open} onClick={() => setOpen(!open)} count={activeCount} />
    </DataToolbar>
  }
  footer={<>Showing 1–10 of 27 · <Pager … /></>}
>
  <table className="portal-lead-table w-full …">…</table>
</TableCard>
```
- Order is fixed: search → filters → (spacer) → actions → Refresh last. Every list with data that can
  change gets a `RefreshButton`.
- The toolbar lives **inside** the TableCard (its `toolbar` slot). Never a separate filter card above
  the table, never filter chips floating between cards.
- Active filters may show as removable chips inside the same toolbar row (after the controls).
- Row actions ("View", "Open") are the last column, right-aligned, `size="sm"` outline buttons or links.
- Pagination in the `footer` slot with `Pager` (and `paginate()` for client-side slicing) from
  `components/ui/pager.tsx` — never a hand-rolled Previous/Next. Empty states via `EmptyState` /
  `NoMatches` from `page-states`.
- `TableCard` does not clip its children (no `overflow-hidden`), so toolbar popovers and menus can
  hang below the toolbar; the table scrolls sideways inside its own wrapper.

## 7. Loading — one look everywhere
- Route level: `app/app/(shell)/loading.tsx` renders `PageLoading` (header + table skeleton).
- Inside a component: `SectionLoading` from `components/ui/page-states.tsx`, placed where the rows
  will appear (inside the TableCard, or in place of the panel). Never "Loading …" text, never a
  spinner-only box, never an empty card with a sentence in it.

## 8. Layout
- A page is: header → (optional) stat strip → the main TableCard(s) → secondary tables. `space-y-6`.
- No card around a card. No decorative side panels. Two-column layouts only when the second column is
  real content (e.g. a detail pane for the selected row), never notes.
- Compact: prefer fewer, denser blocks.

## 9. CSS
- New screens use Tailwind and the shared components; do not add page-specific `.portal-*` rules to
  `app/globals.css`. A sweep on 2026-09-28 removed ~2,200 lines of rules whose classes no component
  used any more. A header cell's own `text-right` now wins over `.portal-lead-table th`.

## Ownership notes
- `components/ui/*` and `app/globals.css` are shared: change them only deliberately, once, for all.
- Pages that write data when opened (dialer, disposition walks) — do not click their actions to "test".
