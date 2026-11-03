"use client";

import { useEffect, useRef, useState } from "react";
import type { CSSProperties, ReactNode } from "react";
import {
  ArrowRight, BadgeDollarSign, Check, ClipboardCheck, FileSpreadsheet, FileText, Link2, Lock, PhoneCall, PhoneIncoming,
  ShieldCheck, Upload, UserRound, Users,
} from "lucide-react";

import styles from "@/components/marketing/landing-features.module.css";

/**
 * "What it does" (2026-11-03, after the owner's reference): the workspace as a stack of feature
 * cards. Each card sticks below the header while the next slides up over it, and the one beneath
 * settles back, so five features take about five screens of scroll. Left: the job, in plain words,
 * with what it includes. Right: an isometric scene built from that feature's real pieces — a vendor
 * file and its rows, the four dial checks, the application steps, a statement line meeting its
 * policy, the save queue. The scenes are drawn in HTML/CSS 3D, float gently while their card is in
 * front, and lift towards the pointer. Behaviour described is the CRM's as observed
 * (docs/design/landing-page-research/crm-workflow-observations-production-2026-11-03.md).
 */
type Tile = { x: number; y: number; w: number; h: number; z: number; tone?: "solid" | "glass" | "accent" | "warn" | "ghost"; children?: ReactNode; float?: number };
type Feature = { key: string; title: string; lede: string; points: string[]; href: string; cta: string; tiles: Tile[]; links?: Array<[number, number, number, number]> };

const FEATURES: Feature[] = [
  {
    key: "leads",
    title: "Lead flow",
    lede: "Every list you buy comes in with its cost attached, cleaned and ready to dial.",
    points: ["Import a vendor’s CSV and map its columns once", "Lead cost recorded on every lead", "Duplicates set aside for a person to review", "Recycle leads on a cadence you choose", "Campaigns and vendors side by side"],
    href: "/signup", cta: "Import your first list",
    tiles: [
      { x: 40, y: 40, w: 200, h: 130, z: 70, tone: "accent", float: 0, children: <><FileSpreadsheet /><b>cobalt-media.csv</b><small>600 rows · $17.06 a lead</small></> },
      { x: 290, y: 60, w: 190, h: 52, z: 30, tone: "glass", float: 1, children: <><UserRound /><b>Ruth A.</b><em>Ready</em></> },
      { x: 290, y: 130, w: 190, h: 52, z: 30, tone: "glass", float: 2, children: <><UserRound /><b>James M.</b><em>Ready</em></> },
      { x: 290, y: 200, w: 190, h: 52, z: 30, tone: "warn", float: 3, children: <><UserRound /><b>Ruth A.</b><em>Duplicate</em></> },
      { x: 290, y: 270, w: 190, h: 52, z: 30, tone: "glass", float: 1, children: <><UserRound /><b>Carol T.</b><em>Ready</em></> },
      { x: 60, y: 260, w: 170, h: 170, z: 10, tone: "ghost", children: <><Upload /><small>Drop a list</small></> },
      { x: 300, y: 370, w: 170, h: 70, z: 50, tone: "solid", float: 2, children: <><b>584</b><small>ready to dial</small></> },
    ],
    links: [[240, 105, 290, 86], [240, 105, 290, 226]],
  },
  {
    key: "floor",
    title: "Floor & dialer",
    lede: "Live transfers are claimed exactly once, and every dial is screened before it’s placed.",
    points: ["Partner transfers land in one queue, with the wait shown", "The first claim wins — a lost race is said plainly", "Consent, DNC, suppression and calling window re-checked by the server", "A refused dial is logged with its reason", "Callbacks and appointments in the same place"],
    href: "/signup", cta: "Set up your floor",
    tiles: [
      { x: 40, y: 50, w: 220, h: 120, z: 80, tone: "accent", float: 0, children: <><PhoneIncoming /><b>Live transfer</b><small>Carol T. · Final expense · 0:14</small></> },
      { x: 60, y: 210, w: 160, h: 56, z: 40, tone: "solid", float: 2, children: <><PhoneCall /><b>Claim ↵</b></> },
      { x: 300, y: 40, w: 180, h: 54, z: 30, tone: "glass", float: 1, children: <><Check /><b>Consent on file</b></> },
      { x: 300, y: 110, w: 180, h: 54, z: 30, tone: "glass", float: 2, children: <><Check /><b>DNC lists</b></> },
      { x: 300, y: 180, w: 180, h: 54, z: 30, tone: "glass", float: 3, children: <><Check /><b>Suppression list</b></> },
      { x: 300, y: 250, w: 180, h: 54, z: 30, tone: "glass", float: 1, children: <><Check /><b>Calling window</b></> },
      { x: 290, y: 340, w: 200, h: 90, z: 60, tone: "solid", float: 0, children: <><ShieldCheck /><b>Clear to dial</b><small>4 of 4 passed</small></> },
    ],
    links: [[220, 238, 300, 67], [390, 304, 390, 340]],
  },
  {
    key: "apps",
    title: "Applications",
    lede: "The application is filled and submitted while the customer is still on the line.",
    points: ["Verify, interview, quote, beneficiaries and payment in one flow", "Imported values marked for confirmation", "Review groups hard blockers apart from soft checks", "A quote is never counted as issued", "Draft dates and pending cases tracked"],
    href: "/signup", cta: "See an application",
    tiles: [
      { x: 60, y: 60, w: 230, h: 300, z: 10, tone: "ghost", children: <><small>Verify</small></> },
      { x: 90, y: 50, w: 230, h: 300, z: 35, tone: "glass", children: <><small>Quote</small><b>$70.00 / mo</b></> },
      { x: 120, y: 40, w: 230, h: 300, z: 60, tone: "glass", children: <><small>Beneficiaries</small><b>2 named</b></> },
      { x: 150, y: 30, w: 230, h: 300, z: 85, tone: "accent", float: 0, children: <><ClipboardCheck /><b>Review & submit</b><small>0 blockers · 1 to confirm</small></> },
      { x: 360, y: 340, w: 140, h: 60, z: 70, tone: "solid", float: 2, children: <><Check /><b>Issued</b></> },
    ],
    links: [[380, 300, 420, 340]],
  },
  {
    key: "money",
    title: "Commissions & book",
    lede: "Every carrier statement line meets the policy you wrote, and what was owed sits beside what was paid.",
    points: ["Carrier files by upload or email", "Statement lines matched to policies — a person accepts", "Expected commission from your rate card", "A missing figure reads —, never $0.00", "True CPA by vendor and campaign"],
    href: "/signup", cta: "Match a statement",
    tiles: [
      { x: 40, y: 60, w: 190, h: 250, z: 40, tone: "glass", float: 1, children: <><FileText /><b>Statement</b><small>Line 14 · SAMPLE-0482</small><b>$84.00</b></> },
      { x: 300, y: 60, w: 190, h: 250, z: 40, tone: "glass", float: 2, children: <><ClipboardCheck /><b>Policy</b><small>SAMPLE-0482 · Ruth A.</small><b>Issued</b></> },
      { x: 220, y: 150, w: 90, h: 70, z: 80, tone: "accent", float: 0, children: <><Link2 /></> },
      { x: 150, y: 360, w: 230, h: 80, z: 60, tone: "solid", float: 3, children: <><BadgeDollarSign /><b>True CPA $46.10</b><small>Cobalt Media</small></> },
    ],
    links: [[230, 185, 300, 185], [265, 310, 265, 360]],
  },
  {
    key: "keep",
    title: "Retention & partners",
    lede: "Keep the policies you wrote, and give partners a view of their own leads — never anyone else’s.",
    points: ["Missed drafts and lapse notices go to a save queue", "Ranked by risk × money", "Servicing and reinstatement tracked", "Partners sign in to their own leads and stages", "No other partner’s leads, notes or lead cost"],
    href: "/signup", cta: "Start keeping more",
    tiles: [
      { x: 40, y: 40, w: 230, h: 60, z: 70, tone: "warn", float: 0, children: <><b>SAMPLE-0533</b><em>$1,240 at risk</em></> },
      { x: 40, y: 115, w: 230, h: 60, z: 45, tone: "glass", float: 1, children: <><b>SAMPLE-0391</b><em>$980</em></> },
      { x: 40, y: 190, w: 230, h: 60, z: 25, tone: "glass", float: 2, children: <><b>SAMPLE-0277</b><em>$610</em></> },
      { x: 310, y: 60, w: 180, h: 180, z: 50, tone: "accent", float: 3, children: <><Users /><b>Partner view</b><small>Summit Data · 3 leads</small></> },
      { x: 320, y: 300, w: 160, h: 110, z: 80, tone: "solid", float: 0, children: <><Lock /><b>Only their own</b></> },
      { x: 60, y: 300, w: 190, h: 130, z: 10, tone: "ghost", children: <><small>Save queue</small></> },
    ],
    links: [[400, 240, 400, 300]],
  },
];

function Scene({ feature, active }: { feature: Feature; active: boolean }) {
  const planeRef = useRef<HTMLDivElement>(null);
  const tilt = (event: React.PointerEvent<HTMLDivElement>) => {
    if (event.pointerType !== "mouse" || !planeRef.current) return;
    const r = event.currentTarget.getBoundingClientRect();
    planeRef.current.style.setProperty("--px", `${((event.clientX - r.left) / r.width - 0.5) * 8}deg`);
    planeRef.current.style.setProperty("--py", `${((event.clientY - r.top) / r.height - 0.5) * -6}deg`);
  };
  const untilt = () => { planeRef.current?.style.setProperty("--px", "0deg"); planeRef.current?.style.setProperty("--py", "0deg"); };
  return (
    <div className={styles.scene} onPointerMove={tilt} onPointerLeave={untilt} aria-hidden="true">
      <div className={styles.grid} />
      <div ref={planeRef} className={styles.plane} data-active={active}>
        <svg className={styles.links} viewBox="0 0 520 480">
          {feature.links?.map(([x1, y1, x2, y2], i) => <line key={i} x1={x1} y1={y1} x2={x2} y2={y2} />)}
        </svg>
        {feature.tiles.map((tile, i) => (
          <div
            key={i}
            className={styles.tile}
            data-tone={tile.tone ?? "glass"}
            data-float={tile.float ?? "none"}
            style={{ left: tile.x, top: tile.y, width: tile.w, height: tile.h, "--z": `${tile.z}px`, "--d": `${i * 70}ms` } as CSSProperties}
          >
            <span className={styles.face}>{tile.children}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

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
          <p className={styles.lede}>One workspace, from the vendor’s list to the carrier’s statement — and the policy after it is issued.</p>
        </header>

        <div className={styles.stack}>
          {FEATURES.map((feature, i) => (
            <article
              key={feature.key}
              ref={(node) => { cardRefs.current[i] = node; }}
              className={styles.card}
              style={{ "--i": i, "--top": `${96 + i * 14}px` } as CSSProperties}
              aria-labelledby={`feature-${feature.key}`}
            >
              <div className={styles.copy}>
                <ol className={styles.rail} aria-hidden="true">
                  {FEATURES.map((f, j) => <li key={f.key} data-on={j === i} />)}
                </ol>
                <span className={styles.count}>{String(i + 1).padStart(2, "0")} / {String(FEATURES.length).padStart(2, "0")}</span>
                <h3 id={`feature-${feature.key}`}>{feature.title}</h3>
                <p>{feature.lede}</p>
                <ul>{feature.points.map((point) => <li key={point}>{point}</li>)}</ul>
                <a href={feature.href} className={styles.cta}>{feature.cta}<ArrowRight aria-hidden="true" /></a>
              </div>
              <Scene feature={feature} active={active === i} />
            </article>
          ))}
        </div>
      </div>
    </section>
  );
}
