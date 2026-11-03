# Live site and conversion-flow review — 3 November 2026

Read-only review of the production landing page, pricing page, signup, sign-in and current source. This is design research, not an implementation request or an approval to change production copy.

## What is already working

- **Landing page:** the live page has a WebGL brand ribbon, a scroll-scrubbed five-scene CRM story, product-specific motion and a real pricing teaser. The scroll story is substantially more developed than the static record cards in Concepts 03–04.
- **Signup and sign-in:** the three-step signup form keeps account details short at step one. Both auth pages share the same split layout and show a selectable four-scene product preview with a pause control. The preview is the strongest existing pattern to bring into the landing page: it lets someone choose which CRM job to inspect.
- **Pricing:** the live catalog drives the displayed prices and features. The page already has individual/agency views, monthly/yearly billing, an agency seat slider, plan-fit questions, feature comparison/explanation, and questions about payment and cancellation. Do not hard-code prices or recreate this as three static plan tiles.
- **Navigation/footer:** public navigation points to real sections and pricing; the footer has separate product, sign-in and published-legal columns. Keep destination-aware links; the legal column is intentionally data-driven.
- **Sign-out:** the CRM’s sign-out action ends the agent session and returns to sign-in. I reviewed its source but did not click it or end the test session.

## What is holding the story back

1. **The opening work surface competes with the promise.** In the production dark-theme view, the animated ribbon crosses the supporting copy and reassurance line. Keep the brand motion, but provide a calmer text-safe region or stage the ribbon behind the product demonstration rather than behind every line.
2. **The desktop workflow is controlled only by scroll.** The five-stage demonstration currently has no visible chapter controls and its product scenes are marked `aria-hidden`. The signup preview already proves a better interaction pattern: select a named scene, pause, and inspect it at your own speed. Preserve scroll storytelling as an enhancement; add direct, keyboard-operable scene controls.
3. **The two biggest demo metrics need careful framing.** The landing scene calls `16.1×` “Return on this lead,” while the page separately defines True CPA at campaign/vendor level. Avoid implying that CPA is profit or that one lead substantiates an aggregate return. Keep unknown expected commission as `—` and show what the system can actually verify.
4. **Pricing is information-rich.** The audience and billing controls make the page adaptable, but visitors still have to understand product/module names and navigate a lengthy comparison. The live “Explain each feature” and “Which plan fits you?” controls should be made easier to notice and use as a guided decision path, with catalog-derived prices unchanged.
5. **The product needs a plain-language explanation beside the software vocabulary.** Keep the approved headlines, but pair “True CPA,” “DNC,” and “issued policy” with a short concrete explanation where needed. Research on web reading supports concise, scannable, plain-language labels; it does not support adding bigger hype or unsupported proof.

## Product evidence for the next demo

- The CRM’s scenes can show transfer claiming, four configured pre-dial checks, application states, and statement/policy reconciliation.
- The four examples should remain separate unless one complete source-to-issued journey is verified. The tested fictional commission match is policy-to-statement only: $84 reported, accepted and linked; expected commission unavailable because that sample carrier has no configured rate.
- Every invented display value must say **Sample data**. Never use a phone number or real customer details in the marketing demo.

## Design direction to test

Replace the passive card in Concept 04 with a **small interactive product theatre**: one real-looking CRM frame, a visible scene selector, and a meaningful control inside each scene. A visitor can claim a sample transfer, run a check (including a refused state), inspect an application that stays a draft, or accept the sample commission match and see the expected amount remain unknown. Make each state change teach something; keep the example records explicitly independent.

The main headline and saved copy remain intact. A short plain-language bridge may be explored as draft copy inside the mockup, not substituted into the homepage.

## Sources

- Current live production: [homepage](https://insurvas-new.vercel.app/), [pricing](https://insurvas-new.vercel.app/pricing), [signup](https://insurvas-new.vercel.app/signup), [agent sign-in](https://insurvas-new.vercel.app/app/login). Pages were inspected read-only; no form was submitted and no account was signed out.
- Current source: `components/marketing/landing-exploded.tsx`, `components/public/pricing-page.tsx`, `components/public/pricing-explorer.tsx`, `components/public/signup-form.tsx`, `components/app/logout-button.tsx`.
- [NN/g: How People Read Online](https://www.nngroup.com/articles/how-people-read-online/) recommends scannable headings, front-loaded information and plain language.
- [W3C: Let users control when content moves](https://www.w3.org/WAI/WCAG2/supplemental/patterns/o8p01-motion/) explains the value of user-controlled changes; the existing auth preview's pause/select controls are a good local precedent.
- [W3C: `prefers-reduced-motion`](https://www.w3.org/WAI/WCAG22/Techniques/css/C39) documents honoring the visitor's motion preference.
