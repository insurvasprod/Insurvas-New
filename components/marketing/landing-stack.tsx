"use client";

import { useEffect, useRef } from "react";
import type { CSSProperties } from "react";
import type { LucideIcon } from "lucide-react";
import {
  BadgeDollarSign, Ban, CalendarX, Check, ClipboardList, Copy, FileQuestion, FileSpreadsheet, HandCoins, Phone,
  PhoneMissed, ShieldAlert, Sheet, Users,
} from "lucide-react";
import { createTimeline, stagger } from "animejs";

import { InsurvasLogo } from "@/components/shared/insurvas-logo";
import styles from "@/components/marketing/landing-stack.module.css";

/**
 * "Sound like your agency?" rebuilt after Umar's review (4 Nov, A3.1–A3.3), on the pattern he named:
 * clepso.io, where scattered cards of mess drift into the product's mark and come out resolved.
 *
 * Here the agency's five tools are a stack of 3D cards that collapses into the Insurvas tile when
 * the section scrolls in (A3.1: "Insurvas here is just replacing those cards"). Then the floor's mess
 * drifts in from the left and clean outcomes leave on the right (A3.3: "problems coming in, going
 * through a system, coming out as a solution"). One line tells the story (A3.2).
 *
 * Every card on the right is something the product does today. The motion is decoration: the five
 * tools are named in the lede, so nothing is lost under reduced motion, where the resolved stage is
 * shown still. The drift pauses whenever the section is off screen.
 */
type Card = { icon: LucideIcon; kind: string; title: string; note: string };

const TOOLS = [
  { icon: Users, name: "A CRM", job: "for tracking" },
  { icon: Phone, name: "A dialer", job: "for calls" },
  { icon: Sheet, name: "A spreadsheet", job: "for commissions" },
  { icon: FileSpreadsheet, name: "Another spreadsheet", job: "for publisher payouts" },
  { icon: ShieldAlert, name: "A prayer", job: "for compliance" },
];

const MESS: Card[][] = [
  [
    { icon: Copy, kind: "Lead", title: "Bought twice", note: "Ruth A. is in two lists" },
    { icon: FileQuestion, kind: "Spreadsheet", title: "commissions_v7_FINAL.xlsx", note: "Which one is current?" },
    { icon: PhoneMissed, kind: "Live transfer", title: "Dropped after 0:40", note: "Nobody claimed it" },
  ],
  [
    { icon: Ban, kind: "Dial", title: "No consent on file", note: "Dialed anyway" },
    { icon: BadgeDollarSign, kind: "Statement line", title: "Unmatched · $84.00", note: "No policy found for it" },
    { icon: ClipboardList, kind: "Application", title: "Re-keyed by hand", note: "Into the carrier’s portal" },
  ],
  [
    { icon: CalendarX, kind: "Draft", title: "Missed on the 3rd", note: "Nobody saw the notice" },
    { icon: HandCoins, kind: "Publisher", title: "Paid twice", note: "Same leads, two invoices" },
    { icon: Copy, kind: "Lead cost", title: "Not recorded", note: "So no true CPA" },
  ],
];

const OUTCOMES: Card[][] = [
  [
    { icon: Check, kind: "Lead", title: "One record per lead", note: "Duplicates set aside" },
    { icon: Check, kind: "Live transfer", title: "Claimed once", note: "The first claim wins" },
    { icon: Check, kind: "True CPA", title: "Every policy to its campaign", note: "Cost on every lead" },
  ],
  [
    { icon: Check, kind: "Dial", title: "Screened before it is placed", note: "Consent · DNC · window" },
    { icon: Check, kind: "Statement line", title: "Matched to its policy", note: "Owed beside paid" },
    { icon: Check, kind: "Application", title: "Submitted on the call", note: "Blockers shown first" },
  ],
  [
    { icon: Check, kind: "Draft", title: "Flagged before it misses", note: "Into the save queue" },
    { icon: Check, kind: "Publisher", title: "Payouts worked out", note: "Per publisher, per period" },
    { icon: Check, kind: "Ledger", title: "Profit by campaign", note: "One set of numbers" },
  ],
];

function Row({ cards, tone, speed }: { cards: Card[]; tone: "mess" | "clean"; speed: number }) {
  // The cards twice over, so the track can loop without a seam.
  const loop = [...cards, ...cards, ...cards, ...cards];
  return (
    <div className={styles.row} data-tone={tone}>
      <div className={styles.track} style={{ animationDuration: `${speed}s` }}>
        {loop.map((card, i) => {
          const Icon = card.icon;
          return (
            <div key={i} className={styles.card}>
              <span className={styles.kind}><Icon aria-hidden="true" />{card.kind}</span>
              <b>{card.title}</b>
              <small>{card.note}</small>
            </div>
          );
        })}
      </div>
    </div>
  );
}

export function LandingStack() {
  const stageRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const stage = stageRef.current;
    if (!stage) return;
    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    if (reduce) { stage.dataset.state = "resolved"; return; }

    let timeline: ReturnType<typeof createTimeline> | null = null;
    // The take-over plays once, the first time the stage is well into view. The drift after it
    // runs only while the stage is on screen.
    const io = new IntersectionObserver(([entry]) => {
      const visible = Boolean(entry?.isIntersecting);
      stage.dataset.run = String(visible && stage.dataset.state === "resolved");
      if (!visible || timeline) return;
      const cards = stage.querySelectorAll("[data-tool]");
      const tile = stage.querySelector("[data-tile]");
      timeline = createTimeline({ defaults: { ease: "inOutCubic" }, onComplete: () => { stage.dataset.state = "resolved"; stage.dataset.run = "true"; } })
        .add(cards, { translateZ: 0, translateY: 30, opacity: 0, duration: 520, delay: stagger(110, { from: "last" }) }, 700)
        .add(tile!, { opacity: [0, 1], scale: [0.7, 1], duration: 560, ease: "outBack(1.6)" }, 1150);
    }, { threshold: 0.45 });
    io.observe(stage);
    return () => { io.disconnect(); timeline?.revert(); };
  }, []);

  return (
    <section aria-labelledby="stack-title" className={styles.section}>
      <div className={styles.inner}>
        <header className={styles.head}>
          <p className={styles.eyebrow}>Sound like your agency?</p>
          <h2 id="stack-title" className={styles.heading}>Most final expense agencies run on five tools that don’t talk to each other.</h2>
          <p className={styles.lede}>A CRM for tracking. A dialer for calls. A spreadsheet for commissions, another for publisher payouts. And a prayer for compliance.</p>
        </header>
      </div>

      <div ref={stageRef} className={styles.stage} data-state="stacked" aria-hidden="true">
        <div className={styles.side} data-side="in">
          {MESS.map((cards, i) => <Row key={i} cards={cards} tone="mess" speed={46 + i * 7} />)}
        </div>
        <div className={styles.core}>
          <span className={styles.beam} />
          <div className={styles.deck}>
            {TOOLS.map((tool, i) => {
              const Icon = tool.icon;
              return (
                <div key={tool.name} data-tool="" className={styles.tool} style={{ "--z": `${(TOOLS.length - 1 - i) * 26}px` } as CSSProperties}>
                  <Icon aria-hidden="true" />
                  <b>{tool.name}</b>
                  <small>{tool.job}</small>
                </div>
              );
            })}
          </div>
          <div data-tile="" className={styles.tile}>
            <InsurvasLogo variant="symbol" tone="dark" size="public" alt="" className={styles.mark} />
          </div>
        </div>
        <div className={styles.side} data-side="out">
          {OUTCOMES.map((cards, i) => <Row key={i} cards={cards} tone="clean" speed={46 + i * 7} />)}
        </div>
      </div>

      <div className={styles.inner}>
        {/* TO CONFIRM (Umar): "two years", from the review call. */}
        <p className={styles.story}>We ran a final expense agency on those five tools for two years. <b>Insurvas is the one system we built to replace them.</b></p>
      </div>
    </section>
  );
}
