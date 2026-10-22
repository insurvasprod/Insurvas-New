# Prompt: a cinematic loading intro for the Insurvas landing page

Build a cinematic loading intro for the Insurvas landing page (`/`). It plays once per browser session, before the hero, and lasts **3.2 s (hard maximum 3.5 s)**. It should feel like a film title sequence: confident, quiet and expensive. It should not feel like a spinner. It ends by handing over to the hero, so the lines that formed the logo seem to become the hero's flowing ribbon.

## Brand (do not deviate)
- **Product:** Insurvas, a CRM for life and health insurance agencies and call centers that buy leads. The idea behind the motion is *a stream of leads and money resolving into one clear mark*.
- **Mark:** the Insurvas isotype ("Data Highway"). It is 8 stacked wave/chevron bands and 10 small slashes, taken from `public/brand/insurvas-isotype.svg` (viewBox `69.58 412.35 259.77 259.77`; paths already exported in `components/marketing/isotype-paths.ts`). Use these exact paths; never redraw or approximate the logo.
- **Colours:**
  - Light theme: deep olive ink `#0d4037` and brand green `#07d6a0` (green is for light and action only, never large fills). The band gradient runs `#07d6a0 → #0d4037`, and the slashes are `#0a8769`.
  - Dark theme: the page is `#08110f`, and the bands use the on-dark gradient `#07d6a0 → #09af85`.
  - Read colours from CSS tokens (`--color-page-bg`, `--primary`, `--accent-ink`, `--footer-bg`) so it follows the theme.
- **Type:** Montserrat. Show no text at all, or at most the wordmark "insurvas" for its final 0.6 s.
- **Tone:** light-first and editorial, with no neon, glitch, particles-everywhere or sci-fi HUD.

## The sequence: five beats on one continuous camera
1. **0.00–0.45 s, the field.**
   - The screen holds the page colour, with a faint radial vignette darker at the edges.
   - A single hairline of green light ignites far off-centre, the way a lens flare starts. Nothing else.
2. **0.30–1.30 s, the stream.**
   - Seven to nine silk ribbons sweep in from the left and right edges on curved paths, drawn as they travel (stroke-draw).
   - They are thin at the tips and swell in the middle, and they sit at different depths:
     - near ribbons are thicker, faster and slightly blurred (fake depth of field);
     - far ribbons are thinner, slower and lower contrast.
   - The whole field drifts in a slow push-in (scale 1 → 1.06) for parallax.
   - Every ribbon's path passes through the screen centre.
3. **1.10–1.90 s, the convergence.**
   - The ribbons tighten toward the centre line and thin out, while the mark's eight bands are traced as outlines from the bottom band up, 70 ms apart.
   - The outline uses the band's own gradient. Ribbons and bands should read as the same light being gathered: match their stroke weight and colour where they meet.
4. **1.80–2.50 s, the reveal.**
   - The bands fill and the outlines dissolve into the fill.
   - The ten slashes snap in with a tiny overshoot, 35 ms apart.
   - One specular light sweep crosses the mark diagonally (a soft white band at about 20% opacity, masked to the logo shape) as the "title card" moment.
   - A single ring ripples outward from the mark and fades.
5. **2.50–3.20 s, the handover.**
   - The mark eases forward (scale 1 → 1.12) and fades out, and the background lifts away.
   - Behind it, the hero ribbon is already fading in on the right and the headline starts to rise. It must feel like one continuous shot (a match cut), never like a curtain dropping.

Easing:
- Entrances use `cubic-bezier(.16,1,.3,1)` (expo-out).
- Transforms that travel across the screen use `cubic-bezier(.65,0,.35,1)`.
- Nothing bounces except the slashes' 4% overshoot.

## Cinematic details that make it premium
- **Camera:** a slow continuous push-in across the whole sequence. Avoid hard cuts.
- **Depth:** three ribbon layers with different speed, weight, blur (0, 1 px, 2.5 px) and opacity.
- **Light:**
  - a soft bloom halo behind the mark at its brightest moment (radial gradient of `--primary` at 15–20%);
  - a gentle film-grain overlay at 3–4% opacity;
  - a subtle vignette.
- **Rhythm:** stagger everything (ribbons 45 ms, bands 70 ms, slashes 35 ms) so it reads as choreography, not as a single fade.
- **Restraint:** one hero moment, the light sweep plus ripple. No spinning, no 3D flip of the logo and no loading bar.
- **Sound:** none. It must work muted.

## Technical constraints
- **Implementation:** CSS and inline SVG (stroke-dasharray with `pathLength="1"`, CSS keyframes). Optionally a small WebGL pass for bloom or grain, only if it costs under 2 ms a frame. Animate only `transform`, `opacity`, `stroke-dashoffset` and `filter` on small elements, at a sustained 60 fps on a mid-range laptop.
- **Runs in CSS:** the timeline is pure CSS, so it plays from first paint without waiting for hydration. If JavaScript fails, the overlay still fades and becomes click-through on its own by 3.2 s (`animation-fill-mode: forwards` to `opacity: 0; visibility: hidden; pointer-events: none`).
- **Once per session:**
  - A tiny inline script checks `sessionStorage` before first paint: if the intro has already played this session it adds `html.intro-seen` and the overlay is never shown; otherwise it sets the flag and adds `html.intro-done` at 3.3 s.
  - A client fallback covers arriving at `/` by a client-side link.
- **Hero hand-off:** the hero's entrance waits through a CSS variable (`--intro-delay`): 2600 ms on a first visit, 0 otherwise.
- **Skippable:** any click, key press or scroll during the intro jumps it to its last 300 ms.
- **Accessibility:**
  - `prefers-reduced-motion: reduce` means no intro and the page shows immediately.
  - The overlay is `aria-hidden`, nothing in it is focusable, and it never traps scroll for longer than the intro.
- **Themes:** correct in light and dark, with the band gradient switching to the on-dark stops.
- **Sizes:** the mark is 168 px on desktop and 120 px on phones. The ribbons cover the viewport at any aspect ratio (`preserveAspectRatio="xMidYMid slice"`).
- **Weight:** no new dependencies, no images or video. The added CSS and SVG stay under 15 KB.

## Done when
- From a cold load it plays once in ≤3.2 s; a reload in the same tab shows the page instantly; a new tab plays it again.
- Paused frame by frame (DevTools → Animations), every beat above is visible and readable, and the logo's final frame matches `insurvas-isotype.svg` exactly.
- The last frame of the intro and the first frame of the hero are continuous, with no flash, jump or blank frame.
- It holds 60 fps with no layout shift, and Lighthouse LCP is no worse than without it.
- Reduced motion, a 375 px phone and dark mode are all checked.
