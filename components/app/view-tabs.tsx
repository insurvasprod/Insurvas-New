import Link from "next/link";

import { cn } from "@/lib/utils";

/**
 * The views of one page, as tabs on the row under its header (2026-10-06 redesign): one view at a
 * time instead of stacked tables, drawn the way the Inbound and Agent floor tabs are. A tab is a
 * button (the page keeps the view in state) or, on a server-rendered page, a link (`href`).
 *
 * No hooks here, so a server page can draw link tabs with it.
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

export function ViewTabs<K extends string>({
  label,
  tabs,
  value,
  onChange,
}: {
  label: string;
  tabs: ReadonlyArray<ViewTab<K>>;
  value: K;
  onChange?: (key: K) => void;
}) {
  return (
    <div role="tablist" aria-label={label} className="inline-flex h-9 w-fit max-w-full gap-0.5 overflow-x-auto rounded-md bg-[var(--canvas)] p-0.5">
      {tabs.map((tab) => {
        const active = tab.key === value;
        const className = cn(
          "inline-flex h-8 shrink-0 items-center gap-1.5 whitespace-nowrap rounded-md border px-3 text-sm font-semibold tracking-[-0.01em]",
          active ? "border-border bg-card text-foreground" : "border-transparent text-muted-foreground hover:text-foreground",
        );
        const body = (
          <>
            {tab.label}
            {tab.count != null && (
              <span className={cn("rounded-full px-1.5 text-xs tabular-nums", tab.tone === "danger" && tab.count > 0 ? "bg-[var(--error-surface)] text-[var(--error-ink)]" : "bg-[var(--surface-alt)] text-muted-foreground")}>
                {tab.count.toLocaleString()}
              </span>
            )}
          </>
        );
        return tab.href ? (
          <Link key={tab.key} href={tab.href} role="tab" aria-selected={active} scroll={false} className={className}>{body}</Link>
        ) : (
          <button key={tab.key} type="button" role="tab" aria-selected={active} onClick={() => onChange?.(tab.key)} className={className}>{body}</button>
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
    <span role="group" aria-label={label} className="inline-flex h-9 max-w-full gap-0.5 overflow-x-auto rounded-md bg-[var(--canvas)] p-0.5">
      {options.map((option) => (
        <button
          key={option.key}
          type="button"
          aria-pressed={value === option.key}
          onClick={() => onChange(option.key)}
          className={cn(
            "inline-flex h-8 shrink-0 items-center gap-1.5 whitespace-nowrap rounded-md border px-2.5 text-sm font-semibold tracking-[-0.01em]",
            value === option.key ? "border-border bg-card text-foreground" : "border-transparent text-muted-foreground hover:text-foreground",
          )}
        >
          {option.label}
          {option.count != null && (
            <span className={cn("rounded-full px-1.5 text-xs tabular-nums", option.tone === "danger" && option.count > 0 ? "bg-[var(--error-surface)] text-[var(--error-ink)]" : "bg-[var(--surface-alt)] text-muted-foreground")}>
              {option.count.toLocaleString()}
            </span>
          )}
        </button>
      ))}
    </span>
  );
}
