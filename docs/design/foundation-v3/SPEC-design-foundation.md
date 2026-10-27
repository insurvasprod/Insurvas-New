# Spec: design-foundation

Module 1 of the [UI Foundation v3 capability map](CAPABILITY-MAP.md). Status: **approved 2026-10-27, built.**

## Objective

Make the v3 foundation the rule someone finds before they build or change any page, without having
to know this conversation happened.

Today the rules live in `docs/design/` (`UI-CONSISTENCY.md` is the single authority, `BRAND.md` owns
colour, type and logo), but nothing in the code folders points there, `AGENTS.md` only carries the
Next.js block, and several v3 decisions contradict what those files say (StatStrip, Montserrat
everywhere, pill buttons). This module updates the docs to v3 and puts a signpost in every place
someone starts work.

**Users:** developers and coding agents adding or changing a page, component or auth screen.

**Success looks like:** opening any component or route folder, or `AGENTS.md`, leads in one click to
the section that governs it, and the docs never describe a rule as live before the code has it.

## Scope

In scope (documentation, plus one test):

1. **`docs/design/UI-CONSISTENCY.md`** stays the single authority and gains the v3 rules:
   - §4 Figures: the glossy stat card (anatomy: header with icon tile, label and period; value with
     change pill; footer with one supporting fact or the action; amber footer only when action is
     needed) replaces `StatStrip`. Hero metric cards (one lead metric plus one composition card) are
     the only larger variant.
   - §5 Controls: 8px corners on buttons and inputs, heights unchanged (36px).
   - §6 Lists: filters open as an inline panel of labelled fields under the toolbar (the
     INSURVAS-CRM `DataGrid` pattern), applied filters as removable chips with "Clear filters".
   - New §10 People and companies: no avatars, initials or logo tiles for clients, leads or
     carriers; avatars only for staff with an uploaded photo.
   - New §11 Overlays by task: Dialog for a short edit, Alert Dialog only when something is lost,
     DetailPanel (Sheet) to read a record beside a list, DropdownMenu for row actions, Sonner toast
     with Undo for confirmations, Command for global search. Sizes from the mockup.
   - New §12 Status colours: green done, blue scheduled, amber needs action, red stopped or failed,
     grey neutral; always dot plus text.
   - New §13 Auth pages: one auth layout (owned by the `auth-shell` module), one heading style, one
     right-panel style, a Back control on every sign-up step after the account exists, trial and
     card copy derived from data.
   - New §14 Numbers: tabular figures everywhere, money right-aligned in tables, muted currency and
     cents in cards, every change names its comparison.
2. **Status markers.** Every v3 rule carries one of: `Live`, or `Decided, lands in <module id>`.
   A rule moves to `Live` only in the commit that ships its code. The rules table in §0 lists them.
3. **`docs/design/BRAND.md`:** the Type line becomes "Inter (Inter Tight for display) in the apps
   and auth pages; Montserrat on the marketing site"; the Shape line becomes "8px controls, 12px
   cards". Both marked `Decided, lands in foundation-tokens`.
4. **`docs/design/00-FOUNDATION.md`:** a note at the top of §3 Type and §4 Shape pointing to the v3
   sections. No rewrite of its history.
5. **`docs/design/README.md`:** a "Foundation v3" row linking `foundation-v3/` and the mockup.
6. **Mockup in the repo:** `docs/design/foundation-v3/mockup.html` (a copy of the published review
   page) is the visual reference. Docs link it by section anchor where one exists.
7. **Pointer READMEs**, each 10 to 25 lines, same template (what lives here, the shared components
   to use, the authority sections that apply, what not to do here):
   `components/ui/`, `components/app/`, `components/portal/`, `components/partner/`,
   `components/admin/`, `components/public/`, `components/marketing/`, `components/shared/`,
   `app/app/`, `app/partner/`, `app/admin/`.
8. **`AGENTS.md`:** a "Design rules" block **outside** the `nextjs-agent-rules` markers (`next dev`
   rewrites what is inside them), pointing to `docs/design/UI-CONSISTENCY.md` and the folder READMEs.
   Root `README.md` gets one line linking the same.
9. **`lib/design/designDocs.test.mjs`** (runs under `npm test`):
   - every pointer README listed above exists and links to `docs/design/UI-CONSISTENCY.md`;
   - every relative Markdown link in `docs/design/*.md`, `docs/design/foundation-v3/*.md` and the
     pointer READMEs resolves to a file;
   - every v3 rule heading in `UI-CONSISTENCY.md` has a status marker;
   - `AGENTS.md` contains the design-rules block outside the Next.js markers.

Out of scope: any change to `app/`, `components/` or `lib/` code other than the new READMEs and the
test file. Tokens, components, auth pages and rollout belong to the later modules.

## Tech stack

Next.js 16.3.3, React 19.2.3, Tailwind CSS 4, shadcn/ui (new-york, Radix), Node test runner with
`--experimental-strip-types`. No new dependencies.

## Commands

```
Test:      npm test
One test:  node --experimental-strip-types --test lib/design/designDocs.test.mjs
Lint:      npm run lint
Types:     npm run typecheck
```

## Project structure

```
docs/design/UI-CONSISTENCY.md        → the single authority (updated)
docs/design/BRAND.md                 → colour, type, logo (updated)
docs/design/00-FOUNDATION.md         → history; gets pointers only
docs/design/foundation-v3/           → map, module specs, mockup.html
components/*/README.md, app/{app,partner,admin}/README.md → pointers (new)
AGENTS.md, README.md                 → entry points (updated)
lib/design/designDocs.test.mjs       → keeps the links honest (new)
```

## Code style

Docs follow the existing `UI-CONSISTENCY.md` voice: short rules, each naming the shared component,
one code snippet where it helps, no essays. Pointer README template:

```md
# components/app

Agent-app building blocks. Before adding or changing anything here, read
[UI-CONSISTENCY.md](../../docs/design/UI-CONSISTENCY.md) §2 header, §4 figures, §6 lists.

Use: `PageHeader`, `StatCard`, `TableCard` + `DataToolbar`, `DetailPanel`, `Button` (components/ui).
Do not: hand-roll a table, a KPI card, a pager or a side panel here.
Visual reference: [foundation-v3/mockup.html](../../docs/design/foundation-v3/mockup.html).
```

The test follows `lib/design/brandContrast.test.mjs`: `node:test`, `node:assert/strict`, plain `fs`
reads, no DB.

## Testing strategy

One DB-free unit test file (above) under the existing `npm test` glob. Manual check: open each
pointer README on GitHub and follow its links.

## Boundaries

- **Always:** keep `UI-CONSISTENCY.md` the only authority; mark every v3 rule with its status; keep
  the Next.js block in `AGENTS.md` untouched; run `npm test` before committing.
- **Ask first:** deleting or rewriting any existing section rather than superseding it; adding a doc
  outside the listed paths.
- **Never:** describe a rule as `Live` before its code ships; edit app code in this module; touch the
  untracked local agent files.

## Success criteria

1. `UI-CONSISTENCY.md` contains §4, §5, §6 updates and §10 to §14, each with a status marker, and a
   §0 table listing all v3 rules and their status.
2. `BRAND.md`, `00-FOUNDATION.md` and `docs/design/README.md` carry the changes in Scope items 3 to 5.
3. All 11 pointer READMEs exist, follow the template and link to the authority.
4. `AGENTS.md` has the design-rules block outside the Next.js markers; root `README.md` links it.
5. `npm test` passes, including `designDocs.test.mjs`; `npm run lint` and `npm run typecheck` pass.
6. A reader starting from any of the 11 folders reaches the governing rule in one click.

## Open questions

None blocking. The README list covers every top-level `components/` folder and the three app planes;
add or drop folders before approval if needed.
