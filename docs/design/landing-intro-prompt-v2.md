# Prompt v2: "The Data Highway", a 5-second 3D intro for the Insurvas landing page

A different approach from v1. v1 was a flat, title-card shot in which lines are drawn and gather into the logo. v2 is a **real-time 3D camera move**. We fly down a highway of light, watch one lead travel it from call to commission, then pull up and back to find that the highway's lanes *are* the Insurvas logo. The designer's name for the isotype is "Data Highway", so the intro tells the story the mark was drawn from.

Build it for `/` (the landing page). It plays once per browser session, lasts **5.0 s exactly (hard maximum)**, can be skipped, and ends by handing the camera to the hero.

## Story, in one sentence
A single lead, a point of green light, enters a dark-olive highway of streaming lanes. It passes four gates (the call, the checks, the policy, the commission), and the camera rises to reveal that every lane it rode is a band of the Insurvas mark.

## Brand (do not deviate)
- **Mark:** the isotype's exact paths, from `public/brand/insurvas-isotype.svg` (8 chevron bands and 10 slashes; already exported in `components/marketing/isotype-paths.ts`). The 3D lanes must resolve *exactly* onto these paths in the final top-down frame. Never approximate the logo.
- **Colours:** read from CSS tokens so the intro follows the theme: `--color-page-bg`, `--footer-bg` (olive ink), `--primary` (green `#07d6a0`, for light only), `--brand-100` (mint), `--accent-ink`.
  - The band gradient runs green → olive on light, and green → `#09af85` on dark. The slashes are `#0a8769`.
  - The scene's ground is the page colour, so the hand-off to the hero has no colour jump.
- **Type:** Montserrat, 11–12 px, medium, letter-spaced, used only for the four gate labels. No headline and no wordmark until the last 0.6 s (optional).
- **Mood:** calm, precise, expensive, like a luxury-car or fintech launch film. No neon, glitch, HUD clutter, lens-flare spam or speed lines on top of the image.

## The shot: 5.0 s, one unbroken camera
| Time | Beat | What the viewer sees | Camera |
|---|---|---|---|
| 0.0–0.6 | **Ignition** | The page colour. Far ahead, one green point of light (the lead) blinks on, and faint lane lines begin to stream toward the viewer out of the dark. | Low, nearly at road level, looking down the highway; still. |
| 0.6–2.6 | **The ride** | Eight lanes of light, ribbons with soft edges and a slow internal shimmer, stream past. The lead rides the centre lane ahead of the camera. It passes **four gates**, thin glass arches spanning the road, each lit as the lead crosses: `CALL CLAIMED`, `4 CHECKS · CLEAR`, `POLICY ISSUED`, `+$612 MATCHED`. Each gate flares green for 150 ms, then falls behind. | Follows the lead with slight lag; a gentle S-curve so lanes bend left then right; subtle roll (±2°). Speed eases up through the ride. |
| 2.6–3.6 | **The rise** | The lanes split into their eight chevron bands, and the road turns out to be shaped like the mark, bending through the logo's W. The lead reaches the end of the last band and becomes one of the ten slashes; the other nine settle in beside it. | Cranes up and back (dolly out plus tilt down) from road level to almost top-down. Depth of field narrows, then opens. |
| 3.6–4.3 | **The mark** | Seen from above, the lanes lock onto the exact isotype paths and fill with the band gradient. One soft specular sweep crosses it, and a quiet bloom sits behind it. Optional: "insurvas" fades in below, 12 px, spaced. | Top-down, still, with a micro push-in (1.00 → 1.03). |
| 4.3–5.0 | **The hand-off** | The mark shrinks and glides to the top-left corner, landing exactly on the nav logo's position and size, as the scene's ground dissolves to reveal the hero. The hero's ribbon is already flowing, and the headline begins rising at 4.6 s. | Locked; only the mark moves (FLIP to the nav logo's bounding box). |

Easing:
- Camera moves use an ease-in-out cubic (`cubic-bezier(.65,0,.35,1)`), never linear.
- Arrivals use expo-out (`cubic-bezier(.16,1,.3,1)`).
- The mark's flight to the nav uses a spring-like ease (`cubic-bezier(.34,1.2,.64,1)`), with at most 3% overshoot.

## What makes it cinematic
- **One camera, no cuts.** Everything happens through camera motion: track, crane, settle.
- **Depth:**
  - real perspective (fov 35–40);
  - lanes fade with distance (exponential fog to the page colour);
  - a post-process bokeh or depth-of-field pass, or cheap fake DOF: blurred duplicate lanes at distance.
- **Light:**
  - lanes are self-lit with a soft, additive core;
  - the gates are glass, with Fresnel edges plus a faint reflection;
  - a single bloom pass (threshold high, strength low);
  - 3–4% film grain and a light vignette in a final screen pass.
- **Motion texture:** a slow shimmer travelling along each lane (shader UV scroll), so the road feels alive even when the camera is still.
- **Restraint:** one subject (the lead), four beats of story, one reveal. The labels are the only text and stay small.
- **Sound:** none. It must work muted.

## Technical
- **Engine:** three.js (already installed, v0.180). Reuse the project's `components/marketing/three/stage.ts` conventions: DPR ≤ 1.75, pause when hidden, dispose everything on exit, and colours from CSS tokens.
  - Lanes: `TubeGeometry` or extruded ribbons along curves sampled from the isotype paths, lifted into 3D for the ride and morphed to flat for the reveal (interpolate the vertex positions between "road" and "logo" layouts).
  - Gates: thin `TorusGeometry` or arch-shaped extrusions with a Fresnel shader.
  - Labels: SDF text or small canvas textures on planes.
  - Post: `EffectComposer` with `UnrealBloomPass` plus a custom grain/vignette pass. If post-processing costs more than 4 ms a frame, drop to bloom-less additive blending.
- **Never blocks the page:**
  - The overlay paints instantly from CSS as a still first frame (page colour plus the lead's point of light), so LCP is never waiting on WebGL.
  - Lazy-load the three.js chunk with high priority.
  - If WebGL is unavailable or the scene isn't ready by **700 ms**, play the existing CSS intro (v1, 3.2 s) instead, and never stack the two.
  - If the main thread stalls, the overlay still removes itself at 5.0 s on a CSS timer.
- **Once per session:**
  - Gate it on `sessionStorage` with the inline pre-paint script already in `components/marketing/landing-intro.tsx` (`html.intro-seen` / `html.intro-done`).
  - Keep the client fallback for client-side navigation (`landing-intro-gate.tsx`).
- **Hero timing:** the hero waits through `--intro-delay`. Set it to 4300 ms for this intro, and 0 when the intro is skipped or has already played.
- **Skip:** a click, key press, wheel or touch jumps straight to the 4.3 s hand-off (the hand-off always plays, so the logo still lands in the nav). Show a quiet "Skip" text button in the bottom-right after 1 s: 12 px, `--muted-foreground`, focusable, Esc also skips.
- **Accessibility:**
  - `prefers-reduced-motion: reduce` means no intro.
  - The overlay is `aria-hidden` except the Skip button.
  - Nothing traps focus or scroll.
- **Performance budget:**
  - 60 fps on a 2020 MacBook Air and a mid-range Android.
  - At most 150 k triangles, at most 3 draw-call groups for lanes, and one post pass.
  - Under 60 KB gzipped of new code (three.js itself is already a dependency).
- **Responsive:**
  - On phones the camera's fov widens and the ride is 0.4 s shorter, with the time given to the reveal.
  - The final mark is 120 px on phones and 168 px on desktop before its flight to the nav.
- **Themes:** correct in light (page `#f2f5f4`-ish, olive lanes with green cores) and dark (near-black olive page, mint-green lanes).

## Done when
- From a cold load it plays once and is gone by 5.0 s; a reload in the same tab shows the page instantly; a new tab plays it again.
- The top-down frame at 4.0 s overlays `insurvas-isotype.svg` pixel for pixel (check with a 50%-opacity overlay of the SVG).
- The logo's flight ends exactly on the nav logo: same position and size, with no jump when the overlay leaves.
- Skip works by click, key, wheel, touch and the Skip button, and still lands the logo in the nav.
- No WebGL → the CSS intro plays. Reduced motion → no intro. Dark mode, a 375 px phone and a 1440 px desktop are all checked.
- DevTools Performance shows no long tasks over 50 ms after the scene starts, and Lighthouse LCP is no worse than with no intro.
