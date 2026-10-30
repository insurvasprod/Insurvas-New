"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { ChevronsLeft, ChevronsRight, CircleAlert, FileSearch, LockKeyhole, PhoneOff, Settings, ShieldCheck, UserX, type LucideIcon } from "lucide-react";

import { COMPLIANCE_RAIL_COOKIE, complianceStepStatus, type ComplianceStep, type ComplianceStepCounts } from "@/lib/compliance/steps";
import { cn } from "@/lib/utils";

type RailStep = { key: ComplianceStep; label: string; sub: string; href: string };

const ICONS: Record<ComplianceStep, LucideIcon> = { overview: ShieldCheck, dnc: PhoneOff, consent: LockKeyhole, complaints: CircleAlert, deletions: UserX, evidence: FileSearch };

/**
 * The Compliance menu (2026-10-30, canvas "M6 · Compliance (one page)"), drawn as the Leads in rail is: a
 * menu, not a path — no numbers, no line joining the pages, each opens any time. An amber badge shows only
 * where something waits for a person (/api/app/compliance/steps). The foot holds Compliance settings for
 * the owner, the one place it was reachable from before (Overview's header).
 */
export function ComplianceRail({ steps, step, initialCollapsed = false, settingsHref = null }: { steps: RailStep[]; step: ComplianceStep; initialCollapsed?: boolean; settingsHref?: string | null }) {
  const [collapsed, setCollapsed] = useState(initialCollapsed);
  const toggle = () => {
    const next = !collapsed;
    setCollapsed(next);
    try { document.cookie = `${COMPLIANCE_RAIL_COOKIE}=${next ? "collapsed" : "open"}; path=/; max-age=31536000; SameSite=Lax`; } catch { /* still toggles for this visit */ }
  };
  const [counts, setCounts] = useState<ComplianceStepCounts>({});
  // On a phone the menu is one scrolling row of chips: bring the open step into view.
  const list = useRef<HTMLUListElement | null>(null);
  useEffect(() => {
    const row = list.current;
    const on = row?.querySelector<HTMLElement>("[aria-current=page]");
    if (row && on && row.scrollWidth > row.clientWidth) row.scrollTo({ left: row.scrollLeft + on.getBoundingClientRect().left - row.getBoundingClientRect().left - 8 });
  }, [step]);
  const counted = steps.some((item) => item.key === "complaints" || item.key === "deletions");
  useEffect(() => {
    if (!counted) return;
    const controller = new AbortController();
    fetch("/api/app/compliance/steps", { cache: "no-store", signal: controller.signal })
      .then((response) => (response.ok ? response.json() : null))
      .then((body: { counts?: ComplianceStepCounts } | null) => { if (body?.counts) setCounts(body.counts); })
      .catch(() => {});
    return () => controller.abort();
  }, [step, counted]);

  return (
    <nav aria-label="Compliance" data-collapsed={collapsed ? "" : undefined} className={cn(
      "m-glass rounded-xl border border-[var(--border)] p-3 lg:flex lg:h-full lg:min-h-0 lg:flex-col lg:transition-[width] lg:duration-300 lg:ease-[cubic-bezier(.2,.8,.2,1)] motion-reduce:transition-none",
      collapsed ? "lg:w-[72px] lg:px-2" : "lg:w-[248px]",
    )}>
      <ul ref={list} className="m-0 flex list-none gap-1 overflow-x-auto p-0 lg:flex-col lg:overflow-visible">
        {steps.map((item) => {
          const on = item.key === step;
          const n = counts[item.key];
          const status = n === undefined ? null : complianceStepStatus(item.key, n);
          const Icon = ICONS[item.key];
          return (
            <li key={item.key} className="shrink-0">
              <Link
                href={item.href}
                aria-current={on ? "page" : undefined}
                title={collapsed ? `${item.label} · ${status?.text ?? item.sub}` : undefined}
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
                {status?.needsYou && n ? (collapsed
                  ? <span aria-hidden="true" className="absolute top-1.5 right-2 hidden size-2.5 rounded-full bg-[var(--warning)] ring-2 ring-[var(--canvas)] lg:block" />
                  : <span className="inline-grid h-5 min-w-[22px] shrink-0 place-items-center rounded-full bg-[color-mix(in_srgb,var(--warning)_18%,transparent)] px-[7px] text-xs font-bold text-[var(--warning-ink)] tabular-nums">{n.toLocaleString("en-US")}</span>
                ) : null}
              </Link>
            </li>
          );
        })}
      </ul>
      {/* Compliance settings (LA-6.8) stay a Settings page; the owner reaches them from every step. */}
      {settingsHref && (
        <Link
          href={settingsHref}
          title={collapsed ? "Compliance settings" : undefined}
          className={cn(
            "mt-auto hidden items-center gap-3 rounded-xl bg-[color-mix(in_srgb,var(--ink)_3%,transparent)] text-sm font-semibold text-[var(--ink)] outline-none transition-colors hover:bg-[color-mix(in_srgb,var(--ink)_6%,transparent)] focus-visible:ring-2 focus-visible:ring-[var(--primary)] lg:flex",
            collapsed ? "justify-center p-2" : "px-3 py-2.5",
          )}
        >
          <Settings className="size-4 shrink-0" aria-hidden="true" />
          <span className={cn(collapsed && "sr-only")}>Compliance settings</span>
        </Link>
      )}
      <button
        type="button"
        onClick={toggle}
        aria-expanded={!collapsed}
        aria-label={collapsed ? "Show the Compliance menu" : "Collapse the Compliance menu"}
        title={collapsed ? "Show labels" : "Collapse"}
        className={cn("mt-2 hidden size-8 shrink-0 place-items-center rounded-lg text-[var(--ink)] outline-none transition-colors hover:bg-[color-mix(in_srgb,var(--ink)_6%,transparent)] focus-visible:ring-2 focus-visible:ring-[var(--primary)] lg:grid", collapsed ? "mx-auto" : "ml-auto", !settingsHref && "lg:mt-auto")}
      >
        {collapsed ? <ChevronsRight className="size-4" aria-hidden="true" /> : <ChevronsLeft className="size-4" aria-hidden="true" />}
      </button>
    </nav>
  );
}
