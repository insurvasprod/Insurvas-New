# Spec: Landing page redesign, round 2 (2026-11-03)

Supersedes the visual direction in [landing-page-research-spec.md](landing-page-research-spec.md);
its evidence and claim rules still apply.

## Objective

A first-time visitor from a life or health agency or call center should think "this is what I
need" within the first viewport, then scroll through a story that shows the product working.
The page must look premium and deliberate (no generic AI-landing tropes) in light and dark themes,
at 1536×826 (the owner's screen), 1366×657 and 390×844.

## Assumptions

1. Existing approved copy stays; new short lines (captions, card copy, trial steps) are allowed and
   listed in the handoff for review.
2. Every product figure is sample data and labelled; figures stay internally consistent.
3. The owner approved adding `animejs@4.5.0` (exact) and running a local dev server.
4. Motion is decorative-plus-meaningful: it never hides copy, pauses off screen, and has a still
   equivalent under `prefers-reduced-motion`.

## Page structure

| # | Section | Signature |
|---|---|---|
| 1 | Hero (dark in both themes) | Headline, CTAs, and the **deal river**: leads flow in from named vendors, pass seven stage gates with live counts, drop-outs fall away, issued ones turn into commission. Hover a lead to inspect it. anime.js entrance timeline. |
| 2 | Built-for strip | Audiences and four guarantees. |
| 3 | The answer: True CPA report | Interactive vendor report and drop-off chart. |
| 4 | Inside one call | Five chapters, sticky product screen per chapter. |
| 5 | What it does | Bento of four animated product moments + four links back to the story. |
| 6 | Pricing, FAQ | From the live catalog; unchanged behaviour. |
| 7 | ~~Close (light, distinct from the olive footer)~~ | ~~**Ledger to tick**: a grid of leads; the issued ones light up and assemble into the Insurvas tick.~~ **Removed 3 Nov 2026** on the owner's instruction, along with the FAQ's "Still deciding?" card. The page now ends on the questions and the footer; the header's trial button rides the whole page, so there is still a call to action everywhere. |

## Commands

- Dev: `npm run dev -- --port 3000`
- Types: `npx tsc --noEmit -p .`
- Lint: `npx eslint components/marketing app/page.tsx`
- Design rules: `node --experimental-strip-types --test lib/design/*.test.mjs`

## Code style

Marketing components in `components/marketing/`, CSS modules, colours from tokens only (no hex
literals in `.tsx`), CTAs via `MarketingCta`, canvas work in a single `useEffect` with
IntersectionObserver + visibility pausing.

## Success criteria

- First viewport at 1536×826 shows headline, both CTAs and the animated river without overlap.
- Story section renders as designed on a fresh server (no unstyled text).
- Close section is visibly separate from the footer.
- No console errors; lint, types and all design tests pass.
- Both themes and the three viewports inspected in screenshots.

## Boundaries

- Always: sample labels, token colours, reduced-motion stills.
- Ask first: pricing logic, header/footer components, new claims about results.
- Never: real customer data, testimonials or logos we cannot back, counting up invented results as proof.

---

# Round 3: polish and audit the rest of the page (proposed, awaiting approval)

Round 2 delivered the dark hero with the deal river, the True CPA "answer" section, the bento and
the ledger-to-tick close. Round 3 brings every other section up to the same standard and closes the
verification gaps.

## Assumptions

1. Scope is the landing page only (`/`): `app/page.tsx`, `components/marketing/*`, and the floating
   header. `/pricing`, auth pages and the apps are out of scope.
2. The hero river and the close animation are kept as they are; round 3 refines, not replaces them.
3. Approved copy stays verbatim; any new line is listed in the handoff.
4. No new dependency beyond `animejs@4.5.0`.
5. Work lands on a new branch `redesign/landing` off `main`, merged by PR (per the branch-per-round
   rule); the current uncommitted work moves there first.

## Objective

A visitor who scrolls past the hero meets sections that are as deliberate as the first viewport: no
dead space, no plain-looking blocks, readable in both themes, and smooth on a mid-range laptop and a
phone.

## Work items and success criteria

| # | Item | Done when |
|---|---|---|
| 1 | **Story ("Inside one call")** | No gap taller than ~40% of the viewport between chapters at 1536×826; the sticky screen has no empty band below its content; inactive chapters stay legible (≥ 4.5:1 for body text). |
| 2 | **Built-for strip** | Wraps cleanly at 390px and 1366px with no leading "/" on a new line. |
| 3 | **Pricing teaser** | Cards match the bento's surface language (radius, border, hover); the recommended plan is distinct without glow; prices still come from the catalog only. |
| 4 | **FAQ** | Open/close animates height smoothly; keyboard and screen-reader behaviour unchanged (`<details>`). |
| 5 | **Mobile hero** | At 390×844 the headline, both CTAs and the start of the river are in the first screen; the river shows a vendor label. |
| 6 | **Close section** | The dot grid aligns with the headline's top; the section is no taller than ~1.2 viewports at 1536×826. |
| 7 | **Accessibility** | The river's lead inspector has a non-pointer equivalent (a "Show a lead" button or a text summary); report rows, chapters and Replay are reachable and visible with keyboard focus. |
| 8 | **Reduced motion** | With `prefers-reduced-motion: reduce`, every section shows a complete still state (river frame with counts, finished tick, report bars). Verified by screenshot. |
| 9 | **Performance** | No long task > 50ms from the river/close on a 4× CPU-throttled Chrome profile; the river pauses off screen (already built) and drops particle count on narrow or low-power screens. |
| 10 | **Commit** | Work committed on `redesign/landing` with the design tests passing; PR opened. |

## Verification

- `npx tsc --noEmit -p .`, `npx eslint components/marketing app/page.tsx components/public/site-header.tsx`,
  `node --experimental-strip-types --test lib/design/*.test.mjs`
- Screenshots at 1536×826, 1366×657, 390×844, light and dark, plus reduced motion, compared against
  the criteria above.
- Chrome performance trace with 4× CPU throttling for item 9.

## Open questions

1. **Branch and PR:** create `redesign/landing` off `main`, commit, and open a PR? (Assumed yes.)
2. **Pricing teaser:** keep the three-card ladder, or switch to a single compact "from $99/month"
   strip that sends people to `/pricing`?
3. **Header:** the solid frosted pill is now landing-only. Should `/pricing` get the same look for
   consistency?
4. **Anything else** you or your manager noticed that should be in this round?
