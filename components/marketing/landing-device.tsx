"use client";

import { useEffect, useRef, useState } from "react";
import type { CSSProperties } from "react";
import { animate } from "animejs";
import {
  BadgeDollarSign, Bell, CalendarCheck, ChevronDown, ClipboardList, FileCheck2, FileText, Inbox, LayoutDashboard, LifeBuoy, Package,
  PhoneCall, Search, ShieldCheck, SquareKanban, Sun, TriangleAlert,
} from "lucide-react";

import { InsurvasLogo } from "@/components/shared/insurvas-logo";
import styles from "@/components/marketing/landing-device.module.css";
import { DEVICE_PAGES, DevicePage, type DevicePageKey } from "@/components/marketing/landing-device-pages";
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
 *
 * Owner, 6 Nov (Umar's A1.4): it shows more than the dashboard. Every 5 seconds it moves on to the
 * next page (Inbound, Dialer, Callbacks, Applications, then back), and those sidebar items are real
 * buttons: choosing one opens that page and holds the cycle for a while. The active item fills a thin
 * bar while it waits, so the change never comes as a surprise. No cycling under reduced motion.
 */
const PAGE_MS = 5_000;
/** How long a page chosen by hand stays before the cycle carries on. */
const HOLD_MS = 20_000;
const PAGE_OF: Record<string, DevicePageKey> = { Dashboard: "dashboard", Inbound: "inbound", Dialer: "dialer", Callbacks: "callbacks", "Lead workspace": "leads", "Lead flow": "leadFlow", Applications: "applications", "Daily deal flow": "dealFlow" };

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
  // Rounded so the server and the browser print the same path and hydration agrees.
  const r = (n: number) => Math.round(n * 100) / 100;
  const pts = values.map((v, i) => [r(i * step), r(h - (v / max) * h * 0.92)]);
  // A gentle curve through the points.
  let d = `M${pts[0][0]},${pts[0][1]}`;
  for (let i = 1; i < pts.length; i += 1) {
    const [x0, y0] = pts[i - 1], [x1, y1] = pts[i];
    const cx = r((x0 + x1) / 2);
    d += ` C${cx},${y0} ${cx},${y1} ${x1},${y1}`;
  }
  return close ? `${d} L${w},${h} L0,${h} Z` : d;
}

const NAV = [
  { group: "Home", items: [{ icon: LayoutDashboard, label: "Dashboard" }] },
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
  const [page, setPage] = useState<DevicePageKey>("dashboard");
  /** True after the first page change, which always comes after the dashboard's count-up. */
  const [moved, setMoved] = useState(false);
  /** Ticks to skip after a page is chosen by hand: HOLD_MS in PAGE_MS steps. */
  const holdTicks = useRef(0);
  const current = DEVICE_PAGES.find((entry) => entry.key === page) ?? DEVICE_PAGES[0];

  const choose = (key: DevicePageKey) => { holdTicks.current = Math.round(HOLD_MS / PAGE_MS); setMoved(true); setPage(key); };

  // A new page every 10 seconds while the device is on screen, unless one was just chosen by hand.
  useEffect(() => {
    if (!live || window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    const timer = window.setInterval(() => {
      if (holdTicks.current > 0) { holdTicks.current -= 1; return; }
      if (document.hidden) return;
      setMoved(true);
      setPage((now) => DEVICE_PAGES[(DEVICE_PAGES.findIndex((entry) => entry.key === now) + 1) % DEVICE_PAGES.length].key);
    }, PAGE_MS);
    return () => window.clearInterval(timer);
  }, [live]);

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
          <div ref={viewportRef} className={styles.viewport} style={{ height: SCREEN_H * scale }} role="group" aria-label="A sample Insurvas workspace. Choose a page in its sidebar to look inside.">
            <div className={styles.screen} style={{ width: SCREEN_W, height: SCREEN_H, transform: `scale(${scale})` } as CSSProperties}>
              {/* ── Sidebar ── */}
              <nav className={styles.rail} aria-label="Sample workspace pages">
                {/* The real logo, as the app's own sidebar shows it (owner, 6 Nov). */}
                <div className={styles.brand} aria-hidden="true">
                  <InsurvasLogo size="sidebar" tone="dark" />
                </div>
                <div className={styles.org} aria-hidden="true"><span>Workspace</span><b>Sample Agency</b></div>
                {NAV.map((group) => (
                  <div key={group.group} className={styles.navGroup}>
                    <small aria-hidden="true">{group.group}</small>
                    {group.items.map(({ icon: Icon, label, ...rest }) => {
                      const target = PAGE_OF[label];
                      const inner = <><Icon aria-hidden="true" />{label}{"badge" in rest && <em aria-hidden="true">{rest.badge}</em>}</>;
                      if (!target) return <span key={label} className={styles.navItem} aria-hidden="true">{inner}</span>;
                      const on = target === page;
                      return (
                        <button key={label} type="button" className={styles.navItem} data-active={on} aria-pressed={on} onClick={() => choose(target)}>
                          {inner}
                          {/* Fills while the page waits for the next one; restarts with each page. */}
                          {on && <span key={page} className={styles.navTimer} aria-hidden="true" />}
                        </button>
                      );
                    })}
                  </div>
                ))}
              </nav>

              {/* ── Main ── */}
              {/* A <div>, not a <main>: this mock sits inside the page's real <main>, and a second
                  main landmark is an accessibility defect. The class does the layout. */}
              <div className={styles.main} aria-hidden="true">
                {/* The app's own top bar (components/app/app-top-bar.tsx): the search on the left; the
                    theme switch, the bell, alerts and the account on the right. No title in it. */}
                <header className={styles.top}>
                  <span className={styles.search}><Search />Search leads, policies, statements<span className={styles.keys}><kbd>⌘</kbd><kbd>K</kbd></span></span>
                  <span className={styles.topActions}>
                    <span className={styles.topIcon}><Sun /></span>
                    <span className={styles.topIcon}><Bell /><em>3</em></span>
                    <span className={`${styles.topIcon} ${styles.topAlert}`}><TriangleAlert /></span>
                    <span className={styles.topDivider} />
                    <span className={styles.account}><span className={styles.avatar}>DK</span>Dana<ChevronDown /></span>
                  </span>
                </header>

                <div className={styles.titleRow}>
                  {/* The trail over the title, as every app page has it (UI-CONSISTENCY §2). */}
                  <div><span className={styles.crumb}>{current.section} <i>›</i> <b>{current.crumb}</b></span><h3>{current.title}</h3><p>{current.sub}</p></div>
                  <div className={styles.segment}><span>Today</span><span>7 days</span><span data-on="true">30 days</span></div>
                </div>

                {/* Each page eases in when it opens. */}
                <div key={page} className={styles.page}>
                {page !== "dashboard" ? <DevicePage page={page} /> : <>

                <div className={styles.kpis}>
                  {[
                    { label: "Lead spend", hint: "4 vendors" },
                    { label: "Issued policies", hint: `${Math.round((ISSUED / VENDORS.reduce((s, v) => s + v.funnel[0], 0)) * 100)}% of leads bought` },
                    { label: "True CPA", hint: "per issued policy" },
                    { label: "Commission received", hint: "matched to policies", accent: true },
                  ].map((kpi, i) => (
                    <div key={kpi.label} className={styles.kpi} data-accent={kpi.accent ?? false}>
                      <span>{kpi.label}</span>
                      {/* Zero until the first count-up; after it, the real figure when the dashboard comes back. */}
                      <b ref={(node) => { kpiRefs.current[i] = node; }}>{moved ? [money(SPEND), ISSUED.toLocaleString("en-US"), money(CPA), money(EARNED)][i] : i === 1 ? "0" : money(0)}</b>
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
                </>}
                </div>
              </div>

              {/* A live transfer arrives and is claimed. */}
              <div className={styles.toast} data-state={toast} aria-hidden="true">
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
      {/* Phones and tablets: the scaled sidebar is too small to tap, so the same pages as tabs. */}
      <div className={styles.pageTabs} role="group" aria-label="Sample workspace pages">
        {DEVICE_PAGES.map((entry) => (
          <button key={entry.key} type="button" aria-pressed={entry.key === page} onClick={() => choose(entry.key)}>
            {entry.crumb === "Agency dashboard" ? "Dashboard" : entry.crumb}
          </button>
        ))}
      </div>
    </div>
  );
}
