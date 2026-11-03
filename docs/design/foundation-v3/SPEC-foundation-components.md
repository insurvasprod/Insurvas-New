# Spec: foundation-components

Module 3 of the [UI Foundation v3 capability map](CAPABILITY-MAP.md). Depends on
`foundation-tokens` (committed in `b30b42e`). Status: **approved 2026-10-27 (page-by-page stat cards), built.** Marketing and pricing CTAs keep
their pill shape (found while building: all nine `rounded-full` Button overrides are marketing
CTAs), so `pill-button` covers every plane except the marketing site.

## Objective

Build the v3 look into the shared components once, so new pages and the pages being reworked can
only be built the v3 way. Stat cards are adopted page by page: a page switches when someone works
on it, and untouched pages keep `StatStrip` (decision 2026-10-27).

| v3 rule | Component work |
|---|---|
| §4a stat cards | New `StatRow` / `StatCard` components with the glossy footer-fact design. `StatStrip` / `StatTile` stay as they are. |
| §5a 8px controls | `Button` loses its pill shape |
| §6a inline filters | `FilterPanel` and `ActiveFilters` join `DataToolbar`; `TableCard` gets a `filters` slot |
| Inter Tight for display | `PageHeader` titles and stat values use `--font-display` |

**Users:** developers adding or reworking a page; every app user for the button change, which
applies everywhere at once.

**Success looks like:**
- `StatCard` and `StatRow` exist and match the footer-fact layout from the approved mockup in both
  themes. A page switches by replacing its imports, and pages nobody is working on do not change.
- Buttons have 8px corners.
- A list can open its filters inline under the toolbar and show active filters as chips.
- The ratchet stops anyone re-adding pill buttons.

## What exists today

- **`components/ui/stat.tsx`.**
  - `StatTile` is the cell: label (12px uppercase), value (24px with `CountUp`), optional
    `Sparkline`, `Meter`, `DeltaChip` (with `goodWhen`), `footnote` and `action`.
  - `StatStrip` is one bordered "glass" strip with hairline cells, styled by
    `.m-stat-strip` / `.m-stat-tile` and the lit top edge in `app/globals.css` (around line 2880).
  - 99 files use `StatStrip`, 120 use `StatTile`.
- **`components/ui/button.tsx:9`.** The base class is `rounded-full`, and so are `xs`, `sm`, `lg`
  and `icon-xs`. Nine call sites pass a `rounded-*` override.
- **`components/ui/data-toolbar.tsx`.**
  - `FilterButton` is an outline button with a grey count pill.
  - Each of the 11 lists that use it builds its own panel or popover.
  - There is no shared panel and no shared chip row.
- **`components/ui/table-card.tsx`** has `toolbar`, `footer` and heading slots, and no slot for
  filters.
- **`components/ui/page-header.tsx:39`.** The `h1` uses the body font.
- **`/design`** (`components/design/primitives-showcase.tsx`, dev only) shows every shared control.
- **Tokens from `foundation-tokens`:** `--gloss-*`, `--stat-icon-*` and `--font-display`.

## Scope

1. **Stat card: new components** (new `components/ui/stat-card.tsx`, plus gloss rules in
   `app/globals.css`). `StatStrip`, `StatTile` and their CSS are **not changed**.
   - **`StatRow`:** a responsive grid of separate cards, 4 columns on wide screens, 2 on tablets
     and 1 on phones (`repeat(auto-fit, minmax(220px, 1fr))`, 12px gap). It takes a `label` for
     its `aria-label`.
   - **`StatCard`:** the glossy card in the mockup's footer-fact anatomy.
     - **Header:** an optional `icon` (Lucide component) in a glossy tile, the label in 13px
       sentence case, an optional `period` in muted text, and an optional `labelTitle` InfoTip.
     - **Value:** 30px `--font-display`, tabular, with `CountUp` reused from `components/ui`.
       `unit` and currency are muted at about half size. `delta` renders as the existing
       `DeltaChip` beside the value.
     - **Footer:** on the `--gloss-foot` band with a divider. `fact: { label, value }` sits on the
       left and an optional `action` on the right. With `tone="warn"` the footer uses the amber
       band.
     - **Optional `meter`:** goal progress, drawn between the value and the footer.
     - **No trend chart:** `StatCard` has no `trend` prop. The manager rejected small trend charts
       in cards.
   - **`DeltaChip`:** gains `goodWhen="neither"`, which is always grey (a rising pending balance
     is neither good nor bad, §12). This is additive, so existing callers are unaffected.
   - **Gloss surface:** gradient, sheen, rim, highlight and shadow from the tokens, a 2px hover
     lift, and none under `prefers-reduced-motion`. Text sits on opaque colour, with no glow
     halo.
   - **Adoption:** no page is switched in this module. A page moves to `StatRow` / `StatCard` when
     someone reworks it (see `foundation-rollout` in the capability map). Mixing the old strip and
     new cards on one page is not allowed.
2. **Buttons** (`components/ui/button.tsx`):
   - `rounded-full` becomes `rounded-md` (8px) in the base and every size.
   - The nine `rounded-*` overrides on `<Button>` are reviewed. Each is removed unless it is a
     deliberate pill: the Filters count badge and toggle tracks are not Buttons.
3. **Filters** (`components/ui/data-toolbar.tsx`, `components/ui/table-card.tsx`):
   - **`FilterButton`:** adds a chevron that flips when open, makes the count badge filled
     (`--primary` / `--on-primary`), and wires `aria-controls`. Its API is otherwise unchanged.
   - **`FilterPanel`** (new): a `role="region"` grid of labelled fields
     (`repeat(auto-fit, minmax(190px, 1fr))`, 12–16px gaps) on a slightly raised band, with an
     `id` for `aria-controls`. It renders only while open.
   - **`ActiveFilters`** (new):
     - an "Active filters" label;
     - removable chips (`{ key, label, value, onRemove }`) with "Key: value ×";
     - "Clear filters".
     It renders nothing when there are no chips, and stays visible when the panel is closed.
   - **`TableCard`:** a `filters` slot between the toolbar and the table, holding the panel and
     the chip row.
   - **Migration:** the 11 existing `FilterButton` lists are **not** moved in this module; that is
     `foundation-rollout`. A new list must use the shared pieces (see the ratchet in item 6).
4. **Display type:**
   - `PageHeader`'s `h1` and the stat value use `font-[family-name:var(--font-display)]` (or a
     `font-display` utility exposed in `@theme`).
   - Nothing else changes face in this module.
5. **`/design` showcase:**
   - stat cards in every state: plain; icon + period; delta up, down and neither; `fact`; `meter`;
     warn tone; text value;
   - the 8px buttons;
   - a `TableCard` with the filter panel open and active chips.
   This is the page used for the visual check.
6. **Ratchet** (`lib/design/uiConsistency.test.mjs` + `uiOffenders.json`):
   - **`pill-button`:** counts `<Button` elements with a `rounded-full` class. Baseline after
     item 2.
   - **`hand-filter-panel`:** counts files that use `FilterButton` without `FilterPanel`. The
     baseline is today's 11, and it only goes down as those lists are reworked.
   - **`mixed-stat`:** counts files that use both `StatStrip`/`StatTile` and
     `StatRow`/`StatCard`. Baseline 0. No rule forces pages off `StatStrip`.
   - Detectors are added with a line in the "detectors still match something" test, as the file
     requires.
7. **Docs** (`UI-CONSISTENCY.md`):
   - §5a moves to **Live**.
   - §4a and §6a move to **Live for new and reworked pages**: untouched pages keep `StatStrip` and
     their own filters until someone works on them.
   - §4 gains a note: `StatStrip` stays valid on pages not yet reworked, and a reworked page uses
     §4a.
   - `components/ui/README.md` lists `StatRow` / `StatCard`, `FilterPanel` and `ActiveFilters`.

Out of scope:
- moving the 11 filter lists, the 30 files with their own tiles (`TrendTile`, `DashTile`,
  `board-stat-tile`), and avatar and initials removal (`foundation-rollout`);
- auth pages (`auth-shell`);
- any colour value change.

## Tech stack

React 19.2, Next.js 16.3 App Router, Tailwind CSS 4, shadcn/ui on Radix, Lucide icons,
`class-variance-authority`. No new dependencies.

## Commands

```
Dev (visual check):  npx next dev --webpack -p 3002   (Turbopack refuses this worktree's linked node_modules)
Session for /app:    npm run session -- tenant --role owner
Test:                npm test
One test:            node --experimental-strip-types --test lib/design/uiConsistency.test.mjs
Types:               npm run typecheck
Lint:                npm run lint
Build:               npx next build --webpack
```

## Project structure

```
components/ui/stat-card.tsx     → StatRow, StatCard (new)
components/ui/stat.tsx          → DeltaChip gains goodWhen "neither" (nothing else changes)
components/ui/button.tsx        → 8px corners
components/ui/data-toolbar.tsx  → FilterButton update, FilterPanel, ActiveFilters
components/ui/table-card.tsx    → filters slot
components/ui/page-header.tsx   → display face on the title
components/design/primitives-showcase.tsx → the new states
app/globals.css                 → gloss card rules (the .m-stat-* rules stay for StatStrip)
lib/design/uiConsistency.test.mjs, lib/design/uiOffenders.json → two new rules
docs/design/UI-CONSISTENCY.md, components/ui/README.md → statuses and names
```

## Code style

Match `stat.tsx` and `data-toolbar.tsx`: a doc comment saying why above each export, Tailwind
classes with token variables (never literal colours), props documented inline.

```tsx
import { StatCard, StatRow } from "@/components/ui/stat-card";

<StatRow label="Today">
  <StatCard icon={Users} label="New leads" period="today" value={86}
            delta={{ value: 11.7, goodWhen: "up" }} fact={{ label: "Top source", value: "Facebook · 38" }} />
  <StatCard icon={DollarSign} label="Commission" period="pending" value="$41,920" tone="warn"
            fact={{ label: "18 statements late" }} action={<Link href="/app/accounting">Review</Link>} />
</StatRow>
```

## Testing strategy

- **Ratchet** (`npm test`): the two new rules, and no existing rule's count rises.
- **Source contracts** (in `uiConsistency.test.mjs` or a small `components.test.mjs`):
  - `button.tsx` contains no `rounded-full`;
  - `stat-card.tsx` reads `--gloss-*` and `--stat-icon-*` and never a literal colour;
  - `stat.tsx`'s `StatStrip` and `StatTile` are unchanged apart from `DeltaChip`;
  - `TableCard` renders its `filters` slot between toolbar and body.
- **Visual check**, with `npx next dev --webpack`, in light and dark at 1280px and 390px:
  - `/design` (every state);
  - one authenticated page with a `StatStrip` and a list, using a session from
    `npm run session`, for example `/app/policies`: it must look exactly as before apart from the
    8px buttons and the display face on the title;
  - the stat row's computed font is Inter Tight;
  - no horizontal scroll;
  - the hover lift works, and is absent under reduced motion.
- `npx next build --webpack`, typecheck and lint pass. `npm test` shows no failures beyond the 23
  known migration/SQL ones.

## Boundaries

- **Always:** keep `StatStrip` / `StatTile` / `FilterButton` and their call sites exactly as they
  are; flip a status to Live only in the commit that ships it; read every colour from tokens.
- **Ask first:**
  - removing a prop from a shared component;
  - changing a page file beyond the nine Button overrides;
  - raising any ratchet baseline.
- **Never:** click actions that write data while checking authenticated pages (UI-CONSISTENCY
  "Ownership notes"); remove the `meter` or `InfoTip` behaviour; widen a feature gate.

## Success criteria

1. `StatRow` and `StatCard` render the footer-fact anatomy in both themes on `/design`, with every
   state listed in Scope item 5. No page file imports them yet, and pages using `StatStrip` look
   as before.
2. `Button` has 8px corners at every size, and `pill-button` is at its new baseline.
3. `FilterPanel`, `ActiveFilters` and the `TableCard` `filters` slot exist and are shown open on
   `/design`. `hand-filter-panel` is at 11 and cannot grow.
4. The `PageHeader` title and stat values render in Inter Tight.
5. `DeltaChip goodWhen="neither"` renders grey.
6. `UI-CONSISTENCY.md` §5a is Live, and §4a and §6a are Live for new and reworked pages.
   `mixed-stat` is at 0. `designDocs`,
   `typeface`, `brandContrast` and `uiConsistency` tests pass.
7. Typecheck, lint and the webpack build pass, with no new `npm test` failures.
8. Screenshots of `/design` and one authenticated page, light and dark, are attached to the
   hand-off.

## Decisions

- **Page by page (2026-10-27):** stat cards are new components. A page adopts them only when you
  work on it, and `StatStrip` / `StatTile` stay untouched.
- **No trend chart in `StatCard`:** the new component has no `trend` prop. Pages that still use
  `StatStrip` keep their sparklines until they are reworked.

## Open questions

None.
