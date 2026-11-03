# Motion direction: one lead, many moments

Research and creative direction, 2026-11-03. This is a proposal for review, not an implemented product or proof that a particular feature works in production.

## The idea

Use one recognizable lead as the page's main character. The visitor first sees a live transfer, then follows the same record as context gathers around it: source and cost, a claimed call, checks, application, policy, and carrier statement. A visual identifier stays with the record throughout. Movement represents a real handoff, decision, or connection.

The page should answer “What happened to the lead I paid for?” even when animation is disabled. Every example is labeled sample data. The page's original copy is preserved; storyboard labels below are working descriptions, not approved replacements.

## Storyboard

1. **Hero: a call arrives.** A single incoming transfer row enters the scene and settles. A source tag and waiting time appear. A claim action resolves to one agent; a subtle continuation line carries the record toward the next section. The headline remains immediately readable. No loading intro blocks the page.
2. **The handoff.** The row expands into an enlarged, simplified view of the real transfer floor. Two possible claim actions converge into one clear owner. This depicts the actual job of claiming a transfer; the example should be checked against CRM behavior before implementation.
3. **Before the dial.** Four short checks appear one at a time: consent, configured DNC sources, agency suppression list, and the customer's local calling window. The last state is either clear or stopped with a reason. Do not imply screening guarantees legal compliance. Let a visitor switch between the two states.
4. **Application to issued policy.** The same record transitions from application to a policy only after an explicit issued state; submission does not imply issuance. Use a stepper to let the visitor move at their own pace. Keep application and policy details recognizable, but use no real customer information.
5. **The return to source.** The policy and a carrier statement line align on the policy identifier. A separate campaign-level view reveals cost per issued policy from sample linked data. Avoid suggesting one policy represents a whole campaign or that CPA is profit. Show unmatched/waiting states if they are shown at all.

## Motion rules

- One hero sequence is the memorable moment; later sections use smaller transitions that explain their own task.
- Animation is brief, readable, and interruptible. Visitors control interactive sequences; never lock page scrolling or delay the CTA.
- Reduced motion shows the same final states, labels and meaning with minimal movement. Test keyboard navigation, mobile layout and real devices.
- Use actual branded assets and verify every product state against current CRM source and browser behavior. Figures are visibly labeled sample data.

## Research and interpretation

- [Rive's Intercom case study](https://rive.app/blog/intercom-s-product-animation-evolution-embracing-rive) describes rebuilding product interactions as high-fidelity animations. The lesson for Insurvas is to animate a real job and its states, rather than decorate a static screenshot. This does not prescribe Rive as a dependency.
- [Stripe Financial Connections](https://stripe.com/financial-connections) breaks a technical service into an explanation, use cases, and a how-it-works flow. The lesson is to make a complicated system legible in stages; this is an interpretation of its content, not a visual motion audit.
- [iPipeline's Agency Integrator](https://ipipeline.com/wp-content/uploads/2025/07/AGENCYINTEGRATOR_Slick_2025.pdf) presents insurance work as a connected process. Insurvas can use the customer's actual record as the connective device, while distinguishing its own capabilities.
- [W3C guidance](https://www.w3.org/WAI/WCAG22/Understanding/animation-from-interactions) explains why interaction-driven motion should respect reduced-motion preferences. The static version must carry the same story.
- The provided Mintlify/Lapa, SaaSUI and AgentCompass references are documented in `stories-and-inspiration.md`. The supplied Behance board and PowerHours URL were inaccessible to the research browser; do not treat them as fully reviewed.

## Decisions still to make

Test whether the hero should start with the transfer moment or with the broader campaign question. Validate the proposed scenes with agency owners and agents, and check that people can explain the product after one quick view. No design can guarantee universal appeal or prove that its concept has never appeared elsewhere.
