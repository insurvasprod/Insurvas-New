"use client";

import Image from "next/image";
import { useEffect, useRef, useState } from "react";
import type { CSSProperties } from "react";
import { ArrowLeft, ArrowRight, Check } from "lucide-react";

import { InsurvasLogo } from "@/components/shared/insurvas-logo";

import styles from "@/components/marketing/landing-broken.module.css";

/**
 * "What's broken today" (2026-11-04, owner, copy from "Insurvas OS Landing.md"): seven leaks as a
 * row of photo cards you can scroll. Each card is a real photograph (public/marketing/README.md has
 * the sources and licences) and the problem in one line; choosing a card opens what Insurvas does
 * about it, and on which plan, underneath. The cards are pressed buttons, not tabs: they scroll.
 *
 * Owner, 6 Nov (third pass): crazier, 3D, and the leaks go through Insurvas the way the five-tools
 * section does. The seven photo cards stand on a slowly turning ring seen from a little above; the
 * Insurvas tile floats over the middle with a beam down to the front. Each card comes round from the
 * left as the problem, and as it passes under the beam a green scan crosses it and it flips to the fix,
 * leaving to the right solved. The panel below always shows the card solved last. Choosing a card or
 * an arrow turns the ring to it and holds for 15 s. The turn is a Web Animations rotation, so it runs
 * on the compositor; the ring pauses off screen and stands still under reduced motion.
 */
const LEAK_HOLD_MS = 15_000;
/** One card reaches the beam every 5 seconds. */
const TURN_MS = 7 * 5_000;
const STEP = 360 / 7;
const LEAKS = [
  {
    key: "lapse",
    tab: "Lapses",
    photo: "/marketing/leak-lapse.webp",
    broken: "One early lapse can erase the profit from 26 good sales.",
    body: "The carrier pays an advance on day one. If the policy lapses early, they take it back on a later statement. Most agents find out when that statement lands.",
    plan: "Advanced",
    fix: "You are warned before the policy dies, not after.",
    points: [
      "A save queue of at-risk policies, ranked by risk times money.",
      "Failed drafts, lapse notices and drafts that land before the deposit are flagged before the draft date.",
      "Payment repair: call, update the bank details, track the change to the carrier.",
    ],
  },
  {
    key: "draft",
    tab: "Draft dates",
    photo: "/marketing/leak-draft.webp",
    broken: "The draft hits an empty account, and the policy is dead in two months.",
    body: "Final expense customers live on Social Security. If the draft date lands before the deposit, the draft bounces, and about two months later the advance is clawed back. Nobody checks the date at the kitchen table.",
    plan: "Basic and up",
    fix: "The draft date is checked while you are still on the phone.",
    points: [
      "Enter the date of birth and Insurvas works out the Social Security deposit window.",
      "A draft date that lands before the deposit is flagged before you submit. You can override it, and the override is logged.",
      "A pre-submission check catches the gaps that make carriers bounce an application (NIGO).",
    ],
  },
  {
    key: "commission",
    tab: "Underpaid commission",
    photo: "/marketing/leak-commission.webp",
    broken: "Carriers underpay you, and nine statement formats make sure you never notice.",
    body: "Every carrier sends its own PDF. Most sit unopened. Policies that were never paid, lines paid at the wrong rate and duplicate chargebacks stay buried on line 34.",
    plan: "Every plan",
    fix: "Every statement line meets the policy you wrote.",
    points: [
      "Upload a statement or send it by email. Each line is matched to a policy, and you accept every match.",
      "A discrepancy report: missing, short-paid, mis-rated, duplicate and unexpected chargebacks.",
      "Dispute letters drafted with the policy numbers and the arithmetic.",
    ],
  },
  {
    key: "vendors",
    tab: "Vendors",
    photo: "/marketing/leak-vendors.webp",
    broken: "You pay your vendors on the honour system.",
    body: "A vendor messages on WhatsApp for last week’s 31 transfers. You count them by hand and get a different number. And the vendor that looks cheapest per sale may be the one whose customers lapse the most.",
    plan: "Basic and Advanced",
    fix: "Every dollar is traced to the lead that earned it, or didn’t.",
    points: [
      "Cost recorded on every lead, from every list and every transfer.",
      "Reject a bad transfer with the call recording. The payout reverses and a dispute opens.",
      "A lead-source scorecard with true cost per sale, lapses included.",
      "Partners sign in and see their own numbers before the argument starts.",
    ],
  },
  {
    key: "compliance",
    tab: "Compliance",
    photo: "/marketing/leak-compliance.webp",
    broken: "One bad dial can cost more than the sale.",
    body: "TCPA penalties start at $500 a call and can reach $1,500. A purchased list is exactly where Do Not Call numbers hide. When a demand letter arrives, finding the proof can take two weeks.",
    plan: "Basic and Advanced",
    fix: "Every dial is screened first. Every call has its paper trail.",
    points: [
      "Every list is scrubbed against Do Not Call before it is dialed. It is not a toggle.",
      "Consent, DNC, your suppression list and the calling window are re-checked on the server before every dial. Refusals are logged with the reason.",
      "Consent certificates and call recordings stored against each lead.",
      "A one-click litigation packet: every call, recording, certificate and scrub result for one contact.",
    ],
    note: "A screening tool, not a guarantee that every call is lawful. Compliance stays with your agency.",
  },
  {
    key: "profit",
    tab: "Profit",
    photo: "/marketing/leak-profit.webp",
    broken: "Nobody can tell you whether you made money today.",
    body: "Leads live in one tool, sales in a spreadsheet, commissions in nine portals and vendor bills in WhatsApp. At nine at night, you still cannot say if the day paid.",
    plan: "Dashboard in every plan, Accounting in Advanced",
    fix: "One ledger. Every dollar in and out, tied to a policy.",
    points: [
      "Lead cost, vendor payouts, advances, commissions and chargebacks written to one ledger.",
      "Profit and loss by month, by vendor and by policy.",
      "Cost per policy issued, beside cost per policy that stays.",
    ],
  },
  {
    key: "team",
    tab: "Your team",
    photo: "/marketing/leak-team.webp",
    broken: "The day you hire, the spreadsheet breaks.",
    body: "Your first assistant needs your leads and callbacks, not your commissions. Your bookkeeper needs the ledger, not the call recordings. A shared login and a shared sheet cannot tell the difference.",
    plan: "Team plans",
    fix: "Everyone gets a role. Nobody gets the whole keyring.",
    points: [
      "Owner, producer, assistant and bookkeeper roles, set per account.",
      "Producers see their own policies and commissions. Assistants see no money data at all.",
    ],
  },
];

export function LandingBroken() {
  const [index, setIndex] = useState(0);
  const leak = LEAKS[index];
  const stageRef = useRef<HTMLDivElement>(null);
  const ringRef = useRef<HTMLDivElement>(null);
  const spin = useRef<Animation | null>(null);
  const holdTimer = useRef(0);

  /** The ring's angle now, in degrees (0 → 360 over one turn). */
  const angleNow = () => {
    const animation = spin.current;
    return animation ? (Number(animation.currentTime ?? 0) / TURN_MS) * 360 : 0;
  };
  /** Turns the ring to an angle over a short ease-out, then holds it before it carries on. */
  const turnTo = (target: number, hold = true) => {
    const animation = spin.current;
    if (!animation) return;
    const from = angleNow();
    let delta = (((target - from) % 360) + 540) % 360 - 180; // the short way round
    if (Math.abs(delta) < 0.5) delta = 0;
    animation.pause();
    // The first frame's time is the start, so no clock is read here.
    let begin = -1;
    const step = (now: number) => {
      if (begin < 0) begin = now;
      const t = Math.min(1, (now - begin) / 700);
      const eased = 1 - (1 - t) ** 4;
      animation.currentTime = ((((from + delta * eased) % 360) + 360) % 360 / 360) * TURN_MS;
      if (t < 1) requestAnimationFrame(step);
    };
    requestAnimationFrame(step);
    window.clearTimeout(holdTimer.current);
    if (hold && !window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
      holdTimer.current = window.setTimeout(() => spin.current?.play(), LEAK_HOLD_MS);
    }
  };
  // Card i reaches the beam at angle i·STEP; just past it, it is solved.
  const choose = (i: number) => turnTo(i * STEP + 4);
  const scroll = (by: number) => turnTo((Math.floor(angleNow() / STEP) + by) * STEP + 4);

  // The turn: a Web Animations rotation (on the compositor, so it stays smooth), one card every 5 s.
  useEffect(() => {
    const ring = ringRef.current;
    const stage = stageRef.current;
    if (!ring || !stage) return;
    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const animation = ring.animate(
      [{ transform: "translateZ(calc(var(--r) * -1)) rotateY(0deg)" }, { transform: "translateZ(calc(var(--r) * -1)) rotateY(360deg)" }],
      { duration: TURN_MS, iterations: Infinity, easing: "linear" },
    );
    animation.currentTime = (4 / 360) * TURN_MS;
    if (reduce) animation.pause();
    spin.current = animation;
    // Which side of the beam each card is on, and which card was solved last: read ten times a second.
    const cards = [...ring.querySelectorAll<HTMLElement>("[data-card]")];
    let last = -1;
    const read = window.setInterval(() => {
      const a = angleNow();
      cards.forEach((card, i) => {
        const world = (((a - i * STEP) % 360) + 360) % 360; // 0 at the beam, growing as it moves right
        card.dataset.solved = String(world < 180);
      });
      const front = ((Math.floor(a / STEP) % LEAKS.length) + LEAKS.length) % LEAKS.length;
      if (front !== last) { last = front; setIndex(front); }
    }, 100);
    const io = new IntersectionObserver(([entry]) => {
      if (reduce) return;
      if (entry?.isIntersecting) { if (!holdTimer.current || animation.playState !== "paused") animation.play(); } else animation.pause();
    }, { threshold: 0 });
    io.observe(stage);
    return () => { window.clearInterval(read); window.clearTimeout(holdTimer.current); io.disconnect(); animation.cancel(); spin.current = null; };
  }, []);

  return (
    <div className={styles.broken}>
      <div className={styles.controls}>
        <p className={styles.count}>{index + 1} of {LEAKS.length} · <b>{leak.tab}</b></p>
        <div className={styles.arrows}>
          <button type="button" onClick={() => scroll(-1)} aria-label="Previous leak"><ArrowLeft aria-hidden="true" /></button>
          <button type="button" onClick={() => scroll(1)} aria-label="Next leak"><ArrowRight aria-hidden="true" /></button>
        </div>
      </div>

      {/* The 3D ring: problems come round from the left, pass under Insurvas's beam, flip to the fix. */}
      <div ref={stageRef} className={styles.stage}>
        <div className={styles.core} aria-hidden="true">
          <span className={styles.coreTile}><InsurvasLogo variant="symbol" tone="dark" size="public" alt="" className={styles.coreMark} /></span>
          <span className={styles.coreBeam} />
        </div>
        <div className={styles.view}>
          <div ref={ringRef} className={styles.ring} role="group" aria-label="What’s broken today">
            {LEAKS.map((item, i) => (
              <button
                key={item.key}
                type="button"
                data-card=""
                data-solved="false"
                aria-pressed={i === index}
                aria-controls="leak-panel"
                aria-label={`${item.tab}: ${item.broken}`}
                className={styles.slot}
                style={{ "--a": `${-i * STEP}deg` } as CSSProperties}
                onClick={() => choose(i)}
              >
                <span className={styles.flip}>
                  <span className={styles.face} data-face="problem">
                    <span className={styles.photo}><Image src={item.photo} alt="" fill sizes="300px" /></span>
                    <span className={styles.cardText}>
                      <span className={styles.cardTab}>{item.tab}</span>
                      <span className={styles.cardTitle}>{item.broken}</span>
                    </span>
                  </span>
                  <span className={styles.face} data-face="fix">
                    <span className={styles.photo}><Image src={item.photo} alt="" fill sizes="300px" /><span className={styles.solved}><Check aria-hidden="true" />Solved in Insurvas</span></span>
                    <span className={styles.cardText}>
                      <span className={styles.cardTab}>{item.tab} · {item.plan}</span>
                      <span className={styles.cardTitle}>{item.fix}</span>
                    </span>
                  </span>
                </span>
              </button>
            ))}
          </div>
        </div>
      </div>

      <div id="leak-panel" className={styles.panel} aria-live="polite" key={leak.key}>
        <div className={styles.panelProblem}>
          <p className={styles.tag}>Broken today</p>
          <p className={styles.problem}>{leak.broken}</p>
          <p className={styles.body}>{leak.body}</p>
        </div>
        <div className={styles.panelFix}>
          <p className={styles.plan}>With Insurvas <b>{leak.plan}</b></p>
          <p className={styles.fix}>{leak.fix}</p>
          <ul className={styles.points}>
            {leak.points.map((point) => <li key={point}>{point}</li>)}
          </ul>
          {"note" in leak && leak.note && <p className={styles.note}>{leak.note}</p>}
        </div>
      </div>
    </div>
  );
}
