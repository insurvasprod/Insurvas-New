"use client";

import { useEffect, useRef } from "react";
import type { LucideIcon } from "lucide-react";
import { createTimeline } from "animejs";

import styles from "@/components/marketing/landing-flow.module.css";

/**
 * A small animated flow diagram (Umar, 4 Nov, A5.3): "small flow diagrams where they pass data and
 * show the whole workflow … an animated video card, it's not actually a video." One record, a green
 * dot, travels the module's real steps; each step lights as it arrives, the last one is the outcome,
 * and the loop starts again.
 *
 * Drawn as one SVG so it scales as a unit, and laid out as a snake on a fixed grid (right, down,
 * left, down, right), so no wire crosses a box. Only opacity and transforms animate. The loop runs
 * only while `playing` (its card is in front) and the diagram is on screen; under reduced motion it
 * shows the finished state, still. Decorative: the card's text carries every claim.
 */
export type FlowStep = { icon: LucideIcon; label: string; sub: string };

const W = 560;
const NODE = { w: 240, h: 84 };
const SLOTS = [[24, 30], [296, 30], [296, 150], [24, 150], [24, 270], [296, 270]] as const;

/** Where a wire leaves one box and enters the next: side to side, or bottom to top. */
function wire(a: readonly [number, number], b: readonly [number, number]) {
  if (a[1] === b[1]) {
    const y = a[1] + NODE.h / 2;
    return a[0] < b[0] ? { x1: a[0] + NODE.w, y1: y, x2: b[0], y2: y } : { x1: a[0], y1: y, x2: b[0] + NODE.w, y2: y };
  }
  const x = a[0] + NODE.w / 2;
  return { x1: x, y1: a[1] + NODE.h, x2: x, y2: b[1] };
}

export function LandingFlow({ steps, playing }: { steps: FlowStep[]; playing: boolean }) {
  const rootRef = useRef<SVGSVGElement>(null);
  const timelineRef = useRef<ReturnType<typeof createTimeline> | null>(null);
  const visibleRef = useRef(false);
  const playingRef = useRef(playing);
  const slots = SLOTS.slice(0, steps.length);
  const wires = slots.slice(1).map((slot, i) => wire(slots[i], slot));
  // As tall as the rows it uses, so a four-step flow is not pushed up by an empty third row.
  const height = Math.max(...slots.map(([, y]) => y)) + NODE.h + 30;

  // Build the loop once. It starts paused; the effects below decide when it runs.
  useEffect(() => {
    const root = rootRef.current;
    if (!root || window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    const nodes = [...root.querySelectorAll<SVGGElement>("[data-node]")];
    const lits = [...root.querySelectorAll<SVGRectElement>("[data-lit]")];
    const lines = [...root.querySelectorAll<SVGLineElement>("[data-wire]")];
    const dot = root.querySelector<SVGCircleElement>("[data-dot]");
    if (!dot || nodes.length === 0) return;

    const tl = createTimeline({ autoplay: false, loop: true, loopDelay: 600, defaults: { ease: "inOutCubic" } })
      .set(nodes, { opacity: 0.4 }, 0)
      .set(lits, { opacity: 0 }, 0)
      .set(lines, { strokeDashoffset: 1 }, 0)
      .set(dot, { opacity: 0, x: wires[0]?.x1 ?? 0, y: wires[0]?.y1 ?? 0 }, 0)
      .add(nodes[0], { opacity: 1, duration: 300 }, 200)
      .add(lits[0], { opacity: 1, duration: 300 }, 200)
      .add(dot, { opacity: 1, duration: 200 }, 450);
    let at = 700;
    wires.forEach((w, i) => {
      tl.set(dot, { x: w.x1, y: w.y1 }, at)
        .add(dot, { x: w.x2, y: w.y2, duration: 700 }, at)
        .add(lines[i], { strokeDashoffset: 0, duration: 700 }, at)
        .add(nodes[i + 1], { opacity: 1, duration: 260 }, at + 620)
        .add(lits[i + 1], { opacity: 1, duration: 260 }, at + 620);
      at += 1100;
    });
    // Hold on the finished flow, then let it settle back before the next run.
    tl.add(dot, { opacity: 0, duration: 250 }, at)
      .add(nodes, { opacity: 0.4, duration: 500 }, at + 1600)
      .add(lits, { opacity: 0, duration: 500 }, at + 1600)
      .add(lines, { strokeDashoffset: 1, duration: 500 }, at + 1600);
    timelineRef.current = tl;

    const io = new IntersectionObserver(([entry]) => {
      visibleRef.current = Boolean(entry?.isIntersecting);
      if (visibleRef.current && playingRef.current) tl.play(); else tl.pause();
    }, { threshold: 0.35 });
    io.observe(root);
    return () => { io.disconnect(); tl.revert(); timelineRef.current = null; };
    // The steps of a card never change after it renders.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    playingRef.current = playing;
    const tl = timelineRef.current;
    if (!tl) return;
    if (playing && visibleRef.current) tl.play(); else tl.pause();
  }, [playing]);

  return (
    <svg ref={rootRef} className={styles.flow} viewBox={`0 0 ${W} ${height}`} role="img" aria-hidden="true" focusable="false">
      {wires.map((w, i) => (
        <g key={i}>
          <line className={styles.wire} x1={w.x1} y1={w.y1} x2={w.x2} y2={w.y2} />
          <line className={styles.wireLit} data-wire="" pathLength={1} x1={w.x1} y1={w.y1} x2={w.x2} y2={w.y2} />
        </g>
      ))}
      {steps.map((step, i) => {
        const [x, y] = slots[i];
        const Icon = step.icon;
        const last = i === steps.length - 1;
        return (
          <g key={step.label} data-node="" className={styles.node} transform={`translate(${x} ${y})`}>
            <rect className={styles.box} width={NODE.w} height={NODE.h} rx={14} />
            <rect className={last ? styles.litResult : styles.lit} data-lit="" width={NODE.w} height={NODE.h} rx={14} />
            <Icon x={18} y={18} width={18} height={18} className={styles.icon} />
            <text className={styles.label} x={46} y={32}>{step.label}</text>
            <text className={styles.sub} x={18} y={62}>{step.sub}</text>
          </g>
        );
      })}
      <circle className={styles.dot} data-dot="" r={6} cx={0} cy={0} />
    </svg>
  );
}
