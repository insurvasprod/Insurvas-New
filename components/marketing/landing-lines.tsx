"use client";

import { useEffect, useRef } from "react";
import type { KeyboardEvent as ReactKeyboardEvent, ReactNode } from "react";
import { ChevronLeft, ChevronRight, HandHeart, HeartPulse, Hospital, Hourglass, Infinity as InfinityIcon, ShieldCheck, Stethoscope, TrendingUp, type LucideIcon } from "lucide-react";

import { ParticlesWaves } from "@/components/marketing/particles-waves";
import styles from "@/components/marketing/landing-lines.module.css";

/**
 * `LandingLines`: life and health, told as a before and after (owner, 10 Nov; spec in
 * tasks/landing-life-health/spec.md). Two drawn scenes in one frame with a slider between them:
 * "Then", where Insurvas began, on the life insurance floor; "Now", life and health under one roof.
 * When the band arrives the slider rests on "Then", then glides across to reveal "Now". Anyone can
 * take the handle and drag it back.
 *
 * The scenes are drawn rather than photographed: a field of particles on an undulating plane
 * (`particles-waves.tsx`), one green for "Then" and a denser field reaching the pale crest for
 * "Now" — the business grew.
 * Earlier passes used a lit sales floor in perspective and then blurred ribbons; both are recorded
 * in the stylesheet and in tasks/landing-corner-cue/todo.md.
 *
 * Life lines are the app's product catalogue. Medicare Advantage is in the catalogue; Medicare
 * Supplement and ACA Marketplace are TO CONFIRM (owner): an Insurvas admin adds them to the product
 * list before this goes live.
 */
type Line = { name: string; Icon: LucideIcon };
const LIFE: Line[] = [
  { name: "Final Expense", Icon: HandHeart },
  { name: "Term Life", Icon: Hourglass },
  { name: "Whole Life", Icon: InfinityIcon },
  { name: "IUL", Icon: TrendingUp },
];
const HEALTH: Line[] = [
  { name: "Medicare Advantage", Icon: Stethoscope },
  { name: "Medicare Supplement", Icon: HeartPulse },
  { name: "ACA Marketplace", Icon: Hospital },
];

// One short line each, a pair that reads as a sentence across the divider (owner, 10 Nov: "tell
// that we were only on life insurance and now we have both, without too much text").
const SCENES: Record<"then" | "now", { tag: string; headline: ReactNode; groups: { label: string; Icon: LucideIcon; lines: Line[] }[] }> = {
  then: {
    tag: "Then",
    headline: <>We started with<br /> <em>life</em> insurance.</>,
    groups: [{ label: "Life", Icon: ShieldCheck, lines: LIFE }],
  },
  now: {
    tag: "Now",
    headline: <>Now we cover <em>life</em> and<br /> <em>health</em> insurance.</>,
    groups: [
      { label: "Life", Icon: ShieldCheck, lines: LIFE },
      { label: "Health", Icon: HeartPulse, lines: HEALTH },
    ],
  },
};

function Scene({ side }: { side: "then" | "now" }) {
  const scene = SCENES[side];
  return (
    <div className={styles.scene} data-side={side}>
      {/* The background: a field of particles on a plane that undulates, seen in perspective with
          the depth of field of a camera. See `particles-waves.tsx`. "Then" runs the smaller field
          in one green, "Now" a denser one reaching the pale crest: the second line of business. */}
      <span className={styles.field} aria-hidden="true">
        <ParticlesWaves side={side} />
        <span className={styles.bloom} />
      </span>
      <span className={styles.grain} aria-hidden="true" />
      <span className={styles.tag}>{scene.tag}</span>
      <div className={styles.content}>
        <h3 className={styles.headline}>{scene.headline}</h3>
        <div className={styles.groups}>
          {scene.groups.map(({ label, Icon, lines }) => (
            <ul key={label} className={styles.group} aria-label={`${label} insurance`}>
              <li className={styles.groupLabel}><Icon aria-hidden="true" />{label}</li>
              {lines.map(({ name, Icon: LineIcon }) => (
                <li key={name} className={styles.chip}><LineIcon aria-hidden="true" />{name}</li>
              ))}
            </ul>
          ))}
        </div>
      </div>
    </div>
  );
}

const clampPos = (n: number) => Math.min(100, Math.max(0, n));
const easeInOut = (t: number) => (t < 0.5 ? 4 * t * t * t : 1 - (-2 * t + 2) ** 3 / 2);

export function LandingLines() {
  const frameRef = useRef<HTMLDivElement>(null);
  const clipRef = useRef<HTMLDivElement>(null);
  const innerRef = useRef<HTMLDivElement>(null);
  const handleRef = useRef<HTMLDivElement>(null);
  /** How much of "Then" shows, from the left, in percent. */
  const pos = useRef(100);
  const setPosRef = useRef<(p: number) => void>(() => {});
  const stopRef = useRef<() => void>(() => {});

  useEffect(() => {
    const frame = frameRef.current;
    const clip = clipRef.current;
    const inner = innerRef.current;
    const handle = handleRef.current;
    if (!frame || !clip || !inner || !handle) return;
    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const knob = handle.firstElementChild as HTMLElement | null;
    let width = frame.clientWidth;
    let shownValue = -1;

    // The reveal is two transforms moving against each other: the wrapper slides away to the left
    // while "Then" inside it slides back by the same amount, so "Then" stays put and is cut off at
    // the divider. Only transforms change, so the glide and a drag never repaint the scenes.
    const parts = [clip, inner, handle, knob].filter(Boolean) as HTMLElement[];
    /** The four transforms for a position, in the order of `parts`. */
    const transformsAt = (p: number) => {
      const off = 100 - p;
      const x = (width * p) / 100;
      const all = [
        `translate3d(${(-off).toFixed(3)}%, 0, 0)`,
        `translate3d(${off.toFixed(3)}%, 0, 0)`,
        `translate3d(${x.toFixed(1)}px, 0, 0)`,
        // The line goes to the very edge; the round knob stays whole inside the frame.
        `translate3d(${(Math.min(width - 34, Math.max(34, x)) - x).toFixed(1)}px, 0, 0)`,
      ];
      return knob ? all : all.slice(0, 3);
    };
    const setPos = (p: number) => {
      pos.current = clampPos(p);
      transformsAt(pos.current).forEach((value, i) => { parts[i].style.transform = value; });
      const value = Math.round(pos.current);
      if (value !== shownValue) {
        shownValue = value;
        handle.setAttribute("aria-valuenow", String(value));
        handle.setAttribute("aria-valuetext", value > 50 ? `Mostly then, ${value}%` : `Mostly now, ${100 - value}%`);
        frame.toggleAttribute("data-now", value < 50);
      }
    };
    setPosRef.current = setPos;
    setPos(reduce ? 0 : 100);

    const fit = new ResizeObserver(() => { width = frame.clientWidth; setPos(pos.current); });
    fit.observe(frame);

    // The glide: on arrival it rests on "Then", then travels to "Now". Once; a touch cancels it.
    // It runs on the browser's own animation engine, not a script loop, so nothing else the page is
    // doing at that moment can make it stutter (owner, 10 Nov: "the animation of changing is not
    // that smooth"). The easing is baked into the keyframes so all four parts stay in step.
    const GLIDE_MS = 1800;
    let wait = 0;
    let played = reduce;
    let running: Animation[] = [];
    let glideFrom = 100;
    let glideStart = 0;
    const settle = (p: number) => {
      setPos(p); // inline styles first, so cancelling the animations shows no jump
      running.forEach((animation) => animation.cancel());
      running = [];
    };
    const stop = () => {
      window.clearTimeout(wait);
      played = true;
      if (running.length) {
        const t = Math.min(1, (performance.now() - glideStart) / GLIDE_MS);
        settle(glideFrom + (0 - glideFrom) * easeInOut(t));
      }
    };
    stopRef.current = stop;
    const glide = () => {
      glideFrom = pos.current;
      glideStart = performance.now();
      const steps = 30;
      const frames = Array.from({ length: steps + 1 }, (_, i) => transformsAt(glideFrom + (0 - glideFrom) * easeInOut(i / steps)));
      running = parts.map((part, k) => part.animate(frames.map((set) => ({ transform: set[k] })), { duration: GLIDE_MS, easing: "linear", fill: "forwards" }));
      running[0].onfinish = () => settle(0);
    };
    const seen = new IntersectionObserver(([entry]) => {
      const on = Boolean(entry?.isIntersecting);
      // The background used to be CSS animations gated on this attribute. It is a canvas now, and
      // `ParticlesWaves` watches for itself, so nothing reads it any more — the observer stays only to
      // start the glide the first time enough of the band is in view.
      if (on && !played && entry.intersectionRatio >= 0.55) { played = true; wait = window.setTimeout(glide, 800); }
    }, { threshold: [0, 0.55] });
    seen.observe(frame);

    return () => { fit.disconnect(); seen.disconnect(); stop(); };
  }, []);

  // Drag anywhere on the frame; a click jumps. Vertical swipes on a phone still scroll the page
  // (touch-action: pan-y in the CSS), and the browser cancels the drag when it does.
  const drag = (event: React.PointerEvent<HTMLDivElement>) => {
    const frame = frameRef.current;
    if (!frame || (event.pointerType === "mouse" && event.button !== 0)) return;
    stopRef.current();
    frame.setPointerCapture(event.pointerId);
    frame.setAttribute("data-dragging", "");
    const box = frame.getBoundingClientRect();
    const follow = (clientX: number) => setPosRef.current(((clientX - box.left) / box.width) * 100);
    follow(event.clientX);
    const move = (e: PointerEvent) => follow(e.clientX);
    const end = () => {
      frame.removeAttribute("data-dragging");
      frame.removeEventListener("pointermove", move);
      frame.removeEventListener("pointerup", end);
      frame.removeEventListener("pointercancel", end);
    };
    frame.addEventListener("pointermove", move);
    frame.addEventListener("pointerup", end);
    frame.addEventListener("pointercancel", end);
  };

  const keys = (event: ReactKeyboardEvent<HTMLDivElement>) => {
    const step = event.shiftKey ? 25 : 5;
    const next = { ArrowLeft: pos.current - step, ArrowDown: pos.current - step, ArrowRight: pos.current + step, ArrowUp: pos.current + step, Home: 0, End: 100 }[event.key];
    if (next === undefined) return;
    event.preventDefault();
    stopRef.current();
    setPosRef.current(next);
  };

  return (
    <section aria-labelledby="landing-lines-heading" className={styles.band}>
        <h2 id="landing-lines-heading" className={styles.eyebrow}>Life and health</h2>
        <div ref={frameRef} className={styles.frame} onPointerDown={drag}>
          <div className={styles.layer}><Scene side="now" /></div>
          <div ref={clipRef} className={`${styles.layer} ${styles.clip}`}>
            <div ref={innerRef} className={styles.layer}><Scene side="then" /></div>
          </div>
          <div
            ref={handleRef}
            className={styles.handle}
            role="slider"
            tabIndex={0}
            aria-label="Compare where Insurvas began with today"
            aria-valuemin={0}
            aria-valuemax={100}
            aria-valuenow={100}
            onKeyDown={keys}
          >
            <span className={styles.knob} aria-hidden="true"><ChevronLeft /><ChevronRight /></span>
          </div>
        </div>
    </section>
  );
}
