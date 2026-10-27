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
| Colour identity | **The 2026 brand: green, by plane** ([BRAND.md](BRAND.md)). Bright green `#07d6a0` for action and deep olive `#0d4037` for ink, the rail and the top bar, in `app/globals.css`, for the agent and partner apps and the public site. The admin console uses the same colours, rail, top bar and page spacing, with a blue accent: `app/admin/admin-plane.css` re-points the accent tokens only (owner decisions 2026-10-13). Components never name a colour. The bright green is never text on a light ground; use `--accent-ink`. `lib/design/brandContrast.test.mjs` enforces it. | FOUNDATION §1's split, and the orange identity of 2026-09 |

## 0. Foundation v3 (2026-10-27)

A second manager review produced the v3 foundation: Inter, a glossy stat card, 8px controls, an
inline filter panel, no avatars for clients or carriers, overlays chosen by task, fixed status
colours, one auth layout and number rules. The visual reference is
[foundation-v3/mockup.html](foundation-v3/mockup.html); the plan is
[foundation-v3/CAPABILITY-MAP.md](foundation-v3/CAPABILITY-MAP.md).

Every v3 rule has a heading marked **(v3)** and a status line:

- **Live:** follow it now.
- **Decided, lands in `<module>`:** the decision is final but the token or component does not exist
  yet. Until that module ships, keep following the current rule it replaces. The status changes to
  Live in the same commit that ships the code.

| v3 rule | Section | Status |
|---|---|---|
| Glossy stat card (`StatRow` / `StatCard`) | §4a | Live for new and reworked pages |
| 8px corners on buttons and inputs | §5a | Live |
| Inline filter panel under the toolbar | §6a | Live for new and reworked lists |
| No avatars for clients, leads or carriers | §10 | Live |
| Overlays chosen by task | §11 | Live |
| Status colours | §12 | Live |
| One auth layout | §13 | Live (`lib/design/authShell.test.mjs`) |
| Sign-up copy, Back on sign-up steps, trial wording from data | §13 | Decided, lands in `signup-flow` |
| Numbers and money | §14 | Live |
| Inter in the apps and auth pages | [BRAND.md](BRAND.md) | Live (`lib/design/typeface.test.mjs`) |
| Gloss surface tokens (`--gloss-*`, `--stat-icon-*`) | `app/globals.css` | Live as tokens; used from `foundation-components` |

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
- **v3:** `StatStrip` stays valid on pages nobody has reworked yet. A page someone reworks moves to
  the stat cards in §4a, and does not keep a strip beside them.

### 4a. Stat cards (v3)
**Status:** Live for new and reworked pages. Pages are moved one at a time, only when someone works
on them; untouched pages keep `StatStrip` (decision 2026-10-27). The `mixed-stat` ratchet keeps a
page from using both.

The figures under a page header are a row of glossy stat cards: `StatRow` and `StatCard` from
`components/ui/stat-card.tsx`. Reference: the "Footer fact, glossy" row in the mockup, and every
state on `/design` (development only).

```tsx
import { CalendarDays, DollarSign, Users } from "lucide-react";
import { StatCard, StatRow } from "@/components/ui/stat-card";

<StatRow label="Today">
  <StatCard icon={Users} label="New leads" period="today" value={86}
            delta={{ value: 11.7, goodWhen: "up" }} fact={{ label: "Top source", value: "Facebook · 38" }} />
  <StatCard icon={CalendarDays} label="Appointments" period="7 days" value={214}
            delta={{ value: -3.6, goodWhen: "up" }} fact={{ label: "Today", value: "38 booked · 4 no-shows" }} />
  <StatCard icon={DollarSign} label="Commission" period="pending" value="$41,920" tone="warn"
            delta={{ value: 9.2, goodWhen: "neither" }} fact={{ label: "18 statements late" }}
            action={<LinkArrow href="/app/accounting">Review</LinkArrow>} />
</StatRow>
```

- `delta.goodWhen` says what a rise means: `"up"`, `"down"`, or `"neither"` (always grey).
- `meter` draws progress toward a goal between the value and the footer. There is no trend chart.

- Anatomy, fixed: header (icon tile, label, period) → value with a change pill → footer with one
  supporting fact as label and value, or the action the card needs.
- The change pill always names its comparison in the period or footer ("vs. last Monday").
- Amber footer only when the card needs action; one per row at most.
- 2–4 cards per row, one row per page, directly under the header. Never mix stat cards and
  `StatTile`s on one page.
- The only larger variant is the dashboard pair: one lead metric with its chart and target, and one
  composition card (for example Active policies). Both use the same glossy surface.
- Surface: soft top-lit gradient, brand sheen in the top-left, bright top rim, layered shadow, 2px
  hover lift (none under reduced motion). Text always sits on opaque colour.

## 5. Buttons and controls — one height
- `<Button>` default size (h-9 / 36px) for every page and toolbar action. Do not pass `h-10`, `h-11`,
  `size="lg"`, `px-…` overrides. `size="sm"` only inside table rows; `size="icon"` for icon-only.
- Native selects, date inputs and number inputs in a toolbar use `toolbarControl` from
  `components/ui/data-toolbar.tsx` so they are exactly as tall as the buttons.
- Form fields are 36px too: the shared `Input`, and `control` / `btn("primary" | "ghost")` in
  `components/app/settings/primitives.tsx` (brought down from 44px/40px on 2026-09-28). Prefer
  `<Button>` over `btn()` in new code.

### 5a. Control shape (v3)
**Status:** Live. `Button` is 8px at every size; the `pill-button` ratchet keeps it that way.

- Buttons and inputs: 8px corners. Cards, dialogs and sheets: 12px. Menus: 10px. Badges: 6px.
- Heights do not change: 36px for buttons and inputs, 32px inside toolbars, `size="sm"` in rows.
- Pill shapes remain only for toggle tracks, the count badge on the Filters button, and the
  marketing and pricing CTAs, which keep the brand's pill ([BRAND.md](BRAND.md)).

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

### 6a. Filters open inline (v3)
**Status:** Live for new and reworked lists. The 11 lists that already had their own filter panels
keep them until someone works on them; the `hand-filter-panel` ratchet only goes down.

Same pattern as the INSURVAS-CRM `DataGrid` (`components/ui/DataGrid.tsx` in that repo), built from
`FilterButton`, `FilterPanel` and `ActiveFilters` in `components/ui/data-toolbar.tsx` and the
`filters` slot of `TableCard`:

```tsx
<TableCard
  toolbar={<DataToolbar actions={…}><ToolbarSearch … /><FilterButton open={open} count={chips.length} controls="policy-filters" onClick={() => setOpen(!open)} /></DataToolbar>}
  filters={<>
    <FilterPanel id="policy-filters" open={open}>{/* labelled fields */}</FilterPanel>
    <ActiveFilters filters={chips} onClear={clearAll} />
  </>}
>…</TableCard>
```


- The toolbar holds search, one **Filters** button with a count badge of applied filters, then the
  actions. No individual facet buttons in the toolbar row.
- **Filters** expands a panel **inside the TableCard, under the toolbar**, that pushes the table
  down. It is not a dropdown or popover. The panel is a grid of labelled fields
  (`repeat(auto-fit, minmax(190px, 1fr))`, 12–16px gaps): multi-selects, selects and date fields.
- Applied filters show in a row under the panel, labelled "Active filters", as removable chips
  ("Status: In force ×") followed by "Clear filters". The row stays visible when the panel is
  collapsed.

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
- **A record's details or a create form beside a list is `DetailPanel`** (`components/ui/detail-panel.tsx`,
  2026-10-09): `mode="split"` sits beside the table (30%, the Callbacks booking panel is the model),
  `mode="overlay"` slides over it from the right. It owns the header, the "Close" button, Escape,
  focus return and the slide-in — never hand-build an `<aside>` for this. A short confirmation or a
  small form is a `Dialog` instead.
- **A page with several lists shows one at a time** with `ViewTabs` (`components/ui/view-tabs.tsx`),
  page actions on the right of the same row; size the pager with `useFittingPageSize`
  (`components/ui/use-fitting-page-size.ts`).
- **Say it in a few words; explain behind an `InfoTip`** (`components/ui/info-tip.tsx`) beside the term.
  Compliance and legal wording is never moved into a tip: it stays on the screen, in full.
- **An empty list offers the action that fills it** (`EmptyState`'s `action`), linking only to a page
  or flow that exists. A filtered list with nothing in it is `NoMatches` with its clear action.

## 9. CSS
- New screens use Tailwind and the shared components; do not add page-specific `.portal-*` rules to
  `app/globals.css`. A sweep on 2026-09-28 removed ~2,200 lines of rules whose classes no component
  used any more. A header cell's own `text-right` now wins over `.portal-lead-table th`.

## 10. People and companies (v3)
**Status:** Live.

- No avatars, initials circles or logo tiles for clients, leads, policyholders or carriers. We never
  have photos of them, so the name is the identifier. This applies to tables, cards, sheets,
  dialogs and search results.
- Avatars appear only for staff users, and only when they uploaded a photo.
- In search results and menus, a plain Lucide icon may show the record type (person, page).

## 11. Overlays chosen by task (v3)
**Status:** Live.

| Task | Component | Size |
|---|---|---|
| Short edit that keeps context | `Dialog` (`components/ui/dialog.tsx`) | up to 440px wide |
| A step that loses something (cancel, delete) | Alert dialog: `Dialog` with a destructive primary and a summary of what is lost | up to 400px |
| Read or work on a record beside a list | `DetailPanel` (§8) | 420px |
| Row and record actions | `DropdownMenu` (`components/ui/dropdown-menu.tsx`) | 224px |
| Confirm that something happened | Sonner toast (`components/ui/sonner.tsx`), with Undo when reversible | — |
| Global search | `SearchCommand` (`components/ui/search-command.tsx`), ⌘K | up to 560px |

- Never a modal for a confirmation; use a toast. Never a toast for an error the user must fix; show
  it where the fix is.
- Destructive dialogs name the impact ("Future commission stops") and label the buttons with the
  action ("Keep policy" / "Cancel policy"), never "OK" / "Cancel".

## 12. Status colours (v3)
**Status:** Live.

| Meaning | Colour | Examples |
|---|---|---|
| Done or good | green | In force, Approved, Appointed |
| Scheduled or in progress | blue | Scheduled, Appointment set, Pending issue |
| Needs action | amber | Needs signature, Callback due, Expires soon, Statements late |
| Stopped or failed | red | Lapsed, Cancelled, Failed |
| Neutral | grey | Draft, Other, a value that is neither good nor bad |

- Always a dot or icon plus text, never colour alone. Use `StatusChip`
  (`components/ui/status-chip.tsx`).
- A rising number is green only when rising is good. A rising pending balance stays grey.

## 13. Auth pages (v3)
**Status:** Live for the layout. The copy, Back and trial-wording rules below are Decided, lands in
`signup-flow`.

- One layout for sign-in, every sign-up step, the account screens, accept terms, partner and staff
  sign-in: `AuthLayout` from `components/portal/auth-layout.tsx`, or one of its wrappers
  (`FunnelFrame`, `AppAuthFrame`, `PartnerAuthFrame`). It is the only component that renders
  `PortalAuthSplitShell`. Every combination is on `/design/auth` (development only).
  - The column, always in this order: logo, `AuthSteps`, `AuthBack`, the screen (opening with
    `AuthHeading`), legal links.
  - Width: 472px, or `width="wide"` (720px) only for a grid of choices or a document (Your agency,
    Your plan, Payment, accept terms).
  - The panel is an `AuthStory` (label, title, rows with a hairline above each; a row can carry a
    value, or a ✓/✗ state with its word), or real content (the plan summary, the receipt) passed
    as `story`.
- Controls from `components/portal/auth-controls.tsx`: `AuthField` + `AuthInput` (or
  `authLabel` / `authControl` on a native control) at **44px**, `AuthSubmit` (full width, 44px),
  `AuthSecondary`, and one `AuthAlert` with `tone="error" | "info" | "success"`. Auth screens are
  exempt from the 36px rule (§5) for this reason; app pages are not.
- Copy follows the order things happen: the first sign-up step creates an account ("Create your
  account"); the trial is named only on the step where it starts.
- Trial length and card wording come from data (`resolveTrialDays`, `checkoutPaymentMode()`), never
  typed into copy.
- Every sign-up step after the account exists has a **Back** control to the previous step.
- No marketing claims or explanatory text on auth pages beyond one line under the title.

## 14. Numbers and money (v3)
**Status:** Live.

- `tabular-nums` on every number that can sit above or beside another number.
- Money: `$1,284.00` in tables and forms, right-aligned in table columns. In cards, the currency
  sign and cents are muted at about half size.
- Every change names its comparison: "↑ 11.7% vs. last Monday", never a bare percentage.
- Monospace only for identifiers people copy or read aloud: policy numbers, Medicare IDs, plan
  codes.

## Ownership notes
- `components/ui/*` and `app/globals.css` are shared: change them only deliberately, once, for all.
- Pages that write data when opened (dialer, disposition walks) — do not click their actions to "test".
