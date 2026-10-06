"use client";

/**
 * View tabs and a viewport-sized pager for the Book of Business and LA-3 list pages (2026-10-06
 * redesign). The same segmented tabs the Inbound and Agent Floor pages draw, so a page with several
 * lists shows one at a time instead of stacking them, and the pager sizes itself to the screen so a
 * long list fills the card without a page-level scroll.
 */

import { useEffect, useState, type ReactNode } from "react";

import { cn } from "@/lib/utils";

/** Rows that fit the viewport once `reserved` pixels of chrome are taken, between 5 and 50. */
export function useFittingPageSize(reserved: number, rowHeight: number) {
  const [size, setSize] = useState(10);
  useEffect(() => {
    const fit = () => setSize(Math.min(50, Math.max(5, Math.floor((window.innerHeight - reserved) / rowHeight))));
    fit();
    window.addEventListener("resize", fit);
    return () => window.removeEventListener("resize", fit);
  }, [reserved, rowHeight]);
  return size;
}

export type ViewTab<K extends string> = { key: K; label: string; count?: number };

/** Segmented tabs, 36px, left of a row whose right side holds the page's actions. */
export function ViewTabs<K extends string>({ label, tabs, value, onChange, idPrefix }: {
  label: string;
  tabs: readonly ViewTab<K>[];
  value: K;
  onChange: (key: K) => void;
  /** Gives each tab an id (`${idPrefix}-${key}`) for a tabpanel's aria-labelledby. */
  idPrefix?: string;
}) {
  return (
    <div role="tablist" aria-label={label} className="inline-flex h-9 w-fit max-w-full gap-0.5 overflow-x-auto rounded-md bg-[var(--canvas)] p-0.5">
      {tabs.map((tab) => (
        <button
          key={tab.key}
          id={idPrefix ? `${idPrefix}-${tab.key}` : undefined}
          type="button"
          role="tab"
          aria-selected={value === tab.key}
          onClick={() => onChange(tab.key)}
          className={cn(
            "inline-flex h-8 shrink-0 items-center gap-1.5 rounded-md border px-3 text-sm font-semibold tracking-[-0.01em] whitespace-nowrap outline-none focus-visible:ring-2 focus-visible:ring-ring",
            value === tab.key ? "border-border bg-card text-foreground" : "border-transparent text-muted-foreground hover:text-foreground",
          )}
        >
          {tab.label}
          {tab.count !== undefined && <span className="rounded-full bg-[var(--surface-alt)] px-1.5 text-xs tabular-nums text-muted-foreground">{tab.count.toLocaleString("en-US")}</span>}
        </button>
      ))}
    </div>
  );
}

/**
 * Sections a server page renders, shown one at a time behind ViewTabs. The content arrives already
 * rendered; only which one is visible is state here.
 */
export function TabbedSections<K extends string>({ label, sections, actions, initial }: {
  label: string;
  sections: readonly (ViewTab<K> & { content: ReactNode })[];
  actions?: ReactNode;
  initial?: K;
}) {
  const [active, setActive] = useState<K | undefined>(initial ?? sections[0]?.key);
  const current = sections.find((section) => section.key === active) ?? sections[0];
  if (!current) return null;
  return (
    <>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <ViewTabs label={label} tabs={sections} value={current.key} onChange={setActive} idPrefix="book-view" />
        {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
      </div>
      <div role="tabpanel" aria-labelledby={`book-view-${current.key}`}>{current.content}</div>
    </>
  );
}
