"use client";

import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import { Activity, Award, BadgeDollarSign, Brain, ChartColumn, ChevronsLeft, ChevronsRight, Gauge, type LucideIcon } from "lucide-react";

import { useMenuSections } from "@/components/ui/page-trail";
import { REPORTS_RAIL_COOKIE, REPORTS_VIEWS, sharedPeriod, type ReportsView } from "@/lib/reports/views";
import { cn } from "@/lib/utils";

const ICONS: Record<ReportsView, LucideIcon> = { sales: ChartColumn, activity: Activity, scoring: Brain, book: Gauge, cpa: BadgeDollarSign, partner: Award };

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/** "1 Aug – 29 Oct" for the rail's period line. Hand-built: the server's ICU prints "Sept", the browser "Sep". */
function periodText(period: { from: string; to: string }) {
  const day = (iso: string) => `${Number(iso.slice(8, 10))} ${MONTHS[Number(iso.slice(5, 7)) - 1]}`;
  return `${day(period.from)} – ${day(period.to)}`;
}

/**
 * The Reports menu (owner 2026-10-30, canvas "Reports in one page", board RpS1), the Leads in menu's
 * twin: a menu, not a path — no numbers, no line — because the six reports are views to open in any
 * order. It offers exactly the Reports pages the sidebar offers this person (the shell's
 * server-filtered menu), and the open view always.
 *
 * The period a view was set to rides along to the views that read a date window (`?from&to`, see
 * lib/reports/views.ts), so switching from Sales performance to True CPA keeps "1 Aug – 29 Oct".
 * An amber count shows only where something waits for a person: appointments to close out on Team
 * activity (owners and producers; the route refuses everyone else, and then there is no badge).
 */
export function ReportsRail({ view, initialCollapsed = false }: { view: ReportsView; initialCollapsed?: boolean }) {
  const menu = useMenuSections();
  const params = useSearchParams();
  const period = sharedPeriod(params);
  const [collapsed, setCollapsed] = useState(initialCollapsed);
  const [closeOuts, setCloseOuts] = useState(0);

  const views = useMemo(() => {
    const keys = new Set((menu ?? []).flatMap((section) => section.items).map((item) => item.key));
    return REPORTS_VIEWS.filter((item) => item.key === view || keys.has(item.menuKey));
  }, [menu, view]);
  const hasActivity = views.some((item) => item.key === "activity");

  useEffect(() => {
    if (!hasActivity) return;
    const controller = new AbortController();
    fetch("/api/app/appointments/close-out", { cache: "no-store", signal: controller.signal })
      .then((response) => (response.ok ? response.json() : null))
      .then((body: { appointments?: unknown[] } | null) => { if (Array.isArray(body?.appointments)) setCloseOuts(body.appointments.length); })
      .catch(() => {});
    return () => controller.abort();
  }, [hasActivity, view]);

  const toggle = () => {
    const next = !collapsed;
    setCollapsed(next);
    try { document.cookie = `${REPORTS_RAIL_COOKIE}=${next ? "collapsed" : "open"}; path=/; max-age=31536000; SameSite=Lax`; } catch { /* still toggles for this visit */ }
  };

  return (
    <nav aria-label="Reports" data-collapsed={collapsed ? "" : undefined} className={cn(
      "m-glass rounded-xl border border-[var(--border)] p-3 lg:flex lg:h-full lg:min-h-0 lg:flex-col lg:transition-[width] lg:duration-300 lg:ease-[cubic-bezier(.2,.8,.2,1)] motion-reduce:transition-none",
      collapsed ? "lg:w-[72px] lg:px-2" : "lg:w-[248px]",
    )}>
      <ul className="m-0 flex list-none gap-1 overflow-x-auto p-0 lg:flex-col lg:overflow-visible">
        {views.map((item) => {
          const on = item.key === view;
          const waiting = item.key === "activity" ? closeOuts : 0;
          const sub = waiting > 0 ? `${waiting.toLocaleString("en-US")} to close out` : item.sub;
          const href = item.sharesPeriod && period ? `${item.href}?from=${period.from}&to=${period.to}` : item.href;
          const Icon = ICONS[item.key];
          return (
            <li key={item.key} className="shrink-0">
              <Link
                href={href}
                aria-current={on ? "page" : undefined}
                title={collapsed ? `${item.label} · ${sub}` : undefined}
                className={cn(
                  "group relative flex items-center gap-3 rounded-xl outline-none transition-colors duration-200 focus-visible:ring-2 focus-visible:ring-[var(--primary)]",
                  collapsed ? "justify-center px-1 py-2" : "px-3 py-2.5",
                  on ? "bg-[var(--primary-soft)] ring-1 ring-inset ring-[color-mix(in_srgb,var(--primary)_50%,transparent)]" : "hover:bg-[color-mix(in_srgb,var(--ink)_5%,transparent)]",
                )}
              >
                <span aria-hidden="true" className={cn(
                  "inline-grid size-[34px] shrink-0 place-items-center rounded-[10px] transition-colors duration-200",
                  on ? "bg-[var(--primary)] text-[var(--on-primary)]" : "bg-[color-mix(in_srgb,var(--ink)_6%,transparent)] text-[var(--ink)]",
                )}><Icon className="size-[18px]" strokeWidth={1.8} /></span>
                <span className={cn("min-w-0 flex-1", collapsed && "lg:sr-only")}>
                  <span className="block whitespace-nowrap text-sm font-semibold text-[var(--ink)]">{item.label}</span>
                </span>
                {waiting > 0 ? (collapsed
                  ? <span aria-hidden="true" className="absolute top-1.5 right-2 hidden size-2.5 rounded-full bg-[var(--warning)] ring-2 ring-[var(--canvas)] lg:block" />
                  : <span className="inline-grid h-5 min-w-[22px] shrink-0 place-items-center rounded-full bg-[color-mix(in_srgb,var(--warning)_18%,transparent)] px-[7px] text-xs font-bold text-[var(--warning-ink)] tabular-nums">{waiting.toLocaleString("en-US")}</span>
                ) : null}
              </Link>
            </li>
          );
        })}
      </ul>
      {/* The shared period, said once: only once a view has set one. */}
      {period && (
        <div className={cn("mt-auto hidden flex-col gap-1 rounded-xl bg-[color-mix(in_srgb,var(--ink)_3%,transparent)] p-3", !collapsed && "lg:flex")}>
          <span className="text-xs font-semibold text-[var(--ink)]">Period kept as you switch</span>
          <span className="text-xs tabular-nums text-[var(--ink)]">{periodText(period)}</span>
        </div>
      )}
      <button
        type="button"
        onClick={toggle}
        aria-expanded={!collapsed}
        aria-label={collapsed ? "Show the Reports menu" : "Collapse the Reports menu"}
        title={collapsed ? "Show labels" : "Collapse"}
        className={cn("mt-2 hidden size-8 shrink-0 place-items-center rounded-lg text-[var(--ink)] outline-none transition-colors hover:bg-[color-mix(in_srgb,var(--ink)_6%,transparent)] focus-visible:ring-2 focus-visible:ring-[var(--primary)] lg:grid", collapsed ? "mx-auto" : "ml-auto", !period && "lg:mt-auto")}
      >
        {collapsed ? <ChevronsRight className="size-4" aria-hidden="true" /> : <ChevronsLeft className="size-4" aria-hidden="true" />}
      </button>
    </nav>
  );
}
