"use client";

import { useEffect, useRef, useState } from "react";
import type { CSSProperties, ReactNode } from "react";
import {
  Bell, BookOpen, Building2, CalendarCheck, CalendarDays, ChartColumn, ChevronDown, ChevronRight, ClipboardList, ContactRound, FileCheck,
  FilePenLine, Handshake, Inbox, Landmark, LayoutDashboard, LifeBuoy, Package, PanelLeftClose, PhoneCall, Receipt, RefreshCw, Search, Settings,
  ShieldCheck, SquareKanban, Sun, TriangleAlert,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";

import { InsurvasLogo } from "@/components/shared/insurvas-logo";
import styles from "@/components/marketing/landing-device.module.css";
import { DEVICE_PAGES, DevicePage, type DevicePageKey } from "@/components/marketing/landing-device-pages";
import { DeviceOverview, DeviceOverviewHeader } from "@/components/marketing/landing-device-overview";

/**
 * The hero's product preview (2026-11-03, after the manager's reference): the Insurvas workspace
 * inside a device frame, under the headline, in HTML so it stays sharp at any size.
 *
 * Owner, 7 Nov: it shows the app as it is now, with good figures. The dashboard is the app's own
 * Overview, drawn with the app's own cards (landing-device-overview.tsx); the sidebar is the app's,
 * the sections in its order (lib/menu/definition.ts) with Today open; the top bar is the app's dark one.
 *
 * Owner, 6 Nov (Umar's A1.4): it shows more than the dashboard. Every 5 seconds it moves on to the
 * next page (Inbound, Dialer, Callbacks, the lead pages, Applications, Daily deal flow, then back),
 * and those sidebar items are real buttons: choosing one opens that page and holds the cycle for a
 * while. The active item fills a thin bar while it waits, so the change never comes as a surprise.
 * A live transfer arrives and is claimed now and then. As the page scrolls the device tilts up from
 * a slight recline to face the reader. Everything pauses off screen; with reduced motion it is a
 * still, complete picture. Sample data, labelled so.
 */
const PAGE_MS = 5_000;
/** How long a page chosen by hand stays before the cycle carries on. */
const HOLD_MS = 20_000;

// The design is drawn at one screen size and scaled to fit, like a real screenshot would be.
const SCREEN_W = 1280;
const SCREEN_H = 780;

type NavPage = { icon: LucideIcon; label: string; page?: DevicePageKey; badge?: string };
type NavEntry = NavPage & { children?: readonly NavPage[]; more?: boolean };

/** The app's sidebar, opened: its sections in order, Today's pages under it (components/app/agent-sidebar.tsx). */
const NAV: readonly NavEntry[] = [
  { icon: LayoutDashboard, label: "Home", page: "dashboard" },
  { icon: Building2, label: "Agency", page: "agency" },
  { icon: CalendarCheck, label: "Today", children: [
    { icon: Inbox, label: "Inbound", page: "inbound", badge: "2" },
    { icon: PhoneCall, label: "Dialer", page: "dialer" },
    { icon: CalendarCheck, label: "Callbacks", page: "callbacks" },
    { icon: CalendarDays, label: "Calendar", page: "calendar" },
  ] },
  { icon: ContactRound, label: "Leads", children: [
    { icon: SquareKanban, label: "Lead workspace", page: "leads" },
    { icon: Package, label: "Lead flow", page: "leadFlow" },
  ] },
  { icon: FileCheck, label: "Sales", children: [
    { icon: FilePenLine, label: "Applications", page: "applications" },
    { icon: ClipboardList, label: "Daily deal flow", page: "dealFlow" },
  ] },
  { icon: BookOpen, label: "Book of Business", page: "book" },
  { icon: RefreshCw, label: "Carrier Sync", page: "sync" },
  { icon: LifeBuoy, label: "Retention", page: "retention" },
  { icon: Receipt, label: "Commissions", page: "commissions" },
  { icon: Landmark, label: "Accounting", page: "accounting" },
  { icon: Handshake, label: "Partners", page: "partners", more: true },
  { icon: ShieldCheck, label: "Compliance", page: "compliance" },
  { icon: ChartColumn, label: "Reports", page: "reports" },
  { icon: Settings, label: "Settings", page: "settings" },
];

export function LandingDevice() {
  const deviceRef = useRef<HTMLDivElement>(null);
  const viewportRef = useRef<HTMLDivElement>(null);
  const [scale, setScale] = useState(0.86);
  const [live, setLive] = useState(false);
  const [toast, setToast] = useState<"hidden" | "waiting" | "claimed">("hidden");
  const [page, setPage] = useState<DevicePageKey>("dashboard");
  /** Ticks to skip after a page is chosen by hand: HOLD_MS in PAGE_MS steps. */
  const holdTicks = useRef(0);
  const current = DEVICE_PAGES.find((entry) => entry.key === page) ?? DEVICE_PAGES[0];

  const choose = (key: DevicePageKey) => { holdTicks.current = Math.round(HOLD_MS / PAGE_MS); setPage(key); };

  // A new page every few seconds while the device is on screen, unless one was just chosen by hand.
  useEffect(() => {
    if (!live || window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    const timer = window.setInterval(() => {
      if (holdTicks.current > 0) { holdTicks.current -= 1; return; }
      if (document.hidden) return;
      setPage((now) => DEVICE_PAGES[(DEVICE_PAGES.findIndex((entry) => entry.key === now) + 1) % DEVICE_PAGES.length].key);
    }, PAGE_MS);
    return () => window.clearInterval(timer);
  }, [live]);

  // Phones and tablets: keep the current page's tab in view in its strip (the strip scrolls, never the page).
  const tabsRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const strip = tabsRef.current;
    const tab = strip?.querySelector<HTMLElement>('[aria-pressed="true"]');
    if (!strip || !tab || strip.scrollWidth <= strip.clientWidth) return;
    strip.scrollTo({ left: tab.offsetLeft - (strip.clientWidth - tab.offsetWidth) / 2, behavior: "smooth" });
  }, [page]);

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

  // Now and then a live transfer arrives and is claimed.
  useEffect(() => {
    if (!live || window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    const timers: number[] = [];
    const cycle = () => {
      timers.push(window.setTimeout(() => setToast("waiting"), 1800));
      timers.push(window.setTimeout(() => setToast("claimed"), 4600));
      timers.push(window.setTimeout(() => setToast("hidden"), 6600));
    };
    cycle();
    const toastTimer = window.setInterval(cycle, 9000);
    return () => { window.clearInterval(toastTimer); timers.forEach((t) => window.clearTimeout(t)); };
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

  /** A sidebar row: a button when it opens a sample page, otherwise a picture of the row. */
  const row = ({ icon: Icon, label, page: target, badge }: NavPage, extra?: ReactNode, sub = false) => {
    const className = sub ? `${styles.navItem} ${styles.navSub}` : styles.navItem;
    const inner = <><Icon aria-hidden="true" />{label}{badge && <em aria-hidden="true">{badge}</em>}{extra}</>;
    if (!target) return <span key={label} className={className} aria-hidden="true">{inner}</span>;
    const on = target === page;
    return (
      <button key={label} type="button" className={className} data-active={on} aria-pressed={on} onClick={() => choose(target)}>
        {inner}
        {/* Fills while the page waits for the next one; restarts with each page. */}
        {on && <span key={page} className={styles.navTimer} aria-hidden="true" />}
      </button>
    );
  };

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
                {/* The real logo and the collapse button, as the app's own sidebar shows them. */}
                <div className={styles.brand} aria-hidden="true">
                  <InsurvasLogo size="sidebar" tone="dark" />
                  <PanelLeftClose />
                </div>
                <div className={styles.navList}>
                  {NAV.map((entry) => {
                    if (!entry.children) return row(entry, entry.more ? <ChevronRight className={styles.navChevron} aria-hidden="true" /> : undefined);
                    // Today stays open, as the app opens it; Leads and Sales open while one of their pages shows.
                    const open = entry.label === "Today" || entry.children.some((child) => child.page === page);
                    const first = entry.children.find((child) => child.page)?.page;
                    const chevron = open ? <ChevronDown className={styles.navChevron} aria-hidden="true" /> : <ChevronRight className={styles.navChevron} aria-hidden="true" />;
                    return (
                      <div key={entry.label} className={styles.navSection}>
                        {open || !first
                          ? <span className={styles.navItem} aria-hidden="true"><entry.icon aria-hidden="true" />{entry.label}{chevron}</span>
                          : <button type="button" className={styles.navItem} aria-pressed={false} onClick={() => choose(first)}><entry.icon aria-hidden="true" />{entry.label}{chevron}</button>}
                        {open && entry.children.map((child) => row(child, undefined, true))}
                      </div>
                    );
                  })}
                </div>
              </nav>

              {/* ── Main ── */}
              {/* A <div>, not a <main>: this mock sits inside the page's real <main>, and a second
                  main landmark is an accessibility defect. The class does the layout. */}
              <div className={styles.main} aria-hidden="true">
                {/* The app's own top bar (components/app/app-top-bar.tsx), dark as the sidebar: the search on
                    the left; the theme switch, the bell, alerts and the account on the right. */}
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

                {page === "dashboard" ? <DeviceOverviewHeader /> : (
                  <div className={styles.titleRow}>
                    {/* The trail over the title, as every app page has it (UI-CONSISTENCY §2). */}
                    <div><span className={styles.crumb}>{current.section} <i>›</i> <b>{current.crumb}</b></span><h3>{current.title}</h3><p>{current.sub}</p></div>
                    <div className={styles.segment}><span>Today</span><span>7 days</span><span data-on="true">30 days</span></div>
                  </div>
                )}

                {/* Each page eases in when it opens. */}
                <div key={page} className={styles.page}>
                  {page === "dashboard" ? <DeviceOverview /> : <DevicePage page={page} />}
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
      <div ref={tabsRef} className={styles.pageTabs} role="group" aria-label="Sample workspace pages">
        {DEVICE_PAGES.map((entry) => (
          <button key={entry.key} type="button" aria-pressed={entry.key === page} onClick={() => choose(entry.key)}>
            {entry.crumb}
          </button>
        ))}
      </div>
    </div>
  );
}
