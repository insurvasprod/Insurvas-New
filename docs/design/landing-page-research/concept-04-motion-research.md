# Concept 04 — motion and product-story direction

Research notes for a static landing-page mockup. No product route or component changes.

## What the references contribute

- **SaaSUI:** use shipped product patterns as evidence; reference the CRM’s own work surfaces rather than inventing a generic dashboard.
- **Mintlify (Lapa + live page):** separate capability storytelling from customer proof; the testimonial carousel exposes a pause control. Borrow the separation and give motion an explicit control, not its palette or AI positioning.
- **Stripe Financial Connections:** stages a complicated product explanation into a clear “how it works” narrative. For Insurvas, stages should show one comprehensible job at a time.
- **Intercom / Rive:** high-fidelity product animation can explain the product before signup. The lesson is to animate recognizable product states, not add ornamental motion; this mockup uses CSS and DOM rather than introducing Rive.
- **Insurance CRM category scan:** category messaging already includes “one place” / “lead to commission” claims ([InforceDesk](https://inforcedesk.com/), [Prodigy Life CRM](https://prodigylifecrm.com/)). Insurvas should demonstrate its own real operations, especially the carrier statement matched to a policy, instead of relying on category shorthand.

## Proposed visual system

The page is an **operating story**: a single framed product stage remains in place while the visitor moves through four chapters. A thin “data highway” line travels between chapter markers and illuminates the active CRM scene. The scene crossfades into a new state; no numbers race, no dashboard tiles float, and the visitor can select a chapter directly.

1. Source and acquisition cost follow a lead.
2. Four configured checks decide whether a dial may proceed.
3. Application work has a visible status; a draft is never presented as issued.
4. A carrier-reported amount can be matched to its policy; an unavailable expected amount stays unavailable.

Each scene is an **illustrative recreation**, not a single real customer journey. The currently verified policy-to-statement sample remains visibly fictional and does not claim to be linked to the lead, campaign, or application scenes.

## Motion with a job

- **Scroll-linked chapter selection:** explanation/orientation; section observation selects the matching stage without controlling or locking scroll.
- **SVG route draw:** explanation; the line makes the relationship between stages visible. A static route remains when reduced motion is requested.
- **Scene transition:** state indication; the visual changes with a short crossfade and small translation, while the chapter heading and text stay still and readable.
- **Direct chapter controls:** feedback; clicking or keyboard-activating a step selects the same scene without requiring scroll.
- **CTA and navigation:** brief hover/press feedback only; no animated loading or delayed action.

No autoplaying infinite loop, pointer-chasing, spinning charts, decorative particles, animated counters, or scroll-jacking. MDN documents scroll and view progress timelines and explicitly calls out reduced-motion preferences; W3C documents the `prefers-reduced-motion` technique for interaction-triggered motion.

## Sources

- [SaaSUI design inspiration](https://www.saasui.design/)
- [Mintlify landing page in Lapa Ninja](https://www.lapa.ninja/post/mintlify-2/)
- [Mintlify live homepage](https://www.mintlify.com/)
- [Stripe Financial Connections](https://stripe.com/gb/financial-connections)
- [Intercom product animation case study (Rive)](https://rive.app/blog/intercom-s-product-animation-evolution-embracing-rive)
- [MDN: scroll-driven animation timelines](https://developer.mozilla.org/en-US/docs/Web/CSS/Guides/Scroll-driven_animations/Timelines)
- [W3C: `prefers-reduced-motion`](https://www.w3.org/WAI/WCAG22/Techniques/css/C39)
- [Agent Compass](https://agentcompass.agency/) and [PowerHours](http://powerhours.agency/) did not render as readable pages in the research browser; they remain unverified visual references.
