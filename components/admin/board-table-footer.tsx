"use client";

/**
 * The admin boards' table footer: a canvas-coloured band under the table, "Showing 1–25 of 412
 * attempts · newest first" on the left and 32px Previous / Next on the right.
 *
 * It replaces the older PaginationBar ("Page x of y") on the tables rebuilt to the boards.
 * `order` is the truthful sort description for THIS table —
 * callers must say what the query actually orders by. `approximate` prefixes the total with "about"
 * when the count is an estimate (PostgREST's estimated count on the large logs).
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
  const pages = Math.max(1, Math.ceil(total / pageSize));
  const current = Math.min(Math.max(page, 1), pages);
  const start = total === 0 ? 0 : (current - 1) * pageSize + 1;
  const end = Math.min(current * pageSize, total);
  const button =
    "inline-flex h-8 items-center rounded-[8px] border border-[var(--border-strong)] bg-[var(--surface)] px-4 text-[14px] leading-[1.43] font-semibold tracking-[-0.01em] text-[var(--ink)] hover:bg-[var(--surface-alt)] disabled:cursor-not-allowed disabled:opacity-40";

  return (
    <div className="flex flex-col gap-3 border-t border-[var(--border)] bg-[var(--canvas)] px-4 py-3 sm:flex-row sm:items-center sm:justify-between">
      <span className="text-[12px] leading-[1.5] tracking-[-0.01em] text-[var(--muted)] tabular-nums" aria-live="polite">
        Showing {start.toLocaleString()}–{end.toLocaleString()} of {approximate ? "about " : ""}
        {total.toLocaleString()} {itemLabel}
        {order ? ` · ${order}` : ""}
      </span>
      <div className="flex items-center gap-2">
        <button type="button" className={button} onClick={() => onPageChange(current - 1)} disabled={busy || current <= 1}>
          Previous
        </button>
        <button type="button" className={button} onClick={() => onPageChange(current + 1)} disabled={busy || current >= pages}>
          Next
        </button>
      </div>
    </div>
  );
}
