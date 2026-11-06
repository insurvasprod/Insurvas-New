"use client";

import { useEffect, useId, useLayoutEffect, useRef, useState } from "react";
import type { CSSProperties, PointerEvent as ReactPointerEvent } from "react";
import type { LucideIcon } from "lucide-react";
import { Check, Workflow } from "lucide-react";
import { createTimeline, svg, utils } from "animejs";

import styles from "@/components/marketing/landing-flow.module.css";

/**
 * A module's workflow, drawn as a small automation canvas (Umar, 4 Nov, A5.3: "flow diagrams where
 * they pass data and show the whole workflow … an animated video card"; owner, 6 Nov: show how the
 * pieces each card names connect, and make it impressive).
 *
 * The module's pages are nodes on a dotted canvas: where work comes in on the left, what Insurvas
 * does in the middle, what comes out on the right, with a side branch where the work splits (a
 * duplicate set aside, a dial refused). In each step a record travels the curved connector, the
 * connector draws behind it, and the node it reaches turns from waiting to done; the outcome counts
 * up its figure. Then the run settles and starts again.
 *
 * It runs only while its card is in front (`playing`) and on screen. Without a script, or under
 * reduced motion, the finished run is shown still. Narrow screens get the same nodes as one column.
 * Decorative: the card's text carries every claim, so the canvas is aria-hidden.
 *
 * In 3D (owner, 6 Nov): the canvas leans back in perspective, the nodes stand off it as raised slabs
 * that rise further when the record reaches them, and the canvas turns a little towards the pointer.
 * The tilt is gentle enough that every label stays readable; reduced motion keeps it still.
 *
 * Flowing (Umar, via the owner, 6 Nov): besides the step-by-step run, data streams along every
 * connector all the time, a few small packets per wire moving in the direction of the work, and the
 * lit wires carry a moving dash. The packets are SVG <animateMotion>, so they run on the browser's own
 * clock and stay smooth; they pause off screen, and CSS hides them under reduced motion.
 */
const STREAM = 3; // packets per connector
const STREAM_S = 2.6; // seconds for one packet to cross a connector
const LIFT_WAIT = 6;
const LIFT_DONE = 22;
export type FlowNode = {
  id: string;
  icon: LucideIcon;
  label: string;
  sub: string;
  /** Grid cell on the wide canvas: column 0–2 (in, Insurvas, out), row 0–2. */
  col: number;
  row: number;
  kind?: "source" | "step" | "branch" | "outcome";
  /** The outcome's figure, counted up when the run reaches it. */
  value?: { to: number; prefix?: string; suffix?: string; decimals?: number };
};
/** Each step is the connectors that run together, as [from, to] node ids. */
export type FlowGraph = { nodes: FlowNode[]; steps: Array<Array<[string, string]>> };

const W = 600;
const NODE_W = 172;
const NODE_H = 72;
const COL_X = [8, 214, 420];
const ROW_Y = [58, 162, 266];
const WIDE_H = 360;
// A narrow screen (a phone, owner 6 Nov): the steps in order down a rail, one slim row each, with
// the record running down the rail and lighting each step as it reaches it. Short enough for the
// whole card to fit one phone screen, so the cards can stack there as they do on a computer.
const NARROW_W = 330;
const RAIL_X = 15;
const NARROW_NODE_X = 34;
const NARROW_NODE_W = NARROW_W - NARROW_NODE_X - 4;
const NARROW_NODE_H = 34;
const NARROW_STEP = 40;
const NARROW_TOP = 48;

/** The rail between two steps: straight down the left edge, centre to centre. */
function rail(a: Box, b: Box): string {
  return `M${RAIL_X},${a.y + a.h / 2} L${RAIL_X},${b.y + b.h / 2}`;
}

type Box = { x: number; y: number; w: number; h: number };

function curve(a: Box, b: Box): string {
  if (Math.abs(a.x - b.x) < 2) {
    // Same column: bottom edge to top edge (or top to bottom when going up).
    const x = a.x + a.w / 2;
    const down = b.y > a.y;
    const y1 = down ? a.y + a.h : a.y;
    const y2 = down ? b.y : b.y + b.h;
    const d = (y2 - y1) / 2;
    return `M${x},${y1} C${x},${y1 + d} ${x},${y2 - d} ${x},${y2}`;
  }
  // Side to side: from the facing edges, whichever way the next node lies.
  const right = b.x > a.x;
  const x1 = right ? a.x + a.w : a.x;
  const y1 = a.y + a.h / 2;
  const x2 = right ? b.x : b.x + b.w;
  const y2 = b.y + b.h / 2;
  const d = Math.max(18, Math.abs(x2 - x1) * 0.6) * (right ? 1 : -1);
  return `M${x1},${y1} C${x1 + d},${y1} ${x2 - d},${y2} ${x2},${y2}`;
}

function format(value: NonNullable<FlowNode["value"]>, n: number) {
  const digits = value.decimals ?? 0;
  return `${value.prefix ?? ""}${n.toLocaleString("en-US", { minimumFractionDigits: digits, maximumFractionDigits: digits })}${value.suffix ?? ""}`;
}

export function LandingFlow({ graph, title, playing }: { graph: FlowGraph; title: string; playing: boolean }) {
  const wrapRef = useRef<HTMLDivElement>(null);
  const stageRef = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(W);
  const narrow = width < 470;
  const playingRef = useRef(playing);
  const visibleRef = useRef(false);
  const timelineRef = useRef<ReturnType<typeof createTimeline> | null>(null);
  const svgRef = useRef<SVGSVGElement>(null);
  const uid = useId().replace(/[^a-zA-Z0-9]/g, "");

  // Positions: the grid on a wide canvas; the rail, in the order the nodes are listed, on a narrow one.
  const boxes = new Map<string, Box>(graph.nodes.map((node, i) => [node.id, narrow
    ? { x: NARROW_NODE_X, y: NARROW_TOP + i * NARROW_STEP, w: NARROW_NODE_W, h: NARROW_NODE_H }
    : { x: COL_X[node.col], y: ROW_Y[node.row], w: NODE_W, h: NODE_H }]));
  const stageW = narrow ? NARROW_W : W;
  const stageH = narrow ? NARROW_TOP + (graph.nodes.length - 1) * NARROW_STEP + NARROW_NODE_H + 12 : WIDE_H;
  // Narrow: the steps become one connector from each node to the next.
  const steps: Array<Array<[string, string]>> = narrow
    ? graph.nodes.slice(1).map((node, i) => [[graph.nodes[i].id, node.id]])
    : graph.steps;
  const edges = steps.flat();
  const scale = Math.min(1, width / stageW);

  useLayoutEffect(() => {
    const wrap = wrapRef.current;
    if (!wrap) return;
    const fit = () => setWidth(wrap.clientWidth || W);
    fit();
    const observer = new ResizeObserver(fit);
    observer.observe(wrap);
    return () => observer.disconnect();
  }, []);

  // The run, rebuilt when the layout changes between wide and narrow.
  useEffect(() => {
    const stage = stageRef.current;
    if (!stage || window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    const q = <T extends Element>(selector: string) => [...stage.querySelectorAll<T>(selector)];
    const node = (id: string) => stage.querySelector<HTMLElement>(`[data-node="${id}"]`);
    const path = (from: string, to: string) => stage.querySelector<SVGPathElement>(`[data-edge="${from}>${to}"]`);
    const packets = q<SVGCircleElement>("[data-packet]");
    const counter = stage.querySelector<HTMLElement>("[data-step]");
    const outcome = graph.nodes.find((n) => n.value);
    const figure = outcome ? stage.querySelector<HTMLElement>(`[data-node="${outcome.id}"] [data-value]`) : null;
    const firsts = new Set(steps[0]?.map(([from]) => from));

    const tl = createTimeline({ autoplay: false, loop: true, loopDelay: 900, defaults: { ease: "inOutSine" } });
    // Reset: everything waiting except where the work starts.
    tl.set(q("[data-node]"), { opacity: 0.5, translateZ: LIFT_WAIT }, 0)
      .set(q("[data-lit]"), { opacity: 0 }, 0)
      .set(q("[data-done]"), { opacity: 0, scale: 0.4 }, 0)
      .set(packets, { opacity: 0 }, 0)
      .call(() => { if (counter) counter.textContent = `Step 1 of ${steps.length}`; if (figure && outcome?.value) figure.textContent = format(outcome.value, 0); }, 0);
    q<SVGPathElement>("[data-edge]").forEach((el) => { tl.set(svg.createDrawable(el), { draw: "0 0" }, 0); });
    firsts.forEach((id) => {
      const el = node(id);
      if (!el) return;
      tl.add(el, { opacity: 1, translateZ: LIFT_DONE, duration: 420, ease: "outBack(1.6)" }, 150)
        .add(el.querySelectorAll("[data-lit]"), { opacity: 1, duration: 300 }, 150)
        .add(el.querySelectorAll("[data-done]"), { opacity: 1, scale: 1, duration: 320, ease: "outBack(2)" }, 350);
    });

    let at = 700;
    steps.forEach((step, s) => {
      tl.call(() => { if (counter) counter.textContent = `Step ${s + 1} of ${steps.length}`; }, at);
      step.forEach(([from, to], k) => {
        const el = path(from, to);
        const packet = packets[edges.findIndex(([f, t]) => f === from && t === to)];
        const target = node(to);
        if (!el || !packet || !target) return;
        const run = 900;
        tl.set(packet, { opacity: 1 }, at)
          .add(packet, { ...svg.createMotionPath(el), duration: run, ease: "inOutQuad" }, at)
          .add(svg.createDrawable(el), { draw: ["0 0", "0 1"], duration: run, ease: "inOutQuad" }, at)
          .add(packet, { opacity: 0, duration: 160 }, at + run - 60)
          .add(target, { opacity: 1, translateZ: LIFT_DONE, duration: 520, ease: "outBack(1.8)" }, at + run - 120)
          .add(target.querySelectorAll("[data-lit]"), { opacity: 1, duration: 280 }, at + run - 120)
          .add(target.querySelectorAll("[data-done]"), { opacity: 1, scale: 1, duration: 340, ease: "outBack(2)" }, at + run + 60 + k * 40);
      });
      at += 1250;
    });
    if (figure && outcome?.value) {
      const value = outcome.value;
      const n = { v: 0 };
      tl.add(n, { v: value.to, duration: 900, ease: "outCubic", onUpdate: () => { figure.textContent = format(value, n.v); } }, at - 300);
    }
    // Hold the finished run before the next one.
    tl.add({ duration: 2400 }, at + 600);
    timelineRef.current = tl;
    if (playingRef.current && visibleRef.current) tl.play();

    const io = new IntersectionObserver(([entry]) => {
      visibleRef.current = Boolean(entry?.isIntersecting);
      if (visibleRef.current && playingRef.current) tl.play(); else tl.pause();
      // The stream flows whenever the canvas is on screen, front card or not.
      if (visibleRef.current) svgRef.current?.unpauseAnimations(); else svgRef.current?.pauseAnimations();
    }, { threshold: 0.35 });
    io.observe(stage);
    return () => {
      io.disconnect();
      tl.revert();
      timelineRef.current = null;
      // Leave the finished state on screen, as without a script.
      utils.set(q("[data-node]"), { opacity: 1, translateZ: LIFT_DONE });
      utils.set(q("[data-lit], [data-done]"), { opacity: 1, scale: 1 });
    };
    // The graph never changes after it renders; only the layout does.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [narrow]);

  // The canvas turns a little towards a mouse pointer.
  const tilt = (event: ReactPointerEvent<HTMLDivElement>) => {
    const stage = stageRef.current;
    if (event.pointerType !== "mouse" || !stage || window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    const r = event.currentTarget.getBoundingClientRect();
    stage.style.setProperty("--ty", `${((event.clientX - r.left) / r.width - 0.5) * 10}deg`);
    stage.style.setProperty("--tx", `${((event.clientY - r.top) / r.height - 0.5) * -8}deg`);
  };
  const untilt = () => { stageRef.current?.style.setProperty("--ty", "0deg"); stageRef.current?.style.setProperty("--tx", "0deg"); };

  useEffect(() => {
    playingRef.current = playing;
    const tl = timelineRef.current;
    if (!tl) return;
    if (playing && visibleRef.current) tl.play(); else tl.pause();
  }, [playing]);

  return (
    <div ref={wrapRef} className={styles.wrap} style={{ height: stageH * scale }} aria-hidden="true" onPointerMove={tilt} onPointerLeave={untilt}>
      <div className={styles.fit} style={{ width: stageW, height: stageH, transform: `scale(${scale})` } as CSSProperties}>
      <div ref={stageRef} className={styles.stage} data-narrow={narrow ? "" : undefined} style={{ width: stageW, height: stageH }}>
        <div className={styles.bar}>
          {/* Narrow canvases name no module: the card's heading, just above, already does. */}
          <span className={styles.barTitle}><Workflow />{narrow ? "Workflow" : title}</span>
          <span className={styles.barStep} data-step="">{steps.length} steps</span>
        </div>
        <svg ref={svgRef} className={styles.wires} width={stageW} height={stageH} viewBox={`0 0 ${stageW} ${stageH}`}>
          {edges.map(([from, to]) => {
            const d = (narrow ? rail : curve)(boxes.get(from)!, boxes.get(to)!);
            return (
              <g key={`${from}>${to}`}>
                <path className={styles.wire} d={d} />
                <path className={styles.wireLit} d={d} data-edge={`${from}>${to}`} />
                <path className={styles.wireFlow} d={d} id={`${uid}-${from}-${to}`} />
                {Array.from({ length: STREAM }, (_, k) => (
                  <circle key={k} className={styles.stream} r={2.6}>
                    <animateMotion dur={`${STREAM_S}s`} begin={`${(-k * STREAM_S) / STREAM}s`} repeatCount="indefinite" keyPoints="0;1" keyTimes="0;1" calcMode="linear">
                      <mpath href={`#${uid}-${from}-${to}`} />
                    </animateMotion>
                  </circle>
                ))}
              </g>
            );
          })}
          {/* The rail's stops, one beside each step. */}
          {narrow && graph.nodes.map((node) => {
            const box = boxes.get(node.id)!;
            return <circle key={`r-${node.id}`} className={styles.railStop} data-kind={node.kind ?? "step"} r={4.5} cx={RAIL_X} cy={box.y + box.h / 2} />;
          })}
          {edges.map(([from, to]) => <circle key={`p-${from}>${to}`} className={styles.packet} r={5} cx={0} cy={0} data-packet="" />)}
        </svg>
        {graph.nodes.map((node) => {
          const Icon = node.icon;
          const box = boxes.get(node.id)!;
          return (
            <div key={node.id} className={styles.node} data-node={node.id} data-kind={node.kind ?? "step"} style={{ left: box.x, top: box.y, width: box.w, height: box.h }}>
              <span className={styles.ring} data-lit="" />
              <span className={styles.icon}><Icon /></span>
              <span className={styles.text}>
                <b>{node.label}</b>
                {node.value ? <small><span data-value="">{format(node.value, node.value.to)}</span> {node.sub}</small> : <small>{node.sub}</small>}
              </span>
              <span className={styles.done} data-done=""><Check /></span>
            </div>
          );
        })}
      </div>
      </div>
    </div>
  );
}
