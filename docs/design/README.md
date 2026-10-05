# INSURVAS redesign prompt set

One implementation prompt for every page in the product. 93 routes, 4 chrome surfaces.

Written 2026-09-18 against branch `codex/la1-end-to-end` by reading every `page.tsx`, every
`layout.tsx`, all 160 components, all 226 API route files, `app/globals.css` (3,804 lines),
`lib/menu/definition.ts`, and all 96 mockup images in
`.codex/generated_images/01a0a6e0-8b59-7021-b861-2b96993f45a9/` plus the 44 curated mockups in
`docs/uiux-mockups/brex/`.

## Read these in order

**Precedence (UX-1, 2026-10-03):** [`UI-CONSISTENCY.md`](UI-CONSISTENCY.md) is the single design
authority. Where any file below or any mockup disagrees with it, it wins. Its rules are enforced by
`lib/design/uiConsistency.test.mjs`, a ratchet whose offender counts only go down.

| File | What it is |
|---|---|
| [`UI-CONSISTENCY.md`](UI-CONSISTENCY.md) | **Read first.** How every page is built: one header, `StatStrip`, `TableCard` + `DataToolbar`, 36px controls, skeleton loading, no eyebrow, orange apps and a blue admin console. |
| [`00-FOUNDATION.md`](00-FOUNDATION.md) | The contract every page inherits. Tokens, type scale, the page skeleton, the six required states, the shell, accessibility floor, responsive rules. **Every page prompt assumes you have read this.** |
| [`01-PUBLIC-AND-AUTH.md`](01-PUBLIC-AND-AUTH.md) | 17 pages. Marketing, signup, login, onboarding, checkout, legal. |
| [`02-AGENT-APP.md`](02-AGENT-APP.md) | 32 pages. The licensed-agent workspace — LA-1 inbound, LA-2 outbound, book of business, settings. |
| [`03-PARTNER-PORTAL.md`](03-PARTNER-PORTAL.md) | 10 pages. The partner-facing portal. |
| [`04-ADMIN.md`](04-ADMIN.md) | 34 pages. Platform administration. **No mockups exist for any of these.** |
| [`05-DEFECT-REGISTER.md`](05-DEFECT-REGISTER.md) | 19 defects found while reading. Eighteen are fixed; one needs a product decision. |
| [`06-MOCKUP-INDEX.md`](06-MOCKUP-INDEX.md) | Which mockup is authoritative for which route, and which of the 96 images to ignore. |

Plus one file outside this folder:

| File | What it is |
|---|---|
| `lib/design/contract.test.mjs` | The contract's teeth. Eleven DB-free tests under `npm test` enforcing the invariants below — dead links, missing gates, leaked internal copy, dead controls, the money boundary. Prose cannot stop a redesign breaking navigation; this can. |

## How to use one page prompt

Each entry is self-contained. Hand a single entry to an implementer (or an agent) with
`00-FOUNDATION.md` and they have everything needed for that page without reading the rest.

Every entry has the same eight parts:

1. **Files** — what to edit.
2. **Mockup** — the authoritative image, or `NONE — design from foundation`.
3. **Gate** — the feature key, the roles, and the read-only behaviour. Copy this exactly; it is
   enforced in three independent places and they must agree.
4. **Purpose** — one sentence. If your redesign makes this sentence less true, stop.
5. **Must do** — the functional contract. Everything in this list works today. If any of it stops
   working, the redesign has failed regardless of how it looks.
6. **Controls** — every button, link and field, and exactly where it goes or what it calls.
   Verified against source, not assumed.
7. **Layout** — the visual specification.
8. **Must not** — the specific mistakes available on this page.

## The three rules that outrank everything else in this document

**1. Nothing in a "Must do" list may stop working.**

The functional contracts were extracted from source, not from memory. `05-DEFECT-REGISTER.md`
lists the things that are already broken; everything else works and must keep working. A
beautiful page that cannot claim a transfer is worth less than the ugly one it replaced.

**2. Never widen a gate to make a page look better.**

Gates are enforced at three independent points: the menu (`lib/menu/definition.ts`), the page
(`guardPage`), and the API (`requireFeature` / `requireFeatureRole`). All three must agree. If a
panel looks empty for a role, that is the correct answer — do not remove the gate to fill the
space. `/app/campaigns` shows money and is owner+producer only; `/app/import` does not and
includes assistants. That difference is deliberate.

**3. An error must never render as an empty state.**

This product has a documented history of graceful handlers that deleted the evidence of their own
failure: `/app/campaigns` rendered "No vendors yet" for an HTTP 500; the CSV import said
"temporarily unavailable, try again later" for a permanent schema fault and logged nothing.
"No vendors yet" and "We could not load your vendors" are different sentences and must never be
substituted for one another. See `00-FOUNDATION.md` § States.

## What this set does not do

- It does not redesign the 24 unbuilt menu destinations individually. They all render through one
  component (`ComingSoon`) via `/app/[section]`; that component is specified once.
- It does not specify `insurvas-demo-video/` (a separate Remotion project).
- It does not cover the orphaned components that no page imported. Those were resolved rather than
  designed: five deleted, one (the DNC number-checker) wired onto the dialer. See D-13 and D-14.
- It does not design the LA-3 screens (Applications, Underwriting interview, Quote Capture,
  Requirements, Pre-submission QA, Sales performance, Carrier field maps, Disclosure library,
  Carrier portal register, Quotation templates, Underwriting templates). Eleven such mockups exist
  in the generated-images folder. **No route, component, API or menu entry exists for any of
  them.** They are a future module, not a redesign. See `06-MOCKUP-INDEX.md`.
