"use client";

import { useEffect, useRef } from "react";

/**
 * `WaveGradient`: a fluid, organic gradient. Four colours are folded into one another by a slow
 * noise field that is warped by itself twice over, so the bands bend and swell the way poured ink
 * does, never settling into a shape you can name. Drawn with WebGL.
 *
 * The owner asked for Framer's New Wave Gradient, exactly (12 Nov). That is a paid component with
 * its own shader; this is not its code — it is the same picture, rebuilt here from its demo. What
 * makes it read as that picture rather than a blurred CSS gradient:
 *
 * - **Domain warping.** The field is sampled at a position the field itself has already moved
 *   (twice: `q`, then `r`). One pass of plain noise gives soft blobs; the second and third fold the
 *   bands back over each other, and that is where the organic, liquid shapes come from.
 * - **Mixing in linear light.** Deep green to cream mixed in sRGB passes through a dead grey. The
 *   ramp squares the colours, mixes, and takes the root back, so the crossing keeps the luminous
 *   sage the reference has.
 * - **A dither of half a level.** Over a band this wide a smooth ramp shows stair-steps on an
 *   8-bit screen, worst in the dark greens. Static hash noise breaks them up and is itself invisible.
 *
 * It renders at a fraction of the screen's pixels and is scaled back up by the browser: nothing in
 * a picture this soft survives to the pixel anyway, and two of these run at once behind the band's
 * slider, so the saving is most of the budget.
 *
 * Colours come from tokens on the host element — §9 of the UI standard is that a component names no
 * colour — read back through a 1x1 canvas so any CSS colour notation resolves. Everything that is
 * not a colour (how fast, how far it folds, how often the pale crest shows) is in `LOOK`, per side.
 *
 * Before this the band ran a field of particles on an undulating plane — Framer's Particle Wave
 * Shader, rebuilt the same way (`particles-waves.tsx`, in the history) — and before that a lit
 * sales floor in perspective, blurred ribbons, and a field of dots.
 */

/** Where this field is running. The landing band is one picture in two states; the auth
 *  panel is the same field on the sign-in door (owner, 12 Nov: "a theme that suits
 *  everything in this SaaS"). */
export type WaveLook = "then" | "now" | "auth";

const TOKENS = ["--wave-1", "--wave-2", "--wave-3", "--wave-4"] as const;

/**
 * What tells the two scenes apart, beyond their colours (owner, 12 Nov: "differentiate them a
 * bit"). "Then" is the floor as it was, on life alone: a tighter field, slower, folding less, and
 * the pale crest at the top of its ramp is rare — `gamma` above 1 holds the whole field down the
 * ramp. "Now" is the same place with a second line of business in it: broader bands, nearly twice
 * the folding, more movement, and a crest that actually shows (`gamma` under 1).
 *
 * The seeds are far apart on purpose. The scenes sit side by side under the slider, and two fields
 * from the same seed would echo each other across the divider.
 *
 * **The speeds are measured against the reference, not chosen.** Frames of each were captured five
 * seconds apart and compared as the mean change per pixel over the mean spread of the picture —
 * scale-free, so two different palettes can be held against each other. The reference comes out at
 * 0.40 over five steps; "Now" is set to sit at about that. Five steps matter: any single pair can
 * read anywhere from 0.13 to 0.55 on the reference itself, and an early reading from one pair sent
 * this chasing a number almost twice too high.
 */
const LOOK: Record<WaveLook, { seed: number; speed: number; travel: number; scale: number; warp: number; amp: number; tilt: number; gamma: number; hold: number; holdY: number; drift: number }> = {
  then: { seed: 11.3, speed: 0.35, travel: 0.12, scale: 1.1, warp: 0.6, amp: 0.38, tilt: 0.45, gamma: 1.25, hold: 0.85, holdY: 0.17, drift: 0.1 },
  now: { seed: 43.7, speed: 0.5, travel: 0.17, scale: 0.95, warp: 0.7, amp: 0.42, tilt: 0.45, gamma: 1.05, hold: 0.95, holdY: 0.17, drift: 0.16 },
  /* The door. The panel is tall where the band is wide, so the field is a shade larger in
     its own units and the hold sits high: Top set puts the words under the logo, not in the
     middle. No pointer parallax here — a form is a place people type, not a place they
     wave the mouse about. */
  auth: { seed: 43.7, speed: 0.5, travel: 0.17, scale: 0.9, warp: 0.7, amp: 0.42, tilt: 0.45, gamma: 1.05, hold: 0.95, holdY: 0.26, drift: 0 },
};

/** One triangle over the whole clip space; there is no geometry in this picture. */
const VERTEX = `
precision highp float;
attribute vec2 a_pos;
void main() { gl_Position = vec4(a_pos, 0.0, 1.0); }
`;

const FRAGMENT = `
precision highp float;
uniform vec2 u_res;
uniform float u_time;    // seconds the band has been on screen
uniform float u_speed;   // how fast the field morphs in place
uniform float u_travel;  // how fast the whole field slides across the frame, in frame-widths
uniform vec3 u_c0;
uniform vec3 u_c1;
uniform vec3 u_c2;
uniform vec3 u_c3;
uniform float u_scale;   // how large the bands are, against the short side of the frame
uniform float u_warp;    // how far the field folds back through itself
uniform float u_amp;     // how far one standard deviation of the field moves a pixel along the ramp
uniform float u_hold;    // how hard the ramp is capped over the words, 0 none, 1 flat at the cap
uniform float u_holdY;   // where that block sits, up from the middle of the frame
uniform float u_tilt;    // the weight of the diagonal the bands run along
uniform float u_gamma;   // over 1 holds the pale end back, under 1 brings it forward
uniform float u_seed;
uniform vec2 u_pointer;  // where the pointer is over the frame, -1 to 1, for the parallax

float hash(vec2 p) {
  p = fract(p * vec2(123.34, 456.21));
  p += dot(p, p + 45.32);
  return fract(p.x * p.y);
}

/* Value noise with a quintic fade: its second derivative is continuous, so the field has no seams
   where the cells meet — on a picture this soft a cubic fade shows them as faint creases. */
float vnoise(vec2 p) {
  vec2 i = floor(p);
  vec2 f = fract(p);
  vec2 u = f * f * f * (f * (f * 6.0 - 15.0) + 10.0);
  float a = hash(i);
  float b = hash(i + vec2(1.0, 0.0));
  float c = hash(i + vec2(0.0, 1.0));
  float d = hash(i + vec2(1.0, 1.0));
  return mix(mix(a, b, u.x), mix(c, d, u.x), u.y);
}

/* Three octaves, and the later ones are quiet: 0.6, then 0.23, then 0.09. At the usual halving the
   field grows filaments and curls, and the picture turns into green smoke — the reference has none
   of that, only broad folds. The 2.03 keeps the octaves off each other's lattice, so they never
   line up. */
float fbm(vec2 p) {
  float v = 0.0;
  float a = 0.6;
  for (int i = 0; i < 3; i++) {
    v += a * vnoise(p);
    p = p * 2.03 + 17.1;
    a *= 0.38;
  }
  return v;
}

vec3 toLinear(vec3 c) { return c * c; }

/* The four colours as one ramp, mixed in linear light (see the file's comment), with smoothstep on
   each leg so no stop announces itself as an edge.

   The stops are not even quarters. The two deep colours hold the floor of the picture, which is
   most of it, and the crest is the last fifth — in the reference the cream is one corner against a
   great deal of green, and even quarters put it across half the frame. */
vec3 ramp(float m) {
  m = clamp(m, 0.0, 1.0);
  vec3 col = mix(toLinear(u_c0), toLinear(u_c1), smoothstep(0.00, 0.34, m));
  col = mix(col, toLinear(u_c2), smoothstep(0.32, 0.80, m));
  col = mix(col, toLinear(u_c3), smoothstep(0.80, 1.00, m));
  return sqrt(max(col, 0.0));
}

void main() {
  // Two framings. The ramp runs along uv, which is the frame itself, so its sweep goes corner to
  // corner whatever the proportions; the field is sampled in p, square units, so the bands are
  // never stretched sideways by a band three times as wide as it is tall.
  vec2 uv = gl_FragCoord.xy / u_res - 0.5;
  vec2 p = (gl_FragCoord.xy - 0.5 * u_res) / min(u_res.x, u_res.y);
  /* Two kinds of movement, and the balance between them is the whole character of the thing.

     The field **slides** bodily across the frame — a mass crosses it in about ten seconds, as the
     reference's does — and **morphs** only slowly as it travels. Measured, that balance is what
     separates the two: with the morph carrying the motion instead, ours changed 1.6 times as fast
     as the reference over half a second but only three quarters as much over two, because it was
     boiling in place rather than going anywhere. Sliding accumulates; boiling saturates. */
  vec2 slide = vec2(-0.86, 0.5) * (u_time * u_travel);
  vec2 w = p * u_scale + vec2(u_seed, u_seed * 0.37) + u_pointer + slide;
  float t = u_time * u_speed;

  // Two warps. Each samples the field at a place the field has already moved, and the drifts pull
  // in different directions, so nothing in the picture travels in a straight line.
  vec2 q = vec2(fbm(w + vec2(0.11, -0.07) * t), fbm(w + vec2(3.7, 8.1) + vec2(-0.09, 0.06) * t));
  vec2 r = vec2(fbm(w + u_warp * q + vec2(1.7, 9.2) + vec2(0.06, 0.05) * t),
                fbm(w + u_warp * q + vec2(8.3, 2.8) + vec2(-0.05, -0.07) * t));
  float n = fbm(w + u_warp * r);

  /* **The field is what moves the picture, and it has to be the larger share of it.** An earlier
     pass made a fixed diagonal the bulk of the tone and let the field only ripple it; measured
     against the reference that capped the motion at a fifth of it however fast the field drifted,
     because four fifths of the tone was not moving at all. Here the field carries it and the
     diagonal is a bias — the reference's bright mass crosses the whole frame in ten seconds, and
     that is only possible if the composition itself travels.

     **The field is normalised first.** Raw fbm has a mean near 0.457 and about 0.142 of spread; its
     average over a frame this size wanders, and a frame can end up sitting inside one low cell of
     it — which is what once left the band flat and dark minutes in. Divided through by its own
     spread the picture keeps its range wherever it has drifted to. The other half of that fix is
     the scale: the frame spans a little over two cells of the field, so there is always a high and
     a low in view.

     The diagonal is not fixed either: it swings about 13 degrees over two minutes, and the ramp
     breathes up and down over three. Both read real seconds, not the field's clock, so making the
     field faster does not turn them into a pulse; their periods are prime-ish against each other
     and against the drift, so the picture never comes round to where it was. */
  float nn = clamp((n - 0.457) / 0.142, -2.2, 2.2);
  float ang = 0.73 + 0.22 * sin(u_time * 0.055 + u_seed);
  float axis = dot(uv, vec2(cos(ang), sin(ang)));
  float base = 0.46 + 0.07 * sin(u_time * 0.037 + u_seed * 0.5);
  float m = base + axis * u_tilt + nn * u_amp;

  /* The words sit in the middle of this band and the crest now travels anywhere, so over the block
     they occupy the ramp is given a ceiling. A ceiling, not a weight: anything already below it is
     left exactly as it is, so there is no permanent dark patch in the middle of the picture — and
     taking a fixed amount off instead is visibly one, a smudge sitting in the centre whenever the
     light moves off it. What this does instead is dim a crest as it crosses the words and let it
     come back up on the far side, which reads as the light passing behind them.

     Held down the ramp, note, not under a grey veil: the centre keeps the deep lit green of the
     picture's own palette, which an overlay cannot do.

     The shape is flat over the block and falls away outside it; the numbers are measured, not
     guessed. With the words hidden, the brightest 5% of what the headline sits on came out at
     2.5:1 before this. The headline runs about 0.23 either side of the middle and from 0.07 to
     0.31 above it, in these units.

     **The ceiling has to be high and gentle, or the band reads as a still picture.** Set at 0.50
     and nearly closed it flattened the middle of the frame into a dark, almost uniform patch: the
     centre changed 11 units every two seconds against the reference's 29, and since the middle is
     where anyone looks, the whole band looked frozen — the only motion left that a person could see
     was the parallax answering their own mouse. The cap is where it is because that is the most the
     centre can be allowed to move while white type still clears its contrast bar. */
  vec2 hv = (uv - vec2(0.0, u_holdY)) * vec2(0.9, 2.5);
  float reach = u_hold * (1.0 - smoothstep(0.30, 0.80, length(hv)));
  m -= reach * (0.18 + max(0.0, m - 0.56) * 0.75);
  m = pow(clamp(m, 0.0, 1.0), u_gamma);

  // Half a level of static dither: enough to break the stair-steps, too little to see.
  float d = (hash(gl_FragCoord.xy) - 0.5) / 255.0;
  gl_FragColor = vec4(ramp(m) + d, 1.0);
}
`;

/** Read a token through a canvas, so any CSS colour notation resolves to numbers. */
function rgbOf(value: string): [number, number, number] | null {
  const probe = document.createElement("canvas");
  probe.width = probe.height = 1;
  const pctx = probe.getContext("2d");
  if (!pctx) return null;
  // An unparseable value leaves `fillStyle` as it was, so a sentinel tells us whether it resolved.
  // A function rather than a hex literal: even a probe's colour is a colour named in a component.
  const sentinel = "rgba(0, 0, 0, 0)";
  pctx.fillStyle = sentinel;
  pctx.fillStyle = value;
  if (pctx.fillStyle === sentinel) return null;
  pctx.fillRect(0, 0, 1, 1);
  const [r, g, b] = pctx.getImageData(0, 0, 1, 1).data;
  return [r / 255, g / 255, b / 255];
}

function compile(gl: WebGLRenderingContext, type: number, source: string): WebGLShader | null {
  const shader = gl.createShader(type);
  if (!shader) return null;
  gl.shaderSource(shader, source);
  gl.compileShader(shader);
  if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
    gl.deleteShader(shader);
    return null;
  }
  return shader;
}

export function WaveField({ look: which, paused = false }: { look: WaveLook; paused?: boolean }) {
  const hostRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = hostRef.current;
    if (!canvas) return;
    const gl = canvas.getContext("webgl", { alpha: true, antialias: false, premultipliedAlpha: true });
    // No WebGL: the band keeps its deep green ground and its words, which is all it needs.
    if (!gl) return;
    const look = LOOK[which];
    const still = paused || window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const touch = window.matchMedia("(pointer: coarse)").matches;
    const saveData = Boolean((navigator as Navigator & { connection?: { saveData?: boolean } }).connection?.saveData);

    const vs = compile(gl, gl.VERTEX_SHADER, VERTEX);
    const fs = compile(gl, gl.FRAGMENT_SHADER, FRAGMENT);
    const program = gl.createProgram();
    if (!vs || !fs || !program) return;
    gl.attachShader(program, vs);
    gl.attachShader(program, fs);
    gl.linkProgram(program);
    if (!gl.getProgramParameter(program, gl.LINK_STATUS)) return;
    gl.useProgram(program);

    const quad = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, quad);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);
    const aPos = gl.getAttribLocation(program, "a_pos");
    gl.enableVertexAttribArray(aPos);
    gl.vertexAttribPointer(aPos, 2, gl.FLOAT, false, 0, 0);

    const u = (name: string) => gl.getUniformLocation(program, name);
    const uRes = u("u_res"), uTime = u("u_time"), uPointer = u("u_pointer");
    const uScale = u("u_scale"), uWarp = u("u_warp"), uAmp = u("u_amp");
    const uSpeed = u("u_speed"), uTravel = u("u_travel");
    const uTilt = u("u_tilt"), uGamma = u("u_gamma"), uSeed = u("u_seed");
    const uHold = u("u_hold"), uHoldY = u("u_holdY");
    const uC = [u("u_c0"), u("u_c1"), u("u_c2"), u("u_c3")];

    gl.uniform1f(uScale, look.scale);
    gl.uniform1f(uSpeed, look.speed);
    gl.uniform1f(uTravel, look.travel);
    gl.uniform1f(uWarp, look.warp);
    gl.uniform1f(uAmp, look.amp);
    gl.uniform1f(uTilt, look.tilt);
    gl.uniform1f(uGamma, look.gamma);
    gl.uniform1f(uHold, look.hold);
    gl.uniform1f(uHoldY, look.holdY);
    gl.uniform1f(uSeed, look.seed);
    gl.uniform2f(uPointer, 0, 0);

    /* How many of the screen's pixels this is drawn with. Everything here is softer than a blur
       radius, so the browser scaling it back up loses nothing a person can see — and it is the
       difference between one gradient and two running at once on a laptop's graphics. */
    let quality = saveData ? 0.34 : touch ? 0.42 : 0.56;
    let fitted = false;

    const fitTo = () => {
      const box = canvas.getBoundingClientRect();
      if (!box.width || !box.height) return false;
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      canvas.width = Math.max(2, Math.round(box.width * dpr * quality));
      canvas.height = Math.max(2, Math.round(box.height * dpr * quality));
      gl.viewport(0, 0, canvas.width, canvas.height);
      gl.uniform2f(uRes, canvas.width, canvas.height);
      const css = getComputedStyle(canvas);
      const tones = TOKENS.map((name) => rgbOf(css.getPropertyValue(name)));
      const fallback = tones.find(Boolean);
      if (!fallback) return false;
      tones.forEach((tone, k) => {
        const [r, g, b] = tone ?? fallback;
        gl.uniform3f(uC[k], r, g, b);
      });
      fitted = true;
      return true;
    };

    const draw = (time: number) => {
      gl.uniform1f(uTime, time);
      gl.drawArrays(gl.TRIANGLES, 0, 3);
    };

    let frame = 0;
    /* Field time, in seconds, and it only runs while the band is on screen: a clock read from
       `performance.now()` would jump the picture forward by however long the visitor was elsewhere
       on the page, and this one picks up where it left off. */
    let shown = 0;
    let live = false;
    let counted = 0;
    let elapsed = 0;
    let last = 0;
    // Where the pointer is, and where the field has got to in following it: it leans against the
    // frame rather than snapping to the cursor.
    let aimX = 0, aimY = 0, atX = 0, atY = 0;
    const tick = (now: number) => {
      if (last) {
        // Capped, so a gap in the frames does not teleport the picture: a background tab stops
        // getting them altogether, and a page busy elsewhere gets them late.
        shown += Math.min(0.5, (now - last) / 1000);
        elapsed += now - last;
        counted += 1;
        // A third of a second or 20 frames, whichever is longer: a real reading, quickly.
        if (counted >= 20 && elapsed >= 350) {
          const per = elapsed / counted;
          if (per > 24 && quality > 0.3) { quality = Math.max(0.3, quality - 0.14); fitTo(); }
          counted = 0;
          elapsed = 0;
        }
      }
      last = now;
      atX += (aimX - atX) * 0.05;
      atY += (aimY - atY) * 0.05;
      gl.uniform2f(uPointer, atX * look.drift, atY * look.drift);
      draw(shown);
      if (live) frame = window.requestAnimationFrame(tick);
    };

    if (fitTo()) draw(still ? 90 : 0); // reduced motion: one frame of the field, held
    /* Start it here, not in the observer below. The observer only ever reports a change, so when
       the band is already on screen at mount its first call matches the state it is already in and
       returns — and the loop was never started at all. That left a single frame, frozen, and a
       blank band entirely if anything resized the canvas afterwards (setting canvas.width clears
       the drawing buffer). */
    if (!still) {
      live = true;
      frame = window.requestAnimationFrame(tick);
    }

    const refit = new ResizeObserver(() => { if (fitTo() && still) draw(90); });
    refit.observe(canvas);

    // Only while it is on screen: a canvas painting sixty times a second off-screen is pure cost.
    const seen = new IntersectionObserver(([entry]) => {
      const on = Boolean(entry?.isIntersecting) && !still;
      if (on === live) return;
      live = on;
      if (on) { last = 0; frame = window.requestAnimationFrame(tick); }
      else { window.cancelAnimationFrame(frame); frame = 0; }
    }, { threshold: 0 });
    seen.observe(canvas);

    /* The parallax. The reference leans its field towards the pointer; here the canvas takes no
       pointer events of its own (the band over it is a slider you drag), so the move is read from
       the window and turned into where the pointer sits over this frame. A touch screen has no
       hover, and dragging the slider should move the slider, so it is left to the mouse. */
    const follow = (event: PointerEvent) => {
      if (event.pointerType !== "mouse" || !fitted) return;
      const box = canvas.getBoundingClientRect();
      if (!box.width || !box.height) return;
      aimX = ((event.clientX - box.left) / box.width - 0.5) * 2;
      aimY = ((event.clientY - box.top) / box.height - 0.5) * 2;
    };
    if (!still && !touch) window.addEventListener("pointermove", follow, { passive: true });

    // The palette follows the theme (the band has its own colours in light mode), so a toggle
    // re-reads the tokens; a held frame is redrawn, a running one picks them up on its next frame.
    const theme = new MutationObserver(() => { if (fitTo() && still) draw(90); });
    theme.observe(document.documentElement, { attributes: true, attributeFilter: ["class", "data-theme"] });

    return () => {
      window.removeEventListener("pointermove", follow);
      theme.disconnect();
      refit.disconnect();
      seen.disconnect();
      window.cancelAnimationFrame(frame);
      gl.deleteBuffer(quad);
      gl.deleteProgram(program);
      gl.deleteShader(vs);
      gl.deleteShader(fs);
    };
  }, [which, paused]);

  return <canvas ref={hostRef} aria-hidden="true" />;
}
