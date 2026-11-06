"use client";

import Image from "next/image";
import { useCallback, useEffect, useRef, useState } from "react";
import { ArrowLeft, ArrowRight } from "lucide-react";

import styles from "@/components/marketing/landing-broken.module.css";

/**
 * "What's broken today" (2026-11-04, owner, copy from "Insurvas OS Landing.md"): seven leaks as a
 * row of photo cards you can scroll. Each card is a real photograph (public/marketing/README.md has
 * the sources and licences) and the problem in one line; choosing a card opens what Insurvas does
 * about it, and on which plan, underneath. The cards are pressed buttons, not tabs: they scroll.
 *
 * Owner, 6 Nov: no scrollbar, the arrows at the top are the controls, the row glides one card to
 * the right on its own every few seconds (wrapping to the start at the end), and its edges fade.
 * The glide waits while the row is pointed at, focused, touched, off screen, or the tab is hidden,
 * and never runs under reduced motion. It only scrolls: the open leak changes when you choose one.
 */
const ADVANCE_MS = 4000;
/** How long after a touch, a click or an arrow the glide waits before it starts again. */
const RESUME_MS = 7000;
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
  const rowRef = useRef<HTMLDivElement>(null);
  const leak = LEAKS[index];

  const holdUntil = useRef(0);
  const hovering = useRef(false);
  const visible = useRef(false);

  /** One card on (or back); past either end it wraps to the other. */
  const scroll = useCallback((by: number) => {
    const row = rowRef.current;
    const card = row?.querySelector("button");
    if (!row || !card) return;
    const step = card.getBoundingClientRect().width + 16;
    const end = row.scrollWidth - row.clientWidth - 8;
    if (by > 0 && row.scrollLeft >= end) row.scrollTo({ left: 0, behavior: "smooth" });
    else if (by < 0 && row.scrollLeft <= 8) row.scrollTo({ left: row.scrollWidth, behavior: "smooth" });
    else row.scrollBy({ left: by * step, behavior: "smooth" });
  }, []);

  const hold = () => { holdUntil.current = Date.now() + RESUME_MS; };

  // The edge fades show only where there is more to see.
  const updateEdges = useCallback(() => {
    const row = rowRef.current;
    if (!row) return;
    row.dataset.start = String(row.scrollLeft <= 8);
    row.dataset.end = String(row.scrollLeft >= row.scrollWidth - row.clientWidth - 8);
  }, []);

  useEffect(() => {
    const row = rowRef.current;
    if (!row) return;
    updateEdges();
    const io = new IntersectionObserver(([entry]) => { visible.current = Boolean(entry?.isIntersecting); }, { threshold: 0.5 });
    io.observe(row);
    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)");
    const timer = window.setInterval(() => {
      if (reduce.matches || !visible.current || hovering.current || document.hidden) return;
      if (Date.now() < holdUntil.current || row.contains(document.activeElement)) return;
      scroll(1);
    }, ADVANCE_MS);
    window.addEventListener("resize", updateEdges);
    return () => { io.disconnect(); window.clearInterval(timer); window.removeEventListener("resize", updateEdges); };
  }, [scroll, updateEdges]);

  return (
    <div className={styles.broken}>
      <div className={styles.controls}>
        <p className={styles.count}>{index + 1} of {LEAKS.length} · <b>{leak.tab}</b></p>
        <div className={styles.arrows}>
          <button type="button" onClick={() => { hold(); scroll(-1); }} aria-label="Scroll back"><ArrowLeft aria-hidden="true" /></button>
          <button type="button" onClick={() => { hold(); scroll(1); }} aria-label="Scroll on"><ArrowRight aria-hidden="true" /></button>
        </div>
      </div>

      <div
        ref={rowRef}
        className={styles.row}
        role="group"
        aria-label="What’s broken today"
        data-start="true"
        data-end="false"
        onScroll={updateEdges}
        onPointerEnter={(event) => { if (event.pointerType === "mouse") hovering.current = true; }}
        onPointerLeave={() => { hovering.current = false; }}
        onPointerDown={hold}
      >
        {LEAKS.map((item, i) => (
          <button
            key={item.key}
            type="button"
            aria-pressed={i === index}
            aria-controls="leak-panel"
            className={styles.card}
            onClick={() => { hold(); setIndex(i); }}
          >
            <span className={styles.photo}>
              <Image src={item.photo} alt="" fill sizes="(max-width: 640px) 80vw, 320px" />
            </span>
            <span className={styles.cardText}>
              <span className={styles.cardTab}>{item.tab}</span>
              <span className={styles.cardTitle}>{item.broken}</span>
            </span>
          </button>
        ))}
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
