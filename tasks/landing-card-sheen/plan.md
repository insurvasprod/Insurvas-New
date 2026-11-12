# Implementation Plan: Feature-card light sweep

## Overview
Owner, 11 Nov: as you scroll, each feature card should catch a light that travels from its top-left
corner to its bottom-right corner, on the card's own surface only: under the text and under the 3D
workflow panel, never over them. As smooth, detailed and cheap as possible.

## Architecture Decisions
- **Driven by the existing scroll loop** (`landing-bento.tsx`): it already reads every card's rect
  once per frame and writes only changed values. The sweep's progress for card *i* is how far that
  card has travelled from the bottom of the screen to where it lands (its sticky top). Scrolling back
  reverses it; a landed card shows no light. No new listeners, no extra reads.
- **Compositor only**: the light is one element per card, moved by `transform` and faded by
  `opacity`. It gets its own graphics layer (`will-change`) only while it moves, so seven idle cards
  hold no extra card-sized layers (layer count was the scroll cost measured on 11 Nov).
- **Under the content by order, not z-index**: the light is the card's first child; the copy column
  and the workflow panel are positioned and come later, so they paint over it. The panel's plate is
  opaque, so the light shows on the card surface around them.
- **Detail without cost**: the band is a layered gradient (a broad green-tinted wash, a softer halo
  and a thin bright core) drawn once; a second, masked copy of the band lights only the card's 1px
  edge as it passes, so the border catches the light too. No blend modes, no filters.
- Off under reduced motion; on phones too (only the arriving card's light is ever a layer).

## Task List
- [x] Task 1: Light element + styles (sheen band and edge ring) in the card.
- [x] Task 2: Drive it from the scroll loop (progress, transform, opacity, layer only while moving).
- [x] Checkpoint: lint, typecheck, design tests; screenshots mid-sweep at 1536×826; layer count
      unchanged at rest; phone check.

## Risks and Mitigations
| Risk | Impact | Mitigation |
|------|--------|------------|
| Light shows over text or the panel | High | First child, no z-index; screenshot check |
| A moving child repaints the whole card layer | High | `will-change: transform, opacity` on the light while it moves |
| Masked edge copy costs a render surface | Low | Only the arriving card's light moves; idle ones are static and unlayered |

## Revision, 11 Nov (owner): timed, on arrival
"It shouldn't be based on scroll; it should happen as the card is fully shown and before the next one
comes." The light now plays once, on a 1.7 s timeline, the moment a card has landed with nothing over
it (on a tablet, where cards do not stack: once wholly on screen), and is re-armed once the card has
been covered or dropped back down. Web Animations, transform and opacity only, so it runs on the
compositor with no per-frame work; parts are layers only while they play. More detail: an entry
flare at the top-left, the main reflection (green wash, halo, warm-white core), a fainter second
reflection 170 ms behind, the 1px edge catching the light, and a glow left at the bottom-right.
Checked: no light while rising; plays on landing; a nudge while landed does not restart it; lands
again → plays again (desktop 1536×826 and phone 390×844); lint, typecheck, 114 design tests.

## Removed, 11 Nov (owner): "let's get rid of the animation that we did from left to right."
The light sweep (markup, trigger and styles) is gone from the feature cards; nothing else changed.
