# Todo: corner cue on the hero laptop + a tidier nav bar (Artin, 11 Nov)

Source: [../manager-transcript-2026-11-11.md](../manager-transcript-2026-11-11.md) — the full call
transcript, what he asked for, and the open questions.
Branch: `redesign/landing-feature-cards` (these are fixes to the same round he was reviewing).
Revert: `git checkout -- components/marketing/landing-device.* components/public/site-header.tsx`

## Task 1: The resting cue moves into the laptop's top corners

**He asked for:** something in the top-right *and* top-left corners saying "something's going on
here"; it must hold rather than "fade away instantly"; it must not "cover any part of the
dashboard"; and he suggested "a curved arrow with an animation… pointing to the dashboard".

- [x] Brackets on both top corners of the bezel, outside the screen (the left one never touches the
      app logo — Rion's objection on the call)
- [x] A label, "Pick a page to explore", above the right corner
- [x] A curved arrow drawing from under the label down to the bezel, tip 8px below the device's top
      edge so it points into the screen without crossing it
- [x] One 3.6s cycle for all of it — brackets and arrow move together, the label holds still. The
      first sketch had seven competing hints on three unsynchronised loops; cut to one grammar.
- [x] The chip that trails the pointer now rests in that same corner and is only ever shown on
      hover, so the two read as one object. It used to wait visible over the middle of the screen —
      the "covering the dashboard" he objected to.
- [x] Off on touch and below 900px (the page tabs do that job); still and finished under reduced motion

**Files:** `components/marketing/landing-device.tsx`, `landing-device.module.css`

## Task 2: The nav bar

**He asked for:** remove a section ("maybe a roadmap"), place them more neatly, reduce the distance
between them, keep them readable.

- [x] Roadmap out of `NAV`. The page is untouched and keeps two ways in: the landing roadmap band's
      "See the full roadmap →" and the footer's Product column.
- [x] `max-w-2xl … justify-evenly` → a content-width group, `justify-center`, `gap-1`, link padding
      `px-4` → `px-3`. The old box was a fixed 672px wide whatever the labels were, so the gaps were
      arbitrary — the scattered look he kept circling.

**Files:** `components/public/site-header.tsx`

## Task 3: The cue moves up near the header (owner, 12 Nov)

"Can we put this more near the navbar."

- [x] The label rises out of the laptop's corner, and the arrow grows into a long sweep back down to
      it (53×100 box → 87×166 from 1240 up). The box keeps the viewBox's 0.525 aspect at both lifts,
      so the curve scales rather than stretching.
- [x] **It sits above the laptop's top-LEFT corner** (owner's call, 12 Nov, after a first pass put it
      top-right: "I said for this to bring it more near the navbar, not more far"). The arrow is
      mirrored to sweep down-right into the screen, the label's icon points right, and the trailing
      chip now rests in that corner too.
- [x] How high it can go is set by whichever of the headline and the sub-line reaches furthest left
      at that width — both are centred. 104px of lift clears the sub-line below 1240; from 1240 up
      the sub-line no longer reaches and it rises to 170px, which leaves 37–48px under the headline.
- [x] Checked at 1536, 1440, 1366, 1280, 1240, 1100 and 960: the label and the arrow miss the
      headline, the sub-line and the header at all seven, the arrow starts below the label, its tip
      stays above the screen, and nothing overflows.
- [x] Hover handoff still right from the new corner: the cue goes to opacity 0 and the chip takes over.

**Why it is not higher:** the headline is centred and wide, so above ~170px of lift the label runs
under its left end. Going higher would mean pushing the label outside the laptop's box, which
overflows the viewport below about 1400px. 170px is the ceiling that holds at every width.

## Task 4: The life and health band's horizon (owner, 12 Nov)

"This line that separates the floor from the lights looks so fake."

There were **four** separate edges stacked at that height, each one a layer at full brightness on its
own boundary. Fixing one at a time just revealed the next, which is why it took three passes.

- [x] **The floor's fade** was authored on `.floor`, which carries `perspective(700px)
      rotateX(60deg)`. A mask on a transformed element is measured in that element's own space, and
      the rotation compresses nearly its whole height into the last few pixels before the far edge —
      so the gradient had no room to resolve and the floor stopped dead. Moved to a new,
      untransformed `.floorStage` wrapper, where it is measured in screen pixels.
- [x] **The floor's own far edge** still showed faintly through that mask: the plane ran out at ~27%
      up the frame while the mask only reached transparent at 30%, so ~13% of the edge was passing.
      `.floor` is now `height: 200%` (150% on a phone), which puts the edge well above where the
      mask has already zeroed. The extra depth is free — it converges to nothing.
- [x] **The shafts** were one box each, brightest along the very bottom edge
      (`radial-gradient(… at 50% 100%)`) and then simply ending at `bottom: 28%`. That is the line
      itself: every beam cut across its own brightest point. Split into `.shaft` (peaks at 85%, with
      a mask taking it to nothing before the element ends) and `.pool` (the light landing on the
      floor), plus a reflection smeared forward over the grid.
- [x] **`.horizon`** was a 96%-wide flat ellipse lighting the full width to nearly one brightness,
      with a crisper top than bottom. It had been added on 10 Nov to cover an earlier line and
      became one itself. Deleted: the light at the far end now comes only from where the shafts land.
- [x] Caught the same mistake one layer down in my own reflection — its gradient was centred
      `at 50% 0%`, brightest exactly on its top edge — and moved the peak inside the box.
- [x] Both scenes get it ("Then" and "Now" share `Scene`); phone beam offset follows the shallower floor

## Task 5: The floor goes; the background becomes an aurora (owner, 12 Nov)

After all of the above the owner still did not like it, and asked for a background from the
components other people publish — "cool background with animations… professional… that makes sense".

- [x] Searched. The technique the aurora backgrounds on [Aceternity
      UI](https://ui.aceternity.com/components/aurora-background) and
      [superdesign.dev](https://superdesign.dev/styles/aurora) use: wide colour sweeps blurred far
      past the point where any stop survives as an edge, moved by `transform` only, over a dark
      base, with a reduced-motion guard. Both are copy-paste, not packages.
- [x] Built from that, in brand colours, as CSS. **No new dependency** (the spec requires asking
      first, and nothing here needs one — not even the `three` and `animejs` already in the project).
- [x] The floor, the grid, the shafts, the pools and the reflections are **all deleted**. The band's
      background is now two drifting ribbons of light. This is the real answer to three rounds of
      "it looks fake": every version of the floor had geometry in it, and geometry has edges. Light
      with no shape has nothing to catch on.
- [x] First attempt used a conic sweep, as superdesign does, and it was wrong here: blurred enough
      to have no edge, a conic has no shape left either, and the band came out a flat green wash.
      Each ribbon is now three nested ellipses — pale crest, green body, deep halo — squashed flat
      and tilted, which keeps the streak through the blur.
- [x] The story survives: "Then" one ribbon, quiet; "Now" two, the second mint for the health lines.
- [x] A scrim under the words, so the headline's contrast does not drift with the light
- [x] Narrower blur on phones; ribbons hold still under reduced motion; they drift only while the
      band is on screen

**Measured, not eyeballed.** A seam is a *sustained* step in brightness, where the rows above sit at
one level and the rows below stay at another — unlike a grid line, which is a 2px spike that returns.
Comparing the median of the 14 rows above each row with the 14 below, through the zone the owner
circled, middle 50% of the width so the "NOW" pill and the slider knob cannot skew it:

| | typical step | largest | |
|---|---|---|---|
| Desktop, original | 9.54 | 23.77 | 2.5x typical |
| Desktop, floor rebuilt | 3.21 | 9.62 | 3.0x |
| Desktop, **aurora** | **1.51** | **1.96** | **1.3x — nothing edge-like left** |
| Phone, original | 31.20 | **225.38** | a real seam |
| Phone, floor rebuilt | 3.42 | 8.88 | |
| Phone, **aurora** | **1.38** | **1.64** | **1.2x** |

The largest step barely exceeding the typical one is the point: it means no row anywhere in the band
stands out from its neighbours, which is what "no line" actually means.

Caveat on the method: the pass/fail *label* in that script is ratio-based and too lenient — it
called the desktop original "smooth" because everything in that zone was uniformly steep. The
absolute numbers are the signal.

## Task 6: The cove (owner, 12 Nov)

The owner sent [Framer's Covelight Shader](https://www.framer.com/marketplace/components/covelight-shader/)
and asked for that animation in both scenes.

- [x] Looked at the live demo rather than the listing, and switched it to its **Aurora** palette,
      which is the green one — the closest read on how it behaves in our colours. The picture is a
      *cove*: trails come down a back wall, turn at the join with the floor, and fan out towards the
      reader from a vanishing point, all heavily bloomed on near-black.
- [x] Built in `components/marketing/cove-light.tsx`. **It is not their code** — Covelight is a paid
      component with its own GLSL. This is the same picture written here.
- [x] **Canvas 2D, not WebGL.** `three` is in the project, so a shader was available, but the whole
      image is strokes along a path: a `Path2D` per trail, `setLineDash` + `lineDashOffset` to run
      the lit segment along it, and three passes (wide faint halo, mid body, thin core) composited
      with `lighter` for the glow. Cheaper than a shader or a blur filter, and far easier to read.
- [x] "Then" runs 27 trails in the two greens; "Now" 46, reaching the pale crest — the business grew
- [x] Paused off-screen by its own `IntersectionObserver`; one static mid-travel frame under reduced
      motion (verified: the canvas draws, and two reads 1.5s apart are identical)
- [x] Replaces the aurora ribbons, which replaced the lit floor

**Two deliberate departures from the reference, both worth knowing:**

1. **Density and brightness are pulled well back.** The original is dense, full-neon, and carries no
   type. This band carries a headline, two rows of chips, a tag and a slider. At the reference's
   density the headline is unreadable, so the trails dim towards the sides, dim again the higher
   they climb the wall (which is also how distance reads), and the join sits at 0.66 of the frame —
   below the chips — so the brightest part of the picture and the words keep out of each other's way.
2. **The palette is the brand ramp, not blue and orange.**

**One thing the ratchet caught and was right about.** The first version named its greens as hex in
the component, and `uiConsistency` §9 failed: a component names no colour. The tones moved to tokens
read with `getComputedStyle` at paint time, so the background follows the brand if the brand moves.

**Superseded by Task 7.** `cove-light.tsx` is deleted — the project's `no component is orphaned`
test does not allow a component nothing imports, which is the right call.

## Task 7: Particles Waves, and the cue lower (owner, 12 Nov)

The owner sent [Framer's Particles Waves](https://www.framer.com/marketplace/components/particles-waves/)
and asked for it in both scenes, and separately for the hero's cue to sit lower.

- [x] **The cue** drops from a 170px lift to 90px, where the owner drew it — in the clear gap rather
      than level with the sub-line's text. 90px clears the headline and the sub-line at every width
      from 960 up, so the 1240px breakpoint that carried the taller lift is gone: one value now.
- [x] **The background** is `components/marketing/particles-waves.tsx`. Again **not their code** —
      it is a paid component; this is the same picture built here. A grid of points on a sheet, the
      sheet warped by three travelling sine waves, projected through a pinhole camera with the
      horizon high in the frame so the crowded far edge sits above the headline.
- [x] Depth of field is the heart of it, and it is done with sprites: a soft disc pre-drawn once per
      tone per blur step, then `drawImage`d at the size the projection asks for. Blurring thousands
      of points a frame with a filter is not affordable. Energy spreads as a point blurs, so blurred
      sprites are drawn dimmer as well as wider, composited with `lighter`.
- [x] "Then" is the smaller field in one green; "Now" is denser and reaches the pale crest
- [x] Colours are `--wave-1/2` on `.field` → `--brand-500/100`, read back through a 1×1 canvas so
      any CSS colour notation resolves. Zero hex in the component (§9); `hex-colour` back to 27.
- [x] The sheet stops short of the frame's sides — covering the full width at the far edge would
      take ten times the points — so `.field` fades its edges rather than letting them end on a line
- [x] Reduced motion: one frame of the wave, held (verified: drawn, and two reads 1.5s apart match)

**Performance, measured rather than assumed.** The first density ran at 15fps. Benchmarking
`drawImage` directly showed cost scales with both the number of points and sprite *area*, and that
`lighter` was only ~18% of it — so the fix was fewer and smaller points, not different blending:

| | ms/frame |
|---|---|
| 2500 points, radius 24, `lighter` | 63.7 |
| 2500 points, radius 24, `source-over` | 53.9 |
| 2500 points, radius 10 | 31.6 |
| 2500 points, radius 4 | 18.8 |

That drove a per-depth stride (the far half of the sheet was most of the work and is the part you
cannot tell apart), a nearer `Z_NEAR`, a smaller max radius and a 1.35 DPR cap.

**It also adapts.** `thin` watches the rolling frame time and skips more of the sheet if the machine
cannot keep up, settling in about a second. Isolated measurement, with the band off screen and on:

| | fps |
|---|---|
| page with the field off screen (paused) | 57–59 |
| field on screen, before it adapts | 15–20 |
| field on screen, after it settles | 26–38 |

**These are software-rendered numbers.** Headless Chromium has no GPU, and the run-to-run spread
above shows how noisy it is under load. On real hardware this should sit at 60; I cannot measure
that from here, which is exactly why the density adapts instead of being a number I guessed.

**Superseded by Task 8** — this was the wrong component. See below.

## Task 8: Particle Wave Shader, the right one (owner, 12 Nov)

Task 7 built Framer's **Particles Waves**. The owner meant
[**Particle Wave Shader**](https://www.framer.com/marketplace/components/particle-wave-shader/) —
"The thing you have done is not like this at all." Different component, different picture.

- [x] Looked at the live demo. It is already green, which suits the brand. The thing that makes it
      is **not the particles — it is the line hanging from every one of them.** Thousands of thin
      vertical strokes under a rolling ridge read as a curtain; the dots riding on top read as the
      surface. A field of dots alone, which is what Task 7 built, is a different thing entirely.
- [x] Rebuilt as a heightfield landscape under a low camera, with the ridge against a black sky
- [x] "Now" is **more glowy**, as asked: a second wider, fainter pass under every line, brighter
      dots. "Then" has neither, and fewer rows and columns.
- [x] Drawn per depth row **and per colour band**, not per particle — one `Path2D` and one
      `stroke()` for a few hundred lines at a time
- [x] 114 design tests, typecheck and lint clean; reduced motion verified (one frame, held)

**Three measurements shaped it**, taken against `stroke` directly rather than guessed:

| | ms/frame |
|---|---|
| 64 rows × 168, **gradient** stroke, `lighter` | 314.7 |
| 64 rows × 168, **solid** stroke, `lighter` | 113.1 |
| 64 rows × 168, gradient, `source-over` | 311.7 |
| 64 rows × 168, solid, `beginPath` not `Path2D` | 110.4 |
| 64 rows × 168, solid, **80px drop** not 300px | 36.9 |

So: a `CanvasGradient` as the stroke costs **three times** a solid one — which is why the palette is
bands rather than a sweep. Line length is the other multiplier, and an unclamped drop here is over a
thousand pixels with most of it off the canvas, so it is capped and clipped. `lighter` versus
`source-over`, and `Path2D` versus `beginPath`, cost nothing either way — worth knowing, since both
would have been tempting things to blame.

**The thinning now drops depth rows, not columns.** The first version thinned columns and gutted the
curtain — it reads as a curtain precisely because its lines are close side by side. Neighbouring
depth rows overlap on screen, so losing one is nearly invisible. Same cost saved, far better picture.

| | fps (software) |
|---|---|
| page with the band off screen (paused) | 59 |
| band on screen, before it adapts | 9 |
| band on screen, after it settles | 22 |

**Still software-rendered, and this picture is expensive in software** — the reference is a GPU
shader and would crawl here too. On the owner's Chrome with a GPU it should run at full density.
That is unverified from this machine, which is why it adapts rather than shipping a guessed number.

**Superseded by Task 9.** Everything in that last paragraph turned out to be wrong-footed: see below.

## Task 9: WebGL, measured against the reference (owner, 12 Nov)

"The design of this is not the same at all." Two separate things were going on.

**1. The owner was looking at a stale build.** Their screenshot showed Task 7's dot field while disk
held Task 8. My own dev server had been stopped by the app; Next 16 allows one `next dev` per folder,
so the owner's own server on :3000 (PID 37028) is the one to use — left running, not killed. Checked
that it serves the current code by grepping the served chunks for markers from each version.

**2. Even the current build was not the reference.** Captured both at 1536×826 with the same tool:

| | Reference | Task 8 |
|---|---|---|
| Sky | rgb(3 8 3), flat | dark teal gradient + green glow |
| Ridge | 0.396 of the frame | ~0.85 |
| Lines | hang to the bottom, dense curtain | capped short |
| Light | bright dots, bright seams | dim, thinned |

- [x] **Rebuilt in WebGL** (`particles-waves.tsx`). The landscape lives in the vertex shader; JS
      uploads the grid once and sends the time each frame; lines and particles are one draw call
      each. Canvas 2D measured 110–314ms a frame for this, which is why every earlier version had to
      be capped short, dimmed and thinned. No dependency — raw WebGL, not `three`.
- [x] **Sky, palette and ridge sampled from the reference's own pixels**, not guessed: sky
      rgb(3 8 3); the median hue of single lit particles left→right 87°/104°/134° → lime
      rgb(188 255 105), green rgb(153 255 118), spring green rgb(100 255 137); ridge at 0.396.
      **This leaves the brand ramp** — the brand green is 164°, teal-er than anything in the
      reference. **Owner's call, 12 Nov: keep the reference greens.**
- [x] **Tuned against measured brightness**, mean / p90 / p99 luminance of curtain and ridge vs the
      reference. Each round found a cause rather than a fudge: point size was dimensionally wrong
      (`u_point * f/z` → `u_point / z`); one depth fade for lines and particles was wrong (lines
      overlap ~15 deep and must fade hard, particles barely overlap and must not); 270 columns ran
      the lines into a haze (the reference's front row is ~48px apart → 172); the hills were flat
      (a world unit is ~36px at the ridge but ~300px at the front, so relief now calms towards the
      camera); the band's `.grain` laid 5% white noise over everything — the haze — and is now a
      vignette only; and lines fade steeply along their length so light sits at the ridge.
- [x] Final, curtain / ridge p99: 135 / 138 against the reference's 166 / 141.
- [x] "Now" glows (a soft halo pass under every particle, brighter lines); "Then" is dimmer and sparser
- [x] **Performance on the real GPU: 54 fps with the band on screen, 59 off — about 1.5ms a frame**
      on the owner's AMD Radeon 780M. Every earlier figure in these notes was SwiftShader (headless
      Chromium's CPU fallback) — see memory `headless-browser-needs-gpu-flags`.
- [x] Reduced motion verified properly: one frame drawn and held (0.00% of pixels change in 1.5s;
      4.6% change with motion on). The earlier check used `toDataURL`, which reads back blank on a
      WebGL canvas — it proved nothing.
- [x] **Line endings: three files had been flipped LF → CRLF by my own scripts** (Python
      `write_text` on Windows), and my earlier "matches HEAD" reports were wrong — the `grep` check
      miscounted. All restored to LF; `numstat` now identical with and without `--ignore-cr-at-eol`.
- [x] 114 design tests, typecheck, lint clean; zero hex in the component (§9)

**Files:** `components/marketing/landing-lines.tsx`, `landing-lines.module.css`

## Checkpoint

- [x] Lint clean; typecheck clean for all source files (the only errors are in `.next/dev/types/*`,
      written by the running dev server while tsc reads them)
- [x] 114 design tests pass
- [x] `npm test`: 4043/4063 pass. The 20 failures are **pre-existing** — identical counts with these
      three files stashed. `lib/transferInbox/statusSeek.test.mjs` is a CRLF/LF mismatch in a SQL
      file, unrelated to this work.
- [x] `git diff --stat` sane on all three files; no line endings flipped
- [x] Checked at 1536×826 (the owner's screen) and 1280×800, light and dark, hover, reduced motion
      and 390×844
- [ ] Owner review on localhost:3000, then commit with the rest of the round and open the PR

## Still open (from the call — see the transcript's "Open questions for Artin")

- Google Analytics: he is sending the code. Nothing done here.
- How long the cue should hold is a judgement call, not his: it holds until a mouse arrives or a
  page is chosen, then stays gone for the visit.
- He said both corners; Rion objected to the left. Resolved by putting both *outside* the screen,
  so the left bracket never meets the logo — worth confirming that reading with him.
