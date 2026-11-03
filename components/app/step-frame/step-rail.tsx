"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { ArrowLeftRight, BookUser, BriefcaseBusiness, Calculator, Settings, ChevronsLeft, ChevronsRight, CircleAlert, CreditCard, FileChartColumn, Files, FileText, Import, Landmark, Link2, Receipt, ReceiptText, Scale, Split, UserRoundSearch, Wallet, ChartLine, LifeBuoy, Wrench, HeartHandshake, ChartNoAxesCombined, ShieldCheck, PhoneOff, LockKeyhole, UserX, FileSearch, BadgeCheck, WalletCards, HandCoins, UserRoundCheck, Network, Banknote, type LucideIcon } from "lucide-react";

import { cn } from "@/lib/utils";

/** A rail entry. `icon` names one of ICONS (the sidebar's own icon for the page). */
export type RailStep = { key: string; label: string; href: string; icon: string };
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
  const [counts, setCounts] = useState<Record<string, number>>({});
  // A decision made in place (no step change) asks for the counts again (STEP_COUNTS_EVENT).
  const [asked, setAsked] = useState(0);
  useEffect(() => {
    const again = () => setAsked((n) => n + 1);
    window.addEventListener(STEP_COUNTS_EVENT, again);
    return () => window.removeEventListener(STEP_COUNTS_EVENT, again);
  }, []);
  useEffect(() => {
    if (!countsUrl) return;
    const controller = new AbortController();
    fetch(countsUrl, { cache: "no-store", signal: controller.signal })
      .then((response) => (response.ok ? response.json() : null))
      .then((body: { counts?: Record<string, number> } | null) => { if (body?.counts) setCounts(body.counts); })
      .catch(() => {});
    return () => controller.abort();
  }, [step, countsUrl, asked]);

  return (
    <nav aria-label={label} data-collapsed={collapsed ? "" : undefined} className={cn(
      "m-glass rounded-xl border border-[var(--border)] p-3 lg:flex lg:h-full lg:min-h-0 lg:flex-col lg:transition-[width] lg:duration-300 lg:ease-[cubic-bezier(.2,.8,.2,1)] motion-reduce:transition-none",
      collapsed ? "lg:w-[72px] lg:px-2" : "lg:w-[248px]",
    )}>
      <ul ref={list} className="m-0 flex list-none gap-1 overflow-x-auto p-0 lg:flex-col lg:overflow-visible">
        {steps.map((item) => {
          const on = item.key === step;
          const Icon = ICONS[item.icon] ?? Files;
          const n = counts[item.key] ?? 0;
          const words = waiting[item.key];
          const note = n > 0 && words ? `${n.toLocaleString("en-US")} ${n === 1 ? words[0] : words[1]}` : null;
          return (
            <li key={item.key} className="shrink-0">
              <Link
                href={item.href}
                aria-current={on ? "page" : undefined}
                title={collapsed ? (note ? `${item.label} · ${note}` : item.label) : note ?? undefined}
                className={cn(
                  "group relative flex items-center gap-3 rounded-xl outline-none",
                  collapsed ? "justify-center px-1 py-2" : "px-3 py-2.5",
                  " transition-colors duration-200 focus-visible:ring-2 focus-visible:ring-[var(--primary)]",
                  on ? "bg-[var(--primary-soft)] ring-1 ring-inset ring-[color-mix(in_srgb,var(--primary)_50%,transparent)]" : "hover:bg-[color-mix(in_srgb,var(--ink)_5%,transparent)]",
                )}
              >
                <span aria-hidden="true" className={cn(
                  "inline-grid size-[34px] shrink-0 place-items-center rounded-[10px] transition-colors duration-200",
                  on ? "bg-[var(--primary)] text-[var(--on-primary)]" : "bg-[color-mix(in_srgb,var(--ink)_6%,transparent)] text-[var(--ink)]",
                )}><Icon className="size-[18px]" strokeWidth={1.8} /></span>
                <span className={cn("min-w-0 flex-1", collapsed && "lg:sr-only")}>
                  <span className="block text-sm font-semibold text-[var(--ink)]">{item.label}</span>
                </span>
                {note ? (collapsed
                  // Collapsed, the count rides on the icon's corner as a dot with its number in the tooltip.
                  ? <span aria-hidden="true" className="absolute top-1.5 right-2 hidden size-2.5 rounded-full bg-[var(--warning)] ring-2 ring-[var(--canvas)] lg:block" />
                  : <span aria-label={note} className="inline-grid h-5 min-w-[22px] shrink-0 place-items-center rounded-full bg-[color-mix(in_srgb,var(--warning)_18%,transparent)] px-[7px] text-xs font-bold text-[var(--warning-ink)] tabular-nums">{n >= 10_000 ? `${(n / 1000).toFixed(1).replace(/\.0$/, "")}k` : n.toLocaleString("en-US")}</span>
                ) : null}
              </Link>
            </li>
          );
        })}
      </ul>
      {foot && (
        <Link
          href={foot.href}
          title={collapsed ? foot.label : undefined}
          className={cn(
            "mt-auto hidden items-center gap-3 rounded-xl bg-[color-mix(in_srgb,var(--ink)_3%,transparent)] text-sm font-semibold text-[var(--ink)] outline-none transition-colors hover:bg-[color-mix(in_srgb,var(--ink)_6%,transparent)] focus-visible:ring-2 focus-visible:ring-[var(--primary)] lg:flex",
            collapsed ? "justify-center p-2" : "px-3 py-2.5",
          )}
        >
          <Settings className="size-4 shrink-0" aria-hidden="true" />
          <span className={cn(collapsed && "sr-only")}>{foot.label}</span>
        </Link>
      )}
      <button
        type="button"
        onClick={toggle}
        aria-expanded={!collapsed}
        aria-label={collapsed ? `Show the ${label} menu` : `Collapse the ${label} menu`}
        title={collapsed ? "Show labels" : "Collapse"}
        className={cn("mt-2 hidden size-8 shrink-0 place-items-center rounded-lg text-[var(--ink)] outline-none transition-colors hover:bg-[color-mix(in_srgb,var(--ink)_6%,transparent)] focus-visible:ring-2 focus-visible:ring-[var(--primary)] lg:grid", !foot && "lg:mt-auto", collapsed ? "mx-auto" : "ml-auto")}
      >
        {collapsed ? <ChevronsRight className="size-4" aria-hidden="true" /> : <ChevronsLeft className="size-4" aria-hidden="true" />}
      </button>
    </nav>
  );
}
