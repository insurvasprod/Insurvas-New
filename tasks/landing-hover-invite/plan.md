# Implementation Plan: Hover invite on the hero laptop (concept 5)

**Branch:** `redesign/landing-feature-cards` (same landing round, same PR).
**Source:** Keller, 10 Nov: "nobody knows you can interact with the pages in the laptop." The owner
chose concept 5 of five on the design canvas (https://claude.ai/artifact/9Tfp4fYkBYUcY3nJx6862x).
**Scope:** `components/marketing/landing-device.tsx` and `landing-device.module.css` only.

## What it does

When a mouse enters the laptop:

1. **The laptop lights up**: a green ring and glow around the bezel fade in.
2. **The sidebar pulses** softly: the place to click.
3. **A chip trails the cursor**: "← Pick a page to explore". It glides after the pointer with a
   little lag (eased, not glued) and fades out while the pointer is over the sidebar itself.
4. **The page holds still** while the mouse is over the laptop: the 5-second cycle pauses, so it
   stops behaving like a video the moment someone reaches for it.
5. **Once someone clicks a page, the teaching stops**: no more pulse or chip for the rest of the
   visit. The light around the bezel stays as a quiet hover state.

Phones and tablets are untouched: they already have page tabs under the laptop.

## Architecture decisions

- **No React re-render on hover or pointer move.** The laptop is a large tree. Hover state is a
  `data-hover` attribute written on the device element; the chip's position is a `transform`
  written in one `requestAnimationFrame` loop. Nothing in React state changes until a page is chosen.
- **Compositor-only motion.** The bezel light is a pseudo-element whose `opacity` fades; the rail
  pulse animates the `opacity` of a layer with a fixed shadow (not the shadow itself); the chip moves
  by `transform: translate3d`. No layout, no paint per frame.
- **The chip lives in the stage, not the device.** The device is 3D-tilted; the stage is not
  transformed, so pointer coordinates map 1:1. One `getBoundingClientRect` read per frame, then
  one write.
- **The rAF loop runs only while it has to**: from pointer enter until the chip has settled after
  leaving. It is idle otherwise.
- **Mouse only:** gated by `(hover: hover) and (pointer: fine)` and the event's `pointerType`, so a
  tap on a touch laptop never shows a chip.
- **Reduced motion:** no pulse and no trailing. The chip sits next to the pointer without easing,
  and the light still fades.

## Tasks

- [ ] **1. Hover state and the cycle pause.** `pointerenter`/`pointerleave` on the device set
  `data-hover`; the interval skips its tick while hovered. *Accept:* the page stays put while the
  mouse is on the laptop and resumes after it leaves.
- [ ] **2. Bezel light and sidebar pulse (CSS).** *Accept:* both visible at 1536×826, dark and light
  themes; the pulse stops after a page is chosen.
- [ ] **3. The trailing chip.** rAF lerp toward the pointer, hidden over the sidebar, gone after a
  page is chosen. *Accept:* smooth at 60 fps (Performance panel: no layout or paint per frame from
  the chip); never shows on touch.
- [ ] **Checkpoint:** design tests, typecheck, lint; screenshots with the mouse over the dashboard
  and over the sidebar; `git diff --stat`; `graphify update .`; owner review on localhost:3000.

## Risks

| Risk | Mitigation |
| --- | --- |
| The chip feels naggy | Gone after the first click; fades over the sidebar; small. |
| Pausing the cycle hides that the laptop has many pages | The cycle resumes as soon as the pointer leaves. |
| 3D tilt makes the ring look off | The ring is on the bezel inside the device, so it tilts with it. |
