"use client";

import Link from "next/link";
import { useState } from "react";
import { ArrowLeft, ArrowRight } from "lucide-react";

import styles from "@/components/marketing/landing-audience-slider.module.css";

/**
 * "Who it's for" (2026-11-04, owner): one switch, Agent or Agency, and three problems each person
 * has, one at a time. Every figure under a problem is something the product does; none is a
 * customer claim. The pricing views behind the two links are real (plan catalog audiences).
 */
type Slide = { problem: string; outcome: string; proof: readonly (readonly [string, string])[] };

const PERSONAS: Record<"agent" | "agency", { label: string; cta: string; href: string; slides: readonly Slide[] }> = {
  agent: {
    label: "Agent",
    cta: "See agent plans",
    href: "/pricing",
    slides: [
      {
        problem: "I can’t tell which vendor actually paid me back.",
        outcome: "See what every lead cost, from the vendor’s list to the issued policy.",
        proof: [["Per vendor", "true CPA"], ["Your data", "linked, not estimated"], ["—", "a missing figure never reads $0.00"]],
      },
      {
        problem: "Carrier statements never match what I’m owed.",
        outcome: "Every statement line is matched to its policy, so you see what is still missing.",
        proof: [["Line by line", "statement matching"], ["Per policy", "the commission you are owed"], ["One place", "leads, policies and statements"]],
      },
      {
        problem: "I’m worried about dialing someone I shouldn’t.",
        outcome: "Consent, DNC and calling-window screening run on the server before every dial.",
        proof: [["4 checks", "re-run before every dial"], ["Server-side", "not in the browser"], ["Kept", "consent evidence per attempt"]],
      },
    ],
  },
  agency: {
    label: "Agency",
    cta: "See agency pricing",
    href: "/pricing?for=agency",
    slides: [
      {
        problem: "My producers cherry-pick the best leads.",
        outcome: "Route leads across the whole floor by rules, not by who grabs first.",
        proof: [["Rules", "not first come"], ["Live", "who is on a call"], ["Whole floor", "one routing chain"]],
      },
      {
        problem: "Payouts and splits turn into a monthly fight.",
        outcome: "Splits, overrides and producer payouts are worked out inside the product.",
        proof: [["Splits", "per producer"], ["Overrides", "built in"], ["Payouts", "in one view"]],
      },
      {
        problem: "I can’t see the floor, or what it all costs.",
        outcome: "One agency dashboard for every producer, at one flat price per workspace.",
        proof: [["One", "dashboard for every producer"], ["Flat", "never per seat or per lead"], ["Private", "partners never see each other’s leads"]],
      },
    ],
  },
};

type Who = keyof typeof PERSONAS;

export function LandingAudienceSlider() {
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
      <div className={styles.slide} key={`${who}-${index}`} aria-live="polite">
        <p className={styles.count}>Problem {index + 1} of {slides.length}</p>
        <p className={styles.problem}>{slide.problem}</p>
        <p className={styles.outcome}>{slide.outcome}</p>
        <ul className={styles.proof}>
          {slide.proof.map(([lead, text]) => <li key={lead + text}><strong>{lead}</strong><span>{text}</span></li>)}
        </ul>
      </div>
      <div className={styles.controls}>
        <div className={styles.progress} role="presentation"><i style={{ width: `${((index + 1) / slides.length) * 100}%` }} /></div>
        <Link href={persona.href} className={styles.cta}>{persona.cta}<ArrowRight aria-hidden="true" /></Link>
        <div className={styles.arrows}>
          <button type="button" onClick={() => step(-1)} aria-label="Previous problem"><ArrowLeft aria-hidden="true" /></button>
          <button type="button" onClick={() => step(1)} aria-label="Next problem"><ArrowRight aria-hidden="true" /></button>
        </div>
      </div>
    </div>
  );
}
