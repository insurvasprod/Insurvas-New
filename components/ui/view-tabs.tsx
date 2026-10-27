import type { ReactNode } from "react";
import Link from "next/link";

import { cn } from "@/lib/utils";

import { TabTrack } from "./tab-track";

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
    <span className={cn("rounded-full px-1.5 text-xs tabular-nums", tone === "danger" && value > 0 ? "bg-[var(--error-surface)] text-[var(--error-ink)]" : "bg-[var(--surface-alt)] text-muted-foreground")}>
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
  vertical = false,
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
  /** The id of the panel the tabs switch, when there is one. */
  controls?: string;
  /** Vertical navigation style, used when the Settings shell places these tabs in its left rail. */
  vertical?: boolean;
}) {
  const list = (
    <TabTrack
      role="tablist"
      aria-label={label}
      aria-orientation={vertical ? "vertical" : undefined}
      className={vertical ? "flex h-auto w-full flex-col items-stretch gap-0.5 overflow-visible rounded-md bg-transparent p-0" : TRACK}
    >
      {tabs.map((tab) => {
        const selected = tab.key === value;
        const body = <>{tab.label}<Count value={tab.count} tone={tab.tone} /></>;
        const id = idPrefix ? `${idPrefix}-${tab.key}` : controls ? `${controls}-tab-${tab.key}` : undefined;
        return tab.href ? (
          <Link key={tab.key} id={id} href={tab.href} role="tab" aria-selected={selected} aria-controls={controls} scroll={false} className={item(selected, vertical ? "w-full justify-start px-2.5" : "px-3")}>{body}</Link>
        ) : (
          <button key={tab.key} id={id} type="button" role="tab" aria-selected={selected} aria-controls={controls} onClick={() => onChange?.(tab.key)} className={item(selected, vertical ? "w-full justify-start px-2.5" : "px-3")}>{body}</button>
        );
      })}
    </TabTrack>
  );
  if (!actions) return list;
  return (
    <div className="flex flex-wrap items-center justify-between gap-3">
      {list}
      <div className="ml-auto flex flex-wrap items-center gap-2">{actions}</div>
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
          {option.label}
          <Count value={option.count} tone={option.tone} />
        </button>
      ))}
    </TabTrack>
  );
}
