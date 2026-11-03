# Spec: "Who it's for" — a split panel for agents and agencies

**Status:** written 3 Nov 2026, awaiting approval. No code written.
**Branch:** `redesign/landing`
**Replaces:** the "Built for" strip (`components/marketing/landing-sections.tsx`, `LandingTruths`).
**Reference:** the owner's Pinterest pin — a split-screen slide, one half per audience, with the
halves reacting to the pointer.

---

## Assumptions — correct these now or I build on them

1. **Two panels, not three.** The plan catalog has exactly two audiences, `individual` and
   `agency` (`lib/publicPlans/types.ts`). The split mirrors the thing the product actually sells.
2. **The section keeps `id="industries"`.** The header nav and the footer both link to
   `/#industries`; changing it breaks both.
3. **It replaces the strip entirely**, rather than sitting beside it.
4. **The four guarantees survive.** The strip also carries "4 checks re-run by the server before
   every dial", "True CPA computed from your own linked data", "A missing figure reads —, never
   $0.00" and "Partners never see each other's leads". Those are the page's trust line and are not
   dropped — they move under the split.
5. **Round-4 rules apply:** white ground, brand green / mint / deep-olive ink, scoped tokens only
   ([BRAND.md](BRAND.md) rule 10), no dependency beyond `animejs@4.5.0`.
6. **The reference is a composition cue, not a template.** No photography, no diagonal cut, no
   red/blue. We have no licensed people photography, and the page has no photographic language.

---

## Objective

A visitor should see, in one glance, that Insurvas is built for two different shapes of business —
one agent with their own book, or an agency running a floor — and should be able to tell within a
second which half is theirs, then get to the right pricing view.

The current strip lists seven business types in a row and asks the reader to find themselves in it.
The split makes the choice explicit and gives each audience its own proof.

## Content model

Each panel carries a label, a one-line claim, three proof points drawn from features the product
really has, and a CTA into that audience's pricing view.

| | Left panel | Right panel |
|---|---|---|
| Label | For the individual agent | For the agency |
| Who | Independent agents · Final expense · Term & whole life · Medicare & health | Live-transfer floors · Outbound call centers · IMOs & FMOs |
| Proof | Your own book, acquisition, selling, compliance, retention and accounting in one workspace | Producers, lead routing, splits, payouts and the agency dashboard — one flat price for the team, never per seat or per lead |
| CTA | See agent plans → `/pricing` | See agency pricing → `/pricing?for=agency` |

**Copy provenance.** The agency line is the approved `/pricing` lede
(`AUDIENCE_COPY.agency` in `components/public/pricing-page.tsx`), lightly trimmed. The audience
nouns are the existing `AUDIENCE` array from the strip, split by organisation shape. The two panel
labels and the agent proof line are **new copy, listed here for review** — nothing else is invented.

**Claims rule.** Every proof point names a module the product ships: the agent side from the plan
ladder's own module labels (Book of business, Acquisition, Sell, Compliance, Retention,
Accounting); the agency side from real surfaces in `components/app/agency/` (producers roster,
hierarchy, splits, payouts, agency dashboard). No seat counts, prices or results are typed in —
prices stay in the catalog, as [UI-CONSISTENCY.md](UI-CONSISTENCY.md) §13 requires.

## Interaction

| State | Behaviour |
|---|---|
| Rest | Both panels equal width. Label and the "who" line visible; proof and CTA present but quiet. |
| Hover / focus one | That panel grows (roughly 58/42), its proof and CTA come forward, the other recedes — dimmed, not hidden. |
| Pointer leaves | Returns to the even rest state. |
| Keyboard | Each panel is a real link. Tab moves between them and focus produces the same grown state as hover — the reveal must never be pointer-only. |
| Touch / no hover | Under `(hover: none)`, both panels sit in their revealed state permanently. Nothing is behind a gesture. |
| Reduced motion | No width transition; both panels fully revealed and still. |
| ≤ 860px | Panels stack, both fully revealed. |

Width and opacity only, on the compositor; no layout thrash per frame.

## Tech stack, commands, structure, style, testing

Unchanged from the landing round — see
[landing-page-redesign-spec.md](landing-page-redesign-spec.md). In short: Next.js + CSS modules in
`components/marketing/`, colours from tokens only, CTAs via `MarketingCta`.

- Types: `npx tsc --noEmit -p .`
- Lint: `npx eslint components/marketing app/page.tsx`
- Design rules: `node --experimental-strip-types --test lib/design/*.test.mjs`

There is no unit test for a marketing section; the design-rule suite plus rendered inspection at the
three viewports is the gate, as it has been for every section this round.

## Boundaries

- **Always:** keep `id="industries"`; token colours; the guarantees stay on the page; keyboard parity
  with hover; a reduced-motion still state.
- **Ask first:** changing the two panel labels; dropping any of the four guarantees; linking anywhere
  other than the two pricing views.
- **Never:** invent customer names, logos, seat counts, results or testimonials; type a price;
  put the only copy of anything behind a hover.

## Success criteria

- [ ] At 1536×826 both panels are readable at rest without hovering anything.
- [ ] Hovering or focusing either panel reveals its proof and CTA; the other dims but stays legible
      (body text ≥ 4.5:1 in both states, measured, not assumed).
- [ ] Tab reaches both panels and shows the same revealed state as hover.
- [ ] With `(hover: none)` both panels are revealed; nothing requires a gesture.
- [ ] With `prefers-reduced-motion: reduce` both panels are revealed and nothing animates.
- [ ] Stacks cleanly at 390×844 with no horizontal overflow.
- [ ] `#industries` still lands correctly from the header nav and the footer.
- [ ] The four guarantees are still on the page.
- [ ] `tsc`, `eslint` and all design tests pass; no console errors.

## Open questions

1. **Panel labels.** "For the individual agent" / "For the agency" — plain, and they match the
   catalog's own words. The Pinterest reference uses one word a side ("FREELANCE" / "OFFICE"); the
   one-word version here would be "Agent" / "Agency". Which do you want?
2. **How far does the hover go?** The reference is a true 50/50 split edge to edge. Ours can either
   be a full-bleed band (two halves, screen edge to screen edge, more dramatic) or two cards inside
   the page's 1320px measure (calmer, consistent with every other section). I lean full-bleed — it
   is the one place on the page a split would earn its keep.
3. **Does the agent half get the product lines?** Final expense / Term & whole life / Medicare &
   health apply to agencies too. Listing them only on the agent side is a simplification; the
   alternative is one shared line under both panels.
