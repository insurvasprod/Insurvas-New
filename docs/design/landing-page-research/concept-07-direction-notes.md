# Concept 07: The record trail

**Status:** Review concept and interaction prototype. The public homepage code is unchanged.

## Why this direction

The page makes the product's distinct promise tangible: a campaign source remains connected to a lead, its work, an issued policy, and the carrier statement line a team can review. That gives the visual system a subject drawn from Insurvas' real workflow instead of a stock dashboard, floating cards, or generic SaaS decoration.

The hero uses an authored route diagram and small document artifacts. The later sections restate the same journey in plain language and show a sample record relationship. No CRM screenshots, customer logos, testimonials, performance claims, or invented financial results are used. The example is explicitly marked as sample data; costs and commissions are shown as different records, not as profit.

The page keeps the source hero wording. The copy baseline remains in [homepage-copy-source-snapshot.md](homepage-copy-source-snapshot.md). Additional story text in the prototype is draft concept copy and should be checked against the source homepage before it is adopted.

## Motion behavior

The visitor selects Source, Call, Policy, or Statement. The same route marker moves to that station; the matching artifact is emphasized and the explanation changes. Controls support click and arrow-key navigation. Nothing autoplays, and `prefers-reduced-motion` removes the transitions while keeping every step visible.

This applies the input/state-machine approach described in [Rive's website examples](https://rive.app/use-cases/websites) and [Motion's scroll and reduced-motion guidance](https://motion.dev/docs/react-scroll-animations), without making a Rive or animation-library dependency necessary for this prototype. The interaction is deliberately direct rather than scroll-pinned: it is an optional explanation, and the four steps remain readable as ordinary page content.

## Review artifacts

- Editable full-page concept and motion storyboard: [Insurvas Motion-led Landing Page Concepts](https://www.figma.com/design/owKgxWYVkc2wUt9mQTeq4z).
- Responsive interactive prototype: [concept-07-record-trail.html](concept-07-record-trail.html).
- Motion and component research: [motion-and-interaction-research-2026-11-03.md](motion-and-interaction-research-2026-11-03.md).

## Before production use

- Replace fictional sample names and identifiers with non-sensitive examples verified against the CRM, or keep them clearly marked as sample.
- Preserve the full homepage copy baseline when replacing the existing page; this early mockup only carries the original hero text verbatim.
- Keep pricing and trial terms data-driven from the current plan catalog.
- Check responsive behavior, keyboard use, contrast, and reduced motion in the real page implementation.
- Review the Rive, Lottie, Motion, GSAP, or community-file license and current package support before selecting a production motion tool. The prototype currently uses inline SVG, CSS, and a small native script.
