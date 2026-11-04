import Link from "next/link";
import { ArrowRight } from "lucide-react";

import { ROADMAP, ROADMAP_STATUS, type RoadmapStatus } from "@/lib/marketing/roadmap";
import styles from "@/components/marketing/landing-roadmap.module.css";

/**
 * A glimpse of /roadmap on the landing page (2026-11-04, owner): one item each from what is being
 * built, what is planned and what is only being explored, and the way to the whole page.
 */
const GLIMPSE: RoadmapStatus[] = ["progress", "planned", "exploring"];

export function LandingRoadmap() {
  const items = GLIMPSE.map((status) => ROADMAP.find((item) => item.status === status)).filter((item) => item !== undefined);
  return (
    <section aria-labelledby="roadmap-title" className={styles.section}>
      <div className={styles.inner}>
        <header className={styles.head}>
          <p className={styles.eyebrow}>Roadmap</p>
          <h2 id="roadmap-title" className={styles.heading}>See what we are building next.</h2>
          <Link href="/roadmap" className={styles.link}>See the full roadmap<ArrowRight aria-hidden="true" /></Link>
        </header>
        <ul className={styles.cards}>
          {items.map((item) => (
            <li key={item.id} className={styles.card} data-status={item.status}>
              <p className={styles.status}><i aria-hidden="true" />{ROADMAP_STATUS[item.status].label}<span>{item.when}</span></p>
              <strong>{item.title}</strong>
              <span>{item.text}</span>
            </li>
          ))}
        </ul>
      </div>
    </section>
  );
}
