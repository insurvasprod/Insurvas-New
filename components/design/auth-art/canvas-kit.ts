/**
 * The small amount of plumbing every one of the auth-panel studies needs: a canvas sized to its
 * box and the screen, colours read from CSS so no study names one, a loop that only runs while the
 * study is on screen, and one still frame when the visitor asked for no motion.
 *
 * Development only — these are mockups for choosing a direction, not shipped surfaces.
 */

export type Paint = (ctx: CanvasRenderingContext2D, time: number, frame: Frame) => void;

export type Frame = {
  /** Canvas size in CSS pixels (the drawing buffer is this times `dpr`). */
  w: number;
  h: number;
  dpr: number;
  /** Colours read back from the host element's custom properties, in order. */
  tones: string[];
  /** Seconds since the last frame, capped so a dropped frame cannot jump the picture. */
  dt: number;
  /** True on the first frame after a resize: a study holding its own buffers rebuilds them. */
  fresh: boolean;
};

/** Read a CSS custom property through a 1x1 canvas, so any colour notation resolves to rgb(). */
function resolve(el: HTMLElement, name: string, fallback: string): string {
  const raw = getComputedStyle(el).getPropertyValue(name).trim();
  if (!raw) return fallback;
  const probe = document.createElement("canvas");
  probe.width = probe.height = 1;
  const ctx = probe.getContext("2d");
  if (!ctx) return fallback;
  const sentinel = "rgba(0, 0, 0, 0)";
  ctx.fillStyle = sentinel;
  ctx.fillStyle = raw;
  return ctx.fillStyle === sentinel ? fallback : String(ctx.fillStyle);
}

/**
 * Run `paint` on a canvas until the returned function is called.
 *
 * `tokens` are custom property names read off the canvas itself; their resolved values arrive in
 * `frame.tones`. `still` draws one frame at `t = stillAt` and stops, for reduced motion.
 */
export function runCanvas(
  canvas: HTMLCanvasElement,
  paint: Paint,
  options: { tokens?: string[]; fallback?: string; quality?: number; stillAt?: number } = {},
): () => void {
  const ctx = canvas.getContext("2d", { alpha: false });
  if (!ctx) return () => {};
  const tokens = options.tokens ?? [];
  const fallback = options.fallback ?? "rgb(0, 0, 0)";
  const quality = options.quality ?? 1;
  const still = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

  let frame: Frame = { w: 0, h: 0, dpr: 1, tones: [], dt: 0, fresh: true };
  let raf = 0;
  let live = false;
  let last = 0;
  let clock = 0;

  const fit = () => {
    const box = canvas.getBoundingClientRect();
    if (!box.width || !box.height) return false;
    const dpr = Math.min(window.devicePixelRatio || 1, 2) * quality;
    canvas.width = Math.max(2, Math.round(box.width * dpr));
    canvas.height = Math.max(2, Math.round(box.height * dpr));
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    frame = {
      w: box.width,
      h: box.height,
      dpr,
      tones: tokens.map((t) => resolve(canvas, t, fallback)),
      dt: 0,
      fresh: true,
    };
    return true;
  };

  const tick = (now: number) => {
    frame.dt = last ? Math.min(0.1, (now - last) / 1000) : 0;
    last = now;
    clock += frame.dt;
    paint(ctx, clock, frame);
    frame.fresh = false;
    if (live) raf = window.requestAnimationFrame(tick);
  };

  if (fit()) {
    clock = still ? (options.stillAt ?? 12) : 0;
    paint(ctx, clock, frame);
    frame.fresh = false;
  }
  // Started here rather than from the observer below: an observer reports a change, so a panel
  // already on screen at mount would never start.
  if (!still) {
    live = true;
    raf = window.requestAnimationFrame(tick);
  }

  const refit = new ResizeObserver(() => {
    if (fit() && still) paint(ctx, clock, frame);
  });
  refit.observe(canvas);

  const seen = new IntersectionObserver(([entry]) => {
    const on = Boolean(entry?.isIntersecting) && !still;
    if (on === live) return;
    live = on;
    if (on) {
      last = 0;
      raf = window.requestAnimationFrame(tick);
    } else {
      window.cancelAnimationFrame(raf);
      raf = 0;
    }
  }, { threshold: 0 });
  seen.observe(canvas);

  const theme = new MutationObserver(() => {
    if (fit() && still) paint(ctx, clock, frame);
  });
  theme.observe(document.documentElement, { attributes: true, attributeFilter: ["class", "data-theme"] });

  return () => {
    theme.disconnect();
    refit.disconnect();
    seen.disconnect();
    window.cancelAnimationFrame(raf);
  };
}

/**
 * A soft round sprite, drawn once into its own canvas and then stamped thousands of times. Drawing
 * a radial gradient per point costs more than the points are worth; stamping a bitmap is a blit.
 */
export function softDot(size: number, colour: string, falloff = 2.4): HTMLCanvasElement {
  const c = document.createElement("canvas");
  c.width = c.height = size;
  const ctx = c.getContext("2d");
  if (!ctx) return c;
  const mid = size / 2;
  const grd = ctx.createRadialGradient(mid, mid, 0, mid, mid, mid);
  for (let i = 0; i <= 8; i += 1) {
    const t = i / 8;
    grd.addColorStop(t, withAlpha(colour, (1 - t) ** falloff));
  }
  ctx.fillStyle = grd;
  ctx.fillRect(0, 0, size, size);
  return c;
}

/**
 * Any CSS colour plus an alpha, without the caller having to parse it.
 *
 * Hex has to be handled, not only `rgb()`: a canvas normalises `fillStyle` to `#rrggbb`, so that is
 * what comes back out of `resolve` above. Reading the digits out of a hex string as if they were
 * `rgb()` numbers silently produces an opaque colour — which drew every soft sprite as a hard
 * square and stopped the long exposure fading at all.
 */
export function withAlpha(colour: string, alpha: number): string {
  const a = Math.max(0, Math.min(1, alpha)).toFixed(3);
  const hex = colour.trim().match(/^#([0-9a-f]{3,8})$/i);
  if (hex) {
    const h = hex[1];
    const wide = h.length > 4;
    const part = (i: number) => {
      const s = wide ? h.slice(i * 2, i * 2 + 2) : h[i] + h[i];
      return parseInt(s, 16);
    };
    return `rgba(${part(0)}, ${part(1)}, ${part(2)}, ${a})`;
  }
  const n = colour.match(/-?\d+(\.\d+)?/g);
  if (!n || n.length < 3) return colour;
  return `rgba(${n[0]}, ${n[1]}, ${n[2]}, ${a})`;
}
