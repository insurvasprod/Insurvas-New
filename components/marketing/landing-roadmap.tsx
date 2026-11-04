"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { ArrowRight } from "lucide-react";

import { ROADMAP, ROADMAP_STATUS, type RoadmapStatus } from "@/lib/marketing/roadmap";
import styles from "@/components/marketing/landing-roadmap.module.css";

/**
 * A glimpse of /roadmap on the landing page (2026-11-04, owner, after road-infographic references):
 * a winding road with a pin for each stop, Shipped to Exploring. The lane markings move, the road
 * fills in green up to what is being built now, and a marker drives there when the section comes
 * into view. Each pin (and its label) opens that stop in the panel below; they are pressed buttons, not tabs, because they sit on the road rather than in a row. Reduced motion: the road
 * is drawn filled and the marker is already parked at "Now".
 */
const STOPS: { status: RoadmapStatus; label: string; at: number; side: "above" | "below" }[] = [
  { status: "shipped", label: "Shipped", at: 0.12, side: "below" },
  { status: "progress", label: "Now", at: 0.37, side: "above" },
  { status: "planned", label: "Next", at: 0.63, side: "below" },
  { status: "exploring", label: "Exploring", at: 0.88, side: "above" },
];
const NOW = 1;
const W = 1200;
const H = 360;
const ROAD = "M-20,250 C150,250 190,110 330,110 C470,110 470,270 610,270 C750,270 760,110 900,110 C1040,110 1060,230 1220,230";

type Point = { x: number; y: number };
/** Close enough for the server render; the browser measures the real path after mount. */
const FALLBACK: Point[] = [{ x: 140, y: 238 }, { x: 420, y: 160 }, { x: 760, y: 212 }, { x: 1040, y: 196 }];

export function LandingRoadmap() {
  const stops = STOPS.map((stop) => ({ ...stop, item: ROADMAP.find((item) => item.status === stop.status) })).filter((stop) => stop.item !== undefined);
  const [active, setActive] = useState(NOW);
  const [points, setPoints] = useState<Point[]>(FALLBACK);
  const [car, setCar] = useState<Point | null>(null);
  const [drawn, setDrawn] = useState(false);
  const pathRef = useRef<SVGPathElement>(null);
  const sectionRef = useRef<HTMLElement>(null);

  // Pins sit exactly on the road: measured from the path itself.
  useEffect(() => {
    const path = pathRef.current;
    if (!path) return;
    const length = path.getTotalLength();
    const measured = STOPS.map((stop) => { const p = path.getPointAtLength(length * stop.at); return { x: p.x, y: p.y }; });
    const timer = window.setTimeout(() => { setPoints(measured); setCar(measured[0]); }, 0);
    return () => window.clearTimeout(timer);
  }, []);

  // The first time the road is seen, it fills to "Now" and the marker drives there.
  useEffect(() => {
    const section = sectionRef.current;
    const path = pathRef.current;
    if (!section || !path) return;
    const length = path.getTotalLength();
    const from = length * STOPS[0].at;
    const to = length * STOPS[NOW].at;
    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    let frame = 0;
    const observer = new IntersectionObserver(([entry]) => {
      if (!entry?.isIntersecting) return;
      observer.disconnect();
      setDrawn(true);
      if (reduce) { const p = path.getPointAtLength(to); setCar({ x: p.x, y: p.y }); return; }
      const start = performance.now();
      const step = (now: number) => {
        const t = Math.min(1, (now - start) / 1800);
        const eased = 1 - Math.pow(1 - t, 3);
        const p = path.getPointAtLength(from + (to - from) * eased);
        setCar({ x: p.x, y: p.y });
        if (t < 1) frame = requestAnimationFrame(step);
      };
      frame = requestAnimationFrame(step);
    }, { threshold: 0.35 });
    observer.observe(section);
    return () => { observer.disconnect(); cancelAnimationFrame(frame); };
  }, []);

  const current = stops[active] ?? stops[0];
  const pct = (p: Point) => ({ left: `${(p.x / W) * 100}%`, top: `${(p.y / H) * 100}%` });

  return (
    <section ref={sectionRef} aria-labelledby="roadmap-title" className={styles.section}>
      <div className={styles.inner}>
        <header className={styles.head}>
          <div>
            <p className={styles.eyebrow}>Roadmap</p>
            <h2 id="roadmap-title" className={styles.heading}>See what we are building next.</h2>
          </div>
          <Link href="/roadmap" className={styles.link}>See the full roadmap<ArrowRight aria-hidden="true" /></Link>
        </header>

        <div className={styles.map} data-drawn={drawn}>
          <svg viewBox={`0 0 ${W} ${H}`} className={styles.road} aria-hidden="true" preserveAspectRatio="xMidYMid meet">
            <path d={ROAD} className={styles.edge} />
            <path ref={pathRef} d={ROAD} className={styles.asphalt} />
            <path d={ROAD} className={styles.lane} />
            <path d={ROAD} className={styles.progress} pathLength={1} style={{ ["--to" as string]: STOPS[NOW].at }} />
            {car && <g className={styles.car} transform={`translate(${car.x} ${car.y})`}><circle r="16" className={styles.carHalo} /><circle r="8" className={styles.carDot} /></g>}
          </svg>

          <div className={styles.pins} role="group" aria-label="Roadmap stops">
            {stops.map((stop, i) => (
              <button
                key={stop.status}
                type="button"
                id={`roadmap-stop-${stop.status}`}
                aria-pressed={active === i}
                aria-controls="roadmap-stop-panel"
                className={styles.pin}
                data-status={stop.status}
                data-side={stop.side}
                style={pct(points[i])}
                onClick={() => setActive(i)}
                onMouseEnter={() => setActive(i)}
                onFocus={() => setActive(i)}
              >
                <span className={styles.node} aria-hidden="true" />
                <span className={styles.tag}><b>{stop.label}</b><span>{stop.item!.title}</span></span>
              </button>
            ))}
          </div>
        </div>

        <div id="roadmap-stop-panel" aria-live="polite" className={styles.panel} data-status={current.status} key={current.status}>
          <p className={styles.panelWhen}><i aria-hidden="true" />{ROADMAP_STATUS[current.status].label}<span>{current.item!.when}</span></p>
          <p className={styles.panelTitle}>{current.item!.title}</p>
          <p className={styles.panelText}>{current.item!.text}</p>
        </div>
      </div>
    </section>
  );
}
