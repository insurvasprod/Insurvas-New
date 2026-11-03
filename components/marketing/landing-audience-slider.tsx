"use client";

import Link from "next/link";
import { useState, type ReactNode } from "react";
import { ArrowLeft, ArrowRight } from "lucide-react";

import styles from "@/components/marketing/landing-audience-slider.module.css";

/**
 * "Who it's for" (2026-11-04, owner): one switch, Agent or Agency, and three problems each person
 * has, one at a time. Problems only, no pitch (owner, 4 Nov); the graph beside each is sample data. The pricing views behind the two links are real (plan catalog audiences).
 */
type Chart = { title: string; note: string; main: readonly number[]; base: readonly number[]; at: number };
type Slide = { problem: string; chart: Chart };

/** A gentle curve through the points, in a 300 x 110 box; rounded so the server and browser print the same path. */
function curve(values: readonly number[]) {
  const r = (n: number) => Math.round(n * 10) / 10;
  const step = 300 / (values.length - 1);
  const pts = values.map((v, i) => [r(i * step), r(104 - v * 92)]);
  return pts.reduce((d, [x, y], i) => {
    if (i === 0) return `M${x},${y}`;
    const cx = r((pts[i - 1][0] + x) / 2);
    return `${d} C${cx},${pts[i - 1][1]} ${cx},${y} ${x},${y}`;
  }, "");
}

const RISE = [0.12, 0.14, 0.2, 0.19, 0.28, 0.33, 0.31, 0.45, 0.52, 0.5, 0.66, 0.74, 0.72, 0.9];
const FALL = [0.9, 0.84, 0.86, 0.74, 0.7, 0.62, 0.64, 0.52, 0.48, 0.42, 0.4, 0.34, 0.3, 0.26];
const STEADY = [0.5, 0.56, 0.52, 0.6, 0.58, 0.66, 0.62, 0.7, 0.68, 0.74, 0.72, 0.78, 0.8, 0.84];
const FLAT = [0.16, 0.17, 0.16, 0.18, 0.17, 0.19, 0.18, 0.2, 0.19, 0.21, 0.2, 0.22, 0.21, 0.23];
const STEPS = [0.2, 0.2, 0.34, 0.34, 0.34, 0.5, 0.5, 0.5, 0.64, 0.64, 0.78, 0.78, 0.78, 0.9];

const PERSONAS: Record<"agent" | "agency", { label: string; cta: string; href: string; slides: readonly Slide[] }> = {
  agent: {
    label: "Insurvas for Independent Agent",
    cta: "See agent plans",
    href: "/pricing",
    slides: [
      {
        problem: "I can’t tell which vendor actually paid me back.",
        chart: { title: "Cost per issued policy", note: "Bayview Data · lowest CPA", main: FALL, base: FLAT, at: 11 },
      },
      {
        problem: "Carrier statements never match what I’m owed.",
        chart: { title: "Commission vs lead spend", note: "Statement line matched", main: RISE, base: FLAT, at: 9 },
      },
      {
        problem: "I’m worried about dialing someone I shouldn’t.",
        chart: { title: "Dials screened", note: "Dial cleared · 4 of 4 checks", main: STEADY, base: FLAT, at: 10 },
      },
    ],
  },
  agency: {
    label: "Insurvas for Agencies",
    cta: "See agency pricing",
    href: "/pricing?for=agency",
    slides: [
      {
        problem: "My producers cherry-pick the best leads.",
        chart: { title: "Leads routed", note: "Lead routed to Tom P.", main: STEADY, base: FLAT, at: 11 },
      },
      {
        problem: "Payouts and splits turn into a monthly fight.",
        chart: { title: "Producer payouts", note: "Payout run ready", main: STEPS, base: FLAT, at: 10 },
      },
      {
        problem: "I can’t see the floor, or what it all costs.",
        chart: { title: "Commission vs lead spend", note: "One dashboard, every producer", main: RISE, base: FLAT, at: 12 },
      },
    ],
  },
};

type Who = keyof typeof PERSONAS;

export function LandingAudienceSlider({ header }: { header: ReactNode }) {
  const [who, setWho] = useState<Who>("agent");
  const [index, setIndex] = useState(0);
  const persona = PERSONAS[who];
  const slides = persona.slides;
  const slide = slides[index];

  const choose = (next: Who) => { setWho(next); setIndex(0); };
  const step = (by: number) => setIndex((current) => (current + by + slides.length) % slides.length);

  return (
    <div className={styles.slider}>
      <div className={styles.switch} role="group" aria-label="Who are you">
        {(Object.keys(PERSONAS) as Who[]).map((key) => (
          <button key={key} type="button" aria-pressed={who === key} onClick={() => choose(key)} className={styles.switchButton}>{PERSONAS[key].label}</button>
        ))}
      </div>
      {header}
      <div className={styles.stage}>
        <div className={styles.slide} key={`${who}-${index}`} aria-live="polite">
          <p className={styles.count}>Problem {index + 1} of {slides.length}</p>
          <p className={styles.problem}>{slide.problem}</p>
        </div>
        <figure className={styles.chart} key={`chart-${who}-${index}`}>
          <figcaption><span>{slide.chart.title}</span><em>Sample data</em></figcaption>
          <svg viewBox="0 0 300 110" role="img" aria-label={`${slide.chart.title}: ${slide.chart.note}`} preserveAspectRatio="none">
            {[0.25, 0.5, 0.75].map((y) => <line key={y} x1="0" x2="300" y1={104 - y * 92} y2={104 - y * 92} className={styles.grid} />)}
            <path d={curve(slide.chart.base)} className={styles.baseLine} pathLength={1} />
            <path d={curve(slide.chart.main)} className={styles.mainLine} pathLength={1} />
          </svg>
          <span className={styles.callout} style={{ left: `${(slide.chart.at / (slide.chart.main.length - 1)) * 100}%`, top: `${((104 - slide.chart.main[slide.chart.at] * 92) / 110) * 100}%` }}>
            <i aria-hidden="true" /><b>{slide.chart.note}</b>
          </span>
        </figure>
      </div>
      <div className={styles.controls}>
        <Link href={persona.href} className={styles.cta}>{persona.cta}<ArrowRight aria-hidden="true" /></Link>
        <div className={styles.arrows}>
          <button type="button" onClick={() => step(-1)} aria-label="Previous problem"><ArrowLeft aria-hidden="true" /></button>
          <button type="button" onClick={() => step(1)} aria-label="Next problem"><ArrowRight aria-hidden="true" /></button>
        </div>
      </div>
    </div>
  );
}
