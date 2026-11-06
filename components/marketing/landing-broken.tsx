"use client";

import Image from "next/image";
import { useEffect, useRef } from "react";
import { Check } from "lucide-react";

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
 * The journey (owner, 6 Nov; it replaces the separate five-tools section). One tall section in three
 * parts on the page: the seven problems with their photos at the top, the Insurvas gate in the middle,
 * and the seven fixes at the bottom. As the visitor scrolls, the problem cards travel down with them,
 * pass one by one behind the gate (where each turns into its fix), and spread out into the solved
 * grid below, photos and all. Scrolling back up plays it backwards.
 *
 * Every frame works the cards' positions out from scratch, from where each card lives, where the gate
 * is, where its solved place is, and where the scroll is. Nothing is recorded, so a late image, a
 * resize or a live reload cannot leave a card aiming at an old spot. The vertical travel moves with
 * the page: a card is in its own place while the problems are in view, behind the gate as the gate
 * crosses the middle of the screen, and in its solved place once the fixes are in view, so it stays
 * on screen the whole way. On phones the cards are slim rows, so the journey fits there too. Short
 * screens (a phone on its side) and reduced motion get the two grids as they are.
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
  return { x: x + el.offsetWidth / 2, y: y + el.offsetHeight / 2, h: el.offsetHeight };
}

const clamp01 = (n: number) => Math.min(1, Math.max(0, n));
const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
const easeInOut = (t: number) => (t < 0.5 ? 4 * t * t * t : 1 - (-2 * t + 2) ** 3 / 2);
const easeOut = (t: number) => 1 - (1 - t) ** 3;

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
    const scene = window.matchMedia("(min-height: 560px) and (prefers-reduced-motion: no-preference)");
    const cards = [...section.querySelectorAll<HTMLElement>("[data-card]")];
    const flips = cards.map((card) => card.querySelector<HTMLElement>("[data-flip]")!);
    const slots = [...section.querySelectorAll<HTMLElement>("[data-slot]")];
    const gate = section.querySelector<HTMLElement>("[data-gate]")!;
    const problems = section.querySelector<HTMLElement>("[data-problems]")!;
    const solved = section.querySelector<HTMLElement>("[data-solved]")!;
    let frame = 0;

    const clear = () => {
      cards.forEach((card) => { card.style.transform = ""; });
      flips.forEach((flip) => { flip.style.transform = ""; });
      gate.style.removeProperty("--glow");
    };

    const update = () => {
      frame = 0;
      if (!scene.matches) { delete section.dataset.mode; clear(); return; }
      section.dataset.mode = "scene";
      const vh = window.innerHeight;
      const scroll = window.scrollY;
      const top = section.getBoundingClientRect().top + scroll;
      const at = (el: HTMLElement) => { const o = offsetWithin(el, section); return { x: o.x, y: o.y + top, h: o.h }; };
      const from = at(problems);
      const to = at(solved);
      const g = at(gate);
      // Start once the problems are centred on screen; end once the fixes sit fully in view.
      const start = from.y - vh / 2 + 40;
      const end = to.y + to.h / 2 - vh + 28;
      const range = Math.max(1, end - start);
      const t = clamp01((scroll - start) / range);
      const atGate = clamp01((g.y - vh / 2 - start) / range);
      let glow = 0;
      cards.forEach((card, i) => {
        const a = at(card);
        const b = at(slots[i]);
        const leave = 0;
        const through = Math.min(0.9, Math.max(leave + 0.1, atGate + (i - 3) * 0.022));
        const land = i < 4 ? 0.95 : 0.995; // the bottom row lands as its row comes fully into view
        let x = a.x;
        let y = a.y;
        let scale = 1;
        let tilt = 0;
        let fixed = false;
        if (t > leave && t < through) {
          const u = (t - leave) / (through - leave);
          x = lerp(a.x, g.x + (i - 3) * 6, easeInOut(u));
          y = lerp(a.y, g.y, u);
          scale = lerp(1, 0.46, u);
          tilt = 18 * u;
        } else if (t >= through) {
          fixed = true;
          const u = clamp01((t - through) / (land - through));
          x = lerp(g.x + (i - 3) * 6, b.x, easeOut(u));
          y = lerp(g.y, b.y, u);
          scale = lerp(0.46, 1, easeOut(u));
          tilt = 18 * (1 - u);
        }
        glow = Math.max(glow, 1 - Math.abs(t - through) / 0.05);
        card.style.transform = t <= leave ? "" : `translate3d(${x - a.x}px, ${y - a.y}px, 0) perspective(900px) rotateX(${tilt}deg) scale(${scale})`;
        flips[i].style.transform = fixed ? "rotateY(180deg)" : "";
      });
      gate.style.setProperty("--glow", String(0.25 + 0.75 * glow));
    };
    const schedule = () => { if (!frame) frame = window.requestAnimationFrame(update); };

    update();
    window.addEventListener("scroll", schedule, { passive: true });
    window.addEventListener("resize", schedule);
    scene.addEventListener("change", schedule);
    const watch = new ResizeObserver(schedule);
    watch.observe(section);
    return () => {
      window.removeEventListener("scroll", schedule);
      window.removeEventListener("resize", schedule);
      scene.removeEventListener("change", schedule);
      watch.disconnect();
      window.cancelAnimationFrame(frame);
      delete section.dataset.mode;
      clear();
    };
  }, []);

  return (
    <section ref={sectionRef} id="industries" aria-labelledby="audience-title" className={styles.section}>
      <div className={styles.inner}>
        <header className={styles.head}>
          <p className={styles.eyebrow}>What’s broken today</p>
          <h2 id="audience-title" className={styles.heading}>Seven leaks in your business. One system closes them.</h2>
          <p className={styles.lede}>Each one costs you money every month.<span className={styles.sceneHint}> Scroll, and watch them go through Insurvas.</span></p>
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
            <span className={styles.gateScan} aria-hidden="true" />
          </div>
          <p className={styles.gateNote} data-out="">One system, built by people who ran the floor</p>
        </div>

        <header className={styles.head} data-solved-head="">
          <p className={styles.eyebrow}>With Insurvas</p>
          <h2 className={styles.heading}>Seven fixes, in one workspace.</h2>
        </header>
        <ul className={styles.grid} data-solved="">
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
