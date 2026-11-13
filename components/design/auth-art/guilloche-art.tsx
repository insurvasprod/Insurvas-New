"use client";

import { useEffect, useRef } from "react";

import { runCanvas, withAlpha } from "@/components/design/auth-art/canvas-kit";

/**
 * **Study B — "Guilloché".** The engraving off a policy document, alive.
 *
 * Guilloché is the fine-line rosette engraved into banknotes, share certificates, bonds and
 * insurance policies: a rose engine turning two eccentrics against each other, cutting a line
 * that can be copied by no one who does not have the machine. It is the visual language of a
 * *written promise* — which is the thing this company actually sells — and it is the one tradition
 * in this industry that no SaaS login has taken, so it cannot read as anyone else's template.
 *
 * Here the machine never stops: the eccentrics drift, so the rosette re-weaves continuously, and
 * every few turns a bright pass runs around one line like ink taking to the plate. The figure the
 * lines are cut around is the isotype's own angle — the I and the V, and the speed lines through
 * them.
 *
 * The curve is the real one, an epitrochoid: a point at distance `c` from the centre of a circle
 * of radius `b` rolling around a circle of radius `a`. Nesting it by `c` is what produces the
 * interference that the eye reads as engraved metal rather than as a drawn spiral.
 */
export function GuillocheArt() {
  const hostRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = hostRef.current;
    if (!canvas) return;

    const RINGS = 62;      // nested lines in the rosette
    const STEPS = 420;     // points per line; below ~320 the curve shows its corners
    const RAIL_STEPS = 260;

    const stop = runCanvas(
      canvas,
      (ctx, time, f) => {
        const [plate, line, ink, crest] = f.tones;
        ctx.fillStyle = plate;
        ctx.fillRect(0, 0, f.w, f.h);

        /* The words take the bottom of the panel, so the plate is cut for the band that is
           actually seen. A figure centred in the frame is a figure half under the headline. */
        const cx = f.w * 0.5;
        const cy = f.h * 0.325;
        const unit = Math.min(f.w, f.h);

        // The eccentrics. Slow, and on periods that do not divide into each other, so the plate
        // never returns to a figure it has already cut.
        const a = 1 + 0.085 * Math.sin(time * 0.063);
        const b = 0.128 + 0.009 * Math.sin(time * 0.041 + 1.4);
        const spin = time * 0.037;
        const ratio = (a + b) / b;

        ctx.lineWidth = 0.6;
        ctx.lineJoin = "round";

        for (let r = 0; r < RINGS; r += 1) {
          const k = r / (RINGS - 1);
          const c = (0.1 + k * 0.62) * (1 + 0.05 * Math.sin(time * 0.05 + k * 3.1));
          const scale = unit * 0.168;
          // The lines are not evenly bright: the ones in the middle of the family carry the
          // figure, the outer ones are the shade around it.
          const weight = 0.07 + 0.3 * Math.sin(Math.PI * k) ** 1.1;
          ctx.strokeStyle = withAlpha(line, weight);
          ctx.beginPath();
          for (let s = 0; s <= STEPS; s += 1) {
            const t = (s / STEPS) * Math.PI * 2;
            const x = cx + scale * ((a + b) * Math.cos(t + spin) - c * Math.cos(ratio * t + spin));
            const y = cy + scale * ((a + b) * Math.sin(t + spin) - c * Math.sin(ratio * t + spin));
            if (s === 0) ctx.moveTo(x, y);
            else ctx.lineTo(x, y);
          }
          ctx.stroke();
        }

        // The inking pass: one line of the family, lit, travelling outwards through it.
        const pass = (time * 0.16) % 1;
        const pk = pass;
        const pc = (0.1 + pk * 0.62) * (1 + 0.05 * Math.sin(time * 0.05 + pk * 3.1));
        const pscale = unit * 0.168;
        const glow = Math.sin(Math.PI * pass) ** 0.8;
        ctx.strokeStyle = withAlpha(crest, 0.62 * glow);
        ctx.lineWidth = 1.1;
        ctx.beginPath();
        for (let s = 0; s <= STEPS; s += 1) {
          const t = (s / STEPS) * Math.PI * 2;
          const x = cx + pscale * ((a + b) * Math.cos(t + spin) - pc * Math.cos(ratio * t + spin));
          const y = cy + pscale * ((a + b) * Math.sin(t + spin) - pc * Math.sin(ratio * t + spin));
          if (s === 0) ctx.moveTo(x, y);
          else ctx.lineTo(x, y);
        }
        ctx.stroke();

        /* The border rail. Security printing runs a second, tighter figure around the edge of the
           plate; it is what stops the middle from floating. Two waves out of phase, as on a note. */
        const inset = unit * 0.055;
        const railTop = f.h * 0.052;
        const railBottom = f.h * 0.545;
        for (const [i, y0] of [railTop, railBottom].entries()) {
          for (let w = 0; w < 3; w += 1) {
            ctx.strokeStyle = withAlpha(line, 0.42 - w * 0.09);
            ctx.lineWidth = 0.7;
            ctx.beginPath();
            for (let s = 0; s <= RAIL_STEPS; s += 1) {
              const u = s / RAIL_STEPS;
              const x = inset + u * (f.w - inset * 2);
              const phase = u * Math.PI * 14 + time * (i ? -0.5 : 0.5) + w * 0.9;
              const y = y0 + Math.sin(phase) * (5 + w * 3.5) + Math.sin(phase * 0.37) * 3;
              if (s === 0) ctx.moveTo(x, y);
              else ctx.lineTo(x, y);
            }
            ctx.stroke();
          }
        }

        /* The counterfoil: the ticks a certificate carries down its edge, and the one that is
           lit is the line the press is cutting. */
        const ticks = 26;
        for (let i = 0; i < ticks; i += 1) {
          const y = railTop + ((railBottom - railTop) * i) / (ticks - 1);
          const live = Math.abs(((time * 0.1) % 1) - i / ticks) < 0.02;
          ctx.strokeStyle = withAlpha(live ? crest : ink, live ? 0.8 : 0.3);
          ctx.lineWidth = live ? 1.4 : 0.8;
          ctx.beginPath();
          ctx.moveTo(inset * 0.5, y);
          ctx.lineTo(inset * 0.5 + (live ? 13 : 7), y);
          ctx.stroke();
        }
      },
      {
        tokens: ["--art-plate", "--art-line", "--art-ink", "--art-crest"],
        fallback: "rgb(0, 0, 0)",
        stillAt: 9,
      },
    );

    return stop;
  }, []);

  return <canvas ref={hostRef} aria-hidden="true" />;
}
