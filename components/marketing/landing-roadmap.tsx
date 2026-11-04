import Link from "next/link";
import { ArrowRight } from "lucide-react";

import { ROADMAP, ROADMAP_STATUS, type RoadmapStatus } from "@/lib/marketing/roadmap";
import styles from "@/components/marketing/landing-roadmap.module.css";

/**
 * A glimpse of /roadmap on the landing page (2026-11-04, owner): a track from Shipped to Exploring,
 * filled up to what is being built now, with one item under each stop and the way to the whole page.
 */
const STOPS: { status: RoadmapStatus; label: string }[] = [
  { status: "shipped", label: "Shipped" },
  { status: "progress", label: "Now" },
  { status: "planned", label: "Next" },
  { status: "exploring", label: "Exploring" },
];

export function LandingRoadmap() {
  const stops = STOPS.map((stop) => ({ ...stop, item: ROADMAP.find((item) => item.status === stop.status) })).filter((stop) => stop.item !== undefined);
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
        <ol className={styles.track}>
          {stops.map(({ status, label, item }) => (
            <li key={status} className={styles.stop} data-status={status} aria-current={status === "progress" ? "step" : undefined}>
              <span className={styles.node} aria-hidden="true" />
              <p className={styles.when}>{label}<span> · {item!.when}</span><span className="sr-only"> ({ROADMAP_STATUS[status].label})</span></p>
              <strong>{item!.title}</strong>
              <span className={styles.text}>{item!.text}</span>
            </li>
          ))}
        </ol>
      </div>
    </section>
  );
}
