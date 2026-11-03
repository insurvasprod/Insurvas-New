# Concept 08: The evidence register

**Status:** New visual direction after feedback on Concept 07. Standalone review mockup; production homepage unchanged. This version adds the scroll-led motion that was missing from the first Concept 08 pass.

## What changed

- The official on-dark SVG and light SVG from `public/brand/` are used directly. The header is no longer re-drawn as a text-only wordmark.
- The current hero introduction is carried over verbatim: audience line, headline, supporting paragraph, calls to action, and the three proof notes. The preserved baseline remains [homepage-copy-source-snapshot.md](homepage-copy-source-snapshot.md).
- The warm cream and near-monochrome treatment was replaced with the CRM's current light theme: `#f1f3f7` canvas, `#ffffff` surface, `#e4e8ee` raised band, `#d5dbe3` rules, and `#0d4037` ink.
- UI colors are used for their CRM meanings: blue `#2563b8` for in-progress, green `#117a3d` for success, and amber `#a35200` for warning. Insurvas action green `#07d6a0` stays a mark or fill; readable green text uses `#00735a`.
- The visual is composed from authored record rows and a statement-review comparison. It is not assembled from CRM screenshots and contains no invented dollar amounts, testimonials, or performance figures.

## Product truth shaping the story

The production workflow review found that lead source, policy status, and carrier statements are distinct records. A policy is only issued when its state says issued; a carrier statement can arrive while rate-card setup is still missing; and a missing expected amount must stay unavailable rather than become zero or a guess. The section “Reported is not the same as expected” turns that real gap into a clear explanation of what the product helps teams review.

The sample state in the mockup is explicitly illustrative. It demonstrates the type of relationship and follow-up, not a claim about an agency's actual setup or results.

## Motion

- **Scroll-led story:** one record stage stays pinned beside four plain-language beats. Normal page scrolling brings each beat through the reading line; the sample artifact changes to that CRM moment while its semantic status updates.
- **Continuous progress:** the thin stage rail and vertical step guide draw with scroll progress. The implementation changes only the transforms on those two elements; it does not scroll the page for the visitor or take over the wheel.
- **Document transition:** the authored record slip exits and the next one enters with a short opacity/transform transition. Each state carries a real workflow distinction: source, human action, issued policy, then a carrier review paused by missing rate setup.
- **Separate control:** “Review policy link” changes the sample relationship state, while the rate-card gap remains visible.
- **Accessibility/performance:** reduced motion removes the sticky sequence and presents all four sample states in a static stack. On smaller screens the narrative becomes a readable vertical sequence. No autoplay, animated blur, looping route, or per-frame framework re-render is used.

## Artifacts and sources

- [Concept 08 responsive HTML mockup](concept-08-evidence-register.html)
- [Current CRM workflow observations](crm-workflow-observations-production-2026-11-03.md)
- [CRM color, type, and logo rules](../BRAND.md)
- [CRM UI foundation v3](../foundation-v3/mockup.html)
- [Rive website examples](https://rive.app/use-cases/websites) and [Motion reduced-motion guidance](https://motion.dev/docs/react-motion-config) informed the interaction research; this mockup uses native HTML, CSS, and SVG rather than adding a motion dependency.

## Preview note

The local browser preview was blocked by the browser's local-file and loopback URL policy. The HTML artifact is ready to open from the repository, but its rendering and interaction have not been browser-verified in this pass. The earlier Figma board still shows the previous concept; the Figma connector reached its Starter-plan tool-call limit before this new visual could be added there.
