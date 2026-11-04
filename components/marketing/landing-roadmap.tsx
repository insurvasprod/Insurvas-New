"use client";

import Image from "next/image";
import Link from "next/link";
import { useState } from "react";
import { ArrowRight } from "lucide-react";

import { ROADMAP, type RoadmapStatus } from "@/lib/marketing/roadmap";
import styles from "@/components/marketing/landing-roadmap.module.css";

/**
 * A glimpse of /roadmap on the landing page (2026-11-04, owner): a real road, photographed from
 * above (public/marketing/README.md has the source and licence), with a pin on it for each stop,
 * Shipped to Exploring, in the order the road runs. Pointing at a pin (or focusing it) opens its
 * label to show the detail; Now is open to start. They are pressed buttons, not tabs, because they sit on the photo rather than in a row.
 *
 * Pin positions are percentages of the cropped photo, placed on the asphalt by eye. Re-place them if
 * the photo or its crop changes.
 */
const STOPS: { status: RoadmapStatus; label: string; x: number; y: number; tag: "above" | "below"; align: "start" | "center" | "end" }[] = [
  { status: "shipped", label: "Shipped", x: 6.8, y: 45.8, tag: "above", align: "start" },
  { status: "progress", label: "Now", x: 31.5, y: 75.8, tag: "above", align: "center" },
  { status: "planned", label: "Next", x: 93.6, y: 52.5, tag: "below", align: "end" },
  { status: "exploring", label: "Exploring", x: 65.7, y: 32.6, tag: "below", align: "center" },
];
const NOW = 1;

export function LandingRoadmap() {
  const stops = STOPS.map((stop) => ({ ...stop, item: ROADMAP.find((item) => item.status === stop.status) })).filter((stop) => stop.item !== undefined);
  const [active, setActive] = useState(NOW);

  return (
    <section aria-labelledby="roadmap-title" className={styles.section}>
      <div className={styles.inner}>
        <header className={styles.head}>
          <div>
            <p className={styles.eyebrow}>Roadmap</p>
            <h2 id="roadmap-title" className={styles.heading}>See what we are building next.</h2>
          </div>
          <Link href="/roadmap" className={styles.link}>See the full roadmap<ArrowRight aria-hidden="true" /></Link>
        </header>

        <div className={styles.map}>
          <Image src="/marketing/roadmap-road.webp" alt="" fill sizes="(max-width: 1320px) 100vw, 1320px" className={styles.photo} />
          <div className={styles.shade} aria-hidden="true" />
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
                style={{ left: `${stop.x}%`, top: `${stop.y}%` }}
                onClick={() => setActive(i)}
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
