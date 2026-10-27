# Spec: foundation-tokens

Module 2 of the [UI Foundation v3 capability map](CAPABILITY-MAP.md). Depends on
`design-foundation` (committed in `2780c32`). Status: **approved 2026-10-27, built.** Answers: `.env.local` copied for the visual check; legal
and affiliate pages take Inter.

## Objective

Put the v3 typeface and the glossy card surface into the design tokens, so that
`foundation-components` and every later module build on variables instead of literal values.

- **Type:** Inter for all UI text, Inter Tight for page titles and large numbers, Geist Mono for
  identifiers, in the agent, partner and admin apps and every auth page. The marketing pages keep
  Montserrat.
- **Gloss:** the surface, rim, sheen, shadow, footer and icon-tile values from the approved
  mockup ("Footer fact, glossy") become named tokens in both themes.

**Users:** developers building components (directly) and every app user (the typeface change is
visible on every screen the day it ships).

**Success looks like:** the apps render in Inter, the landing and pricing pages still render in
Montserrat, the gloss tokens exist in light and dark and pass the contrast tests, and nothing
else on any screen changes.

## What exists today

- `app/layout.tsx:9` loads Montserrat with `next/font/google` as `--font-montserrat` and puts its
  class on `<html>`.
- `app/globals.css:35-39` (`@theme inline`): `--font-sans` and `--font-display` are Montserrat;
  `--font-mono` is the system mono stack. `body` uses `var(--font-sans)` (`globals.css:1693`).
- Radius tokens already match v3 (`--radius-md: 8px`, `--radius-lg: 12px`, `--radius: 8px`). The
  pill buttons come from `components/ui/button.tsx`, which is `foundation-components` scope.
- Status tokens already cover v3 §12: `--success`, `--info`, `--warning`, `--error`, each with
  `-surface` and `-ink`, in `:root` (`globals.css:107-136`) and `.dark` (`:262-287`).
- Marketing routes: `/` (`app/page.tsx`, `LandingHero`) and `/pricing` (`app/pricing/page.tsx`).

## Scope

1. **Fonts, `app/layout.tsx`:** load `Inter`, `Inter_Tight` and `Geist_Mono` from
   `next/font/google` (variables `--font-inter`, `--font-inter-tight`, `--font-geist-mono`,
   `display: "swap"`, latin subset), keep `Montserrat`, and put all four variables on `<html>`.
2. **Font tokens, `app/globals.css` `@theme inline`:**
   - `--font-sans: var(--font-inter), 'Inter', system-ui, …`
   - `--font-display: var(--font-inter-tight), var(--font-inter), 'Inter', system-ui, …`
   - `--font-mono: var(--font-geist-mono), ui-monospace, …`
   - New `--font-brand: var(--font-montserrat), 'Montserrat', system-ui, …`
3. **Marketing keeps Montserrat:** a `.type-brand` class sets `--font-sans` and `--font-display`
   to `var(--font-brand)` for its subtree. It goes on the outermost element of `app/page.tsx` and
   `app/pricing/page.tsx` only. Legal, affiliate and every auth page take Inter.
4. **Gloss tokens** in `:root` and `.dark`, with the same names in both. Values come from the
   approved mockup:
   - `--gloss-top`, `--gloss-bottom`, `--gloss-sheen` (the surface gradient and the brand sheen)
   - `--gloss-edge`, `--gloss-rim`, `--gloss-highlight`, `--gloss-glare` (the border, the top rim
     and the inner highlight)
   - `--gloss-shadow`, `--gloss-shadow-hover` (the layered shadow, at rest and on hover)
   - `--gloss-foot`, `--gloss-divider` (the frosted footer and its rule)
   - `--stat-icon-top`, `--stat-icon-bottom`, `--stat-icon-highlight`, `--stat-icon-drop`,
     `--stat-icon-ring` (the glossy icon tile)

   The tokens are declared only. No component reads them until `foundation-components`.
5. **Contrast held by test** (`lib/design/brandContrast.test.mjs`, both themes):
   - `--ink` and `--muted` text on `--gloss-top` and `--gloss-bottom` are at least 4.5:1;
   - `--accent-ink` on the icon tile (`--stat-icon-bottom`) is at least 4.5:1;
   - `--warning-ink` on `--warning-surface` stays at least 4.5:1 (the amber footer).
6. **Typeface test** (`lib/design/designDocs.test.mjs` or a new `typeface.test.mjs`):
   - `--font-sans` in `globals.css` resolves to Inter;
   - `app/layout.tsx` loads all four families;
   - `.type-brand` appears on the `/` and `/pricing` roots and nowhere under `app/app`,
     `app/partner`, `app/admin` or `components/{app,partner,admin,portal}`.
7. **Docs:** in `UI-CONSISTENCY.md` §0 and `BRAND.md`, the Inter rule moves from "Decided, lands
   in `foundation-tokens`" to **Live**. `BRAND.md`'s "Where it lives in code" font row describes
   the new setup.

Out of scope: buttons, inputs and every component change (`foundation-components`); emails
(`lib/email/brand.ts` keeps its Montserrat stack); colour values other than the new gloss tokens;
Coolvetica.

## Tech stack

Next.js 16.3.3 (`next/font/google`), Tailwind CSS 4 `@theme inline`, Node test runner. No new
dependencies: `next/font/google` already ships `Inter`, `Inter_Tight` and `Geist_Mono`.

## Commands

```
Dev:        npm run dev                  (port 3000, Turbopack)
Test:       npm test
One test:   node --experimental-strip-types --test lib/design/brandContrast.test.mjs
Types:      npm run typecheck
Lint:       npm run lint
Build:      npm run build
```

## Project structure

```
app/layout.tsx                 → loads the four families, puts their variables on <html>
app/globals.css                → @theme font tokens, .type-brand, gloss tokens in :root and .dark
app/page.tsx, app/pricing/page.tsx → .type-brand on the outermost element
lib/design/brandContrast.test.mjs  → gloss contrast pairs
lib/design/typeface.test.mjs       → typeface wiring (new)
docs/design/UI-CONSISTENCY.md, docs/design/BRAND.md → Inter rule to Live
```

## Code style

Match the existing `globals.css` voice: a short comment saying why above each new group, values
aligned, no literal colours outside token blocks.

```css
  /* v3 gloss (docs/design/UI-CONSISTENCY.md §4a): the stat-card surface. Read only through
     the stat card; never paint a page with it. */
  --gloss-top:    #ffffff;
  --gloss-bottom: #f5f8f7;
```

```tsx
const inter = Inter({ subsets: ["latin"], variable: "--font-inter", display: "swap" });
```

## Testing strategy

- Unit (DB-free, `npm test`): the contrast pairs and the typeface wiring above.
- Build: `npm run build` succeeds (next/font downloads at build time).
- Visual check in the dev server, light and dark:
  - `/app/login`: computed `font-family` of the heading and body is Inter / Inter Tight;
  - `/`, `/pricing`: Montserrat;
  - one shell page, for example `/app` with a seeded session: Inter, no layout breakage.

## Boundaries

- **Always:** keep token names identical in `:root` and `.dark`; run `npm test` and `npm run build`
  before committing; flip a rule to Live only in the commit that ships it.
- **Ask first:**
  - copying `.env.local` from the main checkout into this worktree so the dev server can start
    (the file is gitignored and stays local);
  - changing any existing colour value;
  - widening `.type-brand` to more routes.
- **Never:** change a component's look in this module; remove Montserrat (marketing and emails
  still use it); commit environment files.

## Success criteria

1. `app/layout.tsx` loads Inter, Inter Tight, Geist Mono and Montserrat through `next/font/google`,
   and `<html>` carries all four variables.
2. `--font-sans`, `--font-display` and `--font-mono` resolve to Inter, Inter Tight and Geist Mono;
   `--font-brand` resolves to Montserrat.
3. `/` and `/pricing` render in Montserrat; `/app/login`, `/signup`, `/partner/login`,
   `/admin/login` and the app shell render in Inter (checked through computed styles).
4. All gloss and stat-icon tokens exist in `:root` and `.dark` with identical names.
5. The contrast pairs in Scope item 5 pass in both themes.
6. `npm test` shows no new failures against the baseline of 23 known migration and SQL failures;
   `npm run typecheck`, `npm run lint` and `npm run build` pass.
7. `UI-CONSISTENCY.md` §0 and `BRAND.md` mark the Inter rule Live, and `designDocs.test.mjs` passes.

## Open questions

1. **Dev server env:** may I copy `.env.local` from the main checkout into this worktree for the
   visual check? Without it the check is limited to build output and computed styles in a static
   render.
2. **Legal and affiliate pages:** the spec gives them Inter. Say if they should keep Montserrat
   like the marketing pages.
