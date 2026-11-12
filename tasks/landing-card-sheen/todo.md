# Todo: Feature-card light sweep

## Task 1: Light element and styles
**Acceptance:** each card has a `.sheen` (band + edge ring) as its first child, invisible at rest,
under the copy and the workflow panel.
**Verify:** screenshot with the band forced mid-card: text and panel unchanged on top.
**Files:** `components/marketing/landing-bento.tsx`, `components/marketing/landing-features.module.css`
- [x] Done

## Task 2: Scroll-driven sweep
**Acceptance:** as a card rises to land, its light crosses top-left → bottom-right, fading in and out;
reverses on scroll up; no light on a landed or covered card; off under reduced motion; only
transform/opacity written, only when changed; layer only while moving.
**Verify:** lint, typecheck, `node --experimental-strip-types --test lib/design/*.test.mjs`;
screenshots mid-sweep at 1536×826 and 390×844; layer count at rest no higher than before.
**Files:** `components/marketing/landing-bento.tsx`
- [x] Done

## Checkpoint
- [x] All checks pass (lint, typecheck, 114 design tests, screenshots desktop + phone); owner reviews on localhost:3000
