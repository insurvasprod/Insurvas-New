# Implementation Plan: "Seven leaks" journey (Keller's call, 10 Nov)

**Branch:** `redesign/landing-feature-cards` (same landing round). **Owner reviews first and may revert:**
everything is in `landing-broken.tsx` and `landing-broken.module.css`, which nothing else in this round
touches, so `git checkout -- components/marketing/landing-broken.*` undoes it cleanly.

**Source:** clip 1, 0:13–0:57 ([transcript](../landing-feature-cards/transcript.md)), on this section:
"let's say I just wanted to scroll past this part. See how fast it is? We want to elongate it… I'm
scrolling, I'm looking, and then I'm like, oh, it's starting to move. There should be colour here…
the colour break, and it's behind… then there's more colour that breaks out here."

## Changes

| He said | Change |
| --- | --- |
| "See how fast it is? We want to elongate it." | The journey gets ~1.5× the scroll distance, and the problems hold still for a moment before they set off. |
| "I'm looking… oh, it's starting to move." | A small cue under the problems ("Scroll, and watch them get fixed" + a bobbing arrow) that fades as the cards set off. |
| "There should be colour here… the colour break, and it's behind." | An aura of brand-green light behind the scene that rises as the cards start moving, from nothing; the section is clean before. |
| "More colour that breaks out here." | A burst of light behind the Insurvas gate each time cards pass through it. |

Copy is unchanged: each card is already one line, which is what Keller asked for elsewhere.

## Performance (animation-performance skill)

| Finding | Cause | Fix |
| --- | --- | --- |
| Every frame, each card writes a transform, then reads `offsetTop`/`offsetLeft` up its parent chain | Layout thrashing: 7 forced layouts a frame | Measure once (and on resize / content resize); each frame does one read, then writes only |
| The gate's glow is a `box-shadow` spread driven by a CSS variable | Paint every frame | A glow layer whose `opacity` is written directly |
| Each card's flip transform is rewritten every frame with the same value | Needless style work | Written only when it changes |

New motion is `opacity`/`transform` only. The aura is one sticky layer, so it never moves with the scroll.

## Tasks

- [ ] 1. Cache the scene's geometry; read-then-write per frame; flip written on change.
- [ ] 2. Longer journey and the hold at the start.
- [ ] 3. Aura behind the scene and the gate burst (opacity-driven).
- [ ] 4. The scroll cue.
- [ ] Checkpoint: design tests, typecheck, lint; screenshots at 1536×826 (dark, light) before the
  journey, mid-journey and landed; phone 390; layout count while scrolling through the scene;
  owner review.
