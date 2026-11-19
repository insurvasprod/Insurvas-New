"use client";

import { useEffect, useRef } from "react";

import { runCanvas, softDot, withAlpha } from "@/components/design/auth-art/canvas-kit";

/**
 * **Study A — "The Line".** A long exposure of the data highway.
 *
 * Every light is one lead. They come out of the vanishing point in lanes — a lane is a campaign —
 * and accelerate towards the viewer the way traffic does in a thirty-second exposure. Most run
 * past and out of frame. A few slow, burn bright and stop: those are the ones that issued, and
 * each leaves a mark that stays for a while before the night takes it back.
 *
 * The brand concept is "Data Highway" and the panel it replaces is a photograph of a road, so the
 * subject is the one the owner has already approved — this is the same idea built rather than
 * bought, in the brand's own greens, and it moves.
 *
 * **Why it looks photographic and not like a WebGL demo.** Nothing here draws a tail. The canvas
 * is never cleared: each frame lays a nearly transparent wash of the night over the last one, so
 * what is left behind every light is a true accumulation, dimming the way film does. The heads are
 * one soft sprite stamped thousands of times rather than a gradient built per point, which is what
 * keeps a few thousand of them inside the frame budget.
 */
export function LineArt() {
  const hostRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = hostRef.current;
    if (!canvas) return;

    /* A lane is a campaign: an angle out of the vanishing point, how busy it is, and how wide the
       carriageway is. The width is the thing that makes it read as a road — without it every light
       leaves the same point and the frame is a firework, not traffic. */
    const LANES = [
      { angle: -1.46, rate: 3.0, weight: 1, width: 0.1 },
      { angle: -1.28, rate: 2.1, weight: 0.84, width: 0.085 },
      { angle: -1.64, rate: 2.4, weight: 0.92, width: 0.095 },
      { angle: -1.12, rate: 1.1, weight: 0.66, width: 0.07 },
      { angle: -1.82, rate: 1.3, weight: 0.7, width: 0.07 },
    ];

    type Car = { lane: number; z: number; speed: number; lit: number; issued: boolean; held: number; off: number };
    type Mark = { x: number; y: number; born: number; size: number };

    let cars: Car[] = [];
    let marks: Mark[] = [];
    let dots: { head: HTMLCanvasElement; warm: HTMLCanvasElement; issue: HTMLCanvasElement } | null = null;
    let due = 0;

    const Z_FAR = 9;
    const Z_NEAR = 0.52;

    const stop = runCanvas(
      canvas,
      (ctx, time, f) => {
        const [ink, trail, bright, crest] = f.tones;
        if (f.fresh) {
          ctx.fillStyle = ink;
          ctx.fillRect(0, 0, f.w, f.h);
          dots = {
            head: softDot(64, trail, 2.6),
            warm: softDot(64, bright, 2.2),
            issue: softDot(96, bright, 1.9),
          };
          cars = [];
          marks = [];
        }
        if (!dots) return;

        // The wash. Lower and the frame smears into a fog; higher and the trails stop being long.
        ctx.globalCompositeOperation = "source-over";
        ctx.fillStyle = withAlpha(ink, 0.055);
        ctx.fillRect(0, 0, f.w, f.h);

        const vx = f.w * 0.44;
        const vy = f.h * 0.235;
        const focal = f.h * 0.6;

        // New traffic, at each lane's own rate.
        due += f.dt;
        while (due > 0.035) {
          due -= 0.035;
          for (const [i, lane] of LANES.entries()) {
            if (Math.random() < lane.rate * 0.035) {
              cars.push({
                lane: i,
                z: Z_FAR,
                speed: 1.5 + Math.random() * 1.4,
                lit: 0.45 + Math.random() * 0.55,
                // One in eleven is a policy. It is a mockup, not a conversion rate.
                issued: Math.random() < 0.09,
                held: 0,
                off: (Math.random() * 2 - 1) * lane.width,
              });
            }
          }
        }

        ctx.globalCompositeOperation = "lighter";
        const alive: Car[] = [];
        for (const car of cars) {
          const lane = LANES[car.lane];
          // An issued one slows as it arrives, holds, and is let go.
          const slowing = car.issued && car.z < 4.6;
          if (slowing && car.z < 3.5) {
            car.held += f.dt;
            if (car.held > 1.6) car.z -= car.speed * f.dt * 0.35;
          } else {
            car.z -= car.speed * f.dt * (slowing ? 0.3 : 1);
          }
          if (car.z < Z_NEAR) continue;

          const d = focal / car.z;
          // Along the lane, then across it: the offset is perpendicular and grows with distance
          // travelled, which is what gives the carriageway its width in perspective.
          const ax = Math.cos(lane.angle);
          const ay = -Math.sin(lane.angle);
          const x = vx + ax * d * 1.3 + -ay * car.off * d;
          const y = vy + ay * d + ax * car.off * d;
          if (y > f.h + 140 || x < -160 || x > f.w + 160) continue;
          alive.push(car);

          // Perspective: nearer is bigger and brighter, and the far end stays a pinprick.
          const near = (Z_FAR - car.z) / (Z_FAR - Z_NEAR);
          // Small and dim far away, so the far end of the road is a haze of pinpricks and the
          // light arrives with the traffic rather than piling up at the vanishing point.
          const size = (1.6 + near ** 1.5 * 15) * lane.weight;
          const glow = car.lit * lane.weight * (0.1 + near ** 1.7 * 1.05);

          if (car.issued && car.z < 4.6) {
            const burn = Math.min(1, (4.6 - car.z) * 1.1);
            // Tight. A wide soft sprite here reads as a thumbprint on the lens, not as a light.
            const s = size * (0.8 + burn * 0.35);
            ctx.globalAlpha = Math.min(1, glow * 0.6 + burn * 0.4);
            ctx.drawImage(dots.warm, x - s, y - s, s * 2, s * 2);
            ctx.globalAlpha = Math.min(1, 0.45 + burn * 0.5);
            ctx.fillStyle = bright;
            ctx.beginPath();
            ctx.arc(x, y, 1 + burn * 1.6, 0, Math.PI * 2);
            ctx.fill();
            if (car.held > 1.55 && car.held - f.dt <= 1.55) {
              marks.push({ x, y, born: time, size: size * 0.8 });
            }
          } else {
            const sprite = near > 0.55 ? dots.warm : dots.head;
            ctx.globalAlpha = Math.min(1, glow);
            ctx.drawImage(sprite, x - size, y - size, size * 2, size * 2);
          }
        }
        cars = alive.length > 900 ? alive.slice(alive.length - 900) : alive;

        // What issued stays on the plate for a while, like a mark burnt into the film.
        marks = marks.filter((m) => time - m.born < 26);
        for (const m of marks) {
          const age = (time - m.born) / 26;
          const fade = (1 - age) ** 1.6;
          ctx.globalAlpha = fade * 0.5;
          ctx.drawImage(dots.warm, m.x - m.size, m.y - m.size, m.size * 2, m.size * 2);
          ctx.globalAlpha = fade * 0.85;
          ctx.fillStyle = crest;
          ctx.beginPath();
          ctx.arc(m.x, m.y, 1.3, 0, Math.PI * 2);
          ctx.fill();
        }

        ctx.globalAlpha = 1;
        ctx.globalCompositeOperation = "source-over";
      },
      {
        tokens: ["--art-ink", "--art-trail", "--art-bright", "--art-crest"],
        fallback: "rgb(0, 0, 0)",
        stillAt: 14,
      },
    );

    return stop;
  }, []);

  return <canvas ref={hostRef} aria-hidden="true" />;
}
