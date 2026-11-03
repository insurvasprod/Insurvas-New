"use client";

import { useEffect, useRef, useState } from "react";
import type { CSSProperties } from "react";
import { animate } from "animejs";
import {
  BadgeDollarSign, CalendarCheck, ClipboardList, FileCheck2, FileText, Inbox, LayoutDashboard, LifeBuoy, Package,
  PhoneCall, Search, ShieldCheck, SquareKanban,
} from "lucide-react";

import styles from "@/components/marketing/landing-device.module.css";
import { money, VENDORS } from "@/components/marketing/landing-sample-data";

/**
 * The hero's product preview (2026-11-03, after the manager's reference): the Insurvas agency
 * dashboard inside a device frame, under the headline. It is built in HTML from the real app's
 * navigation (lib/menu/definition.ts) and the landing page's shared sample figures, so it stays sharp
 * at any size and the numbers agree with the True CPA report further down.
 *
 * It lives a little: the totals count up and the chart draws itself when it comes into view, the
 * activity feed takes a new event every few seconds and a live transfer arrives and is claimed. As the
 * page scrolls the device tilts up from a slight recline to face the reader. Everything pauses off
 * screen; with reduced motion it is a still, complete picture. Sample data, labelled so.
 */

// The design is drawn at one screen size and scaled to fit, like a real screenshot would be.
const SCREEN_W = 1280;
const SCREEN_H = 780;

const SPEND = VENDORS.reduce((sum, v) => sum + v.spend, 0);
const ISSUED = VENDORS.reduce((sum, v) => sum + v.funnel[v.funnel.length - 1], 0);
const CPA = SPEND / ISSUED;
const AVG_COMMISSION = 132.4; // sample first-year commission per issued policy
const EARNED = ISSUED * AVG_COMMISSION;

/** Thirty sample days: spend runs steady, commission builds as policies issue. Sums match the totals. */
function series() {
  let seed = 11;
  const rand = () => { seed = (seed * 16807) % 2147483647; return (seed - 1) / 2147483646; };
  const spend = Array.from({ length: 30 }, () => 0.94 + rand() * 0.12);
  const earned = Array.from({ length: 30 }, (_, d) => (0.35 + Math.pow(d / 29, 1.4) * 1.2) * (0.9 + rand() * 0.2));
  const scale = (values: number[], total: number) => { const sum = values.reduce((a, b) => a + b, 0); return values.map((v) => (v / sum) * total); };
  return { spend: scale(spend, SPEND), earned: scale(earned, EARNED) };
}
const DAYS = series();

function areaPath(values: number[], max: number, w: number, h: number, close: boolean) {
  const step = w / (values.length - 1);
  const pts = values.map((v, i) => [i * step, h - (v / max) * h * 0.92]);
  // A gentle curve through the points.
  let d = `M${pts[0][0]},${pts[0][1]}`;
  for (let i = 1; i < pts.length; i += 1) {
    const [x0, y0] = pts[i - 1], [x1, y1] = pts[i];
    const cx = (x0 + x1) / 2;
    d += ` C${cx},${y0} ${cx},${y1} ${x1},${y1}`;
  }
  return close ? `${d} L${w},${h} L0,${h} Z` : d;
}

const NAV = [
  { group: "Home", items: [{ icon: LayoutDashboard, label: "Dashboard", active: true }] },
  { group: "Today", items: [{ icon: Inbox, label: "Inbound", badge: "2" }, { icon: PhoneCall, label: "Dialer" }, { icon: CalendarCheck, label: "Callbacks" }] },
  { group: "Leads", items: [{ icon: SquareKanban, label: "Lead workspace" }, { icon: Package, label: "Lead flow" }] },
  { group: "Sales", items: [{ icon: FileCheck2, label: "Applications" }, { icon: ClipboardList, label: "Daily deal flow" }] },
  { group: "Book", items: [{ icon: LifeBuoy, label: "Save queue" }, { icon: FileText, label: "Statements" }] },
  { group: "Reports", items: [{ icon: BadgeDollarSign, label: "True CPA" }] },
];

/** How many events the feed shows at once; also where the id counter starts. */
const FEED_SIZE = 4;

const EVENTS = [
  { kind: "issued", title: "Policy issued", detail: "Ruth A. · Final expense · Cobalt Media", amount: "+$84.00" },
  { kind: "matched", title: "Statement matched", detail: "Sample Carrier Life · line 14", amount: "$126.40" },
  { kind: "claimed", title: "Transfer claimed", detail: "Dana K. took James M. · 0:12 wait", amount: "" },
  { kind: "checks", title: "Dial cleared", detail: "4 of 4 checks passed · Carol T.", amount: "" },
  { kind: "submitted", title: "Application submitted", detail: "Omar S. · Term life · Summit Data", amount: "" },
  { kind: "issued", title: "Policy issued", detail: "Nina R. · Final expense · Bayview Data", amount: "+$212.75" },
  { kind: "matched", title: "Statement matched", detail: "Sample Mutual · line 3", amount: "$96.10" },
  { kind: "issued", title: "Policy issued", detail: "Dale P. · Term life · Summit Data", amount: "+$158.30" },
];

export function LandingDevice() {
  const deviceRef = useRef<HTMLDivElement>(null);
  const viewportRef = useRef<HTMLDivElement>(null);
  const kpiRefs = useRef<Array<HTMLElement | null>>([]);
  const [scale, setScale] = useState(0.86);
  const [live, setLive] = useState(false);
  const [feed, setFeed] = useState(() => EVENTS.slice(0, FEED_SIZE).map((event, i) => ({ ...event, id: i })));
  /**
   * The next feed id, in a ref rather than inside the effect below. `live` flips every time the
   * hero leaves and re-enters the viewport, so a counter scoped to the effect restarted at
   * FEED_SIZE on every scroll back and handed React a key it was still showing — "two children with
   * the same key, 4" (2026-11-03). A ref outlives the re-run, so ids only ever climb.
   */
  const nextEventId = useRef(FEED_SIZE);
  const [toast, setToast] = useState<"hidden" | "waiting" | "claimed">("hidden");

  // Fit the fixed-size screen into the frame.
  useEffect(() => {
    const viewport = viewportRef.current;
    if (!viewport) return;
    const fit = () => setScale(viewport.clientWidth / SCREEN_W);
    const observer = new ResizeObserver(fit);
    observer.observe(viewport);
    return () => observer.disconnect();
  }, []);

  // Live only while on screen.
  useEffect(() => {
    const device = deviceRef.current;
    if (!device) return;
    const io = new IntersectionObserver(([entry]) => setLive(Boolean(entry?.isIntersecting)), { threshold: 0.15 });
    io.observe(device);
    return () => io.disconnect();
  }, []);

  // The totals count up once, the first time the dashboard is seen.
  const counted = useRef(false);
  useEffect(() => {
    if (!live || counted.current) return;
    counted.current = true;
    const targets = [
      { to: SPEND, format: (n: number) => money(n) },
      { to: ISSUED, format: (n: number) => Math.round(n).toLocaleString("en-US") },
      { to: CPA, format: (n: number) => money(n) },
      { to: EARNED, format: (n: number) => money(n) },
    ];
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
      targets.forEach((t, i) => { const el = kpiRefs.current[i]; if (el) el.textContent = t.format(t.to); });
      return;
    }
    targets.forEach((t, i) => {
      const value = { n: 0 };
      animate(value, { n: t.to, duration: 1600, delay: 300 + i * 90, ease: "outCubic", onUpdate: () => { const el = kpiRefs.current[i]; if (el) el.textContent = t.format(value.n); } });
    });
  }, [live]);

  // A new event every few seconds, and a live transfer that arrives and is claimed.
  useEffect(() => {
    if (!live || window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    const feedTimer = window.setInterval(() => {
      const id = nextEventId.current;
      nextEventId.current += 1;
      setFeed((now) => [{ ...EVENTS[id % EVENTS.length], id }, ...now].slice(0, FEED_SIZE));
    }, 3600);
    const timers: number[] = [];
    const cycle = () => {
      timers.push(window.setTimeout(() => setToast("waiting"), 1800));
      timers.push(window.setTimeout(() => setToast("claimed"), 4600));
      timers.push(window.setTimeout(() => setToast("hidden"), 6600));
    };
    cycle();
    const toastTimer = window.setInterval(cycle, 9000);
    return () => { window.clearInterval(feedTimer); window.clearInterval(toastTimer); timers.forEach((t) => window.clearTimeout(t)); };
  }, [live]);

  // As the page scrolls, the device lifts from a slight recline to face the reader.
  useEffect(() => {
    const device = deviceRef.current;
    if (!device || window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    let frame = 0;
    const update = () => {
      frame = 0;
      const rect = device.getBoundingClientRect();
      const progress = Math.min(1, Math.max(0, (window.innerHeight - rect.top) / (window.innerHeight * 0.9)));
      const eased = 1 - Math.pow(1 - progress, 2);
      device.style.setProperty("--tilt", `${(1 - eased) * 16}deg`);
      device.style.setProperty("--lift", `${(1 - eased) * 30}px`);
      device.style.setProperty("--zoom", `${0.94 + eased * 0.06}`);
    };
    const schedule = () => { if (!frame) frame = window.requestAnimationFrame(update); };
    update();
    window.addEventListener("scroll", schedule, { passive: true });
    window.addEventListener("resize", schedule);
    return () => { window.removeEventListener("scroll", schedule); window.removeEventListener("resize", schedule); window.cancelAnimationFrame(frame); };
  }, []);

  const maxDay = Math.max(...DAYS.earned, ...DAYS.spend);
  const vendorRows = VENDORS.map((v) => ({ ...v, issued: v.funnel[v.funnel.length - 1] }));
  const maxCpa = Math.max(...vendorRows.map((v) => (v.issued ? v.spend / v.issued : 0)));

  return (
    <div className={styles.stage}>
      <div className={styles.halo} aria-hidden="true" />
      <div className={styles.frameOutline} aria-hidden="true" />
      <div ref={deviceRef} className={styles.device} data-live={live}>
        <div className={styles.bezel}>
          <span className={styles.camera} aria-hidden="true" />
          <div ref={viewportRef} className={styles.viewport} style={{ height: SCREEN_H * scale }} role="img" aria-label="Sample Insurvas agency dashboard: lead spend, issued policies, True CPA and commission received, with live activity">
            <div className={styles.screen} style={{ width: SCREEN_W, height: SCREEN_H, transform: `scale(${scale})` } as CSSProperties} aria-hidden="true">
              {/* ── Sidebar ── */}
              <aside className={styles.rail}>
                <div className={styles.brand}>
                  <svg width="22" height="22" viewBox="0 0 16 16"><path d="M2 8.5 6 13 14 3" fill="none" stroke="var(--primary)" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round" /></svg>
                  <b>insurvas</b>
                </div>
                <div className={styles.org}><span>Workspace</span><b>Sample Agency</b></div>
                {NAV.map((group) => (
                  <div key={group.group} className={styles.navGroup}>
                    <small>{group.group}</small>
                    {group.items.map(({ icon: Icon, label, ...rest }) => (
                      <span key={label} className={styles.navItem} data-active={"active" in rest && rest.active}>
                        <Icon />{label}{"badge" in rest && <em>{rest.badge}</em>}
                      </span>
                    ))}
                  </div>
                ))}
              </aside>

              {/* ── Main ── */}
              {/* A <div>, not a <main>: this mock sits inside the page's real <main>, and a second
                  main landmark is an accessibility defect. The class does the layout. */}
              <div className={styles.main}>
                <header className={styles.top}>
                  <span className={styles.crumb}>Home <i>/</i> <b>Agency dashboard</b></span>
                  <span className={styles.search}><Search />Search leads, policies, statements<kbd>⌘K</kbd></span>
                  <span className={styles.status}><i />Taking calls</span>
                  <span className={styles.avatar}>DK</span>
                </header>

                <div className={styles.titleRow}>
                  <div><h3>Good morning, Dana</h3><p>Sample Agency · last 30 days · sample data</p></div>
                  <div className={styles.segment}><span>Today</span><span>7 days</span><span data-on="true">30 days</span></div>
                </div>

                <div className={styles.kpis}>
                  {[
                    { label: "Lead spend", hint: "4 vendors" },
                    { label: "Issued policies", hint: `${Math.round((ISSUED / VENDORS.reduce((s, v) => s + v.funnel[0], 0)) * 100)}% of leads bought` },
                    { label: "True CPA", hint: "per issued policy" },
                    { label: "Commission received", hint: "matched to policies", accent: true },
                  ].map((kpi, i) => (
                    <div key={kpi.label} className={styles.kpi} data-accent={kpi.accent ?? false}>
                      <span>{kpi.label}</span>
                      <b ref={(node) => { kpiRefs.current[i] = node; }}>{i === 1 ? "0" : money(0)}</b>
                      <small>{kpi.hint}</small>
                    </div>
                  ))}
                </div>

                <div className={styles.grid}>
                  <section className={styles.card}>
                    <div className={styles.cardHead}>
                      <b>Commission received vs lead spend</b>
                      <span className={styles.legend}><i data-k="earned" />Commission <i data-k="spend" />Lead spend</span>
                    </div>
                    <svg className={styles.chart} viewBox="0 0 600 200" preserveAspectRatio="none">
                      <defs>
                        <linearGradient id="device-earned" x1="0" x2="0" y1="0" y2="1">
                          <stop offset="0" stopColor="var(--primary)" stopOpacity=".35" />
                          <stop offset="1" stopColor="var(--primary)" stopOpacity="0" />
                        </linearGradient>
                      </defs>
                      {[0.25, 0.5, 0.75].map((y) => <line key={y} x1="0" x2="600" y1={200 * y} y2={200 * y} className={styles.gridLine} />)}
                      <path d={areaPath(DAYS.earned, maxDay, 600, 200, true)} fill="url(#device-earned)" className={styles.area} />
                      <path d={areaPath(DAYS.earned, maxDay, 600, 200, false)} pathLength={1} className={styles.lineEarned} />
                      <path d={areaPath(DAYS.spend, maxDay, 600, 200, false)} pathLength={1} className={styles.lineSpend} />
                    </svg>
                    <div className={styles.axis}><span>Oct 4</span><span>Oct 11</span><span>Oct 18</span><span>Oct 25</span><span>Today</span></div>
                  </section>

                  <section className={styles.card}>
                    <div className={styles.cardHead}><b>Live activity</b><span className={styles.pulseDot}><i />Live</span></div>
                    <ul className={styles.feed}>
                      {feed.map((event) => (
                        <li key={event.id} data-kind={event.kind}>
                          <span className={styles.feedIcon}>{event.kind === "issued" ? <FileCheck2 /> : event.kind === "matched" ? <FileText /> : event.kind === "claimed" ? <PhoneCall /> : event.kind === "checks" ? <ShieldCheck /> : <ClipboardList />}</span>
                          <span className={styles.feedText}><b>{event.title}</b><small>{event.detail}</small></span>
                          {event.amount && <em>{event.amount}</em>}
                        </li>
                      ))}
                    </ul>
                  </section>
                </div>

                <section className={`${styles.card} ${styles.vendors}`}>
                  <div className={styles.cardHead}><b>True CPA by vendor</b><span>Cost per issued policy</span></div>
                  {vendorRows.map((v) => {
                    const cpa = v.issued ? v.spend / v.issued : null;
                    return (
                      <div key={v.name} className={styles.vendorRow}>
                        <span><b>{v.name}</b><small>{v.campaign}</small></span>
                        <span>{money(v.spend)}</span>
                        <span>{v.issued}</span>
                        <span className={styles.bar}><i style={{ "--w": cpa ? cpa / maxCpa : 0 } as CSSProperties} /></span>
                        <b>{cpa ? money(cpa) : "—"}</b>
                      </div>
                    );
                  })}
                </section>
              </div>

              {/* A live transfer arrives and is claimed. */}
              <div className={styles.toast} data-state={toast}>
                <span className={styles.toastIcon}><PhoneCall /></span>
                <span className={styles.toastText}>
                  <b>{toast === "claimed" ? "Claimed by Dana K." : "Live transfer waiting"}</b>
                  <small>Carol T. · Final expense · Summit Data · 0:14</small>
                </span>
                <span className={styles.toastAction}>{toast === "claimed" ? "Opening call…" : <>Claim <kbd>↵</kbd></>}</span>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
