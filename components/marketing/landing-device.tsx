"use client";

import { useEffect, useRef, useState } from "react";
import type { CSSProperties, ReactNode } from "react";
import {
  ArrowLeft, ArrowRight, Bell, BookOpen, Building2, CalendarCheck, CalendarDays, ChartColumn, ChevronDown, ChevronRight, ClipboardList, ContactRound, FileCheck,
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
/** How long the cycle waits after the mouse last moved on the sidebar. */
const RAIL_PAUSE_MS = 2_500;

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

  // The hover invite (Keller, 10 Nov: "nobody knows that you can interact with these pages"). A
  // mouse over the laptop takes the "Pick a page to explore" chip along, lights the bezel and
  // pulses the sidebar. The first click inside the laptop ends the lesson: no more chip or pulse
  // this visit.
  //
  // Where it waits changed on 11 Nov (Artin). He asked for the resting cue to sit "in the corners
  // at the top, so top right and top left", to hold rather than "fade away instantly", and to not
  // "cover any part of the dashboard" — the chip used to wait centred over the screen, which it
  // did. So the resting state moved out of the screen into `.cues` (CSS, below the bezel in the
  // markup): brackets on both top corners, and a label with the curved arrow he described above
  // the right one. The chip itself is now only ever the thing that trails a pointer, and it glides
  // back to that corner when the mouse leaves, so the two read as one object.
  const stageRef = useRef<HTMLDivElement>(null);
  const chipRef = useRef<HTMLDivElement>(null);
  const hovering = useRef(false);
  // The page holds still only while the mouse is moving on the sidebar, about to pick a page, and
  // for a moment after. Not while it is anywhere over the laptop (owner, 10 Nov: "it's stuck there"),
  // and not while a mouse merely rests on the sidebar: one parked there froze the pages until a
  // click (owner, 11 Nov). When the mouse last moved on the sidebar, or 0.
  const railAt = useRef(0);
  const learnt = useRef(false);

  const choose = (key: DevicePageKey) => {
    holdTicks.current = Math.round(HOLD_MS / PAGE_MS);
    learnt.current = true;
    deviceRef.current?.setAttribute("data-learnt", "true");
    chipRef.current?.setAttribute("data-show", "false");
    setPage(key);
  };

  // A new page every few seconds while the device is on screen, unless one was just chosen by hand
  // or the mouse is on the sidebar.
  useEffect(() => {
    if (!live || window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    const timer = window.setInterval(() => {
      if (performance.now() - railAt.current < RAIL_PAUSE_MS) return;
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

  // The invite's moving parts. Nothing here touches React state: the hover is an attribute on the
  // device, and the chip is moved by a transform written once a frame, only while it is moving. It
  // trails the pointer with a little lag (eased, not glued), and sits in the stage rather than the
  // tilted device so the pointer's coordinates map straight onto it. Mouse only: a tap never shows it.
  useEffect(() => {
    const device = deviceRef.current;
    const stage = stageRef.current;
    const chip = chipRef.current;
    if (!device || !stage || !chip) return;
    const mouse = window.matchMedia("(hover: hover) and (pointer: fine)");
    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    let frame = 0;
    let x = 0, y = 0, toX = 0, toY = 0;
    let shown = "false";
    // Written only when it changes: an attribute set on every pointer move restyles the chip each time.
    const show = (on: boolean) => {
      const next = String(on);
      if (next !== shown) { shown = next; chip.setAttribute("data-show", next); }
    };
    const place = () => { chip.style.transform = `translate3d(${x.toFixed(1)}px, ${y.toFixed(1)}px, 0)`; };
    const glide = () => {
      frame = 0;
      const ease = reduce ? 1 : 0.2;
      x += (toX - x) * ease;
      y += (toY - y) * ease;
      place();
      if (Math.abs(toX - x) > 0.25 || Math.abs(toY - y) > 0.25) frame = window.requestAnimationFrame(glide);
    };
    const kick = () => { if (!frame) frame = window.requestAnimationFrame(glide); };

    // Where the chip waits when no mouse is on the laptop: the top-left corner, under the cue's
    // label (Artin, 11 Nov; the owner moved it to this corner on 12 Nov). It is never shown there —
    // the cue is what you see at rest — but a mouse
    // that arrives lifts the chip from that corner and a mouse that leaves sends it back, so the
    // label and the chip read as one object rather than two copies of the same hint. Until 11 Nov
    // the chip rested visible over the middle of the screen, which is the "covering the dashboard"
    // he objected to. The first click inside the laptop ends it for the visit.
    let restX = 0, restY = 0, placed = false;
    const rest = () => {
      restX = device.offsetLeft + 14;
      restY = device.offsetTop - 2;
      if (hovering.current) return;
      toX = restX; toY = restY;
      if (!placed) { x = toX; y = toY; place(); placed = true; } else kick();
    };
    if (mouse.matches) rest();
    const fit = new ResizeObserver(() => { if (mouse.matches) rest(); });
    fit.observe(stage);

    const aim = (event: PointerEvent) => {
      const box = stage.getBoundingClientRect();
      toX = event.clientX - box.left + 18;
      toY = event.clientY - box.top + 20;
      // Over the sidebar the pointer is already where it should be: the chip steps aside.
      const overRail = event.target instanceof Element && event.target.closest("nav") !== null;
      railAt.current = overRail ? performance.now() : 0;
      show(!learnt.current && !overRail);
    };
    const enter = (event: PointerEvent) => {
      if (event.pointerType !== "mouse" || !mouse.matches) return;
      hovering.current = true;
      device.setAttribute("data-hover", "true");
      aim(event);
      kick(); // glides from where it waits to the pointer
    };
    const move = (event: PointerEvent) => {
      if (!hovering.current) return;
      aim(event);
      kick();
    };
    const leave = () => {
      railAt.current = 0;
      if (!hovering.current) return;
      hovering.current = false;
      device.removeAttribute("data-hover");
      toX = restX; toY = restY;
      // Back to the corner and out of sight: the cue fades in again behind it.
      show(false);
      kick();
    };
    // Any click inside the laptop, a page in its sidebar or not: the visitor has found it.
    const learn = () => {
      learnt.current = true;
      device.setAttribute("data-learnt", "true");
      show(false);
    };
    device.addEventListener("pointerenter", enter);
    device.addEventListener("pointermove", move, { passive: true });
    device.addEventListener("pointerleave", leave);
    device.addEventListener("click", learn);
    // A scroll moves the laptop out from under a still mouse without always saying so: the pause ends.
    const unpause = () => { railAt.current = 0; };
    window.addEventListener("scroll", unpause, { passive: true });
    return () => {
      window.removeEventListener("scroll", unpause);
      device.removeEventListener("pointerenter", enter);
      device.removeEventListener("pointermove", move);
      device.removeEventListener("pointerleave", leave);
      device.removeEventListener("click", learn);
      fit.disconnect();
      window.cancelAnimationFrame(frame);
    };
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
    <div ref={stageRef} className={styles.stage}>
      <div className={styles.halo} aria-hidden="true" />
      <div className={styles.frameOutline} aria-hidden="true" />
      <div ref={deviceRef} className={styles.device} data-live={live}>
        {/* The resting cue (Artin, 11 Nov): brackets on both top corners, and above the right one a
            label with the curved arrow he asked for, running back down to the bezel. Decoration —
            the viewport's own label already tells a screen reader the pages can be chosen. */}
        <div className={styles.cues} aria-hidden="true">
          <span className={`${styles.corner} ${styles.cornerLeft}`} />
          <span className={`${styles.corner} ${styles.cornerRight}`} />
          <span className={styles.cueLabel}><span className={styles.cueMouse}>Pick a page to explore</span><span className={styles.cueTouch}>Tap a page to explore</span><ArrowRight /></span>
          {/* The viewBox is cropped to the path, so none of the drawn height is wasted on margin.
              It runs out from under the label's right end and sweeps down into the screen. */}
          <svg className={styles.cueArrow} viewBox="22 6 84 160" aria-hidden="true">
            <path d="M24 8 C 28 70 48 130 104 164 M104 164 l -9 -16 M104 164 l -18 0" />
          </svg>
        </div>
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
      {/* The invite that trails a mouse over the laptop (see above). Decoration: the screen's own
          label already says the pages can be chosen. */}
      <div ref={chipRef} className={styles.invite} data-show="false" aria-hidden="true">
        <span className={styles.inviteChip}><ArrowLeft />Pick a page to explore</span>
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
