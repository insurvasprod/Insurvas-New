"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { AlignLeft, ChevronsLeft, ChevronsRight, Download, GitBranch, RotateCw, SquareCheck, Trash, type LucideIcon } from "lucide-react";

import { RAIL_COOKIE, leadsInStepStatus, type LeadsInStep } from "@/lib/leadSources/steps";
import { IMPORT_CSV_KEY } from "@/lib/agentTemplates/importReviewModel";
import { cn } from "@/lib/utils";

type RailStep = { key: LeadsInStep; label: string; sub: string; href: string };

const ICONS: Partial<Record<LeadsInStep, LucideIcon>> = { source: AlignLeft, import: Download, review: SquareCheck, clean: Trash, route: GitBranch, recycle: RotateCw };

/**
 * The Lead sources menu (owner pick "Navigation A", canvas m2-leads-in-r3 board LirN1, 2026-10-29): a
 * menu, not a path. No step numbers and no line joining the pages, because each page stands alone and
 * opens any time (owner: "I don't want the user to think that he still needs to go from step one to step
 * two"). The usual order lives in one quiet card at the foot. An amber badge shows only where something
 * waits for a person.
 *
 * Under each page, its live count once /api/app/lead-sources/steps answers (its plain line until then,
 * or if a read fails).
 *
 * Review is this browser's: a staged file can only be reviewed where it was dropped (the file itself
 * waits in this tab's sessionStorage, see import-review-bridge.tsx). So Review counts and opens the
 * files staged here — the server's newest one when it is among them — never one dropped elsewhere.
 */
function stagedHere(): string[] {
  try {
    const prefix = `${IMPORT_CSV_KEY}:`;
    const ids: string[] = [];
    for (let i = 0; i < sessionStorage.length; i++) {
      const key = sessionStorage.key(i);
      if (key?.startsWith(prefix)) ids.push(key.slice(prefix.length));
    }
    return ids;
  } catch {
    return [];
  }
}

/**
 * The files this tab holds that are still waiting (2026-10-29 clean-up). A file discarded or imported
 * elsewhere is forgotten here, so Review never counts or opens it. Only a clear answer ("missing" or
 * "committed") forgets one; a refused or failed read keeps it.
 */
async function stillStaged(ids: string[], signal: AbortSignal): Promise<string[]> {
  const kept = await Promise.all(ids.map(async (id) => {
    const response = await fetch(`/api/app/leads/import/batches/${id}`, { cache: "no-store", signal }).catch(() => null);
    const body = response?.ok ? await response.json().catch(() => null) as { state?: string } | null : null;
    if (body?.state === "missing" || body?.state === "committed") {
      try { sessionStorage.removeItem(`${IMPORT_CSV_KEY}:${id}`); } catch { /* kept until the tab closes */ }
      return null;
    }
    return id;
  }));
  return kept.filter((id): id is string => id !== null);
}

/** A badge's figure: 12,805 reads 12.8k so the badge stays one short pill. */
function badgeFigure(n: number) {
  return n >= 10_000 ? `${(n / 1000).toFixed(1).replace(/\.0$/, "")}k` : n.toLocaleString("en-US");
}

export function LeadsInRail({ steps, step, initialCollapsed = false }: { steps: RailStep[]; step: LeadsInStep; initialCollapsed?: boolean }) {
  const [collapsed, setCollapsed] = useState(initialCollapsed);
  const toggle = () => {
    const next = !collapsed;
    setCollapsed(next);
    try { document.cookie = `${RAIL_COOKIE}=${next ? "collapsed" : "open"}; path=/; max-age=31536000; SameSite=Lax`; } catch { /* still toggles for this visit */ }
  };
  const [counts, setCounts] = useState<Partial<Record<LeadsInStep, number>>>({});
  const [reviewHref, setReviewHref] = useState<string | null>(null);
  useEffect(() => {
    const controller = new AbortController();
    fetch("/api/app/lead-sources/steps", { cache: "no-store", signal: controller.signal })
      .then((response) => (response.ok ? response.json() : null))
      .then(async (body: { counts?: Partial<Record<LeadsInStep, number>>; reviewHref?: string | null } | null) => {
        const here = await stillStaged(stagedHere(), controller.signal);
        const newest = body?.reviewHref?.split("/").pop() ?? null;
        const open = newest && here.includes(newest) ? newest : here[here.length - 1] ?? null;
        if (body?.counts) setCounts({ ...body.counts, review: here.length });
        setReviewHref(open ? `/app/import/review/${open}` : null);
      })
      .catch(() => {});
    return () => controller.abort();
  }, [step]);

  return (
    <nav aria-label="Lead flow" data-collapsed={collapsed ? "" : undefined} className={cn(
      "m-glass rounded-xl border border-[var(--border)] p-3 lg:flex lg:h-full lg:min-h-0 lg:flex-col lg:transition-[width] lg:duration-300 lg:ease-[cubic-bezier(.2,.8,.2,1)] motion-reduce:transition-none",
      collapsed ? "lg:w-[72px] lg:px-2" : "lg:w-[248px]",
    )}>
      <ul className="m-0 flex list-none gap-1 overflow-x-auto p-0 lg:flex-col lg:overflow-visible">
        {steps.map((item) => {
          const on = item.key === step;
          const n = counts[item.key];
          const status = n === undefined ? null : leadsInStepStatus(item.key, n);
          const href = item.key === "review" && !on ? reviewHref ?? item.href : item.href;
          const Icon = ICONS[item.key] ?? AlignLeft;
          return (
            <li key={item.key} className="shrink-0">
              <Link
                href={href}
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
                  // Collapsed, the count rides on the icon's corner as a dot with its number in the tooltip.
                  ? <span aria-hidden="true" className="absolute top-1.5 right-2 hidden size-2.5 rounded-full bg-[var(--warning)] ring-2 ring-[var(--canvas)] lg:block" />
                  : <span className="inline-grid h-5 min-w-[22px] shrink-0 place-items-center rounded-full bg-[color-mix(in_srgb,var(--warning)_18%,transparent)] px-[7px] text-xs font-bold text-[var(--warning-ink)] tabular-nums">{badgeFigure(n)}</span>
                ) : null}
              </Link>
            </li>
          );
        })}
      </ul>
      {/* The order, said once and quietly: a guide, never a gate. */}
      <div className={cn("mt-auto hidden flex-col gap-1.5 rounded-xl bg-[color-mix(in_srgb,var(--ink)_3%,transparent)] p-3", !collapsed && "lg:flex")}>
        <span className="text-xs font-semibold text-[var(--ink)]">How a list usually moves</span>
        <span className="text-xs leading-[1.5] text-[var(--ink)]">{steps.map((item) => item.label).join(" › ")}</span>
        <span className="text-xs text-[var(--body)]">Open any page, any time.</span>
      </div>
      {/* Collapse to icons and back (owner 2026-10-30); the pages keep every number as a badge or tooltip. */}
      <button
        type="button"
        onClick={toggle}
        aria-expanded={!collapsed}
        aria-label={collapsed ? "Show the Lead flow menu" : "Collapse the Lead flow menu"}
        title={collapsed ? "Show labels" : "Collapse"}
        className={cn("mt-2 hidden size-8 shrink-0 place-items-center rounded-lg text-[var(--ink)] outline-none transition-colors hover:bg-[color-mix(in_srgb,var(--ink)_6%,transparent)] focus-visible:ring-2 focus-visible:ring-[var(--primary)] lg:grid", collapsed ? "mx-auto" : "ml-auto")}
      >
        {collapsed ? <ChevronsRight className="size-4" aria-hidden="true" /> : <ChevronsLeft className="size-4" aria-hidden="true" />}
      </button>
    </nav>
  );
}
