# SaaS motion and interaction research

Research only — 3 November 2026. The CRM screenshots in the previous concept are not a direction for the public site. No new mockup or production change is included in this pass.

## Finding

Ready-made effects are easy to find; a distinctive result comes from making one effect respond to an Insurvas-specific decision. The strongest fit is a custom, interactive **insurance operations switchboard**: a visual field of incoming leads, agent availability and multiple possible next steps. The visitor changes a state, and the system visibly routes or branches. It can feel rich and high-craft without using CRM screenshots, stock people, decorative orbs, or a fake dashboard.

## Reference research

| Source | What I reviewed | What is useful for Insurvas | Limit |
|---|---|---|---|
| [SaaSUI](https://www.saasui.design/) | Its library groups shipped UI by patterns such as pricing, onboarding, navigation, forms and tables. | Browse interaction patterns by visitor task; do not lift the site's gallery layout. | A pattern library, not one cohesive brand or motion direction. |
| [Mintlify on Lapa Ninja](https://www.lapa.ninja/post/mintlify-2/) | The listing includes a full-page recording. | Study how motion and product explanation alternate down a long page. | Borrow pacing only; a developer-docs page is not an insurance art direction. |
| [PowerHours](https://www.powerhours.agency/) | The supplied site was reviewed in the earlier reference pass. | Its named floor activity gives a concrete starting point for an agent-routing interaction. | Keep its competitive scoreboard framing, typography and palette specific to that brand. |
| [AgentCompass: How it works](https://agentcompass.agency/how-it-works) | The supplied workflow page was reviewed in the earlier reference pass. | Study how a visitor can move through a product explanation at their own pace. | Use the pattern of optional detail, not its layout or workflow illustration. |
| [Insurvas Behance moodboard](https://www.behance.net/moodboard/227268593/Insurvas-Landing-Page) | It appears in the manager's recording; the moodboard could not be searched or inspected item by item in this web pass. | Revisit saved references in the normal browser when choosing a visual system. | No exact moodboard item is attributed or copied here. |
| [Saaspo](https://saaspo.com/) | The site blocked the research fetch in this pass. | It remains a candidate source gallery for future pattern hunting. | No page-level findings claimed. |
| [Intercom product demos](https://www.intercom.com/view-demos) | Current page pairs a chaptered product video with an interactive Fin demo and separate feature demos. | Give visitors both a guided overview and an optional hands-on moment; don't force every visitor into a long animation. | Use the presentation model, not the helpdesk look or AI claims. |
| [Linear feature page](https://linear.app/features) | Feature sections describe a workflow and pair each section with a product moment. | Keep each section's visual and sentence focused on one job; build a consistent chapter rhythm. | The Linear UI language and near-black palette are specific to Linear. |

## Ready-made motion resources

| Resource | What it offers | Recommended use | Watch-out |
|---|---|---|---|
| [Rive website examples](https://rive.app/use-cases/websites) · [Marketplace](https://rive.app/marketplace/) | Interactive vector art, state machines, cursor/click input, scroll/data inputs, and community files. The marketplace has an [Interactive Hero Section template](https://rive.app/marketplace/28570-54275-interactive-hero-section-rive-ui-template/) (CC BY) and a [Web Landing Page study](https://www.rive.app/marketplace/26886-50518-web-landing-page/) (CC BY). | Best fit for a signature landing-page scene that changes when a visitor chooses a lead outcome or agent state. Build the graphic from Insurvas visual language; use marketplace files as studies or editable starting points. | Check each community asset's license and attribution conditions. The examples are starting material, not an Insurvas visual identity. |
| [Intercom's Rive case study](https://rive.app/blog/intercom-s-product-animation-evolution-embracing-rive) · [Figma homepage case study](https://rive.app/blog/figma-s-new-homepage-is-full-of-rive-animations) | Production examples of interactive product animation used across a SaaS site. | Study sharp vector product choreography and how interaction can reveal product behavior. | Their article reports their own workflow and performance outcomes; those numbers are not a promise for this project. |
| [LottieFiles](https://lottiefiles.com/) · [Community animations](https://docs.lottiefiles.com/en/creator/14_plugins/community-animations) | Searchable library of ready-made motion files and editor integrations. Specific examples: [phone-call icon](https://lottiefiles.com/free-animation/phone-call-01rCAJQolp) and [file-upload category](https://lottiefiles.com/free-animations/file-upload). | Use a carefully selected small icon or state animation for one supporting moment—e.g. a call pulse, a check resolving, or a status changing. | Review each file and its license. Avoid stock characters, looping business illustrations and loading animations as the hero. |
| [Motion for React](https://motion.dev/docs/react-scroll-animations) · [reduced-motion configuration](https://motion.dev/docs/react-motion-config) | React transitions, viewport triggers, scroll-linked values and a built-in reduced-motion policy. | Good for section entrances, state transitions and a user-controlled chapter selector without bringing in a separate graphics authoring workflow. | Use scroll-linked motion only when the visual relationship truly follows the scroll. Keep direct navigation and normal scrolling. |
| [GSAP ScrollTrigger](https://gsap.com/docs/v3/Plugins/ScrollTrigger/) · [interactive examples](https://gsapdemos.com/examples) | Scroll-triggered and scroll-scrubbed timelines, pinning, timeline controls and interactive examples. | Strong option for one carefully storyboarded chapter where the visitor can scrub or jump between beats. | Do not pin the whole page, hijack the wheel, or make copy depend on completing the sequence. Check current licensing before production use. |
| [Motion Primitives](https://motion-primitives.com/docs/text-effect) | Small React components for text effects, transitions and interactive motion. | Useful for seeing implementation patterns and prototyping compact transitions. | The text effects (scramble, typewriter, per-character reveal) are easy to overuse and often read as template decoration. |
| [Magic UI](https://magicui.design/) · [React Bits](https://reactbits.dev/) · [Aceternity UI](https://ui.aceternity.com/) | Large component catalogs: animated backgrounds, spotlights, beams, grids, marquees, text effects, cards and interactive demos. | Browse their live examples to name and compare mechanics before deciding on a bespoke component. | These catalogs make it easy to assemble a familiar “AI SaaS” page. Avoid a stack of their default beams, auroras, globes, spotlights, bento cards and floating elements. |

Rive is the best research lead for an original, responsive hero animation; Motion is a sensible fit for restrained page and interaction transitions; GSAP suits one more choreographed scroll chapter. The current marketing implementation already uses authored CSS/WAAPI and its own scroll-motion helper, so the references do not justify adding multiple libraries by default.

### Ready-made files I inspected

- [Rive's interactive hero template](https://rive.app/marketplace/28570-54275-interactive-hero-section-rive-ui-template/) is an editable state-machine example with hover transitions and data binding, licensed CC BY. Useful to understand how a designer can expose distinct interaction states; the visual itself should not be copied into Insurvas.
- [Rive's community landing-page study](https://rive.app/community/files/9597-18279-interactive-landing-page/) is a remixable page-scale example, also CC BY. Treat it as a mechanics study, not a ready-to-ship page.
- [LottieFiles' phone-call asset](https://lottiefiles.com/free-animation/phone-call-01rCAJQolp) is a concrete candidate for a small UI icon/state. Its page lists 30.5 KB JSON and 2.9 KB optimized dotLottie options. Confirm the best runtime format and test its color/theme behavior before use.
- LottieFiles has an [upload animation category](https://lottiefiles.com/free-animations/file-upload) and individual files such as a [folder/document upload animation](https://lottiefiles.com/free-animation/upload-animation-CP43DyT2cb). The file/folder metaphor fits an import moment better than its stock character animations; recolor and simplify or redraw it if selected.

## Five motion opportunities worth testing

| # | Location / moment | Purpose | Frequency | Motion to prototype | Why it could feel specific |
|---|---|---|---|---|---|
| 1 | Hero: the lead-routing switchboard | **Explanation** | First visit / optional replay | 6–8 second Rive sequence. Several small lead signals arrive from named sources; one live-transfer signal routes to an available agent lane. Pause at the claim. Let the visitor toggle an agent between available and away; reroute the signal and update the label. No automatic loop after one play. | Connects the brand's “Data Highway” identity to a real live-floor job. Motion communicates ownership and routing instead of decorating the background. |
| 2 | After the call: choose the outcome | **State indication / explanation** | Occasional interaction | Click Callback, No answer, or Submitted. A shared lead marker travels along a short branch and the next step changes. Use a 350–500ms continuity transition; selected state updates immediately and remains keyboard-accessible. | Shows that real leads branch. It avoids the fake “every dot becomes a policy” funnel. |
| 3 | Before a dial: configured checks | **Explanation** | First visit / optional replay | A compact sequence highlights one check at a time, then ends in either “ready” or a clearly named “refused” example. Visitor can replay and switch states. Each state is a designed vector scene, not a screenshot. | Explains why compliance and eligibility affect what an agent can do next. Use only checks and behavior verified against the CRM. |
| 4 | Policy and carrier statement | **Explanation** | First visit / optional replay | Two typographic records enter from opposite sides and align on matching policy details. A user-triggered “Review match” resolves the statement line. If expected commission is unconfigured, leave it as unknown; never animate an unsupported payout into view. | Uses a concrete insurance bookkeeping task as the visual payoff and treats uncertainty as part of trustworthy software. |
| 5 | Pricing: choose the team shape | **Feedback / state indication** | Occasional interaction | The visitor switches Individual / Agency and changes seat count. The active plan and comparison details move into place in 180–250ms; price comes from the current catalog. No slot-machine number ticker. | Turns existing pricing controls into a guided choice, making the site interactive where the decision is real. |

These are proposals, not implementation instructions or claims that each behavior has been verified in every account. The CRM's existing language and catalog remain the source of truth.

## Visual effects to reject for this brand

- Mouse-following spotlights, beams, aurora gradients, particle fields and 3D globe backgrounds: they do not explain insurance work and are highly recognizable stock patterns.
- Infinite logo/testimonial marquees: they imply social proof and customer permission that have not been established.
- Typewriter or scrambled headline text: it slows down the headline that should explain the product immediately.
- A continuously pulsing route, orbiting cards, generic floating dashboards, or a full-page parallax stack: motion without a user decision or visible consequence.
- Counting up invented leads, conversion, ROI, or commissions: animated numbers feel like evidence even when labeled sample.
- Long autoplay walkthroughs, scroll hijacking and animations that hide essential text until the visitor completes a sequence.

## Motion rules for any future concept

- One signature motion idea per page; use quiet transitions elsewhere.
- Explain the motion with the content: keep labels, chapters and a visible stop/replay control.
- Prefer direct input (click, hover where available, drag only when useful) over auto-playing state changes. Keep keyboard controls equivalent.
- Use transforms and opacity for small UI transitions; reserve SVG/Rive/Canvas work for the main visual. Keep hover-only effects behind fine-pointer media queries.
- Respect `prefers-reduced-motion`. Preserve the same message in a still layout.
- Do not animate information while someone needs to read it. Make motion repeatable but never mandatory.

## Existing implementation context

The landing page already has a branded highway intro and a sticky, scroll-scrubbed five-scene CRM story. Its motion is built with authored CSS/WAAPI and `components/marketing/motion.tsx`; no Motion, GSAP, Rive or Lottie package was found in `package.json`. The current product story is therefore not a blank canvas for effects. New research should focus on alternate visual metaphors and visitor-controlled explanations rather than adding another animated ribbon or another row of floating product cards.

The repository's marketing timing already uses `cubic-bezier(.16,1,.3,1)` for entrances and `cubic-bezier(.65,0,.35,1)` for the highway motion. Existing site-wide reduced-motion styles are present in `app/globals.css`. Any later prototype should use those as its baseline, with frequent UI responses shorter than 300ms and the longer timeline reserved for optional marketing explanation.

## Sources and access notes

- [Rive's interactive website features](https://rive.app/use-cases/websites) describes state machines responding to hover/click and code-driven scroll inputs; [Rive Marketplace](https://rive.app/marketplace/) requires JavaScript to search its files.
- [Intercom's Rive case study](https://rive.app/blog/intercom-s-product-animation-evolution-embracing-rive) describes true-to-life product animation as a way to let visitors understand a product without signing in. [Intercom's current demo page](https://www.intercom.com/view-demos) combines a chaptered video and an interactive demo.
- [Motion scroll animation docs](https://motion.dev/docs/react-scroll-animations) distinguish trigger-based reveals from scroll-linked motion. [GSAP ScrollTrigger docs](https://gsap.com/docs/v3/Plugins/ScrollTrigger/) describe timeline and scroll control.
- [LottieFiles' community animation guide](https://docs.lottiefiles.com/en/creator/14_plugins/community-animations) confirms editable community assets; [license notes](https://help.lottiefiles.com/animation-licensing-basics-) explain commercial-use terms and restrictions.
- Component galleries: [Motion Primitives](https://motion-primitives.com/docs/text-effect), [Magic UI](https://magicui.design/), [React Bits](https://reactbits.dev/) and [Aceternity UI](https://ui.aceternity.com/).
- UX guidance: [W3C on user control of moving content](https://www.w3.org/WAI/WCAG2/supplemental/patterns/o8p01-motion/) and [W3C on `prefers-reduced-motion`](https://www.w3.org/WAI/WCAG22/Techniques/css/C39).
