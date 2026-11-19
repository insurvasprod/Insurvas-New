"use client";

import { useEffect, useRef, useState } from "react";
import { AlignLeft, ChevronsLeft, ChevronsRight, Download, GitBranch, RotateCw, SquareCheck, Trash, type LucideIcon } from "lucide-react";

import { RAIL_COOKIE, leadsInStepStatus, type LeadsInStep } from "@/lib/leadSources/steps";
import { IMPORT_CSV_KEY } from "@/lib/agentTemplates/importReviewModel";
import { cn } from "@/lib/utils";
import { CountBadge } from "@/components/ui/count-badge";
import { IntentLink } from "@/components/ui/nav-pending";
import { rememberLeadsIn } from "@/components/app/step-frame/frame-memory";
import { RailCornerDot, RailHighlight, useRailGlide } from "@/components/app/step-frame/rail-glide";
import { readResource } from "@/lib/client/resource-cache";

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

/**
 * The last counts this tab saw: a client move draws the next step's menu with them, so its badges are there at once
 * and roll, rather than popping in on every step. Empty while a fresh document hydrates, as the server's HTML is.
 */
let lastCounts: Partial<Record<LeadsInStep, number>> = {};

export function LeadsInRail({ steps, step, initialCollapsed = false }: { steps: RailStep[]; step: LeadsInStep; initialCollapsed?: boolean }) {
  const [collapsed, setCollapsed] = useState(initialCollapsed);
  const toggle = () => {
    const next = !collapsed;
    setCollapsed(next);
    try { document.cookie = `${RAIL_COOKIE}=${next ? "collapsed" : "open"}; path=/; max-age=31536000; SameSite=Lax`; } catch { /* still toggles for this visit */ }
  };
  // Remembered for the shell's loading state, which redraws this title and menu while the next step loads (frame-memory.ts).
  useEffect(() => { rememberLeadsIn({ steps, collapsed }); }, [steps, collapsed]);
  const [counts, setCounts] = useState<Partial<Record<LeadsInStep, number>>>(() => (typeof window === "undefined" ? {} : lastCounts));
  // The open step's highlight glides from step to step (rail-glide.tsx).
  const list = useRef<HTMLUListElement | null>(null);
  const pill = useRailGlide(list, "Lead flow");
  const [reviewHref, setReviewHref] = useState<string | null>(null);
  useEffect(() => {
    const controller = new AbortController();
    // Through the app's cache (speed pass 2026-11-09): moving between steps reuses an answer up to 20s old.
    readResource<{ counts?: Partial<Record<LeadsInStep, number>>; reviewHref?: string | null }>("/api/app/lead-sources/steps", { freshFor: 20_000 })
      .catch(() => null)
      .then(async (body: { counts?: Partial<Record<LeadsInStep, number>>; reviewHref?: string | null } | null) => {
        const here = await stillStaged(stagedHere(), controller.signal);
        const newest = body?.reviewHref?.split("/").pop() ?? null;
        const open = newest && here.includes(newest) ? newest : here[here.length - 1] ?? null;
        if (body?.counts) { lastCounts = { ...body.counts, review: here.length }; setCounts(lastCounts); }
        setReviewHref(open ? `/app/import/review/${open}` : null);
      })
      .catch(() => {});
    return () => controller.abort();
  }, [step]);

  return (
    <nav aria-label="Lead flow" data-collapsed={collapsed ? "" : undefined} className={cn(
      "m-glass rounded-xl border border-[var(--border)] p-3 lg:flex lg:h-full lg:min-h-0 lg:flex-col lg:transition-[width] lg:duration-[var(--t-panel)] lg:ease-[var(--e-out)]",
      collapsed ? "lg:w-[72px] lg:px-2" : "lg:w-[248px]",
    )}>
      <ul ref={list} data-rail-track="" className="relative isolate m-0 flex list-none gap-1 overflow-x-auto p-0 [scrollbar-width:none]! lg:flex-col lg:overflow-visible [&::-webkit-scrollbar]:hidden">
        <RailHighlight pill={pill} />
        {steps.map((item, index) => {
          const on = item.key === step;
          // Down the menu slides forward, up it slides back (§ Motion).
          const here = steps.findIndex((s) => s.key === step);
          const n = counts[item.key];
          const status = n === undefined ? null : leadsInStepStatus(item.key, n);
          const href = item.key === "review" && !on ? reviewHref ?? item.href : item.href;
          const Icon = ICONS[item.key] ?? AlignLeft;
          return (
            <li key={item.key} className="shrink-0">
              <IntentLink
                href={href}
                transitionTypes={on ? undefined : [here >= 0 && index < here ? "nav-back" : "nav-forward"]}
                aria-current={on ? "page" : undefined}
                title={collapsed ? `${item.label} · ${status?.text ?? item.sub}` : undefined}
                className={cn(
                  "group relative flex items-center gap-3 rounded-xl outline-none",
                  collapsed ? "justify-center px-1 py-2" : "px-3 py-2.5",
                  " transition-colors duration-[var(--t-panel)] ease-[var(--e)] focus-visible:ring-2 focus-visible:ring-[var(--primary)]",
                  // The open step's ground is the gliding pill once it is measured; until then (the first paint) its own.
                  on ? !pill && "bg-[var(--primary-soft)] ring-1 ring-inset ring-[color-mix(in_srgb,var(--primary)_50%,transparent)]" : "hover:bg-[color-mix(in_srgb,var(--ink)_5%,transparent)]",
                )}
              >
                <span aria-hidden="true" className={cn(
                  "inline-grid size-[34px] shrink-0 place-items-center rounded-[10px] transition-colors duration-[var(--t-panel)] ease-[var(--e)]",
                  on ? "bg-[var(--primary)] text-[var(--on-primary)]" : "bg-[color-mix(in_srgb,var(--ink)_6%,transparent)] text-[var(--ink)]",
                )}><Icon className="size-[18px]" strokeWidth={1.8} /></span>
                <span className={cn("min-w-0 flex-1", collapsed && "lg:sr-only")}>
                  <span className="block text-sm font-semibold text-[var(--ink)]">{item.label}</span>
                </span>
                {collapsed
                  // Collapsed, the count rides on the icon's corner as a dot with its number in the tooltip.
                  ? <RailCornerDot on={Boolean(status?.needsYou && n)} />
                  // The count rolls when it changes, pops in when it appears and shrinks away at 0 (CountBadge); 12,805
                  // reads 12.8k so the badge stays one short pill.
                  : <CountBadge value={status?.needsYou && n ? n : 0} tone="warning" compact className="shrink-0" />}
              </IntentLink>
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
        className={cn("mt-2 hidden size-8 shrink-0 place-items-center rounded-lg text-[var(--ink)] outline-none transition-colors duration-[var(--t-micro)] ease-[var(--e)] hover:bg-[color-mix(in_srgb,var(--ink)_6%,transparent)] focus-visible:ring-2 focus-visible:ring-[var(--primary)] lg:grid", collapsed ? "mx-auto" : "ml-auto")}
      >
        {collapsed ? <ChevronsRight className="size-4" aria-hidden="true" /> : <ChevronsLeft className="size-4" aria-hidden="true" />}
      </button>
    </nav>
  );
}
