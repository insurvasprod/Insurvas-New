"use client";

import { useEffect, useRef, useState } from "react";
import { ArrowLeftRight, BookUser, BriefcaseBusiness, Calculator, Settings, CircleAlert, CreditCard, FileChartColumn, Files, FileText, Import, Landmark, Link2, Receipt, ReceiptText, Scale, Split, UserRoundSearch, Wallet, ChartLine, LifeBuoy, Wrench, HeartHandshake, ChartNoAxesCombined, ShieldCheck, PhoneOff, LockKeyhole, UserX, FileSearch, BadgeCheck, WalletCards, HandCoins, UserRoundCheck, Network, Banknote, ListTodo, LayoutGrid, Repeat, Hourglass, Undo2, Tag, BadgePercent, Gauge, TrendingUp, PlugZap, Scale3d, Package, Puzzle, ToggleRight, Boxes, LayoutTemplate, BookCheck, TableProperties, ListChecks, FileInput, Compass, Flag, LogIn, MonitorSmartphone, ScrollText, ServerCog, FileWarning, Mail, SlidersHorizontal, UserCog, PanelLeftClose, PanelLeftOpen, type LucideIcon } from "lucide-react";

import { CountBadge } from "@/components/ui/count-badge";
import { IntentLink } from "@/components/ui/nav-pending";
import { countsFor, rememberCounts, rememberRail } from "@/components/app/step-frame/frame-memory";
import { RailCornerDot, RailHighlight, useRailGlide } from "@/components/app/step-frame/rail-glide";
import { load as loadResource, readResource } from "@/lib/client/resource-cache";
import { cn } from "@/lib/utils";

/** A rail entry. `icon` names one of ICONS (the sidebar's own icon for the page). */
/** `group`: a small label drawn over the first step of each group (Commissions: Money in · Money out, round 7). */
/** `elsewhere`: the area whose page this row opens (Accounting's Team payouts and Partner payouts live in Commissions, round 7): drawn like any other step (owner 2026-11-11: no ↗), but never the open step. */
export type RailStep = { key: string; label: string; href: string; icon: string; group?: string; elsewhere?: string };
/** What a step's badge counts, singular and plural ("file could not be read" / "files could not be read"). */
export type RailWaiting = Record<string, [one: string, many: string]>;

const ICONS: Record<string, LucideIcon> = {
  files: Files, import: Import, link: Link2, "circle-alert": CircleAlert, "book-user": BookUser, settings: Settings,
  "chart-line": ChartLine, landmark: Landmark, "receipt-text": ReceiptText, "credit-card": CreditCard, split: Split, wallet: Wallet, "file-chart-column": FileChartColumn,
  "file-text": FileText, receipt: Receipt, scale: Scale, "user-round-search": UserRoundSearch, "arrow-left-right": ArrowLeftRight, calculator: Calculator, "briefcase-business": BriefcaseBusiness,
  "life-buoy": LifeBuoy, wrench: Wrench, "heart-handshake": HeartHandshake, "chart-no-axes-combined": ChartNoAxesCombined,
  "shield-check": ShieldCheck, "phone-off": PhoneOff, "lock-keyhole": LockKeyhole, "user-x": UserX, "file-search": FileSearch, "badge-check": BadgeCheck,
  // Team and the pages it handed on (2026-11-03): Producers, Hierarchy, Producer payouts, Commission splits.
  "wallet-cards": WalletCards, "hand-coins": HandCoins, "user-round-check": UserRoundCheck, network: Network, banknote: Banknote,
  // Accounting › To do (round 7).
  "list-todo": ListTodo,
  // Admin › Billing (admin round 1, 2026-11-17): the admin sidebar's own icons for these pages.
  "layout-grid": LayoutGrid, repeat: Repeat, hourglass: Hourglass, "undo-2": Undo2, tag: Tag, "badge-percent": BadgePercent, gauge: Gauge, "trending-up": TrendingUp, "plug-zap": PlugZap, "scale-3d": Scale3d,
  // Admin › Catalog (admin round 1, 2026-11-17).
  package: Package, puzzle: Puzzle, "toggle-right": ToggleRight, boxes: Boxes, "layout-template": LayoutTemplate, "book-check": BookCheck, "table-properties": TableProperties, "list-checks": ListChecks, "file-input": FileInput, compass: Compass, flag: Flag,
  // Admin › Monitoring (admin round 1, 2026-11-17). "lock-keyhole" is already above.
  "log-in": LogIn, "monitor-smartphone": MonitorSmartphone, "scroll-text": ScrollText, "server-cog": ServerCog,
  // Admin › Platform (admin round 1, 2026-11-18). "shield-check", "phone-off", "server-cog" and "scale" are already above.
  "file-warning": FileWarning, mail: Mail, "sliders-horizontal": SlidersHorizontal, "user-cog": UserCog,
};

/** Fired on window after something that waits on a person is decided where it is listed, so badges re-read. */
export const STEP_COUNTS_EVENT = "step-rail:counts";
export const refreshStepCounts = () => { if (typeof window !== "undefined") window.dispatchEvent(new Event(STEP_COUNTS_EVENT)); };

/**
 * The menu of a merged page (Data in 2026-11-02, Accounting 2026-11-02), drawn as the Compliance and Reports
 * rails are: a menu, not a path — no numbers, no line joining the pages, each opens any time, name only. An
 * amber badge shows only where something waits on a person (`countsUrl`, re-read on every step so clearing
 * an item takes the number down). On a phone it is one scrolling row of chips; on a wide screen it stands
 * the page's height and collapses to icons, remembered in `cookie`.
 */
export function StepRail({ label, cookie, countsUrl, waiting = {}, steps, step, initialCollapsed = false, foot = null }: {
  label: string;
  /** A page that is not a step but belongs to this menu (Compliance settings, for the owner), at the rail's foot. */
  foot?: { label: string; href: string } | null;
  cookie: string;
  countsUrl?: string;
  waiting?: RailWaiting;
  steps: RailStep[];
  step: string;
  initialCollapsed?: boolean;
}) {
  const [collapsed, setCollapsed] = useState(initialCollapsed);
  const toggle = () => {
    const next = !collapsed;
    setCollapsed(next);
    try { document.cookie = `${cookie}=${next ? "collapsed" : "open"}; path=/; max-age=31536000; SameSite=Lax`; } catch { /* still toggles for this visit */ }
  };
  // On a phone the menu is one scrolling row of chips: bring the open step into view.
  const list = useRef<HTMLUListElement | null>(null);
  useEffect(() => {
    const row = list.current;
    const on = row?.querySelector<HTMLElement>("[aria-current=page]");
    if (row && on && row.scrollWidth > row.clientWidth) row.scrollTo({ left: row.scrollLeft + on.getBoundingClientRect().left - row.getBoundingClientRect().left - 8 });
  }, [step]);
  // The last counts this tab saw for the rail, so a redrawn rail (the next step, the loading state) keeps its badges.
  const [counts, setCounts] = useState<Record<string, number>>(() => countsFor(countsUrl));
  // A decision made in place (no step change) asks for the counts again (STEP_COUNTS_EVENT).
  const [asked, setAsked] = useState(0);
  useEffect(() => {
    const again = () => setAsked((n) => n + 1);
    window.addEventListener(STEP_COUNTS_EVENT, again);
    return () => window.removeEventListener(STEP_COUNTS_EVENT, again);
  }, []);
  useEffect(() => {
    if (!countsUrl) return;
    // A stale answer is ignored, not aborted: aborting on unmount surfaced as an uncaught AbortError in dev.
    let stale = false;
    // Through the app's cache (speed pass 2026-11-09): moving between steps reuses an answer up to 20s old instead of
    // asking on every step; a decision made in place (`asked`) always asks again.
    const read = asked > 0 ? loadResource<{ counts?: Record<string, number> }>(countsUrl) : readResource<{ counts?: Record<string, number> }>(countsUrl, { freshFor: 20_000 });
    read
      .then((body) => { if (!stale && body?.counts) { rememberCounts(countsUrl, body.counts); setCounts(body.counts); } })
      .catch(() => {});
    return () => { stale = true; };
  }, [step, countsUrl, asked]);

  // Remembered for the shell's loading state, which redraws this rail while the next step loads (frame-memory.ts).
  useEffect(() => { rememberRail({ label, cookie, countsUrl, waiting, steps, foot, collapsed }); });
  // The open step's highlight glides from step to step (rail-glide.tsx), on the list the steps sit in.
  const pill = useRailGlide(list, label);

  // Expanding and collapsing is one calm move (owner 2026-11-18: "a smoother transition"): the rail's width glides,
  // the icons never move (the same padding open or closed, so a 34px icon sits centred in the 72px rail), and the
  // names and group labels fade instead of popping in and out.
  const fade = cn("whitespace-nowrap transition-opacity duration-[var(--t-panel)] ease-[var(--e)]", collapsed && "lg:pointer-events-none lg:opacity-0");
  const PanelIcon = collapsed ? PanelLeftOpen : PanelLeftClose;

  return (
    <nav aria-label={label} data-collapsed={collapsed ? "" : undefined} className={cn(
      "m-glass rounded-xl border border-[var(--border)] p-3 lg:flex lg:h-full lg:min-h-0 lg:flex-col lg:overflow-hidden lg:px-2 lg:transition-[width] lg:duration-[var(--t-panel)] lg:ease-[var(--e-out)]",
      collapsed ? "lg:w-[72px]" : "lg:w-[248px]",
    )}>
      {/* The steps scroll inside the rail when they are taller than the page (owner 2026-11-18), never past its edge. */}
      <ul ref={list} data-rail-track="" className="relative isolate m-0 flex list-none gap-1 overflow-x-auto p-0 [scrollbar-width:none]! lg:min-h-0 lg:flex-1 lg:flex-col lg:overflow-x-hidden lg:overflow-y-auto [&::-webkit-scrollbar]:hidden">
        <RailHighlight pill={pill} />
        {steps.map((item, index) => {
          const on = item.key === step && !item.elsewhere;
          // A step further down slides the content up from the right, one further up from the left (§ Motion).
          const here = steps.findIndex((s) => s.key === step);
          const Icon = ICONS[item.icon] ?? Files;
          const n = counts[item.key] ?? 0;
          const words = waiting[item.key];
          const note = n > 0 && words ? `${n.toLocaleString("en-US")} ${n === 1 ? words[0] : words[1]}` : null;
          const groupLabel = item.group && item.group !== steps[index - 1]?.group ? item.group : null;
          return (
            <li key={item.key} className="shrink-0">
              {/* Collapsed, a group's name fades and a short rule takes its place, so the steps never jump. */}
              {groupLabel ? (
                <p className={cn("relative m-0 hidden px-[10px] pb-1 text-xs font-semibold text-muted-foreground lg:block", index > 0 && "pt-3")}>
                  <span className={cn("block", fade)}>{groupLabel}</span>
                  <span aria-hidden="true" className={cn("absolute bottom-2.5 left-1/2 h-px w-5 -translate-x-1/2 bg-[var(--border)] transition-opacity duration-[var(--t-panel)] ease-[var(--e)]", collapsed ? "opacity-100" : "opacity-0")} />
                </p>
              ) : null}
              <IntentLink
                href={item.href}
                transitionTypes={on ? undefined : [here >= 0 && index < here ? "nav-back" : "nav-forward"]}
                aria-current={on ? "page" : undefined}
                title={collapsed ? (note ? `${item.label} · ${note}` : item.label) : note ?? undefined}
                className={cn(
                  "group relative flex items-center gap-3 rounded-xl px-3 py-2.5 outline-none lg:px-[10px]",
                  " transition-colors duration-[var(--t-panel)] ease-[var(--e)] focus-visible:ring-2 focus-visible:ring-[var(--primary)]",
                  // The open step's ground is the gliding pill once it is measured; until then (the first paint) its own.
                  on ? !pill && "bg-[var(--primary-soft)] ring-1 ring-inset ring-[color-mix(in_srgb,var(--primary)_50%,transparent)]" : "hover:bg-[color-mix(in_srgb,var(--ink)_5%,transparent)]",
                )}
              >
                <span aria-hidden="true" className={cn(
                  "inline-grid size-[34px] shrink-0 place-items-center rounded-[10px] transition-colors duration-[var(--t-panel)] ease-[var(--e)]",
                  on ? "bg-[var(--primary)] text-[var(--on-primary)]" : "bg-[color-mix(in_srgb,var(--ink)_6%,transparent)] text-[var(--ink)]",
                )}><Icon className="size-[18px]" strokeWidth={1.8} /></span>
                <span className={cn("min-w-0 flex-1", fade)}>
                  <span className="block truncate text-sm font-semibold text-[var(--ink)]">{item.label}</span>
                </span>
                {collapsed
                  // Collapsed, the count rides on the icon's corner as a dot with its number in the tooltip.
                  ? <RailCornerDot on={Boolean(note)} />
                  // The count rolls when it changes, pops in when it appears and shrinks away at 0 (CountBadge).
                  : <CountBadge value={words ? n : 0} label={note ?? undefined} tone="warning" compact className="shrink-0" />}
              </IntentLink>
            </li>
          );
        })}
      </ul>
      {foot && (
        <IntentLink
          href={foot.href}
          title={collapsed ? foot.label : undefined}
          className="mt-2 hidden shrink-0 items-center gap-3 rounded-xl bg-[color-mix(in_srgb,var(--ink)_3%,transparent)] px-[18px] py-2.5 text-sm font-semibold text-[var(--ink)] outline-none transition-colors duration-[var(--t-micro)] ease-[var(--e)] hover:bg-[color-mix(in_srgb,var(--ink)_6%,transparent)] focus-visible:ring-2 focus-visible:ring-[var(--primary)] lg:flex"
        >
          <Settings className="size-4 shrink-0" aria-hidden="true" />
          <span className={fade}>{foot.label}</span>
        </IntentLink>
      )}
      {/* Showing and hiding the menu is a real button (owner 2026-11-18: "not an arrow"): a panel icon and its words,
          the words fading with the rest when the rail is narrow. */}
      <button
        type="button"
        onClick={toggle}
        aria-expanded={!collapsed}
        aria-label={collapsed ? `Show the ${label} menu` : `Hide the ${label} menu`}
        title={collapsed ? "Show menu" : "Hide menu"}
        className="mt-2 hidden h-9 shrink-0 items-center gap-3 rounded-xl border border-[var(--border)] px-[17px] text-sm font-semibold text-[var(--ink)] outline-none transition-colors duration-[var(--t-micro)] ease-[var(--e)] hover:bg-[color-mix(in_srgb,var(--ink)_6%,transparent)] focus-visible:ring-2 focus-visible:ring-[var(--primary)] lg:flex"
      >
        <PanelIcon className="size-4 shrink-0" aria-hidden="true" />
        <span className={fade}>{collapsed ? "Show menu" : "Hide menu"}</span>
      </button>
    </nav>
  );
}
