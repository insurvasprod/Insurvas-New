"use client";

import Link from "next/link";
import { useEffect, useLayoutEffect, useRef, useState } from "react";

import { leadsInStepStatus, type LeadsInStep } from "@/lib/leadSources/steps";
import { IMPORT_CSV_KEY } from "@/lib/agentTemplates/importReviewModel";
import { cn } from "@/lib/utils";

type RailStep = { key: LeadsInStep; label: string; sub: string; href: string };

const LAST_STEP = "insurvas.leadsIn.lastStep";

/**
 * The one Leads page's rail (owner pick B, 2026-10-28). It stands the column's full height, every step
 * sharing the space, like the application's rail. Moving between steps animates the way the application
 * does: the pill slides from the step you left to the one you opened, and the line fills green up to it
 * (each step is its own address, so the step you left is remembered for the moment of the move).
 *
 * Under each step, its live count once /api/app/lead-sources/steps answers (its plain line until then,
 * or if a read fails); counts that want a person are amber.
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

export function LeadsInRail({ steps, step }: { steps: RailStep[]; step: LeadsInStep }) {
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

  const here = steps.findIndex((item) => item.key === step);
  const listRef = useRef<HTMLOListElement>(null);
  const links = useRef<Array<HTMLAnchorElement | null>>([]);
  const [pill, setPill] = useState<{ top: number; left: number; width: number; height: number; slide: boolean } | null>(null);
  const [filled, setFilled] = useState(here);

  // Start where the last step left off, then slide to this one on the next frame.
  useLayoutEffect(() => {
    let from = here;
    try {
      const last = sessionStorage.getItem(LAST_STEP);
      const index = steps.findIndex((item) => item.key === last);
      if (index >= 0) from = index;
      sessionStorage.setItem(LAST_STEP, step);
    } catch { /* private window: no slide, nothing else lost */ }
    const place = (index: number, slide: boolean) => {
      const link = links.current[index];
      if (link) setPill({ top: link.offsetTop, left: link.offsetLeft, width: link.offsetWidth, height: link.offsetHeight, slide });
    };
    let second = 0;
    const first = requestAnimationFrame(() => {
      place(from, false);
      setFilled(from);
      second = requestAnimationFrame(() => { place(here, true); setFilled(here); });
    });
    const list = listRef.current;
    const observer = list && typeof ResizeObserver !== "undefined" ? new ResizeObserver(() => place(here, false)) : null;
    if (list) observer?.observe(list);
    return () => { cancelAnimationFrame(first); cancelAnimationFrame(second); observer?.disconnect(); };
  }, [here, step, steps]);

  const seg = (green: boolean) => (
    <span aria-hidden="true" className={cn("hidden w-[3px] flex-1 rounded-full transition-colors duration-700 lg:block", green ? "bg-[var(--primary)] shadow-[0_0_8px_color-mix(in_srgb,var(--primary)_45%,transparent)]" : "bg-[color-mix(in_srgb,var(--ink)_12%,transparent)]")} />
  );

  return (
    <nav aria-label="Lead source steps" className="m-glass rounded-xl border border-[var(--border)] p-3 lg:flex lg:h-full lg:min-h-0 lg:flex-col">
      <ol ref={listRef} className="relative m-0 flex list-none gap-1 overflow-x-auto p-0 lg:flex-1 lg:flex-col lg:gap-0 lg:overflow-visible">
        {pill && (
          <span
            aria-hidden="true"
            className={cn("pointer-events-none absolute rounded-full bg-[var(--primary-soft)] ring-1 ring-[color-mix(in_srgb,var(--primary)_45%,transparent)]", pill.slide && "transition-[top,left,width,height] duration-500 ease-[cubic-bezier(.2,.8,.2,1)] motion-reduce:transition-none")}
            style={{ top: pill.top, left: pill.left, width: pill.width, height: pill.height }}
          />
        )}
        {steps.map((item, i) => {
          const on = item.key === step;
          const n = counts[item.key];
          const status = n === undefined ? null : leadsInStepStatus(item.key, n);
          const href = item.key === "review" && !on ? reviewHref ?? item.href : item.href;
          const lit = i <= filled;
          return (
            <li key={item.key} className="flex shrink-0 flex-col lg:min-h-[64px] lg:flex-1 lg:shrink">
              <span className="hidden h-2 flex-col pl-[25px] lg:flex">{i > 0 ? seg(i <= filled) : <span className="flex-1" />}</span>
              <Link
                ref={(element) => { links.current[i] = element; }}
                href={href}
                aria-current={on ? "step" : undefined}
                className="group relative z-10 flex items-center gap-3 rounded-full px-2.5 py-2 outline-none transition-colors focus-visible:ring-2 focus-visible:ring-[var(--primary)]"
              >
                <span aria-hidden="true" className={cn(
                  "inline-grid size-[30px] shrink-0 place-items-center rounded-full border-2 text-xs font-bold transition-all duration-500",
                  on ? "border-[var(--primary)] bg-[var(--primary)] text-[var(--on-primary)] shadow-[0_0_14px_color-mix(in_srgb,var(--primary)_55%,transparent)]"
                    : lit ? "border-[var(--primary)] bg-[var(--surface)] text-[var(--ink)]"
                    : "border-[var(--border-strong)] bg-[var(--surface)] text-[var(--ink)] group-hover:border-[var(--primary)]",
                )}>{i + 1}</span>
                <span className="min-w-0 pr-2">
                  <span className={cn("block text-sm text-[var(--ink)]", on ? "font-semibold" : "font-medium")}>{item.label}</span>
                  <span className={cn("block truncate text-xs transition-colors", status?.needsYou ? "font-medium text-[var(--warning-ink)]" : "text-[var(--body)]")}>{status?.text ?? item.sub}</span>
                </span>
              </Link>
              <span className="hidden flex-1 flex-col pl-[25px] lg:flex">{i < steps.length - 1 ? seg(i < filled) : <span className="flex-1" />}</span>
            </li>
          );
        })}
      </ol>
    </nav>
  );
}
