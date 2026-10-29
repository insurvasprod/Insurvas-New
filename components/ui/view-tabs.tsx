import type { KeyboardEvent, ReactNode } from "react";
import Link from "next/link";

import { cn } from "@/lib/utils";

import { TabTrack } from "./tab-track";
import { titleCaseNode } from "@/components/ui/title-case";

/**
 * A page's views, as segmented tabs on the row under its header: one view at a time instead of
 * stacked tables (the 2026-10-06 redesign), with the page's actions on the right of the same row.
 *
 * One component (2026-10-09). The redesign had grown four copies of this markup that were drifting
 * apart — a missing focus ring here, a count that could not go red there.
 *
 * A tab is a button (the page keeps the view in state) or, on a server page, a link (`href`). No
 * hooks, so a server component can draw link tabs; `TabbedPanels` (view-tabs-panels.tsx) is the
 * client island for server pages that hand in rendered sections.
 */
export type ViewTab<K extends string> = {
  key: K;
  label: string;
  /** A small count after the label; omitted when null or undefined. */
  count?: number | null;
  /** "danger" colours a non-zero count, for a tab that holds something to act on. */
  tone?: "danger";
  /** Server pages: the tab is a link to this URL instead of a button. */
  href?: string;
  /** UnderlineTabs only: drawn before the label, e.g. a step's number or a done tick. */
  marker?: ReactNode;
  /** UnderlineTabs only: read after the label by screen readers, e.g. "(done)". */
  srSuffix?: string;
};

const TRACK = "inline-flex h-9 w-fit max-w-full gap-0.5 overflow-x-auto rounded-md bg-[var(--canvas)] p-0.5";

const item = (selected: boolean, padding = "px-3") =>
  cn(
    "inline-flex h-8 shrink-0 items-center gap-1.5 whitespace-nowrap rounded-md border text-sm font-semibold tracking-[-0.01em] outline-none transition-colors duration-150 focus-visible:ring-2 focus-visible:ring-ring",
    padding,
    selected ? "border-border bg-card text-foreground shadow-[0_1px_2px_rgba(16,20,26,.06)]" : "border-transparent text-muted-foreground hover:text-foreground",
  );

function Count({ value, tone }: { value: number | null | undefined; tone?: "danger" }) {
  if (value == null) return null;
  return (
    <span className={cn("rounded-badge px-1.5 text-xs tabular-nums", tone === "danger" && value > 0 ? "bg-[var(--error-surface)] text-[var(--error-ink)]" : "bg-[var(--surface-alt)] text-muted-foreground")}>
      {value.toLocaleString("en-US")}
    </span>
  );
}

export function ViewTabs<K extends string>({
  label,
  tabs,
  value,
  onChange,
  actions,
  idPrefix,
  controls,
}: {
  /** Accessible name of the tab list. */
  label: string;
  tabs: ReadonlyArray<ViewTab<K>>;
  value: K;
  onChange?: (key: K) => void;
  /** Right-aligned on the same row: the page's actions, primary last. Without it, just the tabs. */
  actions?: ReactNode;
  /** Gives each tab an id (`${idPrefix}-${key}`) for a tabpanel's aria-labelledby. */
  idPrefix?: string;
  /** The id of the panel the tabs switch, when there is one; a function when each tab has its own panel. */
  controls?: string | ((key: K) => string);
}) {
  const list = (
    <TabTrack role="tablist" aria-label={label} className={TRACK} data-page-lead={actions ? undefined : ""}>
      {tabs.map((tab) => {
        const selected = tab.key === value;
        const body = <>{titleCaseNode(tab.label)}<Count value={tab.count} tone={tab.tone} /></>;
        const panel = typeof controls === "function" ? controls(tab.key) : controls;
        const id = idPrefix ? `${idPrefix}-${tab.key}` : panel ? `${panel}-tab-${tab.key}` : undefined;
        return tab.href ? (
          <Link key={tab.key} id={id} href={tab.href} role="tab" aria-selected={selected} aria-controls={panel} scroll={false} className={item(selected)}>{body}</Link>
        ) : (
          <button key={tab.key} id={id} type="button" role="tab" aria-selected={selected} aria-controls={panel} onClick={() => onChange?.(tab.key)} className={item(selected)}>{body}</button>
        );
      })}
    </TabTrack>
  );
  if (!actions) return list;
  return (
    // data-page-lead: right after a PageHeader, the page's actions join this row (page-header.tsx).
    <div data-page-lead className="flex flex-wrap items-center justify-between gap-3">
      {list}
      <div className="ml-auto flex flex-wrap items-center gap-2">{actions}</div>
    </div>
  );
}

/**
 * The sections of one record (foundation v3, 2026-10-27): underline tabs, for a lead's or a case's
 * parts and a sheet's sections, where segmented tabs would read as page views. A 2px brand line
 * under the chosen one, 13/500 labels, an optional count. The row draws its own bottom rule.
 *
 * The tab pattern's keys: the chosen tab is the one stop in the Tab order, and the arrow keys
 * (Home and End too) move to and choose another.
 */
export function UnderlineTabs<K extends string>({
  label,
  tabs,
  value,
  onChange,
  idPrefix,
  controls,
  className,
}: {
  label: string;
  tabs: ReadonlyArray<ViewTab<K>>;
  value: K;
  onChange: (key: K) => void;
  idPrefix?: string;
  /** The panel the tabs switch; a function when each tab has its own panel. */
  controls?: string | ((key: K) => string);
  /** Layout only (margins, padding). */
  className?: string;
}) {
  const move = (event: KeyboardEvent<HTMLButtonElement>, from: number) => {
    const to = event.key === "ArrowRight" ? (from + 1) % tabs.length
      : event.key === "ArrowLeft" ? (from - 1 + tabs.length) % tabs.length
        : event.key === "Home" ? 0
          : event.key === "End" ? tabs.length - 1
            : -1;
    if (to < 0) return;
    event.preventDefault();
    onChange(tabs[to].key);
    const row = event.currentTarget.parentElement;
    (row?.children[to] as HTMLElement | undefined)?.focus();
  };
  return (
    <div role="tablist" aria-label={label} data-page-lead className={cn("flex max-w-full gap-4 overflow-x-auto overflow-y-hidden border-b border-border", className)}>
      {tabs.map((tab, index) => {
        const selected = tab.key === value;
        return (
          <button
            key={tab.key}
            type="button"
            onClick={() => onChange(tab.key)}
            onKeyDown={(event) => move(event, index)}
            id={idPrefix ? `${idPrefix}-${tab.key}` : undefined}
            role="tab"
            aria-selected={selected}
            aria-controls={typeof controls === "function" ? controls(tab.key) : controls}
            tabIndex={selected ? 0 : -1}
            className={cn(
              "-mb-px inline-flex h-10 shrink-0 items-center gap-1.5 whitespace-nowrap border-b-2 px-1 text-label outline-none transition-colors focus-visible:ring-2 focus-visible:ring-ring",
              selected ? "border-[var(--primary)] text-foreground" : "border-transparent text-muted-foreground hover:text-foreground",
            )}
          >
            {tab.marker}
            {titleCaseNode(tab.label)}
            {tab.srSuffix && <span className="sr-only"> {tab.srSuffix}</span>}
            <Count value={tab.count} tone={tab.tone} />
          </button>
        );
      })}
    </div>
  );
}

/** The segmented control inside a toolbar (a filter, not a page view): the same look, pressed buttons. */
export function Segmented<K extends string>({
  label,
  options,
  value,
  onChange,
}: {
  label: string;
  options: ReadonlyArray<{ key: K; label: string; count?: number | null; tone?: "danger" }>;
  value: K;
  onChange: (key: K) => void;
}) {
  return (
    <TabTrack role="group" aria-label={label} className={cn(TRACK, "w-auto")}>
      {options.map((option) => (
        <button key={option.key} type="button" aria-pressed={value === option.key} onClick={() => onChange(option.key)} className={item(value === option.key, "px-2.5")}>
          {titleCaseNode(option.label)}
          <Count value={option.count} tone={option.tone} />
        </button>
      ))}
    </TabTrack>
  );
}
