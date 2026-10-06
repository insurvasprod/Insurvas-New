"use client";

import { useEffect, useState, type ReactNode } from "react";

import { cn } from "@/lib/utils";

/**
 * The tab row the lead-operations pages share (lead lists, import, duplicates, assignment,
 * recycling — the 2026-10-06 redesign): views on the left, page-level actions on the right of the
 * same line, one view at a time. The same markup as the Agent Floor's and the transfer inbox's rows.
 */

export type ViewTab<K extends string> = { key: K; label: string; count?: number | null };

export function ViewTabs<K extends string>({ tabs, value, onChange, label, actions }: {
  tabs: ViewTab<K>[];
  value: K;
  onChange: (key: K) => void;
  /** Accessible name of the tab list. */
  label: string;
  /** Right-aligned on the same row: the page's actions, primary last. */
  actions?: ReactNode;
}) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-3">
      <div role="tablist" aria-label={label} className="inline-flex h-9 w-fit max-w-full gap-0.5 overflow-x-auto rounded-md bg-[var(--canvas)] p-0.5">
        {tabs.map((tab) => (
          <button
            key={tab.key}
            type="button"
            role="tab"
            aria-selected={value === tab.key}
            onClick={() => onChange(tab.key)}
            className={cn(
              "inline-flex h-8 shrink-0 items-center gap-1.5 whitespace-nowrap rounded-md border px-3 text-sm font-semibold tracking-[-0.01em]",
              value === tab.key ? "border-border bg-card text-foreground" : "border-transparent text-muted-foreground hover:text-foreground",
            )}
          >
            {tab.label}
            {tab.count != null && <span className="rounded-full bg-[var(--surface-alt)] px-1.5 text-xs tabular-nums text-muted-foreground">{tab.count.toLocaleString()}</span>}
          </button>
        ))}
      </div>
      {actions && <div className="ml-auto flex flex-wrap items-center gap-2">{actions}</div>}
    </div>
  );
}

/**
 * Tabs whose panels are rendered elsewhere — for a server component (the lead-list detail) that
 * hands its sections in as nodes and needs a client island only to switch between them.
 */
export function TabbedPanels<K extends string>({ tabs, label, actions, initial }: {
  tabs: Array<ViewTab<K> & { panel: ReactNode }>;
  label: string;
  actions?: ReactNode;
  initial?: K;
}) {
  const [value, setValue] = useState<K>((initial ?? tabs[0]?.key) as K);
  const current = tabs.find((tab) => tab.key === value) ?? tabs[0];
  return (
    <div className="flex min-w-0 flex-col gap-4">
      <ViewTabs tabs={tabs} value={current?.key ?? value} onChange={setValue} label={label} actions={actions} />
      <div role="tabpanel" aria-label={current?.label} className="min-w-0">{current?.panel}</div>
    </div>
  );
}

/**
 * Rows per page: as many as fit the window under the page's chrome, so the pager sits at the
 * bottom of the screen rather than a scroll away (the transfer inbox's hook). Recomputed on resize.
 */
export function useFittingPageSize(reserved: number, rowHeight: number, fallback = 10) {
  const [size, setSize] = useState(fallback);
  useEffect(() => {
    const fit = () => setSize(Math.min(50, Math.max(5, Math.floor((window.innerHeight - reserved) / rowHeight))));
    fit();
    window.addEventListener("resize", fit);
    return () => window.removeEventListener("resize", fit);
  }, [reserved, rowHeight]);
  return size;
}

/**
 * The TableCard classes that make a list card reach the bottom of the window: the card is a flex
 * column at least `chrome` px shorter than the viewport, and the table area takes the slack so the
 * footer (the pager) sits at the foot.
 */
export function fullHeightCard(chrome: number) {
  return cn("flex min-w-0 flex-col [&>.overflow-x-auto]:flex-1", FULL_HEIGHT[chrome] ?? FULL_HEIGHT[240]);
}

// Spelled out so Tailwind sees each class literally.
const FULL_HEIGHT: Record<number, string> = {
  160: "min-h-[calc(100dvh-var(--top-bar-h)-160px)]",
  200: "min-h-[calc(100dvh-var(--top-bar-h)-200px)]",
  240: "min-h-[calc(100dvh-var(--top-bar-h)-240px)]",
  300: "min-h-[calc(100dvh-var(--top-bar-h)-300px)]",
  340: "min-h-[calc(100dvh-var(--top-bar-h)-340px)]",
};
