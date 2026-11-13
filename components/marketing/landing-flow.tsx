"use client";

import { memo, useEffect, useLayoutEffect, useRef, useState } from "react";
import type { CSSProperties, PointerEvent as ReactPointerEvent } from "react";
import type { LucideIcon } from "lucide-react";
import { Check, Workflow } from "lucide-react";

import styles from "@/components/marketing/landing-flow.module.css";

/**
 * A module's workflow, drawn as a small automation canvas (Umar, 4 Nov, A5.3: "flow diagrams where
 * they pass data and show the whole workflow … an animated video card"; owner, 6 Nov: show how the
 * pieces each card names connect, and make it impressive).
 *
 * Floating glass (owner, 10 Nov, mockup A2): a thick glass plate leans back in perspective, labelled
 * "Comes in / Insurvas / Comes out"; the module's pages float above it as glass boxes, the wires
 * between them float too, and both cast soft shadows on the plate. In each step the record itself
 * (a pill naming it: "Line 14 · $84.00") rides the wire, the wire lights behind it, and the box it
 * reaches rises, glows and takes its tick; the outcome counts up its figure. Data streams along every
 * wire all the time, and the plate sways slowly so the depth reads.
 *
 * It runs only while its card is in front (`playing`) and on screen. Without a script, or under
 * reduced motion, the finished run is shown still. Narrow screens get the same boxes as one flat
 * column with the record running down a rail. Decorative: the card's text carries every claim, so the
 * canvas is aria-hidden.
 *
 * Cost: everything that moves is transform or opacity (the glow is a ring's opacity, not an animated
 * shadow); the shadows and blurs are static, so they are drawn once.
 */
// How far a reached box rises while its run plays. The floating layer is flat inside (its content is
// one picture unless something on it moves), so the rise is a lift and a little growth, not real depth:
// with every box, light and record of all seven cards on a graphics layer of its own, scrolling the
// stack dropped frames (measured, 11 Nov: about 200 layers from these canvases alone).
const LIFT_DONE = 10;
const STREAM = 2; // lights per wire
const STREAM_MS = 1800; // for one light to cross a wire
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
/** Each step is the connectors that run together, as [from, to] node ids. `record` names what travels. */
export type FlowGraph = { nodes: FlowNode[]; steps: Array<Array<[string, string]>>; record: string };

const W = 620;
const NODE_W = 182;
const NODE_H = 70;
const OUTCOME_H = 98;
const COL_X = [6, 219, 432];
const ROW_Y = [70, 170, 270];
const WIDE_H = 380;
const COLUMNS = ["Comes in", "Insurvas", "Comes out"];
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

type Box = { x: number; y: number; w: number; h: number };

/** The rail between two steps: straight down the left edge, centre to centre. */
function rail(a: Box, b: Box): string {
  return `M${RAIL_X},${a.y + a.h / 2} L${RAIL_X},${b.y + b.h / 2}`;
}

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

/** Where the outcome's count starts each run: most of the way there, so it reads as going up, not as nothing. */
function start(value: NonNullable<FlowNode["value"]>) {
  const factor = 10 ** (value.decimals ?? 0);
  return Math.round(value.to * 0.85 * factor) / factor;
}

function format(value: NonNullable<FlowNode["value"]>, n: number) {
  const digits = value.decimals ?? 0;
  return `${value.prefix ?? ""}${n.toLocaleString("en-US", { minimumFractionDigits: digits, maximumFractionDigits: digits })}${value.suffix ?? ""}`;
}

/**
 * Memoised (13 Nov, owner: "make the scrolling on these cards smoother"): when the card in front
 * changes, only the two diagrams whose `playing` flips re-render, not all seven in the scroll frame.
 */
export const LandingFlow = memo(function LandingFlow({ graph, playing }: { graph: FlowGraph; playing: boolean }) {
  const wrapRef = useRef<HTMLDivElement>(null);
  const swayRef = useRef<HTMLDivElement>(null);
  const stageRef = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(W);
  const narrow = width < 470;
  const playingRef = useRef(playing);
  const visibleRef = useRef(false);
  const controlRef = useRef<((on: boolean) => void) | null>(null);
  // Everything that moves runs only on the card in front, while it is on screen: the record's run,
  // the sway and the dash along the wires. A card covered in the stack still counts as on screen but
  // shows only its top edge, and its moving dash repainted the whole card every frame (owner, 10 Nov:
  // "the scrolling here isn't smooth at all"). Reads the refs when called.
  const syncRef = useRef(() => {
    const on = playingRef.current && visibleRef.current;
    controlRef.current?.(on);
    swayRef.current?.toggleAttribute("data-flowing", on);
  });

  // Positions: the grid on a wide canvas (the outcome taller, centred on its row); the rail, in the
  // order the nodes are listed, on a narrow one.
  const boxes = new Map<string, Box>(graph.nodes.map((node, i) => {
    if (narrow) return [node.id, { x: NARROW_NODE_X, y: NARROW_TOP + i * NARROW_STEP, w: NARROW_NODE_W, h: NARROW_NODE_H }];
    const h = node.kind === "outcome" ? OUTCOME_H : NODE_H;
    return [node.id, { x: COL_X[node.col], y: ROW_Y[node.row] + (NODE_H - h) / 2, w: NODE_W, h }];
  }));
  const stageW = narrow ? NARROW_W : W;
  const stageH = narrow ? NARROW_TOP + (graph.nodes.length - 1) * NARROW_STEP + NARROW_NODE_H + 12 : WIDE_H;
  // Narrow: the steps become one connector from each node to the next.
  const steps: Array<Array<[string, string]>> = narrow
    ? graph.nodes.slice(1).map((node, i) => [[graph.nodes[i].id, node.id]])
    : graph.steps;
  const edges = steps.flat();
  const paths = edges.map(([from, to]) => (narrow ? rail : curve)(boxes.get(from)!, boxes.get(to)!));
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

  // The run, rebuilt when the layout changes between wide and narrow. It is one loop of Web Animations
  // (owner, 10 Nov: "as smooth as possible"): every box, ring, tick, wire, light and record moves by
  // transform or opacity on the browser's compositor, so the run stays smooth while the page scrolls;
  // only the outcome's figure touches the main thread, and only while it counts.
  useEffect(() => {
    const stage = stageRef.current;
    if (!stage || window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    const node = (id: string) => stage.querySelector<HTMLElement>(`[data-node="${id}"]`);
    const records = [...stage.querySelectorAll<HTMLElement>("[data-record]")];
    const lits = [...stage.querySelectorAll<SVGPathElement>("[data-edge]")];
    const dots = [...stage.querySelectorAll<HTMLElement>("[data-stream]")];
    const move = (p: DOMPoint) => ({ transform: `translate(${p.x.toFixed(2)}px, ${p.y.toFixed(2)}px)` });
    const outcome = graph.nodes.find((n) => n.value);
    const figure = outcome ? stage.querySelector<HTMLElement>(`[data-node="${outcome.id}"] [data-value]`) : null;
    const firsts = new Set(steps[0]?.map(([from]) => from));

    // The schedule, in ms: the starting boxes settle, then each step carries its record (RUN ms) and
    // lifts the box it reaches; the last step's figure counts up; the finished run holds; then
    // everything eases back to the glass for the next.
    const RUN = 1000;
    const hits = new Map<string, number>();
    const legs: Array<{ edge: number; at: number }> = [];
    let at = 700;
    steps.forEach((step, s) => {
      step.forEach(([from, to]) => {
        legs.push({ edge: edges.findIndex(([f, t]) => f === from && t === to), at });
        if (!hits.has(to)) hits.set(to, at + RUN - 140);
      });
      at += s === steps.length - 1 ? 1300 : 1400;
    });
    const countAt = at - 400;
    const T = at + 3000;
    const RESET = T - 520;

    // Measuring a wire (getTotalLength, getPointAtLength) is the costly part of a build, and it was
    // done afresh every time the card came to the front, inside that scroll frame. Each wire is
    // measured once, the first time it is needed or in a quiet moment after the page settles.
    const rideCache = new Map<number, DOMPoint[]>();
    const streamCache = new Map<number, Keyframe[]>();
    const ridePoints = (edge: number, lit: SVGPathElement) => {
      let points = rideCache.get(edge);
      if (!points) {
        const total = lit.getTotalLength();
        const SAMPLES = 32;
        points = Array.from({ length: SAMPLES + 1 }, (_, i) => {
          const u = i / SAMPLES;
          return lit.getPointAtLength(total * (u < 0.5 ? 2 * u * u : 1 - (-2 * u + 2) ** 2 / 2));
        });
        rideCache.set(edge, points);
      }
      return points;
    };
    const streamFrames = (index: number, lit: SVGPathElement) => {
      let frames = streamCache.get(index);
      if (!frames) {
        const total = lit.getTotalLength();
        const SAMPLES = 16;
        frames = Array.from({ length: SAMPLES + 1 }, (_, k) => {
          const u = k / SAMPLES;
          return { ...move(lit.getPointAtLength(total * u)), opacity: u < 0.15 ? u / 0.15 : u > 0.85 ? (1 - u) / 0.15 : 1, offset: u };
        });
        streamCache.set(index, frames);
      }
      return frames;
    };
    const idle = (run: () => void) => {
      const w = window as Window & { requestIdleCallback?: (cb: () => void, o?: { timeout: number }) => number; cancelIdleCallback?: (id: number) => void };
      if (w.requestIdleCallback) { const id = w.requestIdleCallback(run, { timeout: 400 }); return () => w.cancelIdleCallback?.(id); }
      const id = window.setTimeout(run, 120);
      return () => window.clearTimeout(id);
    };
    const warm = idle(() => { legs.forEach(({ edge }) => { if (lits[edge]) ridePoints(edge, lits[edge]); }); lits.forEach((lit, i) => streamFrames(i, lit)); });

    let anims: Animation[] = [];
    // One looping animation per element, its keyframes placed on the shared T-long loop.
    const loop = (el: Element, frames: Array<[number, Keyframe]>) => {
      anims.push(el.animate(frames.map(([t, k]) => ({ ...k, offset: Math.min(1, Math.max(0, t / T)) })), { duration: T, iterations: Infinity, fill: "both" }));
    };
    const OUT = "cubic-bezier(.23, 1, .32, 1)";
    const POP = "cubic-bezier(.34, 1.56, .64, 1)";
    const IN_OUT = "cubic-bezier(.45, 0, .55, 1)";
    const z = (v: number) => (v ? `translateY(${(-v * 0.4).toFixed(1)}px) scale(${(1 + v * 0.0025).toFixed(4)})` : "none");

    // Built when the card comes to the front and cancelled when it leaves: a paused animation still
    // keeps its element on a layer of its own, and the seven cards' boxes, lights and records on
    // layers made every scroll frame of the stack slow (measured, 11 Nov). Each run starts afresh.
    const build = () => {
      graph.nodes.forEach((n) => {
        const el = node(n.id);
        if (!el) return;
        const first = firsts.has(n.id);
        const hit = first ? 150 : hits.get(n.id);
        if (hit === undefined) return; // never reached in this run: stays finished.
        const ring = el.querySelector("[data-lit]");
        const done = el.querySelector("[data-done]");
        // The box rises off the glass, overshoots and settles; the ring flares and stays softly lit.
        loop(el, first
          ? [[0, { transform: z(0) }], [hit, { transform: z(0), easing: POP }], [hit + 500, { transform: z(LIFT_DONE) }], [RESET, { transform: z(LIFT_DONE), easing: IN_OUT }], [T - 60, { transform: z(0) }], [T, { transform: z(0) }]]
          : [[0, { transform: z(0) }], [hit, { transform: z(0), easing: OUT }], [hit + 320, { transform: z(26), easing: IN_OUT }], [hit + 900, { transform: z(LIFT_DONE) }], [RESET, { transform: z(LIFT_DONE), easing: IN_OUT }], [T - 60, { transform: z(0) }], [T, { transform: z(0) }]]);
        if (ring) loop(ring, first
          ? [[0, { opacity: 0 }], [T, { opacity: 0 }]]
          : [[0, { opacity: 0 }], [hit, { opacity: 0, easing: OUT }], [hit + 260, { opacity: 1, easing: IN_OUT }], [hit + 900, { opacity: 0.45 }], [RESET, { opacity: 0.45, easing: IN_OUT }], [T - 60, { opacity: 0 }], [T, { opacity: 0 }]]);
        const tick = hit + (first ? 200 : 220);
        if (done) loop(done, [[0, { opacity: 0, transform: "scale(.4)" }], [tick, { opacity: 0, transform: "scale(.4)", easing: POP }], [tick + 360, { opacity: 1, transform: "scale(1)" }], [RESET, { opacity: 1, transform: "scale(1)", easing: IN_OUT }], [T - 60, { opacity: 0, transform: "scale(.4)" }], [T, { opacity: 0, transform: "scale(.4)" }]]);
      });

      legs.forEach(({ edge, at: t0 }) => {
        const lit = lits[edge];
        const record = records[edge];
        if (!lit || !record) return;
        // The wire lights up behind the record, stays lit, and fades for the next run.
        const layer = lit.ownerSVGElement;
        if (layer) loop(layer, [[0, { opacity: 0 }], [t0 + 150, { opacity: 0, easing: IN_OUT }], [t0 + RUN, { opacity: 1 }], [RESET, { opacity: 1, easing: IN_OUT }], [T - 60, { opacity: 0 }], [T, { opacity: 0 }]]);
        // The record's path, baked into transform keyframes with the ease built in, so the compositor
        // carries it; it shows only once clear of the box it leaves and is gone before the next.
        const ride = ridePoints(edge, lit);
        const moves: Array<[number, Keyframe]> = [[0, move(ride[0])]];
        ride.forEach((point, i) => moves.push([t0 + (RUN * i) / (ride.length - 1), move(point)]));
        moves.push([T, move(ride[ride.length - 1])]);
        loop(record, moves);
        const pill = record.firstElementChild;
        if (pill) loop(pill, [[0, { opacity: 0 }], [t0 + 120, { opacity: 0, easing: OUT }], [t0 + 320, { opacity: 1 }], [t0 + RUN - 320, { opacity: 1, easing: IN_OUT }], [t0 + RUN - 120, { opacity: 0 }], [T, { opacity: 0 }]]);
      });

      // The stream: STREAM lights per wire, evenly spaced, riding it end to end at a steady pace and
      // fading in and out at its ends; their own short loop, independent of the run's.
      lits.forEach((lit, i) => {
        const frames = streamFrames(i, lit);
        dots.slice(i * STREAM, i * STREAM + STREAM).forEach((dot, k) => {
          anims.push(dot.animate(frames, { duration: STREAM_MS, iterations: Infinity, delay: (-k * STREAM_MS) / STREAM }));
        });
      });
    };

    // The outcome's figure: written only while it counts, and only when it changes.
    let raf = 0;
    let shown = "";
    const tickFigure = () => {
      raf = requestAnimationFrame(tickFigure);
      const clock = anims[0];
      if (!figure || !outcome?.value || !clock) return;
      const t = Number(clock.currentTime ?? 0) % T;
      const u = Math.min(1, Math.max(0, (t - countAt) / 900));
      const from = start(outcome.value);
      const text = format(outcome.value, from + (outcome.value.to - from) * (1 - (1 - u) ** 3));
      if (text !== shown) { figure.textContent = text; shown = text; }
    };
    const settle = () => {
      // Cancelled, everything falls back to its finished look in CSS, as without a script.
      anims.forEach((a) => a.cancel());
      anims = [];
      if (figure && outcome?.value) figure.textContent = format(outcome.value, outcome.value.to);
      shown = "";
    };
    // Starting is deferred to the frame after the one that brought the card forward, so the scroll
    // frame only flips a flag; stopping is immediate (it only cancels).
    let starting = 0;
    controlRef.current = (on: boolean) => {
      cancelAnimationFrame(raf);
      cancelAnimationFrame(starting);
      if (!on) { settle(); return; }
      starting = requestAnimationFrame(() => {
        starting = requestAnimationFrame(() => {
          if (!anims.length) build();
          if (figure) raf = requestAnimationFrame(tickFigure);
        });
      });
    };
    syncRef.current();

    const io = new IntersectionObserver(([entry]) => {
      visibleRef.current = Boolean(entry?.isIntersecting);
      syncRef.current();
    }, { threshold: 0.35 });
    io.observe(stage);
    return () => {
      io.disconnect();
      warm();
      cancelAnimationFrame(starting);
      cancelAnimationFrame(raf);
      controlRef.current = null;
      settle();
    };
    // The graph never changes after it renders; only the layout does.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [narrow]);

  // The plate turns a little towards a mouse pointer. Set on the plate itself, not through an inherited
  // custom property, so nothing inside it has its style recalculated.
  const lean = (x: number, y: number) => {
    const stage = stageRef.current;
    if (stage && !narrow) stage.style.transform = `rotateX(${25 + y}deg) rotateY(${-11 + x}deg) rotateZ(2deg)`;
  };
  const tilt = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (event.pointerType !== "mouse" || window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    const r = event.currentTarget.getBoundingClientRect();
    lean(((event.clientX - r.left) / r.width - 0.5) * 10, ((event.clientY - r.top) / r.height - 0.5) * -8);
  };
  const untilt = () => lean(0, 0);
  // A lean left from a wide layout must not tilt the flat narrow one.
  useEffect(() => { if (narrow && stageRef.current) stageRef.current.style.transform = ""; }, [narrow]);

  useEffect(() => {
    playingRef.current = playing;
    syncRef.current();
  }, [playing]);

  return (
    <div ref={wrapRef} className={styles.wrap} style={{ height: stageH * scale }} aria-hidden="true" onPointerMove={tilt} onPointerLeave={untilt}>
      <div className={styles.fit} style={{ width: stageW, height: stageH, transform: `scale(${scale})` } as CSSProperties}>
      <div ref={swayRef} className={styles.sway} style={{ width: stageW, height: stageH }}>
      <div ref={stageRef} className={styles.stage} data-narrow={narrow ? "" : undefined} style={{ width: stageW, height: stageH }}>
        {/* The plate's thickness: its front and right edges, seen under the tilt. */}
        {!narrow && <><span className={styles.edgeB} /><span className={styles.edgeR} /></>}
        <div className={styles.plate}>
          {narrow
            ? <div className={styles.bar}><span className={styles.barTitle}><Workflow />Workflow</span></div>
            : COLUMNS.map((label, c) => (
              <span key={label} className={styles.column} data-col={c} style={{ left: COL_X[c] + 4 }}>{label}</span>
            ))}
          {/* What the floating layer casts on the plate: painted with the plate, never animated. */}
          {!narrow && (
            <div className={styles.shadows}>
              <svg className={styles.shadowWires} width={stageW} height={stageH} viewBox={`0 0 ${stageW} ${stageH}`}>
                {paths.map((d, i) => <path key={i} d={d} />)}
              </svg>
              {graph.nodes.map((node) => {
                const box = boxes.get(node.id)!;
                return <span key={node.id} className={styles.cast} style={{ left: box.x, top: box.y, width: box.w, height: box.h }} />;
              })}
            </div>
          )}
        </div>
        <div className={styles.float}>
        <div className={styles.flat}>
          {/* The wires themselves: never repainted. */}
          <svg className={styles.wires} width={stageW} height={stageH} viewBox={`0 0 ${stageW} ${stageH}`}>
            {paths.map((d, i) => (
              <g key={i}>
                <path className={styles.wireGlow} d={d} />
                <path className={styles.wire} d={d} />
              </g>
            ))}
            {/* The rail's stops, one beside each step. */}
            {narrow && graph.nodes.map((node) => {
              const box = boxes.get(node.id)!;
              return <circle key={`r-${node.id}`} className={styles.railStop} data-kind={node.kind ?? "step"} r={4.5} cx={RAIL_X} cy={box.y + box.h / 2} />;
            })}
          </svg>
          {/* Each lit wire is a layer of its own, so the run fades it in on the compositor (a change
              inside an SVG can only be repainted, on the main thread). */}
          {edges.map(([from, to], i) => (
            <svg key={`lit-${from}>${to}`} className={styles.litLayer} data-lit-wire="" width={stageW} height={stageH} viewBox={`0 0 ${stageW} ${stageH}`}>
              <path className={styles.wireLitGlow} d={paths[i]} />
              <path className={styles.wireLit} d={paths[i]} data-edge={`${from}>${to}`} />
            </svg>
          ))}
          {/* The stream: small lights riding every wire all the time, carried by the compositor. */}
          {edges.map(([from, to]) => Array.from({ length: STREAM }, (_, k) => (
            <span key={`dot-${from}>${to}-${k}`} className={styles.streamDot} data-stream="" />
          )))}
          {graph.nodes.map((node) => {
            const Icon = node.icon;
            const box = boxes.get(node.id)!;
            const outcome = node.kind === "outcome" && !narrow;
            return (
              <div key={node.id} className={styles.node} data-node={node.id} data-kind={node.kind ?? "step"} style={{ left: box.x, top: box.y, width: box.w, height: box.h }}>
                <span className={styles.ring} data-lit="" />
                {outcome ? (
                  <>
                    <span className={styles.outLabel}><Icon />{node.label}</span>
                    <b className={styles.outValue} data-value="">{node.value ? format(node.value, node.value.to) : ""}</b>
                    <small className={styles.outSub}>{node.sub}</small>
                  </>
                ) : (
                  <>
                    <span className={styles.icon}><Icon /></span>
                    <span className={styles.text}>
                      <b>{node.label}</b>
                      {node.value ? <small><span data-value="">{format(node.value, node.value.to)}</span> {node.sub}</small> : <small>{node.sub}</small>}
                    </span>
                  </>
                )}
                <span className={styles.done} data-done=""><Check /></span>
              </div>
            );
          })}
          {/* The record: one pill per wire, carried along it by the run. */}
          {edges.map(([from, to]) => (
            <span key={`rec-${from}>${to}`} className={styles.record} data-record="">
              <span className={styles.recordPill}><i />{narrow ? "" : graph.record}</span>
            </span>
          ))}
        </div>
        </div>
      </div>
      </div>
      </div>
    </div>
  );
});
