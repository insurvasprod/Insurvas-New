import type { ComponentProps, ReactNode } from "react";
import { RotateCw, Search, SlidersHorizontal } from "lucide-react";

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
 * Opens a filter panel. `count` is how many filters are on, shown as a small badge. Other Button props
 * (and the ref) pass through, so it also works as a `<DropdownMenuTrigger asChild>` child.
 */
export function FilterButton({
  open,
  count = 0,
  children = "Filters",
  onClick,
  ...props
}: { open?: boolean; count?: number } & Omit<ComponentProps<typeof Button>, "variant">) {
  return (
    <Button type="button" variant="outline" aria-expanded={open} onClick={onClick} {...props}>
      <SlidersHorizontal aria-hidden="true" />
      {children}
      {count > 0 && (
        <span className="inline-flex min-w-5 items-center justify-center rounded-full bg-muted px-1.5 text-xs tabular-nums text-foreground">{count}</span>
      )}
    </Button>
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
