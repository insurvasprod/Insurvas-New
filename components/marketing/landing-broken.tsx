"use client";

import Image from "next/image";
import { useEffect, useRef } from "react";
import { Check } from "lucide-react";
import { gsap } from "gsap";
import { ScrollTrigger } from "gsap/ScrollTrigger";

import { InsurvasLogo } from "@/components/shared/insurvas-logo";
import styles from "@/components/marketing/landing-broken.module.css";

/**
 * "What's broken today": seven leaks, each a real photograph (public/marketing/README.md has the
 * sources and licences), the problem in one line and the fix Insurvas brings, on the plan shown.
 */
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

/**
 * The journey (owner, 6 Nov; it replaces the separate five-tools section). One screen that holds
 * still while the visitor scrolls through it: the seven problems in a row at the top, Insurvas in the
 * middle, and seven empty places in a row at the bottom. Scrolling sends the problem cards down one
 * after another; each drops behind Insurvas, turns into its fix there, and comes out into its place
 * below, photo and all. Everything stays on screen the whole way, so there is no empty scrolling.
 *
 * GSAP ScrollTrigger scrubs one timeline (scrub 0.6), so the motion follows the scroll and plays
 * backwards on the way up. The paths are measured inside the pinned stage, which does not move, and
 * re-measured whenever its size changes. Phones and reduced motion get the parts in order instead.
 */
function offsetWithin(el: HTMLElement, root: HTMLElement) {
  let x = 0;
  let y = 0;
  let node: HTMLElement | null = el;
  while (node && node !== root) {
    x += node.offsetLeft;
    y += node.offsetTop;
    node = node.offsetParent as HTMLElement | null;
  }
  return { x: x + el.offsetWidth / 2, y: y + el.offsetHeight / 2 };
}

function Face({ leak, side }: { leak: (typeof LEAKS)[number]; side: "problem" | "fix" }) {
  return (
    <div className={styles.face} data-face={side}>
      <span className={styles.photo}>
        <Image src={leak.photo} alt="" fill sizes="(max-width: 760px) 75vw, 260px" />
        {side === "fix" && <span className={styles.solved}><Check aria-hidden="true" />Solved</span>}
      </span>
      <span className={styles.text}>
        <span className={styles.tab}>{side === "fix" ? `${leak.tab} · ${leak.plan}` : leak.tab}</span>
        <span className={styles.title}>{side === "fix" ? leak.fix : leak.broken}</span>
      </span>
    </div>
  );
}

export function LandingBroken() {
  const sectionRef = useRef<HTMLElement>(null);

  useEffect(() => {
    const section = sectionRef.current;
    if (!section) return;
    gsap.registerPlugin(ScrollTrigger);
    const mm = gsap.matchMedia();
    mm.add("(min-width: 761px) and (prefers-reduced-motion: no-preference)", () => {
      section.dataset.mode = "scene";
      const stage = section.querySelector<HTMLElement>("[data-stage]")!;
      const cards = gsap.utils.toArray<HTMLElement>("[data-card]", section);
      const slots = gsap.utils.toArray<HTMLElement>("[data-slot]", section);
      const gate = section.querySelector<HTMLElement>("[data-gate]")!;
      const count = section.querySelector<HTMLElement>("[data-count]")!;
      const through: number[] = [];
      const tl = gsap.timeline({
        defaults: { ease: "none" },
        scrollTrigger: { trigger: section, start: "top top", end: "bottom bottom", scrub: 0.6, invalidateOnRefresh: true },
      });
      cards.forEach((card, i) => {
        const flip = card.querySelector<HTMLElement>("[data-flip]")!;
        const start = 0.04 + i * 0.075;
        const arrive = start + 0.2; // behind the gate
        through.push(arrive);
        const from = () => offsetWithin(card, stage);
        tl.to(card, {
          x: () => offsetWithin(gate, stage).x - from().x,
          y: () => offsetWithin(gate, stage).y - from().y,
          scale: 0.4,
          rotationX: 28,
          transformPerspective: 900,
          duration: arrive - start,
          ease: "power2.in",
        }, start)
          .set(flip, { rotationY: 180 }, arrive)
          .fromTo(gate, { "--glow": 1 }, { "--glow": 0.25, duration: 0.08, immediateRender: false }, arrive)
          .to(card, {
            x: () => offsetWithin(slots[i], stage).x - from().x,
            y: () => offsetWithin(slots[i], stage).y - from().y,
            scale: 1,
            rotationX: 0,
            duration: 0.2,
            ease: "power3.out",
          }, arrive);
      });
      tl.to({}, { duration: 0.06 });
      // The gate counts the fixes as the cards go through it.
      let shown = -1;
      tl.eventCallback("onUpdate", () => {
        const done = through.filter((t) => tl.time() >= t).length;
        if (done !== shown) { shown = done; count.textContent = `${done} of 7 fixed`; }
      });
      let pending = 0;
      const remeasure = () => { window.clearTimeout(pending); pending = window.setTimeout(() => ScrollTrigger.refresh(), 120); };
      const watch = new ResizeObserver(remeasure);
      watch.observe(stage);
      document.fonts?.ready.then(remeasure);
      return () => { watch.disconnect(); window.clearTimeout(pending); delete section.dataset.mode; count.textContent = "7 of 7 fixed"; };
    });
    return () => mm.revert();
  }, []);

  return (
    <section ref={sectionRef} id="industries" aria-labelledby="audience-title" className={styles.section}>
      <div className={styles.stage} data-stage="">
        <header className={styles.head}>
          <p className={styles.eyebrow}>What’s broken today</p>
          <h2 id="audience-title" className={styles.heading}>Seven leaks in your business. One system closes them.</h2>
          <p className={styles.lede}>Each one costs you money every month. Scroll, and watch them go through Insurvas.</p>
        </header>

        <ul className={styles.grid} data-problems="">
          {LEAKS.map((leak) => (
            <li key={leak.key} className={styles.card} data-card="">
              <div className={styles.flip} data-flip="">
                <Face leak={leak} side="problem" />
                <Face leak={leak} side="fix" />
              </div>
            </li>
          ))}
        </ul>

        {/* The gate: the five tools go in, one system comes out (Umar's A3, in one line). */}
        <div className={styles.gateZone}>
          <p className={styles.gateNote}>A CRM, a dialer, two spreadsheets and a prayer</p>
          <div className={styles.gate} data-gate="">
            <InsurvasLogo variant="wordmark" tone="dark" size="public" alt="Insurvas" />
            <span className={styles.count} data-count="" aria-hidden="true">7 of 7 fixed</span>
            <span className={styles.gateScan} aria-hidden="true" />
          </div>
          <p className={styles.gateNote} data-out="">One system, built by people who ran the floor</p>
        </div>

        <ul className={styles.grid} data-solved="" aria-label="With Insurvas">
          {LEAKS.map((leak) => (
            <li key={leak.key} className={styles.card} data-slot="">
              <div className={styles.flip}><Face leak={leak} side="fix" /></div>
            </li>
          ))}
        </ul>
      </div>
    </section>
  );
}
