"use client";

import { useEffect, useRef } from "react";

import { runCanvas, withAlpha } from "@/components/design/auth-art/canvas-kit";

/**
 * **Study C — "The Floor".** The room the product runs, drawn as its own instrument.
 *
 * A plan of a sales floor: every square is a seat. A lead arrives at the left edge, is routed to
 * the seat that takes it, and the seat holds while the call is live. Most calls end and the seat
 * goes quiet. Some end in a policy, and then a second token leaves the seat for the ledger at the
 * right, where it stacks — the money arriving, traced back along the route it came in on.
 *
 * The claim beside it is "know what every lead cost you", and this is that sentence as a picture:
 * one lead, one route, one seat, one line in the ledger. It is also the audience's own world seen
 * from above — they run this room — rather than a metaphor borrowed from somewhere else.
 *
 * Nothing here is a real figure. It is a mockup of a floor, and the showcase says so.
 */
export function FloorArt() {
  const hostRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = hostRef.current;
    if (!canvas) return;

    const COLS = 9;
    const ROWS = 5;

    type Seat = { x: number; y: number; busy: number; since: number; won: number };
    type Lead = { seat: number; t: number; speed: number; entryY: number; won: boolean; done: boolean };
    type Coin = { x: number; y: number; t: number; row: number };

    let seats: Seat[] = [];
    let leads: Lead[] = [];
    let coins: Coin[] = [];
    let ledger: number[] = [];
    let trace: number[] = [];
    let due = 0;
    let traceDue = 0;
    let geo = { sx: 0, sy: 0, gapX: 0, gapY: 0, cell: 0, ledgerX: 0, traceY: 0 };

    const stop = runCanvas(
      canvas,
      (ctx, time, f) => {
        const [ground, quiet, live, won] = f.tones;

        if (f.fresh) {
          /* The floor sits in the top half: the words own the bottom of the panel, and a plan
             drawn behind them is a plan nobody sees. */
          const cell = Math.min(f.w * 0.05, f.h * 0.04);
          const gapX = cell * 1.8;
          const gapY = cell * 1.75;
          const sx = f.w * 0.21;
          const sy = f.h * 0.135;
          // The ledger keeps the right-hand margin to itself: drawn under the last columns it is
          // invisible, which is the whole point of it gone.
          geo = { sx, sy, gapX, gapY, cell, ledgerX: f.w * 0.9, traceY: f.h * 0.52 };
          seats = [];
          for (let r = 0; r < ROWS; r += 1) {
            for (let c = 0; c < COLS; c += 1) {
              seats.push({ x: sx + c * gapX, y: sy + r * gapY, busy: 0, since: 0, won: 0 });
            }
          }
          leads = [];
          coins = [];
          ledger = Array.from({ length: 5 }, () => 0.3 + Math.random() * 0.7);
          trace = [];
        }

        ctx.fillStyle = ground;
        ctx.fillRect(0, 0, f.w, f.h);
        const { cell, ledgerX, traceY } = geo;

        // A lead every so often, to a seat that is free if one is.
        due += f.dt;
        while (due > 0.55) {
          due -= 0.55;
          const free = seats.map((s, i) => (s.busy <= 0 ? i : -1)).filter((i) => i >= 0);
          if (free.length) {
            const seat = free[Math.floor(Math.random() * free.length)];
            leads.push({
              seat,
              t: 0,
              speed: 0.5 + Math.random() * 0.4,
              entryY: f.h * (0.1 + Math.random() * 0.42),
              won: Math.random() < 0.23,
              done: false,
            });
          }
        }

        // The routes. Each lead runs in from the left edge, turns once, and arrives.
        ctx.lineCap = "round";
        for (const lead of leads) {
          const seat = seats[lead.seat];
          const turnX = seat.x - cell * 1.9;
          lead.t = Math.min(1, lead.t + f.dt * lead.speed);
          const legA = turnX;
          const legB = Math.abs(seat.y - lead.entryY);
          const total = legA + legB + (seat.x - turnX);
          const travelled = lead.t * total;

          ctx.strokeStyle = withAlpha(quiet, 0.5);
          ctx.lineWidth = 1;
          ctx.beginPath();
          ctx.moveTo(0, lead.entryY);
          ctx.lineTo(turnX, lead.entryY);
          ctx.lineTo(turnX, seat.y);
          ctx.lineTo(seat.x, seat.y);
          ctx.stroke();

          // Where the head is along that route.
          let hx: number;
          let hy: number;
          if (travelled < legA) {
            hx = travelled;
            hy = lead.entryY;
          } else if (travelled < legA + legB) {
            hx = turnX;
            hy = lead.entryY + Math.sign(seat.y - lead.entryY) * (travelled - legA);
          } else {
            hx = turnX + (travelled - legA - legB);
            hy = seat.y;
          }
          ctx.fillStyle = live;
          ctx.beginPath();
          ctx.arc(hx, hy, 2.6, 0, Math.PI * 2);
          ctx.fill();
          ctx.fillStyle = withAlpha(live, 0.22);
          ctx.beginPath();
          ctx.arc(hx, hy, 8, 0, Math.PI * 2);
          ctx.fill();

          if (lead.t >= 1 && !lead.done) {
            lead.done = true;
            seat.busy = 2.4 + Math.random() * 3.4;
            seat.since = time;
            if (lead.won) seat.won = 1;
            trace.push(0.25 + Math.random() * 0.7);
          }
        }
        leads = leads.filter((l) => !l.done);

        // The seats.
        for (const seat of seats) {
          const busy = seat.busy > 0;
          if (busy) {
            seat.busy -= f.dt;
            if (seat.busy <= 0 && seat.won) {
              coins.push({ x: seat.x, y: seat.y, t: 0, row: ledger.length });
              seat.won = 0;
            }
          }
          const beat = busy ? 0.55 + 0.45 * Math.sin((time - seat.since) * 6.2) : 0;
          ctx.fillStyle = busy ? withAlpha(live, 0.2 + beat * 0.5) : withAlpha(quiet, 0.5);
          roundRect(ctx, seat.x - cell / 2, seat.y - cell / 2, cell, cell, cell * 0.26);
          ctx.fill();
          ctx.strokeStyle = busy ? withAlpha(live, 0.85) : withAlpha(quiet, 0.85);
          ctx.lineWidth = 1;
          ctx.stroke();
          if (busy) {
            const ring = ((time - seat.since) % 1.5) / 1.5;
            ctx.strokeStyle = withAlpha(live, (1 - ring) * 0.45);
            ctx.lineWidth = 1;
            ctx.beginPath();
            ctx.arc(seat.x, seat.y, cell * (0.7 + ring * 1.3), 0, Math.PI * 2);
            ctx.stroke();
          }
        }

        // What issued, on its way to the ledger.
        for (const coin of coins) {
          coin.t = Math.min(1, coin.t + f.dt * 0.55);
          const ty = f.h * 0.13 + (coin.row % 13) * (f.h * 0.028);
          const x = coin.x + (ledgerX - coin.x) * ease(coin.t);
          const y = coin.y + (ty - coin.y) * ease(coin.t);
          ctx.fillStyle = withAlpha(won, 0.9);
          ctx.beginPath();
          ctx.arc(x, y, 3.2, 0, Math.PI * 2);
          ctx.fill();
          ctx.fillStyle = withAlpha(won, 0.2);
          ctx.beginPath();
          ctx.arc(x, y, 9, 0, Math.PI * 2);
          ctx.fill();
          if (coin.t >= 1) ledger.push(0.3 + Math.random() * 0.7);
        }
        coins = coins.filter((c) => c.t < 1);

        // The ledger: what the floor booked, stacking up the right-hand edge.
        for (const [i, bar] of ledger.slice(-13).entries()) {
          const y = f.h * 0.13 + i * (f.h * 0.028);
          ctx.fillStyle = withAlpha(won, 0.78);
          ctx.fillRect(ledgerX, y - 1.25, bar * (f.w * 0.07), 2.5);
        }

        // Speed to lead, as the instrument it is on a real floor.
        traceDue += f.dt;
        if (traceDue > 0.1) {
          traceDue = 0;
          trace.push(trace.length ? trace[trace.length - 1] * 0.86 : 0.1);
          if (trace.length > 150) trace.shift();
        }
        ctx.strokeStyle = withAlpha(live, 0.55);
        ctx.lineWidth = 1.2;
        ctx.beginPath();
        for (const [i, v] of trace.entries()) {
          const x = (i / 150) * f.w;
          const y = traceY - v * (f.h * 0.07);
          if (i === 0) ctx.moveTo(x, y);
          else ctx.lineTo(x, y);
        }
        ctx.stroke();
        ctx.strokeStyle = withAlpha(quiet, 0.8);
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.moveTo(0, traceY);
        ctx.lineTo(f.w, traceY);
        ctx.stroke();
      },
      {
        tokens: ["--art-ground", "--art-quiet", "--art-live", "--art-won"],
        fallback: "rgb(0, 0, 0)",
        stillAt: 16,
      },
    );

    return stop;
  }, []);

  return <canvas ref={hostRef} aria-hidden="true" />;
}

const ease = (t: number) => (t < 0.5 ? 2 * t * t : 1 - (-2 * t + 2) ** 2 / 2);

function roundRect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}
