"use client";

import { useEffect, useRef, useState } from "react";
import type { CSSProperties } from "react";
import {
  ArrowLeft, BadgeCheck, BadgeDollarSign, Ban, BookOpen, CalendarClock, ClipboardCheck, CopyX, FileCheck, FileSpreadsheet, FileText, Handshake, HeartHandshake, IdCard, Link2, ListOrdered, PhoneCall, PhoneIncoming, Plus, Receipt, Route, ScrollText, ShieldAlert, ShieldCheck, Stethoscope, Tag, TrendingUp, TriangleAlert, UserCheck, Wallet,
} from "lucide-react";

import { LandingFlow, type FlowGraph } from "@/components/marketing/landing-flow";
import styles from "@/components/marketing/landing-features.module.css";
import { titleCase } from "@/lib/marketing/titleCase";

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
 * Owner, 6 Nov: the seven are Umar's, in his order and wording (10:23 in the call), each card carrying
 * that module's main information: the promise, four points, and the app pages it is made of
 * ("Inside", real menu pages from lib/menu/definition.ts).
 */
// On the card: the module's name, a tagline and three short points (Keller, 10 Nov: "it's an elevator
// pitch"). Behind "More info": the lede, the four points and the app pages it is made of.
type Module = { key: string; title: string; tagline: string; short: string[]; lede: string; points: string[]; inside: string[]; graph: FlowGraph };

// Written in sentence case; the cards show it in title case (see MODULES, below the list).
const COPY: Module[] = [
  {
    key: "partners",
    title: "Partnerships & lead flow",
    lede: "Set up every partner and lead source once; their leads and live transfers arrive in one queue, each with its source and cost.",
    tagline: "Every lead source, one queue.",
    short: ["Partners get their own portal", "Live transfers claimed once", "Cost on every lead"],
    points: ["Partners and publishers with their own sign-in, chat and terms", "Live transfers claimed once, with the wait shown", "Lead cost recorded on every lead and transfer", "Partners see only their own leads and results"],
    inside: ["Partners", "Publishers", "Lead routing", "Inbound", "Partner chat"],
    graph: {
      record: "Lead · $38.00",
      nodes: [
        { id: "summit", icon: Handshake, label: "Summit Data", sub: "Partner posts a lead", col: 0, row: 0, kind: "source" },
        { id: "bayview", icon: PhoneIncoming, label: "Bayview Data", sub: "Publisher live transfer", col: 0, row: 2, kind: "source" },
        { id: "routing", icon: Route, label: "Lead routing", sub: "Source and cost $38.00", col: 1, row: 1 },
        { id: "queue", icon: PhoneCall, label: "Inbound queue", sub: "Waiting 0:14", col: 2, row: 0 },
        { id: "claimed", icon: UserCheck, label: "Claimed once", sub: "transfers today", col: 2, row: 2, kind: "outcome", value: { to: 38 } },
      ],
      steps: [[["summit", "routing"], ["bayview", "routing"]], [["routing", "queue"]], [["queue", "claimed"]]],
    },
  },
  {
    key: "dialer",
    title: "Outbound dialer & lead management",
    lede: "Import the lists you buy, clean them once, and dial them with every call screened first.",
    tagline: "Buy a list. Dial it today.",
    short: ["Duplicates caught on import", "DNC checked before every dial", "Callbacks in the client’s time"],
    points: ["Map a vendor’s CSV once; duplicates set aside for review", "Consent, DNC, suppression and calling window checked before every dial", "Queue scored by priority; leads recycled on your cadence", "Callbacks booked in the client’s own time"],
    inside: ["Dialer", "Lead workspace", "List import", "Lead recycling", "Callbacks"],
    graph: {
      record: "600 rows",
      nodes: [
        { id: "import", icon: FileSpreadsheet, label: "List import", sub: "cobalt-media.csv · 600 rows", col: 0, row: 1, kind: "source" },
        { id: "dupes", icon: CopyX, label: "Duplicate check", sub: "16 set aside for review", col: 1, row: 0, kind: "branch" },
        { id: "screen", icon: ShieldCheck, label: "Screened first", sub: "Consent · DNC · window", col: 1, row: 2 },
        { id: "dial", icon: PhoneCall, label: "Dialer", sub: "Ruth A. · clear to dial", col: 2, row: 0 },
        { id: "callback", icon: CalendarClock, label: "Callback booked", sub: "contacts today", col: 2, row: 2, kind: "outcome", value: { to: 61 } },
      ],
      steps: [[["import", "dupes"], ["import", "screen"]], [["screen", "dial"]], [["dial", "callback"]]],
    },
  },
  {
    key: "apps",
    title: "Interview and submit in one window",
    lede: "Verify, interview, quote, name beneficiaries and take payment in one flow, while the client is still on the line.",
    tagline: "Close the sale before you hang up.",
    short: ["Interview to submission, one window", "Draft date checked first", "Pending cases tracked"],
    points: ["One window from identity check to submitted application", "Review separates hard blockers from soft checks", "Draft dates checked against the deposit before you submit", "Pending cases tracked until the carrier decides"],
    inside: ["Applications", "Quotes", "Application review", "Draft dates", "Pending cases"],
    graph: {
      record: "Ruth A.",
      nodes: [
        { id: "verify", icon: IdCard, label: "Identity verified", sub: "Ruth A. · on the line", col: 0, row: 0, kind: "source" },
        { id: "interview", icon: Stethoscope, label: "Interview", sub: "Health questions", col: 0, row: 1 },
        { id: "quote", icon: Receipt, label: "Quote", sub: "$70.00 a month", col: 0, row: 2 },
        { id: "review", icon: ClipboardCheck, label: "Review", sub: "0 blockers · 1 to confirm", col: 1, row: 1 },
        { id: "draft", icon: CalendarClock, label: "Draft date", sub: "After the deposit", col: 2, row: 0 },
        { id: "submitted", icon: BadgeCheck, label: "Submitted", sub: "submitted this week", col: 2, row: 2, kind: "outcome", value: { to: 23 } },
      ],
      steps: [[["verify", "interview"]], [["interview", "quote"]], [["quote", "review"]], [["review", "draft"]], [["draft", "submitted"]]],
    },
  },
  {
    key: "money",
    title: "Commissions, book of business & automations",
    lede: "Everything after the submission: every policy in one book, every statement line matched, and the routine work done for you.",
    tagline: "Know you got paid right.",
    short: ["Statements matched line by line", "Expected vs. paid, side by side", "Splits worked out per agent"],
    points: ["Carrier statements by upload or email, each line matched to a policy", "Expected commission from your rate card, beside what was paid", "Splits and overrides worked out per producer", "Policy status changes move the book on their own"],
    inside: ["Book of business", "Policies", "Statements", "Commission ledger", "Rate card"],
    graph: {
      record: "Line 14 · $84.00",
      nodes: [
        { id: "policy", icon: FileCheck, label: "Policy issued", sub: "SAMPLE-0482 · Ruth A.", col: 0, row: 0, kind: "source" },
        { id: "statement", icon: FileText, label: "Carrier statement", sub: "Line 14 · $84.00", col: 0, row: 2, kind: "source" },
        { id: "match", icon: Link2, label: "Line matched", sub: "A person accepts it", col: 1, row: 1 },
        { id: "book", icon: BookOpen, label: "Book of business", sub: "Status moves to Paid", col: 2, row: 0 },
        { id: "ledger", icon: BadgeDollarSign, label: "Commissions", sub: "matched this month", col: 2, row: 2, kind: "outcome", value: { to: 63816.8, prefix: "$", decimals: 2 } },
      ],
      steps: [[["policy", "match"], ["statement", "match"]], [["match", "book"], ["match", "ledger"]]],
    },
  },
  {
    key: "accounting",
    title: "Accounting",
    lede: "Lead spend, commission, payouts and expenses in one ledger, so profit is a number, not a guess.",
    tagline: "Profit is a number, not a guess.",
    short: ["Every lead dollar tracked", "Payouts worked out for you", "True CPA by campaign"],
    points: ["Vendor bills and lead spend from every list", "Publisher payout runs worked out per period", "Profit and loss by campaign, vendor and month", "True CPA from your own linked data"],
    inside: ["Profit & loss", "Payout runs", "Vendor bills", "Expenses", "True CPA"],
    graph: {
      record: "Lead spend",
      nodes: [
        { id: "bills", icon: Receipt, label: "Vendor bills", sub: "Lead spend $10,236", col: 0, row: 0, kind: "source" },
        { id: "commission", icon: BadgeDollarSign, label: "Commission in", sub: "$63,816.80", col: 0, row: 1, kind: "source" },
        { id: "payouts", icon: Wallet, label: "Payout runs", sub: "Summit Data · October", col: 0, row: 2, kind: "source" },
        { id: "ledger", icon: BookOpen, label: "One ledger", sub: "Every dollar to a policy", col: 1, row: 1 },
        { id: "cpa", icon: Tag, label: "True CPA", sub: "$56.00 per policy", col: 2, row: 0 },
        { id: "pnl", icon: TrendingUp, label: "Profit & loss", sub: "this month", col: 2, row: 2, kind: "outcome", value: { to: 41180, prefix: "+$" } },
      ],
      steps: [[["bills", "ledger"], ["commission", "ledger"], ["payouts", "ledger"]], [["ledger", "cpa"], ["ledger", "pnl"]]],
    },
  },
  {
    key: "retention",
    title: "Retention",
    lede: "Missed drafts and lapse notices become a save queue, worked before the policy and its commission are lost.",
    tagline: "Save policies before they lapse.",
    short: ["Save queue ranked by money at risk", "Lapses flagged before the draft", "Reinstatements tracked"],
    points: ["A save queue ranked by risk times money", "Lapse risk flagged before the draft date", "Servicing and reinstatement tracked to the carrier", "Retention results by producer and vendor"],
    inside: ["Save queue", "Lapse risk", "Servicing", "Reinstatement", "Retention results"],
    graph: {
      record: "SAMPLE-0533",
      nodes: [
        { id: "missed", icon: TriangleAlert, label: "Draft missed", sub: "SAMPLE-0533 · notice", col: 0, row: 1, kind: "branch" },
        { id: "risk", icon: ShieldAlert, label: "Lapse risk", sub: "$1,240 at risk", col: 1, row: 0 },
        { id: "queue", icon: ListOrdered, label: "Save queue", sub: "Risk × money, first", col: 1, row: 2 },
        { id: "call", icon: PhoneCall, label: "Servicing call", sub: "New bank details", col: 2, row: 0 },
        { id: "saved", icon: HeartHandshake, label: "Policy saved", sub: "a year kept", col: 2, row: 2, kind: "outcome", value: { to: 1240, prefix: "$" } },
      ],
      steps: [[["missed", "risk"]], [["risk", "queue"]], [["queue", "call"]], [["call", "saved"]]],
    },
  },
  {
    key: "compliance",
    title: "Compliance",
    lede: "Consent, screening and every refused dial are recorded as the work happens, not reconstructed when a letter arrives.",
    tagline: "Every dial on the record.",
    short: ["Consent kept on every lead", "DNC refusals logged", "Evidence report in one click"],
    points: ["Consent certificates kept on every lead", "TCPA and DNC screening, with refusals logged and their reason", "Complaints tracked to their regulator deadline", "An evidence report for any contact, in one export"],
    inside: ["Compliance", "TCPA / DNC", "Consent locker", "Complaints", "Evidence report"],
    graph: {
      record: "Dial · Ruth A.",
      nodes: [
        { id: "consent", icon: FileCheck, label: "Consent locker", sub: "Certificate on the lead", col: 0, row: 1, kind: "source" },
        { id: "checks", icon: ShieldCheck, label: "DNC checks", sub: "TCPA, before every dial", col: 1, row: 1 },
        { id: "refused", icon: Ban, label: "Dial refused", sub: "Outside the window", col: 2, row: 0, kind: "branch" },
        { id: "placed", icon: PhoneCall, label: "Dial placed", sub: "4 of 4 passed", col: 2, row: 1 },
        { id: "evidence", icon: ScrollText, label: "Evidence report", sub: "records, one export", col: 2, row: 2, kind: "outcome", value: { to: 214 } },
      ],
      steps: [[["consent", "checks"]], [["checks", "refused"], ["checks", "placed"]], [["placed", "evidence"]]],
    },
  },
];

/* Title case on the cards (owner, 12 Nov: "each word to start with a capital, except a, the, it").
   Applied here, once, to everything a card and its diagram show, so new copy follows the rule without
   anyone having to remember it. `titleCase` only ever raises a first letter, so the diagrams' sample
   data — TCPA, SAMPLE-0482, cobalt-media.csv, Ruth A. — comes through untouched. The lede behind
   "More info" is a sentence of prose and stays one. */
const MODULES: Module[] = COPY.map((m) => ({
  ...m,
  title: titleCase(m.title),
  tagline: titleCase(m.tagline),
  short: m.short.map(titleCase),
  points: m.points.map(titleCase),
  inside: m.inside.map(titleCase),
  graph: {
    ...m.graph,
    record: titleCase(m.graph.record),
    nodes: m.graph.nodes.map((node) => ({ ...node, label: titleCase(node.label), sub: titleCase(node.sub) })),
  },
}));

export function LandingBento() {
  const cardRefs = useRef<Array<HTMLElement | null>>([]);
  const moreRefs = useRef<Array<HTMLButtonElement | null>>([]);
  const backRefs = useRef<Array<HTMLButtonElement | null>>([]);
  const sectionRef = useRef<HTMLElement>(null);
  const [active, setActive] = useState(0);
  // The card whose "More info" panel is open, if any; one at a time. It closes by itself once its
  // card is covered or off the screen, so scrolling back never finds a card left open.
  const [open, setOpen] = useState<number | null>(null);
  const openRef = useRef<number | null>(null);
  const focusAfter = useRef<HTMLElement | null>(null);
  // Keller, 10 Nov: "there should be colour here… you can see the colour break". A glow blooms
  // behind the stack once, as the section arrives.
  const [lit, setLit] = useState(false);

  useEffect(() => { openRef.current = open; focusAfter.current?.focus(); focusAfter.current = null; }, [open]);
  const show = (i: number) => { focusAfter.current = backRefs.current[i]; setOpen(i); };
  const hide = (i: number) => { focusAfter.current = moreRefs.current[i]; setOpen(null); };

  useEffect(() => {
    const section = sectionRef.current;
    if (!section) return;
    const io = new IntersectionObserver(([entry]) => { if (entry?.isIntersecting) { setLit(true); io.disconnect(); } }, { rootMargin: "0px 0px -35% 0px" });
    io.observe(section);
    return () => io.disconnect();
  }, []);

  // As the next card slides over, the one beneath recedes: a little smaller, and darker under its
  // shade, while the incoming card's top edge lights up (Keller, 10 Nov: "this starts to fade out…
  // a little bit of colour on the outside… to show you depth"). On narrower screens, where the cards
  // do not stack, each one rises and tilts up into place as it scrolls in instead (owner, 6 Nov).
  //
  // Everything is written straight onto the card, its shade and its rim, and only transform and
  // opacity change, so nothing inside the card is recomputed or repainted per frame. iPhone Safari
  // allows a page little memory for moving layers: a card carries a transform only while it moves.
  useEffect(() => {
    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const narrow = window.matchMedia("(max-width: 1000px)");
    // Phones stack the cards as a computer does (owner, 6 Nov), each card short enough for one screen.
    const phone = window.matchMedia("(max-width: 640px)");
    let frame = 0;
    const cards = cardRefs.current.filter(Boolean) as HTMLElement[];
    const dims = cards.map((card) => card.querySelector<HTMLElement>("[data-dim]"));
    const rims = cards.map((card) => card.querySelector<HTMLElement>("[data-rim]"));
    // Each value is written only when it changes: a card that is not moving costs nothing.
    const last = new WeakMap<HTMLElement, { transform?: string; opacity?: string }>();
    const put = (el: HTMLElement | null | undefined, prop: "transform" | "opacity", value: string) => {
      if (!el) return;
      const seen = last.get(el) ?? {};
      if (seen[prop] === value) return;
      seen[prop] = value;
      last.set(el, seen);
      el.style[prop] = value;
    };
    let lastActive = -1;
    const update = () => {
      frame = 0;
      const vh = window.innerHeight;
      const stacked = phone.matches || !narrow.matches;
      // Every read first, then every write. Reading a card's position after writing another's
      // transform makes the browser restyle the page, and the old loop did that once per card.
      const rects = cards.map((card) => card.getBoundingClientRect());
      const heights = cards.map((card) => card.offsetHeight);
      let current = 0;
      cards.forEach((card, i) => {
        const rect = rects[i];
        const next = rects[i + 1];
        if (rect.top < vh * 0.55) current = i;
        let cover = 0;
        if (stacked && next && !reduce) cover = Math.min(1, Math.max(0, 1 - (next.top - rect.top) / heights[i]));
        if (openRef.current === i && (cover > 0.85 || rect.bottom < 0 || rect.top > vh)) setOpen(null);
        if (stacked) {
          put(card, "opacity", "");
          put(card, "transform", cover > 0 ? `scale(${(1 - cover * (phone.matches ? 0.06 : 0.08)).toFixed(4)})` : "");
          put(dims[i], "opacity", (cover * (phone.matches ? 0.55 : 0.6)).toFixed(3));
          put(rims[i + 1], "opacity", reduce ? "" : (0.35 + cover * 0.65).toFixed(3));
          return;
        }
        put(dims[i], "opacity", "");
        put(rims[i + 1], "opacity", "");
        const enter = reduce ? 1 : Math.min(1, Math.max(0, (vh - rect.top) / (vh * 0.4)));
        if (enter >= 1 || rect.top > vh + 80) {
          put(card, "transform", "");
          put(card, "opacity", "");
        } else {
          const u = 1 - enter;
          put(card, "transform", `perspective(1100px) translateY(${(u * 90).toFixed(1)}px) rotateX(${(u * 16).toFixed(2)}deg) scale(${(1 - u * 0.08).toFixed(3)})`);
          put(card, "opacity", (0.15 + enter * 0.85).toFixed(3));
        }
      });
      // The flow diagram re-renders only when the card in front changes, not on every frame.
      if (current !== lastActive) { lastActive = current; setActive(current); }
    };
    const schedule = () => { if (!frame) frame = window.requestAnimationFrame(update); };
    update();
    window.addEventListener("scroll", schedule, { passive: true });
    window.addEventListener("resize", schedule);
    return () => { window.removeEventListener("scroll", schedule); window.removeEventListener("resize", schedule); window.cancelAnimationFrame(frame); };
  }, []);

  return (
    <section ref={sectionRef} id="features" aria-labelledby="features-title" className={styles.section} data-lit={lit || undefined}>
      <span className={styles.glow} aria-hidden="true" />
      <div className={styles.inner}>
        <header className={styles.head}>
          <p className={styles.eyebrow}>What it does</p>
          <h2 id="features-title" className={styles.title}>Built for the way insurance is <em>really</em> sold.</h2>
          <p className={styles.lede}>Seven modules in one workspace, from the partner’s first lead to the policy you keep.</p>
        </header>

        <div className={styles.stack}>
          {MODULES.map((module, i) => {
            const isOpen = open === i;
            const panelId = `feature-${module.key}-more`;
            return (
              <article
                key={module.key}
                ref={(node) => { cardRefs.current[i] = node; }}
                className={styles.card}
                data-open={isOpen || undefined}
                style={{ "--i": i, "--top": `${96 + i * 12}px` } as CSSProperties}
                aria-labelledby={`feature-${module.key}`}
              >
                <span className={styles.rim} data-rim="" aria-hidden="true" />
                <div className={styles.copy}>
                  <div className={styles.front} inert={isOpen}>
                    <h3 id={`feature-${module.key}`}>
                      <span className={styles.label}>
                        <span className={styles.count}>{String(i + 1).padStart(2, "0")} / {String(MODULES.length).padStart(2, "0")}</span>
                        {module.title}
                      </span>
                      <span className={styles.tagline}>{module.tagline}</span>
                    </h3>
                    <ul className={styles.points}>{module.short.map((point) => <li key={point}>{point}</li>)}</ul>
                    <div className={styles.actions}>
                      <button
                        type="button"
                        onClick={() => show(i)}
                        ref={(node) => { moreRefs.current[i] = node; }}
                        className={styles.more}
                        aria-expanded={isOpen}
                        aria-controls={panelId}
                      >
                        More Info<Plus aria-hidden="true" />
                      </button>
                    </div>
                  </div>
                  <div id={panelId} role="region" aria-label={`${module.title}: More Info`} className={styles.panel} inert={!isOpen}>
                    <button type="button" onClick={() => hide(i)} ref={(node) => { backRefs.current[i] = node; }} className={styles.back}>
                      <ArrowLeft aria-hidden="true" />Back
                    </button>
                    <p className={styles.panelTitle}>{module.title}</p>
                    <p className={styles.panelLede}>{module.lede}</p>
                    <ul className={styles.points}>{module.points.map((point) => <li key={point}>{point}</li>)}</ul>
                    <div className={styles.inside}>
                      <span>Inside</span>
                      <ul aria-label={`Pages in ${module.title}`}>{module.inside.map((page) => <li key={page}>{page}</li>)}</ul>
                    </div>
                  </div>
                </div>
                <div className={styles.scene}>
                  <LandingFlow graph={module.graph} playing={active === i} />
                </div>
                <span className={styles.dim} data-dim="" aria-hidden="true" />
              </article>
            );
          })}
        </div>
      </div>
    </section>
  );
}
