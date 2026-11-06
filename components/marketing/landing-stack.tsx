"use client";

import { useEffect, useRef } from "react";
import type { LucideIcon } from "lucide-react";
import {
  BadgeDollarSign, Ban, CalendarX, Check, ClipboardList, Copy, FileQuestion, FileSpreadsheet, HandCoins, Phone,
  PhoneMissed, ShieldAlert, Sheet, Users,
} from "lucide-react";
import { createTimeline, utils } from "animejs";

import { InsurvasLogo } from "@/components/shared/insurvas-logo";
import styles from "@/components/marketing/landing-stack.module.css";

/**
 * "Sound like your agency?" rebuilt after Umar's review (4 Nov, A3.1–A3.3), on the pattern he named:
 * clepso.io, where scattered cards of mess drift into the product's mark and come out resolved.
 *
 * Owner, 6 Nov (second pass): one screen, and the change shown where it happens. Three lanes of
 * matched cards run through an Insurvas gate in the middle; each arrives as a problem and leaves as
 * its fix (`Lane`), so the story reads without words: problems in, Insurvas, solutions out.
 *
 * Reworked 6 Nov (owner: "buggy and bad"). The agency's five tools stand in a column of cards in the
 * middle; as the section scrolls in they close up into one stack and the Insurvas tile lands in front
 * and takes them over (A3.1: "3D cards, they get stacked, and Insurvas is just replacing those
 * cards"). Then the floor's problems flow in from the left, under "Coming in", and the outcomes flow
 * out on the right, under "Coming out" (A3.3: "problems coming in, going through a system, coming
 * out as a solution"). The cards are flat, so they stay sharp. One line tells the story (A3.2).
 *
 * Every card on the right is something the product does today. The motion is decoration: the five
 * tools are named in the lede, so nothing is lost under reduced motion, where the resolved stage is
 * shown still. The drift pauses whenever the section is off screen.
 */

const TOOLS = [
  { icon: Users, name: "A CRM", job: "for tracking" },
  { icon: Phone, name: "A dialer", job: "for calls" },
  { icon: Sheet, name: "A spreadsheet", job: "for commissions" },
  { icon: FileSpreadsheet, name: "Another spreadsheet", job: "for publisher payouts" },
  { icon: ShieldAlert, name: "A prayer", job: "for compliance" },
];

/** Each problem and the fix Insurvas turns it into: the same kind of thing, before and after. */
type Pair = { kind: string; icon: LucideIcon; problem: [string, string]; fix: [string, string] };

const LANES: Pair[][] = [
  [
    { kind: "Lead", icon: Copy, problem: ["Bought twice", "Ruth A. is in two lists"], fix: ["One record per lead", "The duplicate set aside"] },
    { kind: "Live transfer", icon: PhoneMissed, problem: ["Dropped after 0:40", "Nobody claimed it"], fix: ["Claimed once", "The first claim wins"] },
    { kind: "Lead cost", icon: BadgeDollarSign, problem: ["Not recorded", "So no true CPA"], fix: ["On every lead", "True CPA by campaign"] },
  ],
  [
    { kind: "Dial", icon: Ban, problem: ["No consent on file", "Dialed anyway"], fix: ["Screened first", "Consent · DNC · window"] },
    { kind: "Statement line", icon: FileQuestion, problem: ["Unmatched · $84.00", "No policy found for it"], fix: ["Matched to its policy", "Owed beside paid"] },
    { kind: "Application", icon: ClipboardList, problem: ["Re-keyed by hand", "Into the carrier’s portal"], fix: ["Submitted on the call", "Blockers shown first"] },
  ],
  [
    { kind: "Draft", icon: CalendarX, problem: ["Missed on the 3rd", "Nobody saw the notice"], fix: ["Flagged before it misses", "Into the save queue"] },
    { kind: "Publisher", icon: HandCoins, problem: ["Paid twice", "Same leads, two invoices"], fix: ["Payouts worked out", "Per publisher, per period"] },
    { kind: "Spreadsheet", icon: FileSpreadsheet, problem: ["commissions_v7.xlsx", "Which one is current?"], fix: ["One ledger", "One set of numbers"] },
  ],
];

/**
 * One lane: the same moving track twice, one layer clipped to the left of the gate and showing each
 * card as the problem, one clipped to the right showing it as the fix. The two move in step, so a card
 * turns into its fix exactly as it passes through Insurvas.
 */
function Lane({ pairs, speed, delay }: { pairs: Pair[]; speed: number; delay: number }) {
  const loop = [...pairs, ...pairs, ...pairs, ...pairs];
  const track = (side: "problem" | "fix") => (
    <div className={styles.layer} data-side={side}>
      <div className={styles.track} style={{ animationDuration: `${speed}s`, animationDelay: `${delay}s` }}>
        {loop.map((pair, i) => {
          const Icon = side === "fix" ? Check : pair.icon;
          const [title, note] = pair[side];
          return (
            <div key={i} className={styles.card}>
              <span className={styles.kind}><Icon aria-hidden="true" />{pair.kind}</span>
              <b>{title}</b>
              <small>{note}</small>
            </div>
          );
        })}
      </div>
    </div>
  );
  return <div className={styles.lane}>{track("problem")}{track("fix")}</div>;
}

/**
 * Where each of the five tools starts (Umar, 4 Nov: "a CRM here, a dialer here … in a different
 * segregated way"): spread across the stage as tilted 3D cards. x is a share of the half-width the
 * stage allows; y is pixels from the middle.
 */
const SCATTER = [
  { x: -1, y: -96, rotateY: 22, rotate: -5 },
  { x: -0.52, y: 78, rotateY: 14, rotate: 4 },
  { x: 0, y: -58, rotateY: 0, rotate: -2 },
  { x: 0.52, y: 84, rotateY: -14, rotate: 5 },
  { x: 1, y: -84, rotateY: -22, rotate: -4 },
];

export function LandingStack() {
  const stageRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const stage = stageRef.current;
    if (!stage) return;
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) { stage.dataset.state = "resolved"; return; }
    const tools = [...stage.querySelectorAll<HTMLElement>("[data-tool]")];
    const tile = stage.querySelector<HTMLElement>("[data-tile]");
    if (!tile || tools.length === 0) return;

    // How far apart the tools can sit: most of the stage on a wide screen, the middle on a phone.
    const reach = () => Math.max(60, Math.min(stage.clientWidth / 2 - 150, 520));
    const phone = () => stage.clientWidth < 760;
    const scatter = () => tools.forEach((tool, i) => {
      const at = SCATTER[i] ?? SCATTER[0];
      utils.set(tool, {
        translateX: phone() ? at.x * 40 : at.x * reach(),
        translateY: phone() ? (i - 2) * 58 : at.y,
        rotateX: 16,
        rotateY: phone() ? 0 : at.rotateY,
        rotate: at.rotate,
        scale: 1,
        opacity: 1,
      });
    });
    scatter();

    let timeline: ReturnType<typeof createTimeline> | null = null;
    // The take-over plays once, the first time the stage is well into view; the flow on both sides
    // runs only while the stage is on screen.
    const io = new IntersectionObserver(([entry]) => {
      const visible = Boolean(entry?.isIntersecting);
      stage.dataset.run = String(visible && stage.dataset.state === "resolved");
      if (!visible || timeline) return;
      timeline = createTimeline({
        defaults: { ease: "inOutCubic" },
        onComplete: () => { stage.dataset.state = "resolved"; stage.dataset.run = "true"; },
      });
      // 1. The five tools fly into the middle and settle into one 3D stack, each a little above the last.
      tools.forEach((tool, i) => {
        timeline!.add(tool, {
          translateX: 0,
          translateY: 34 - i * 14,
          rotateX: 52,
          rotateY: 0,
          rotate: -24,
          duration: 900,
        }, 500 + i * 90);
      });
      // 2. Insurvas lands on top of the stack and takes it over.
      timeline
        .add(tile, { opacity: [0, 1], translateY: [-40, 0], scale: [1.12, 1], duration: 560, ease: "outBack(1.3)" }, 1800)
        .add(tools, { opacity: 0, scale: 0.85, duration: 420, ease: "inQuad" }, 2050);
    }, { threshold: 0.5 });
    io.observe(stage);
    const onResize = () => { if (!timeline) scatter(); };
    window.addEventListener("resize", onResize);
    return () => { io.disconnect(); window.removeEventListener("resize", onResize); timeline?.revert(); };
  }, []);

  return (
    <section aria-labelledby="stack-title" className={styles.section}>
      <div className={styles.inner}>
        <header className={styles.head}>
          <p className={styles.eyebrow}>Sound like your agency?</p>
          <h2 id="stack-title" className={styles.heading}>Most final expense agencies run on five tools that don’t talk to each other.</h2>
          <p className={styles.lede}>A CRM for tracking. A dialer for calls. A spreadsheet for commissions, another for publisher payouts. And a prayer for compliance. None of it scales.</p>
        </header>
      </div>

      <div ref={stageRef} className={styles.stage} data-state="stacked" aria-hidden="true">
        <div className={styles.labels}><span data-side="problem">Coming in</span><span data-side="fix">Coming out</span></div>
        <div className={styles.lanes}>
          {/* Visibly moving (owner, 6 Nov): about 85px a second, each lane a little different. */}
          {LANES.map((pairs, i) => <Lane key={i} pairs={pairs} speed={[17, 21, 19][i]} delay={-i * 5} />)}
        </div>
        {/* The gate: every card passes through it and comes out fixed. */}
        <div className={styles.gate}>
          <span className={styles.beam} />
          <div data-tile="" className={styles.tile}>
            <InsurvasLogo variant="symbol" tone="dark" size="public" alt="" className={styles.mark} />
          </div>
        </div>
        {/* The five tools, as 3D cards spread across the stage; they stack and Insurvas takes over. */}
        <div className={styles.deck}>
          {TOOLS.map((tool, i) => {
            const Icon = tool.icon;
            return (
              <div key={tool.name} data-tool="" className={styles.tool} style={{ zIndex: i + 1 }}>
                <Icon aria-hidden="true" />
                <b>{tool.name}</b>
                <small>{tool.job}</small>
              </div>
            );
          })}
        </div>
      </div>

      <div className={styles.inner}>
        {/* TO CONFIRM (Umar): "two years", from the review call. */}
        <p className={styles.story}>We ran a final expense agency on those five tools for two years. <b>Insurvas is the one system we built to replace them.</b></p>
      </div>
    </section>
  );
}
