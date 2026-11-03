"use client";

import { Pager } from "@/components/ui/pager";

/**
 * The admin boards' table footer: a canvas-coloured band under the table with the one shared pager
 * (components/ui/pager.tsx) — "Showing 1–25 of 412 attempts · newest first" on the left, the page
 * numbers on the right — so the console pages exactly as the agent app does (2026-10-13).
 *
 * `order` is the truthful sort description for THIS table: callers must say what the query actually
 * orders by. `approximate` prefixes the total with "about" when the count is an estimate
 * (PostgREST's estimated count on the large logs).
 */
export function BoardTableFooter({
  page,
  pageSize,
  total,
  itemLabel,
  order,
  approximate = false,
  onPageChange,
  busy = false,
}: {
  page: number;
  pageSize: number;
  total: number;
  itemLabel: string;
  order?: string;
  approximate?: boolean;
  onPageChange: (page: number) => void;
  busy?: boolean;
}) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-3 border-t border-border bg-[var(--canvas)] px-4 py-2.5 text-xs text-muted-foreground">
      <Pager page={page} pageSize={pageSize} total={total} noun={itemLabel} suffix={order} approximate={approximate} onPage={onPageChange} disabled={busy} />
    </div>
  );
}
