"use client";

import Image from "next/image";
import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { ArrowRight } from "lucide-react";

import { ROADMAP, type RoadmapStatus } from "@/lib/marketing/roadmap";
import styles from "@/components/marketing/landing-roadmap.module.css";

/**
 * A glimpse of /roadmap (owner, 4 Nov), reworked after Umar's review (4 Nov, A8.3–A8.5): the road
 * photo stays, for the energy an image gives the page, but it is a short band now rather than a
 * full screen, pushed back under a dark green shade, with the heading and why we build over it. The
 * contact form follows on the same ground (`LandingContact`).
 *
 * The photo sits in a stage that keeps its proportions and is anchored to the band's bottom edge,
 * so the pins (percentages of the photo) stay on the asphalt at every width. Re-place them by eye if
 * the photo changes. On phones (owner, 6 Nov: the pins belong on the photo, not in a list under it)
 * the band is a strip of the whole photo, swiped sideways, and it tours the stops on its own: every
 * few seconds it glides to the next pin and opens its label, until the visitor touches it.
 */
const STOPS: { status: RoadmapStatus; label: string; x: number; y: number; tag: "above" | "below"; align: "start" | "center" | "end" }[] = [
  { status: "shipped", label: "Shipped", x: 20, y: 63.5, tag: "below", align: "start" },
  { status: "progress", label: "Now", x: 46, y: 83, tag: "above", align: "center" },
  { status: "planned", label: "Next", x: 94, y: 51, tag: "below", align: "end" },
  { status: "exploring", label: "Exploring", x: 64, y: 65.5, tag: "above", align: "center" },
];
const NOW = 1;
const TOUR_MS = 4_000;

export function LandingRoadmap() {
  const stops = STOPS.map((stop) => ({ ...stop, item: ROADMAP.find((item) => item.status === stop.status) })).filter((stop) => stop.item !== undefined);
  const [active, setActive] = useState(NOW);
  const mapRef = useRef<HTMLDivElement>(null);
  const touched = useRef(false);
  const [wait, setWait] = useState(0);

  // Phones: keep the pin being shown in the middle of the strip, and tour the stops until touched.
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !window.matchMedia("(max-width: 760px)").matches) return;
    const pin = map.querySelectorAll<HTMLElement>("[data-pin]")[active];
    if (!pin) return;
    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    map.scrollTo({ left: pin.offsetLeft - map.clientWidth / 2, behavior: reduce ? "auto" : "smooth" });
    if (reduce || touched.current) return;
    const next = window.setTimeout(() => {
      const rect = map.getBoundingClientRect();
      // Only while the strip is on screen; otherwise check again later.
      if (rect.bottom > 0 && rect.top < window.innerHeight) setActive((i) => (i + 1) % STOPS.length);
      else setWait((n) => n + 1);
    }, TOUR_MS);
    return () => window.clearTimeout(next);
  }, [active, wait]);
  const stopTour = () => { touched.current = true; };

  return (
    <section id="roadmap" aria-labelledby="roadmap-title" className={styles.section}>
        {/* The white of the section above melts into the band (owner, 6 Nov). */}
        <div className={styles.fadeIn} aria-hidden="true" />
        {/* The header: the heading on the left, the why and the link on the right, on one baseline
            on a row of its own over the photo's faded top edge, so the pins below have the road to
            themselves (owner, 6 Nov). */}
        <div className={styles.over}>
          <div className={styles.titleBlock}>
            <p className={styles.eyebrow}>Roadmap</p>
            <h2 id="roadmap-title" className={styles.heading}>See what we are building next.</h2>
          </div>
          <div className={styles.aside}>
            {/* TO CONFIRM (Umar): the why. Same claim as the trust band, in one line. */}
            <p className={styles.why}>Insurvas is built by people who ran a final expense floor, and it grows from what agencies ask us for.</p>
            <Link href="/roadmap" className={styles.link}>See the full roadmap<ArrowRight aria-hidden="true" /></Link>
          </div>
        </div>
      <div ref={mapRef} className={styles.map} onPointerDown={stopTour} onWheel={stopTour}>
        <div className={styles.stage}>
          <Image src="/marketing/roadmap-road.webp" alt="" fill sizes="100vw" className={styles.photo} />
        </div>
        <div className={styles.shade} aria-hidden="true" />
        {/* A second stage of the same shape holds the pins, so they sit above the shade. */}
        <div className={styles.stage}>
          <div className={styles.pins} role="group" aria-label="Roadmap stops">
            {stops.map((stop, i) => (
              <button
                key={stop.status}
                type="button"
                aria-pressed={active === i}
                className={styles.pin}
                data-status={stop.status}
                data-tag={stop.tag}
                data-align={stop.align}
                data-pin=""
                style={{ left: `${stop.x}%`, top: `${stop.y}%` }}
                onClick={() => { stopTour(); setActive(i); }}
                onMouseEnter={() => setActive(i)}
                onFocus={() => setActive(i)}
              >
                <span className={styles.node} aria-hidden="true" />
                <span className={styles.tag}><b>{stop.label} · {stop.item!.when}</b><span>{stop.item!.title}</span><span className={styles.detail}><span>{stop.item!.text}</span></span></span>
              </button>
            ))}
          </div>
        </div>
      </div>

    </section>
  );
}
