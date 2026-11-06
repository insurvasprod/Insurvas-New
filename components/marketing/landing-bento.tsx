"use client";

import { useEffect, useRef, useState } from "react";
import type { CSSProperties } from "react";
import {
  ArrowRight, BadgeCheck, BadgeDollarSign, Ban, CalendarClock, ClipboardCheck, CopyX, FileCheck, FileSpreadsheet,
  FileText, Handshake, HeartHandshake, IdCard, Link2, ListOrdered, PhoneCall, PhoneIncoming, Receipt, ScrollText,
  ShieldCheck, Stethoscope, Tag, TrendingUp, TriangleAlert, UserCheck, Wallet,
} from "lucide-react";

import { LandingFlow, type FlowStep } from "@/components/marketing/landing-flow";
import styles from "@/components/marketing/landing-features.module.css";

/**
 * "What it does": the workspace as a stack of module cards. Each card sticks below the header while
 * the next slides up over it, and the one beneath settles back.
 *
 * Umar's review (4 Nov): seven modules, not five (A5.1); the section design stays but the copy is
 * cut (A5.2), to a one-line lede and three points; and the isometric 3D scenes are replaced by a
 * small 2D flow diagram per module, a record travelling that module's real steps (A5.3,
 * `LandingFlow`). Behaviour described is the CRM's as observed
 * (docs/design/landing-page-research/crm-workflow-observations-production-2026-11-03.md).
 *
 * TO CONFIRM (Umar): the seven names are his first pass, spoken while thinking.
 */
type Module = { key: string; title: string; lede: string; points: string[]; cta: string; flow: FlowStep[] };

const MODULES: Module[] = [
  {
    key: "partners",
    title: "Partnerships & lead flow",
    lede: "Partners and vendors send leads and live transfers into one queue, each with its source and cost.",
    points: ["Partners sign in to see only their own leads", "Live transfers land in one queue, with the wait shown", "Lead cost recorded on every lead"],
    cta: "Set up a partner",
    flow: [
      { icon: Handshake, label: "Partner sends a lead", sub: "Summit Data · Final expense" },
      { icon: Tag, label: "Source and cost attached", sub: "Lead cost $38.00" },
      { icon: PhoneIncoming, label: "Live transfer queued", sub: "Waiting 0:14" },
      { icon: UserCheck, label: "Claimed by an agent", sub: "The first claim wins" },
    ],
  },
  {
    key: "dialer",
    title: "Outbound dialer & leads",
    lede: "Every list you buy is imported once, cleaned, and screened before a single dial.",
    points: ["Import a vendor’s CSV and map its columns once", "Duplicates set aside for a person to review", "Consent, DNC, suppression and calling window re-checked before every dial"],
    cta: "Import your first list",
    flow: [
      { icon: FileSpreadsheet, label: "Vendor list imported", sub: "cobalt-media.csv · 600 rows" },
      { icon: CopyX, label: "Duplicates set aside", sub: "16 for a person to review" },
      { icon: ShieldCheck, label: "Screened before the dial", sub: "Consent · DNC · calling window" },
      { icon: PhoneCall, label: "Dial placed", sub: "Ruth A. · clear to dial" },
      { icon: CalendarClock, label: "Callback booked", sub: "Thursday 10:30, her time" },
    ],
  },
  {
    key: "apps",
    title: "Applications",
    lede: "The application is filled and submitted while the client is still on the line.",
    points: ["Verify, interview, quote, beneficiaries and payment in one flow", "Review separates hard blockers from soft checks", "Draft dates and pending cases tracked"],
    cta: "See an application",
    flow: [
      { icon: IdCard, label: "Identity verified", sub: "Ruth A. · on the line" },
      { icon: Stethoscope, label: "Interview", sub: "Health questions answered" },
      { icon: Receipt, label: "Quote", sub: "$70.00 a month" },
      { icon: ClipboardCheck, label: "Beneficiaries & payment", sub: "2 named · draft on the 3rd" },
      { icon: BadgeCheck, label: "Submitted", sub: "0 blockers · 1 to confirm" },
    ],
  },
  {
    key: "money",
    title: "Commissions & book",
    lede: "Every carrier statement line meets the policy you wrote, with what was owed beside what was paid.",
    points: ["Carrier statements by upload or email", "Each line matched to a policy, and a person accepts it", "True CPA by vendor and campaign"],
    cta: "Match a statement",
    flow: [
      { icon: FileCheck, label: "Policy issued", sub: "SAMPLE-0482 · Ruth A." },
      { icon: FileText, label: "Carrier statement in", sub: "Line 14 · $84.00" },
      { icon: Link2, label: "Line matched", sub: "A person accepts it" },
      { icon: BadgeDollarSign, label: "Commission booked", sub: "Owed $84.00 · paid $84.00" },
    ],
  },
  {
    key: "accounting",
    title: "Accounting",
    lede: "Lead spend, commission and publisher payouts in one ledger, so profit is a number, not a guess.",
    points: ["Lead spend from every list and transfer", "Publisher payouts worked out per period", "Profit and loss by campaign and month"],
    cta: "See the ledger",
    flow: [
      { icon: Tag, label: "Lead spend", sub: "Cobalt Media · $10,236" },
      { icon: BadgeDollarSign, label: "Commission received", sub: "$63,816.80 this month" },
      { icon: Wallet, label: "Publisher payouts", sub: "Summit Data · per period" },
      { icon: TrendingUp, label: "Profit by campaign", sub: "P&L for the month" },
    ],
  },
  {
    key: "retention",
    title: "Retention",
    lede: "Missed drafts and lapse notices become a save queue, worked before the policy is lost.",
    points: ["Missed drafts and lapse notices go to a save queue", "Ranked by risk times money", "Servicing and reinstatement tracked"],
    cta: "Start keeping more",
    flow: [
      { icon: TriangleAlert, label: "Draft missed", sub: "SAMPLE-0533 · lapse notice" },
      { icon: ListOrdered, label: "Into the save queue", sub: "Ranked by risk × money" },
      { icon: PhoneCall, label: "Agent calls the client", sub: "New bank details taken" },
      { icon: HeartHandshake, label: "Policy saved", sub: "$1,240 a year kept" },
    ],
  },
  {
    key: "compliance",
    title: "Compliance",
    lede: "Consent, screening and every refused dial are recorded as the work happens, not reconstructed later.",
    points: ["Consent kept on every lead", "A refused dial is logged with its reason", "Complaints tracked to their regulator deadline"],
    cta: "See the checks",
    flow: [
      { icon: FileCheck, label: "Consent on file", sub: "Certificate on the lead" },
      { icon: ShieldCheck, label: "Checked before the dial", sub: "DNC · suppression · window" },
      { icon: Ban, label: "Dial refused", sub: "Outside the calling window" },
      { icon: ScrollText, label: "Logged with the reason", sub: "Who, when and why" },
    ],
  },
];

export function LandingBento() {
  const cardRefs = useRef<Array<HTMLElement | null>>([]);
  const [active, setActive] = useState(0);

  // As the next card slides over, the one beneath settles back: a little smaller and dimmer.
  useEffect(() => {
    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    let frame = 0;
    const update = () => {
      frame = 0;
      const cards = cardRefs.current.filter(Boolean) as HTMLElement[];
      let current = 0;
      cards.forEach((card, i) => {
        const next = cards[i + 1];
        const top = card.getBoundingClientRect().top;
        if (top < window.innerHeight * 0.55) current = i;
        if (!next || reduce) { card.style.setProperty("--cover", "0"); return; }
        const gap = next.getBoundingClientRect().top - top;
        const cover = Math.min(1, Math.max(0, 1 - gap / card.offsetHeight));
        card.style.setProperty("--cover", cover.toFixed(3));
      });
      setActive(current);
    };
    const schedule = () => { if (!frame) frame = window.requestAnimationFrame(update); };
    update();
    window.addEventListener("scroll", schedule, { passive: true });
    window.addEventListener("resize", schedule);
    return () => { window.removeEventListener("scroll", schedule); window.removeEventListener("resize", schedule); window.cancelAnimationFrame(frame); };
  }, []);

  return (
    <section id="features" aria-labelledby="features-title" className={styles.section}>
      <div className={styles.inner}>
        <header className={styles.head}>
          <p className={styles.eyebrow}>What it does</p>
          <h2 id="features-title" className={styles.title}>Built for the way insurance is <em>really</em> sold.</h2>
          <p className={styles.lede}>Seven modules, one workspace: from the partner’s lead to the policy you keep.</p>
        </header>

        <div className={styles.stack}>
          {MODULES.map((module, i) => (
            <article
              key={module.key}
              ref={(node) => { cardRefs.current[i] = node; }}
              className={styles.card}
              style={{ "--i": i, "--top": `${96 + i * 12}px` } as CSSProperties}
              aria-labelledby={`feature-${module.key}`}
            >
              <div className={styles.copy}>
                <span className={styles.count}>{String(i + 1).padStart(2, "0")} / {String(MODULES.length).padStart(2, "0")}</span>
                <h3 id={`feature-${module.key}`}>{module.title}</h3>
                <p>{module.lede}</p>
                <ul>{module.points.map((point) => <li key={point}>{point}</li>)}</ul>
                <a href="/signup" className={styles.cta}>{module.cta}<ArrowRight aria-hidden="true" /></a>
              </div>
              <div className={styles.scene}>
                <LandingFlow steps={module.flow} playing={active === i} />
              </div>
            </article>
          ))}
        </div>
      </div>
    </section>
  );
}
