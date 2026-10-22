"use client";

import { Fragment, useEffect, useRef, useState, type CSSProperties, type ReactNode } from "react";

/**
 * Motion for the public pages: reveal-on-scroll, pointer-driven 3D tilt, scroll progress and a
 * one-shot count-up. CSS transforms only — no WebGL, no new dependency — so it is cheap on a phone
 * and nothing here blocks the first paint (every element renders in its final place on the server
 * and the motion is layered on after hydration).
 *
 * Every helper stands still under prefers-reduced-motion: content simply appears.
 */

export function usePrefersReducedMotion() {
  const [reduced, setReduced] = useState(false);
  useEffect(() => {
    const query = window.matchMedia("(prefers-reduced-motion: reduce)");
    const update = () => setReduced(query.matches);
    update();
    query.addEventListener("change", update);
    return () => query.removeEventListener("change", update);
  }, []);
  return reduced;
}

/** True once the element has scrolled into view (and stays true). */
export function useInView<T extends Element>(options: { threshold?: number; rootMargin?: string } = {}) {
  const ref = useRef<T>(null);
  const [inView, setInView] = useState(false);
  const { threshold = 0.2, rootMargin = "0px 0px -8% 0px" } = options;
  useEffect(() => {
    const node = ref.current;
    if (!node || inView) return;
    if (typeof IntersectionObserver === "undefined") {
      const frame = requestAnimationFrame(() => setInView(true));
      return () => cancelAnimationFrame(frame);
    }
    const observer = new IntersectionObserver((entries) => {
      if (entries.some((entry) => entry.isIntersecting)) { setInView(true); observer.disconnect(); }
    }, { threshold, rootMargin });
    observer.observe(node);
    return () => observer.disconnect();
  }, [inView, threshold, rootMargin]);
  return { ref, inView };
}

type RevealVariant = "rise" | "tilt" | "zoom" | "left" | "right";

const HIDDEN: Record<RevealVariant, string> = {
  rise: "translate3d(0, 28px, 0)",
  tilt: "perspective(1200px) rotateX(18deg) translate3d(0, 40px, -60px)",
  zoom: "scale(0.94)",
  left: "translate3d(-40px, 0, 0)",
  right: "translate3d(40px, 0, 0)",
};

/**
 * Fades an element up (or tilts it in from below) the first time it enters the viewport.
 * Before hydration and without JS the content is simply visible: the hidden state is only applied
 * by the browser once it knows the element is still below the fold.
 */
export function Reveal({ children, variant = "rise", delay = 0, className, as: Tag = "div", style }: { children: ReactNode; variant?: RevealVariant; delay?: number; className?: string; as?: "div" | "section" | "li" | "article"; style?: CSSProperties }) {
  const { ref, inView } = useInView<HTMLDivElement>();
  const reduced = usePrefersReducedMotion();
  const [armed, setArmed] = useState(false);
  useEffect(() => {
    // Arm only elements that start below the fold, so above-the-fold content never flashes.
    const node = ref.current;
    if (node && node.getBoundingClientRect().top > window.innerHeight * 0.9) setArmed(true);
  }, [ref]);
  const hidden = armed && !inView && !reduced;
  return (
    <Tag
      ref={ref as never}
      className={className}
      style={{
        ...style,
        opacity: hidden ? 0 : 1,
        transform: hidden ? HIDDEN[variant] : "none",
        transition: reduced ? undefined : `opacity 700ms cubic-bezier(.16,1,.3,1) ${delay}ms, transform 900ms cubic-bezier(.16,1,.3,1) ${delay}ms`,
        willChange: armed && !inView ? "opacity, transform" : undefined,
      }}
    >
      {children}
    </Tag>
  );
}

/**
 * Rotates its child in 3D toward the pointer. `max` is the largest tilt in degrees. The surface
 * springs back to `rest` (a resting pose, e.g. a slight isometric angle) when the pointer leaves.
 * Pointer-only: on touch devices the element keeps its resting pose.
 */
export function Tilt3D({ children, max = 10, rest = { x: 0, y: 0 }, className, perspective = 1400, glare = false }: { children: ReactNode; max?: number; rest?: { x: number; y: number }; className?: string; perspective?: number; glare?: boolean }) {
  const ref = useRef<HTMLDivElement>(null);
  const frame = useRef(0);
  const reduced = usePrefersReducedMotion();
  const [pose, setPose] = useState({ x: rest.x, y: rest.y, gx: 50, gy: 50, active: false });

  useEffect(() => () => cancelAnimationFrame(frame.current), []);

  const onMove = (event: React.PointerEvent<HTMLDivElement>) => {
    if (reduced || event.pointerType !== "mouse" || !ref.current) return;
    const box = ref.current.getBoundingClientRect();
    const px = (event.clientX - box.left) / box.width;
    const py = (event.clientY - box.top) / box.height;
    cancelAnimationFrame(frame.current);
    frame.current = requestAnimationFrame(() => setPose({ x: rest.x + (0.5 - py) * max * 2, y: rest.y + (px - 0.5) * max * 2, gx: px * 100, gy: py * 100, active: true }));
  };
  const onLeave = () => { cancelAnimationFrame(frame.current); setPose({ x: rest.x, y: rest.y, gx: 50, gy: 50, active: false }); };

  return (
    <div ref={ref} className={className} style={{ perspective }} onPointerMove={onMove} onPointerLeave={onLeave}>
      <div
        style={{
          position: "relative",
          transformStyle: "preserve-3d",
          transform: reduced ? undefined : `rotateX(${pose.x.toFixed(2)}deg) rotateY(${pose.y.toFixed(2)}deg)`,
          transition: pose.active ? "transform 120ms ease-out" : "transform 900ms cubic-bezier(.16,1,.3,1)",
        }}
      >
        {children}
        {glare && !reduced && (
          <span
            aria-hidden="true"
            className="pointer-events-none absolute inset-0 rounded-[inherit]"
            style={{ background: `radial-gradient(600px circle at ${pose.gx}% ${pose.gy}%, rgba(255,255,255,${pose.active ? 0.14 : 0}), transparent 45%)`, transition: "background 200ms" }}
          />
        )}
      </div>
    </div>
  );
}

/** 0 → 1 as the element travels through the viewport (0 when its top meets the bottom edge). */
export function useScrollProgress<T extends HTMLElement>() {
  const ref = useRef<T>(null);
  const [progress, setProgress] = useState(0);
  useEffect(() => {
    let frame = 0;
    const measure = () => {
      const node = ref.current;
      if (!node) return;
      const box = node.getBoundingClientRect();
      const total = box.height + window.innerHeight;
      setProgress(Math.min(1, Math.max(0, (window.innerHeight - box.top) / total)));
    };
    const onScroll = () => { cancelAnimationFrame(frame); frame = requestAnimationFrame(measure); };
    measure();
    window.addEventListener("scroll", onScroll, { passive: true });
    window.addEventListener("resize", onScroll);
    return () => { cancelAnimationFrame(frame); window.removeEventListener("scroll", onScroll); window.removeEventListener("resize", onScroll); };
  }, []);
  return { ref, progress };
}

/**
 * 0 → 1 while a tall section scrolls past a sticky stage inside it: 0 when the section's top reaches
 * the top of the window, 1 when its bottom reaches the bottom. The scroll-told scenes (2026-10-13)
 * are driven by this one number. Under reduced motion it reads 1, so every scene shows its end state.
 */
export function useStickyProgress<T extends HTMLElement>() {
  const ref = useRef<T>(null);
  const reduced = usePrefersReducedMotion();
  const [progress, setProgress] = useState(0);
  useEffect(() => {
    if (reduced) return;
    let frame = 0;
    const measure = () => {
      const node = ref.current;
      if (!node) return;
      const box = node.getBoundingClientRect();
      const travel = Math.max(1, box.height - window.innerHeight);
      setProgress(Math.min(1, Math.max(0, -box.top / travel)));
    };
    const onScroll = () => { cancelAnimationFrame(frame); frame = requestAnimationFrame(measure); };
    frame = requestAnimationFrame(measure);
    window.addEventListener("scroll", onScroll, { passive: true });
    window.addEventListener("resize", onScroll);
    return () => { cancelAnimationFrame(frame); window.removeEventListener("scroll", onScroll); window.removeEventListener("resize", onScroll); };
  }, [reduced]);
  return { ref, progress: reduced ? 1 : progress, reduced };
}

/** Maps `progress` inside [from, to] onto 0 → 1 (clamped): one scene's share of a scroll-told section. */
export function segment(progress: number, from: number, to: number) {
  return Math.min(1, Math.max(0, (progress - from) / (to - from)));
}

/**
 * A headline whose words rise into place one after another — once, when it scrolls into view (or
 * on load, for the hero). The words are real text in the server render; only the motion is added.
 */
export function SplitWords({ text, className, wordClassName, delay = 0, stagger = 70, onLoad = false }: { text: string; className?: string; wordClassName?: string; delay?: number; stagger?: number; onLoad?: boolean }) {
  const { ref, inView } = useInView<HTMLSpanElement>({ threshold: 0.3 });
  const reduced = usePrefersReducedMotion();
  const [mounted, setMounted] = useState(false);
  useEffect(() => { const timer = window.setTimeout(() => setMounted(true), 30); return () => window.clearTimeout(timer); }, []);
  const shown = reduced || (onLoad ? mounted : inView);
  const words = text.split(" ");
  return (
    <span ref={ref} className={className}>
      {words.map((word, index) => (
        <Fragment key={`${word}-${index}`}>
          <span className="inline-block overflow-hidden pb-[0.12em] align-bottom">
            <span
              className={`inline-block ${wordClassName ?? ""}`}
              style={reduced ? undefined : {
                transform: shown ? "none" : "translate3d(0, 105%, 0) rotate(4deg)",
                opacity: shown ? 1 : 0,
                transition: `transform 900ms cubic-bezier(.16,1,.3,1) ${delay + index * stagger}ms, opacity 600ms ease ${delay + index * stagger}ms`,
              }}
            >
              {word}
            </span>
          </span>
          {index < words.length - 1 ? " " : null}
        </Fragment>
      ))}
    </span>
  );
}

/** A number that counts up once when it scrolls into view. The server renders the final value. */
export function CountUp({ value, prefix = "", suffix = "", decimals = 0, duration = 1400 }: { value: number; prefix?: string; suffix?: string; decimals?: number; duration?: number }) {
  const { ref, inView } = useInView<HTMLSpanElement>({ threshold: 0.4 });
  const reduced = usePrefersReducedMotion();
  const [shown, setShown] = useState<number | null>(null);
  const animate = inView && !reduced && value !== 0;
  useEffect(() => {
    if (!animate) return;
    const started = performance.now();
    let frame = 0;
    // Every state write happens in a frame or timer callback, never in the effect body.
    const step = (at: number) => {
      const t = Math.min(1, (at - started) / duration);
      setShown(value * (1 - Math.pow(1 - t, 3)));
      if (t < 1) frame = requestAnimationFrame(step);
    };
    frame = requestAnimationFrame(step);
    const settle = window.setTimeout(() => { cancelAnimationFrame(frame); setShown(value); }, duration + 150);
    return () => { cancelAnimationFrame(frame); window.clearTimeout(settle); };
  }, [animate, value, duration]);
  // Until the count starts (server render, off screen, reduced motion) the real figure shows.
  const display = animate && shown !== null ? shown : value;
  return <span ref={ref} className="tabular-nums">{prefix}{decimals ? display.toFixed(decimals) : Math.round(display).toLocaleString("en-US")}{suffix}</span>;
}
