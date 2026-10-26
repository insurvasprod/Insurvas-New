"use client";

import { useEffect, useRef } from "react";

/**
 * The landing page's ribbon, as a slow backdrop behind a role home (redesign 2026-10-25, owner:
 * "the background … from the third", Dashboard C). Forty-odd hairlines sweep from the bottom left to
 * the top right; the glass cards above it frost them (`m-stage .m-glass`).
 *
 * A 2D canvas, not the landing's WebGL object: a home is open all day beside the dialer, and this
 * costs a few thousand line segments a frame. It draws one still frame for reduced motion, stops
 * while the tab is hidden, and reads its colour from `--ribbon-ink` so it follows the theme.
 */
export function RibbonBackdrop() {
  const ref = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = ref.current;
    if (!canvas) return;
    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    let raf = 0;
    let t = 0;
    let frame = 0;
    let ink = "7, 214, 160";

    const readInk = () => {
      const value = getComputedStyle(canvas).getPropertyValue("--ribbon-ink").trim();
      if (/^\d+,\s*\d+,\s*\d+$/.test(value)) ink = value;
    };

    const draw = () => {
      const rect = canvas.getBoundingClientRect();
      if (!rect.width || !rect.height) return;
      const ratio = Math.min(1.5, window.devicePixelRatio || 1);
      const width = Math.round(rect.width * ratio);
      const height = Math.round(rect.height * ratio);
      if (canvas.width !== width || canvas.height !== height) { canvas.width = width; canvas.height = height; }
      const ctx = canvas.getContext("2d");
      if (!ctx) return;
      ctx.setTransform(ratio, 0, 0, ratio, 0, 0);
      const W = rect.width;
      const H = rect.height;
      ctx.clearRect(0, 0, W, H);
      const lines = 44;
      for (let k = 0; k < lines; k += 1) {
        const s = (k / (lines - 1)) * 2 - 1;
        ctx.beginPath();
        for (let x = -20; x <= W + 20; x += 12) {
          const u = x / W;
          const centre = H * (0.86 - 0.66 * u) + Math.sin(u * 3 + t * 2) * H * 0.05;
          const y = centre + s * H * 0.17 * Math.cos(u * 4 + t * 1.4);
          if (x === -20) ctx.moveTo(x, y); else ctx.lineTo(x, y);
        }
        const front = 0.5 + 0.5 * Math.sin(t * 1.4 + s * 1.2);
        const gradient = ctx.createLinearGradient(0, 0, W, 0);
        gradient.addColorStop(0, `rgba(${ink}, 0)`);
        gradient.addColorStop(0.5, `rgba(${ink}, ${0.05 + 0.13 * front})`);
        gradient.addColorStop(1, `rgba(${ink}, ${0.08 + 0.2 * front})`);
        ctx.strokeStyle = gradient;
        ctx.lineWidth = 1;
        ctx.stroke();
      }
    };

    const loop = () => {
      if (frame % 90 === 0) readInk();
      frame += 1;
      t += 0.004;
      draw();
      raf = window.requestAnimationFrame(loop);
    };
    const start = () => { if (!raf && !document.hidden) raf = window.requestAnimationFrame(loop); };
    const stop = () => { window.cancelAnimationFrame(raf); raf = 0; };
    const onVisibility = () => (document.hidden ? stop() : start());

    readInk();
    if (reduce) {
      draw();
      const onResize = () => { readInk(); draw(); };
      window.addEventListener("resize", onResize);
      return () => window.removeEventListener("resize", onResize);
    }
    start();
    document.addEventListener("visibilitychange", onVisibility);
    return () => { stop(); document.removeEventListener("visibilitychange", onVisibility); };
  }, []);

  return (
    <div aria-hidden="true" className="m-ribbon-layer">
      <canvas ref={ref} className="m-ribbon" />
    </div>
  );
}
