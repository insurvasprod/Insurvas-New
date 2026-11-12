"use client";

import { useEffect, useRef } from "react";

/**
 * `ParticlesWaves`: a rolling landscape of particles, each one hanging a line down to a floor far
 * below, seen from a low camera. Drawn with WebGL.
 *
 * The owner asked for Framer's Particle Wave Shader, exactly (12 Nov). That is a paid component with
 * its own GLSL; this is not its code — it is the same picture, rebuilt here from looking at it.
 *
 * What makes the picture is the **line under every particle**. They all hang to the same floor, deep
 * below the landscape, so each is hundreds of pixels long, and where thousands of them overlap the
 * light adds up into a curtain. Where a column lines up across depth — straight ahead, above all —
 * dozens of lines fall on the same pixels and burn into a bright seam. None of that is drawn on
 * purpose; it falls out of additive blending, which is why it looks right.
 *
 * **Why WebGL, after two Canvas 2D attempts.** A curtain like this is tens of thousands of long
 * strokes, and Canvas 2D rasterises every one on the CPU's terms: measured, the same field cost
 * 110–314ms a frame, so the earlier versions had to cap the lines short, dim them and thin them out —
 * which is exactly why they did not look like the reference. Here the landscape lives in the vertex
 * shader: the CPU uploads the grid once, and each frame sends one number, the time. Every line and
 * every particle is one draw call each.
 *
 * Colours come from tokens on the host element — §9 of the UI standard is that a component names no
 * colour — read back through a 1x1 canvas so any CSS colour notation resolves.
 */

type Side = "then" | "now";

const TOKENS = ["--wave-1", "--wave-2", "--wave-3"] as const;

const VERTEX = `
precision highp float;
attribute vec3 a_pos;      // x and z on the landscape; then 0 for the particle, 1 for its line's foot
uniform float u_time;
uniform vec2 u_res;        // the canvas, in device pixels
uniform float u_focal;     // pixels per world unit at depth 1
uniform float u_horizon;   // the horizon, in pixels from the top
uniform float u_camH;      // the camera's height above the landscape
uniform float u_floor;     // the height every line hangs down to
uniform float u_zNear;
uniform float u_zFar;
uniform float u_point;     // a particle's size in pixels at depth 1; perspective divides it by z
uniform float u_pointMax;
varying float v_far;
varying float v_ratio;
varying float v_end;
varying float v_x;

// Long, rolling hills — two or three to the frame at the ridge, as in the reference.
float land(vec2 p, float t) {
  return 0.75 * sin(p.x * 0.36 + t * 0.2) * cos(p.y * 0.19 - t * 0.11)
       + 0.45 * sin(p.x * 0.24 - p.y * 0.33 + t * 0.15)
       + 0.16 * sin(p.x * 0.8 + p.y * 0.5 - t * 0.27);
}

// How much of that relief shows at a given depth. At the ridge a world unit is about 36px on
// screen, so the hills need real height to read as hills; on the front row the same unit is over
// 300px, and the same height becomes a wobble that throws the rows about. So the land calms towards
// the camera — the front rows run nearly straight, as the reference's do, and the ridge rolls.
float relief(float z) {
  return mix(0.22, 1.0, smoothstep(u_zNear, u_zFar * 0.55, z));
}

void main() {
  float z = a_pos.y;
  float y = mix(land(a_pos.xy, u_time) * relief(z), u_floor, a_pos.z);
  float s = u_focal / z;
  float sx = u_res.x * 0.5 + a_pos.x * s;
  float sy = u_horizon + (u_camH - y) * s;
  gl_Position = vec4(sx / u_res.x * 2.0 - 1.0, 1.0 - sy / u_res.y * 2.0, 0.0, 1.0);
  gl_PointSize = clamp(u_point / z, 1.0, u_pointMax);
  v_far = clamp((z - u_zNear) / (u_zFar - u_zNear), 0.0, 1.0);
  // How far back this point is, as zNear/z: 1 on the front row, about 0.11 at the ridge. The
  // fragment shader raises it to a different power for lines than for particles (see there).
  v_ratio = u_zNear / z;
  v_end = a_pos.z;
  v_x = sx / u_res.x;
}
`;

const FRAGMENT = `
precision mediump float;
uniform vec3 u_c0;
uniform vec3 u_c1;
uniform vec3 u_c2;
uniform float u_alpha;
uniform float u_isPoint;
uniform float u_soft;      // 0 a crisp particle, 1 a wide soft halo
/* How hard brightness falls with depth. Lines and particles need different answers, and using one
   for both was the mistake: about fifteen far lines cross each pixel of the curtain band and sum to
   a haze unless they fade hard, while particles barely overlap, so fading them as hard dims the
   ridge's highlights to nothing. Measured against the reference, ours had the higher mean (a flat
   haze, 28 vs 21) and half its highlights (p99 95 vs 166) until they were split. */
uniform float u_fadePow;
varying float v_far;
varying float v_ratio;
varying float v_end;
varying float v_x;

// The palette sweeps across the frame, left to right, as the reference's does.
vec3 sweep(float x) {
  x = clamp(x, 0.0, 1.0);
  return x < 0.5 ? mix(u_c0, u_c1, x * 2.0) : mix(u_c1, u_c2, x * 2.0 - 1.0);
}

void main() {
  float a = u_alpha * pow(v_ratio, u_fadePow);
  if (u_isPoint > 0.5) {
    float r = length(gl_PointCoord - 0.5) * 2.0;
    a *= u_soft > 0.5 ? pow(max(0.0, 1.0 - r), 2.2) : smoothstep(1.0, 0.45, r);
  } else {
    // Brightest where it leaves the particle, gone by the time it reaches the floor. Steep, so the
    // light sits at the top of each line: at 1.7 the lower curtain filled in evenly (mean 30 against
    // the reference's 21) and the ridge came out dim; 2.6 moves it up to where the reference has it.
    a *= pow(1.0 - v_end, 2.6);
  }
  gl_FragColor = vec4(sweep(v_x) * a, a);
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

export function ParticlesWaves({ side }: { side: Side }) {
  const hostRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = hostRef.current;
    if (!canvas) return;
    const gl = canvas.getContext("webgl", { alpha: true, antialias: true, premultipliedAlpha: true });
    // No WebGL: the band keeps its dark ground and its words, which is all it needs.
    if (!gl) return;
    const still = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const glowy = side === "now";

    const vs = compile(gl, gl.VERTEX_SHADER, VERTEX);
    const fs = compile(gl, gl.FRAGMENT_SHADER, FRAGMENT);
    const program = gl.createProgram();
    if (!vs || !fs || !program) return;
    gl.attachShader(program, vs);
    gl.attachShader(program, fs);
    gl.linkProgram(program);
    if (!gl.getProgramParameter(program, gl.LINK_STATUS)) return;
    gl.useProgram(program);

    /* The grid. Rows are laid out interleaved — every even row, then every odd one — so drawing the
       first half of the buffer is every other row. That is the whole of the slow-machine fallback:
       a shorter count, never a gappier row, because the curtain reads as a curtain from how close
       its lines sit side by side. */
    /* Columns set from the reference itself: its front row of particles sits about 48px apart at
       1536 wide — some 32 across the frame. 270 put ours 30px apart, and the lines ran together
       into a haze instead of standing apart as a curtain does. */
    const COLS = glowy ? 172 : 144;
    const ROWS = glowy ? 96 : 78;
    const HALF_X = 13;
    const Z_NEAR = 1.6;
    const Z_FAR = 14;
    const order: number[] = [];
    for (let j = 0; j < ROWS; j += 2) order.push(j);
    for (let j = 1; j < ROWS; j += 2) order.push(j);

    const lineData = new Float32Array(COLS * ROWS * 6);
    const pointData = new Float32Array(COLS * ROWS * 3);
    let li = 0, pi = 0;
    for (const j of order) {
      const z = Z_NEAR + ((Z_FAR - Z_NEAR) * j) / (ROWS - 1);
      for (let i = 0; i < COLS; i += 1) {
        const x = -HALF_X + (2 * HALF_X * i) / (COLS - 1);
        lineData[li++] = x; lineData[li++] = z; lineData[li++] = 0;
        lineData[li++] = x; lineData[li++] = z; lineData[li++] = 1;
        pointData[pi++] = x; pointData[pi++] = z; pointData[pi++] = 0;
      }
    }
    const lineBuf = gl.createBuffer();
    const pointBuf = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, lineBuf);
    gl.bufferData(gl.ARRAY_BUFFER, lineData, gl.STATIC_DRAW);
    gl.bindBuffer(gl.ARRAY_BUFFER, pointBuf);
    gl.bufferData(gl.ARRAY_BUFFER, pointData, gl.STATIC_DRAW);

    const aPos = gl.getAttribLocation(program, "a_pos");
    const u = (name: string) => gl.getUniformLocation(program, name);
    const uTime = u("u_time"), uRes = u("u_res"), uFocal = u("u_focal"), uHorizon = u("u_horizon");
    const uCamH = u("u_camH"), uFloor = u("u_floor"), uNear = u("u_zNear"), uFar = u("u_zFar");
    const uPoint = u("u_point"), uPointMax = u("u_pointMax");
    const uAlpha = u("u_alpha"), uIsPoint = u("u_isPoint"), uSoft = u("u_soft"), uFadePow = u("u_fadePow");
    const uC = [u("u_c0"), u("u_c1"), u("u_c2")];

    gl.uniform1f(uNear, Z_NEAR);
    gl.uniform1f(uFar, Z_FAR);
    // The camera sits so the near rows run off the bottom of the frame and the far ridge stands
    // against the sky a little under halfway down, where the reference puts it.
    gl.uniform1f(uCamH, 1.18);
    gl.uniform1f(uFloor, -3.6);

    // Additive: the light of overlapping lines sums, which is what makes the curtain and its seams.
    gl.enable(gl.BLEND);
    gl.blendFunc(gl.ONE, gl.ONE);
    gl.disable(gl.DEPTH_TEST);

    let w = 0, h = 0, dpr = 1;
    /* A particle's size in device pixels at depth 1, before perspective divides it by z. Measured
       against the reference at 1536x826: about 3.5px on the nearest row, a pixel at the ridge. */
    let dot = 1;
    /* How much brighter, and bigger, the theme wants the field: 1 in dark. The light theme's green ground
       is far brighter than the night sky, so its particles need more light to read (owner, 12 Nov). */
    let gain = 1;
    const fitTo = () => {
      const box = canvas.getBoundingClientRect();
      if (!box.width || !box.height) return false;
      dpr = Math.min(window.devicePixelRatio || 1, 2);
      w = Math.round(box.width * dpr);
      h = Math.round(box.height * dpr);
      canvas.width = w;
      canvas.height = h;
      gl.viewport(0, 0, w, h);
      gl.uniform2f(uRes, w, h);
      gl.uniform1f(uFocal, h * 0.87);
      gl.uniform1f(uHorizon, h * 0.36);
      const css = getComputedStyle(canvas);
      const num = (name: string) => { const v = parseFloat(css.getPropertyValue(name)); return Number.isFinite(v) && v > 0 ? v : 1; };
      gain = num("--wave-gain");
      dot = 7 * dpr * (glowy ? 1.18 : 1) * num("--wave-size");
      gl.uniform1f(uPoint, dot);
      gl.uniform1f(uPointMax, 4.4 * dpr * Math.sqrt(gain));
      const tones = TOKENS.map((name) => rgbOf(css.getPropertyValue(name)));
      const fallback = tones.find(Boolean);
      if (!fallback) return false;
      tones.forEach((tone, k) => {
        const [r, g, b] = tone ?? fallback;
        gl.uniform3f(uC[k], r, g, b);
      });
      return true;
    };

    /** How many rows to draw: all of them, or every other one on a machine that cannot keep up. */
    let rows = ROWS;

    const draw = (time: number) => {
      gl.clearColor(0, 0, 0, 0);
      gl.clear(gl.COLOR_BUFFER_BIT);
      gl.uniform1f(uTime, time);
      gl.enableVertexAttribArray(aPos);

      // The curtain.
      gl.bindBuffer(gl.ARRAY_BUFFER, lineBuf);
      gl.vertexAttribPointer(aPos, 3, gl.FLOAT, false, 0, 0);
      gl.uniform1f(uIsPoint, 0);
      gl.uniform1f(uFadePow, 0.75);
      // "Now" burns noticeably brighter than "Then" — the business grew (owner, 12 Nov: at 0.32 the
      // two scenes measured within 2% of each other on average, which nobody could see).
      gl.uniform1f(uAlpha, (glowy ? 0.44 : 0.24) * gain);
      gl.drawArrays(gl.LINES, 0, rows * COLS * 2);

      gl.bindBuffer(gl.ARRAY_BUFFER, pointBuf);
      gl.vertexAttribPointer(aPos, 3, gl.FLOAT, false, 0, 0);
      gl.uniform1f(uIsPoint, 1);
      gl.uniform1f(uFadePow, 0.15);
      if (glowy) {
        // "Now" glows: a wide, faint halo under every particle before the particle itself. The
        // overlap of thousands of them is the bloom; there is no blur pass.
        gl.uniform1f(uSoft, 1);
        gl.uniform1f(uPoint, dot * 3.2);
        gl.uniform1f(uPointMax, 14 * dpr);
        gl.uniform1f(uAlpha, 0.15 * gain);
        gl.drawArrays(gl.POINTS, 0, rows * COLS);
        gl.uniform1f(uPoint, dot);
        gl.uniform1f(uPointMax, 4.4 * dpr);
      }
      gl.uniform1f(uSoft, 0);
      gl.uniform1f(uAlpha, (glowy ? 1 : 0.88) * gain);
      gl.drawArrays(gl.POINTS, 0, rows * COLS);
    };

    let frame = 0;
    let start = 0;
    let live = !still;
    let counted = 0;
    let elapsed = 0;
    let last = 0;
    const tick = (now: number) => {
      if (!start) start = now;
      if (last) {
        elapsed += now - last;
        counted += 1;
        // A third of a second or 20 frames, whichever is longer: a real reading, quickly.
        if (counted >= 20 && elapsed >= 350) {
          const per = elapsed / counted;
          if (per > 24 && rows === ROWS) rows = Math.ceil(ROWS / 2);
          else if (per < 12 && rows !== ROWS) rows = ROWS;
          counted = 0;
          elapsed = 0;
        }
      }
      last = now;
      draw((now - start) / 1000);
      if (live) frame = window.requestAnimationFrame(tick);
    };

    if (fitTo()) draw(still ? 6 : 0); // reduced motion: one frame of the landscape, held

    const refit = new ResizeObserver(() => { if (fitTo() && still) draw(6); });
    refit.observe(canvas);

    // Only while it is on screen: a canvas painting sixty times a second off-screen is pure cost.
    const seen = new IntersectionObserver(([entry]) => {
      const on = Boolean(entry?.isIntersecting) && !still;
      if (on === live) return;
      live = on;
      if (on) { start = 0; last = 0; frame = window.requestAnimationFrame(tick); }
      else { window.cancelAnimationFrame(frame); frame = 0; }
    }, { threshold: 0 });
    seen.observe(canvas);

    // The palette follows the theme (the band has its own colours in light mode), so a toggle re-reads
    // the tokens; a held frame is redrawn, a running one picks them up on its next frame.
    const theme = new MutationObserver(() => { if (fitTo() && still) draw(6); });
    theme.observe(document.documentElement, { attributes: true, attributeFilter: ["class", "data-theme"] });

    return () => {
      theme.disconnect();
      refit.disconnect();
      seen.disconnect();
      window.cancelAnimationFrame(frame);
      gl.deleteBuffer(lineBuf);
      gl.deleteBuffer(pointBuf);
      gl.deleteProgram(program);
      gl.deleteShader(vs);
      gl.deleteShader(fs);
    };
  }, [side]);

  return <canvas ref={hostRef} aria-hidden="true" />;
}
