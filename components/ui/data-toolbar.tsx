import type { ComponentProps, ReactNode } from "react";
import { ChevronDown, RotateCw, Search, SlidersHorizontal, X } from "lucide-react";

import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

/**
 * The one toolbar every list uses (2026-09-28 review: "filters somewhere, the search bar somewhere
 * else — nothing is consistent"). It goes in <TableCard toolbar={…}> and always reads the same way:
 *
 *   [ search ] [ filters … ]                                        [ actions … ] [ Refresh ]
 *
 * Search first and a fixed width, so it is in the same place on every screen and leaves room for
 * the filters beside it; filters next; anything that acts on the list on the right. Every control is
 * 36px high — the Button default — so a select, a date, a search box and a button line up.
 */

/** The class for a native control (select, date, number) sitting in a toolbar: the same 36px box as the search. */
export const toolbarControl =
  "h-9 rounded-md border border-input bg-background px-3 text-sm text-foreground outline-none transition-colors focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring/30 disabled:opacity-50";

export function DataToolbar({
  children,
  actions,
  className,
}: {
  /** Search first, then filters. */
  children?: ReactNode;
  /** Right-aligned: exports, bulk actions, then <RefreshButton /> last. */
  actions?: ReactNode;
  className?: string;
}) {
  return (
    <div className={cn("flex w-full flex-wrap items-center gap-2", className)}>
      {children && <div className="flex min-w-0 flex-1 flex-wrap items-center gap-2">{children}</div>}
      {actions && <div className="ml-auto flex flex-wrap items-center gap-2">{actions}</div>}
    </div>
  );
}

/** The toolbar's search box: first in the row, the same width on every list. */
export function ToolbarSearch({
  value,
  onChange,
  placeholder = "Search",
  label,
  className,
}: {
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  /** Accessible name; defaults to the placeholder. */
  label?: string;
  className?: string;
}) {
  return (
    <label className={cn("relative block w-full sm:w-64", className)}>
      <span className="sr-only">{label ?? placeholder}</span>
      <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" aria-hidden="true" />
      <input
        type="search"
        value={value}
        onChange={(event) => onChange(event.target.value)}
        placeholder={placeholder}
        className={cn(toolbarControl, "w-full pl-9")}
      />
    </label>
  );
}

/**
 * Opens a filter panel. `count` is how many filters are on, shown as a filled badge; the chevron
 * flips while the panel is open. Pass the panel's id as `controls` when it is a `<FilterPanel>`.
 * Other Button props (and the ref) pass through, so it also works as a `<DropdownMenuTrigger asChild>`
 * child on the lists that have not moved to the inline panel yet.
 */
export function FilterButton({
  open,
  count = 0,
  controls,
  children = "Filters",
  onClick,
  ...props
}: { open?: boolean; count?: number; controls?: string } & Omit<ComponentProps<typeof Button>, "variant">) {
  return (
    <Button type="button" variant="outline" aria-expanded={open} aria-controls={controls} onClick={onClick} {...props}>
      <SlidersHorizontal aria-hidden="true" />
      {children}
      {count > 0 && (
        <span className="inline-flex min-w-5 items-center justify-center rounded-full bg-primary px-1.5 text-xs font-semibold tabular-nums text-primary-foreground">
          {count}
          <span className="sr-only"> applied</span>
        </span>
      )}
      <ChevronDown className={cn("transition-transform", open && "rotate-180")} aria-hidden="true" />
    </Button>
  );
}

/**
 * The filters, opened inline under the toolbar (UI-CONSISTENCY §6a, the INSURVAS-CRM DataGrid
 * pattern): a grid of labelled fields that pushes the table down, never a dropdown over it. It goes
 * in `<TableCard filters={…}>` and renders only while `open`. Give it the `id` the FilterButton's
 * `controls` names.
 */
export function FilterPanel({ id, open, children, className }: { id: string; open: boolean; children: ReactNode; className?: string }) {
  if (!open) return null;
  return (
    <div
      id={id}
      role="region"
      aria-label="Filters"
      className={cn("grid grid-cols-[repeat(auto-fit,minmax(190px,1fr))] gap-x-4 gap-y-3 border-b border-border px-4 py-4", className)}
    >
      {children}
    </div>
  );
}

export type ActiveFilter = { key: string; label: string; value: string; onRemove: () => void };

/**
 * What is filtering the list right now, as removable chips ("Status: In force ×") and a "Clear
 * filters" link. It stays visible while the panel is closed, so a filtered list never looks like the
 * whole list. Renders nothing when no filter is on.
 */
export function ActiveFilters({ filters, onClear, className }: { filters: ActiveFilter[]; onClear: () => void; className?: string }) {
  if (filters.length === 0) return null;
  return (
    <div className={cn("flex flex-wrap items-center gap-1.5 border-b border-border px-4 py-2 text-sm", className)}>
      <span className="mr-1 text-xs font-medium text-muted-foreground">Active filters</span>
      {filters.map((filter) => (
        <span key={filter.key} className="inline-flex h-7 items-center gap-1.5 rounded-md border border-border bg-card pl-2.5 pr-1 text-xs">
          <span className="text-muted-foreground">{filter.label}:</span>
          <span className="font-medium text-foreground">{filter.value}</span>
          <button
            type="button"
            onClick={filter.onRemove}
            aria-label={`Remove ${filter.label}: ${filter.value}`}
            className="grid size-5 place-items-center rounded text-muted-foreground outline-none hover:bg-[var(--surface-alt)] hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring"
          >
            <X className="size-3.5" aria-hidden="true" />
          </button>
        </span>
      ))}
      <button
        type="button"
        onClick={onClear}
        className="ml-1 rounded text-xs font-medium text-foreground underline underline-offset-[3px] outline-none hover:text-[var(--accent-ink)] focus-visible:ring-2 focus-visible:ring-ring"
      >
        Clear filters
      </button>
    </div>
  );
}

/**
 * Turns every filter and the search off. Shown only while something is filtering, just before
 * Refresh, and drawn like Refresh so the two read as a pair rather than a loose word beside a button.
 */
export function ClearFiltersButton({ onClick, label = "Clear" }: { onClick: () => void; label?: string }) {
  return (
    <Button type="button" variant="outline" onClick={onClick} aria-label="Clear all filters and the search">
      <X aria-hidden="true" />
      {label}
    </Button>
  );
}

/**
 * An option that changes what the action beside it does ("also the lines I left unmatched"), as one
 * 36px row so it lines up with the toolbar's buttons. It sits just before the button it qualifies.
 */
export function ToolbarCheckbox({ checked, onChange, label, disabled = false, title }: {
  checked: boolean;
  onChange: (next: boolean) => void;
  label: ReactNode;
  disabled?: boolean;
  title?: string;
}) {
  return (
    <label title={title} className={cn("inline-flex h-9 cursor-pointer items-center gap-2 rounded-md px-1 text-sm text-foreground select-none", disabled && "cursor-not-allowed opacity-50")}>
      <input type="checkbox" className="size-4 accent-[var(--primary)]" checked={checked} disabled={disabled} onChange={(event) => onChange(event.target.checked)} />
      {label}
    </label>
  );
}

/** Reloads the list. Last in the actions; spins while the reload is in flight. */
export function RefreshButton({ onClick, refreshing = false, label = "Refresh" }: { onClick: () => void; refreshing?: boolean; label?: string }) {
  return (
    <Button type="button" variant="outline" onClick={onClick} disabled={refreshing} aria-busy={refreshing}>
      <RotateCw className={cn(refreshing && "animate-spin")} aria-hidden="true" />
      {label}
    </Button>
  );
}
