# Motion redirection — 3 November 2026

The user rejected the paper-and-disc hero, the preceding record presentation, and the drifting labels at the closing CTA. The aim is to make the relationship between lead source, work, policy and statement perceptible without screenshots, decorative arrows, or extra claims.

## Reference observations

- [Webflow: SaaS landing pages](https://webflow.com/blog/saas-landing-page) recommends a clear first promise, focused visual and consistent primary action. This is editorial guidance, not evidence of a conversion increase for Insurvas.
- [SaaS UI](https://www.saasui.design/) indexes real product patterns and interactions. Use its patterns to understand interaction states, not as visual templates for the marketing page.
- [Mintlify on Lapa Ninja](https://www.lapa.ninja/post/mintlify-2/) provides a recorded SaaS page reference. Its use of a clear product proposition is relevant; its identity is not Insurvas's identity.
- [Motion's scroll documentation](https://motion.dev/docs/scroll) distinguishes a continuously scroll-linked value from a reveal triggered on entering the viewport, and recommends native sticky positioning for pinned scenes. The current story uses chapter-triggered selection; a continuous transition would require separate design and testing.
- [Rive's interactive examples](https://rive.app/use-cases/character-animation) illustrate state-driven artwork. A custom Rive asset could support a more authored interaction later; no Rive dependency or asset is introduced here.
- Search results for [Variable](https://youare.io/) describe data-driven visual work; the actual site timed out in the research browser. Its stated approach suggests that data relationships can define the motion, but no specific project was visually verified.
- The supplied Behance moodboard and AgentCompass URL were inaccessible through the research browser; they were not visually reviewed in this pass.

## Direction under review

- Hero: four selectable, dimensional layers represent the same sample lead's source, work, policy and statement. Selection brings a layer forward and changes the accompanying explanation. This is an illustrative interpretation, not a CRM screenshot or live data.
- Story: five chapters update a visible scene while scrolling or selecting a chapter; the scene shows one current idea instead of a second dense table.
- Closing CTA: a procedural field of fragments moves from a dispersed arrangement toward ordered records, over a generated, text-free background artwork. It is a metaphor for organising the agency's information, not a claim about a specific import process. The procedural layer pauses offscreen and the artwork remains as the reduced-motion / WebGL fallback.

Generated art-direction references: [closing field](record-field-cta-direction.png) (1672 × 941) and [hero layers](record-layers-hero-direction.png) (1487 × 1058). These are visual explorations only; the generated logo, copy, curves and lighting are not approved brand assets or implementation requirements. The coded render uses the real logo and copy, and differs materially from these images.

Review must cover the actual animation in the browser, keyboard selection, mobile layout and reduced motion. The static reference alone does not establish motion quality or performance.
