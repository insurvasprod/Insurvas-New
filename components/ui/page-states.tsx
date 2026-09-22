import type { ReactNode } from "react";

/**
 * The two empty states a list can be in, which are not the same thing.
 *
 * NOTHING EXISTS YET is the first thing a new operator sees on a screen, and half of ours stopped
 * at the fact: "No coupons yet." That is true and it is a dead end — it does not say what a coupon
 * is for, or that making one is the next thing to do. The ones written during the Module 4 pass do
 * say it ("No products yet. Templates and reporting both reference this list, so add…"), and the
 * difference is the whole point of this component: `hint` is not optional.
 *
 * NOTHING MATCHES THE FILTER looks identical and means the opposite — the data is there and the
 * filter is hiding it. Telling someone to "add your first coupon" when they have twelve and a typo
 * in the search box is worse than saying nothing. That state gets its own component below, and it
 * offers the way out.
 */
export function EmptyState({
  title,
  hint,
  action,
}: {
  title: string;
  /** What this list is for, or what to do next. Required on purpose — see above. */
  hint: string;
  action?: ReactNode;
}) {
  return (
    <div className="flex flex-col items-center gap-2 px-6 py-12 text-center">
      <p className="text-sm font-semibold text-foreground">{title}</p>
      <p className="max-w-[52ch] text-sm text-muted-foreground">{hint}</p>
      {action && <div className="mt-2">{action}</div>}
    </div>
  );
}

/**
 * A filter matched nothing.
 *
 * Always offers to clear it. Someone who has filtered themselves into a corner should not have to
 * work out which of four controls did it — and on a screen with a search box, a status select and a
 * date range, that is a genuine question.
 */
export function NoMatches({
  noun,
  onClear,
}: {
  /** Plural, lowercase: "tenants", "invoices", "audit entries". */
  noun: string;
  onClear?: () => void;
}) {
  return (
    <div className="flex flex-col items-center gap-2 px-6 py-12 text-center">
      <p className="text-sm font-semibold text-foreground">No {noun} match these filters</p>
      <p className="max-w-[52ch] text-sm text-muted-foreground">
        {onClear
          ? "There may still be some hidden by a filter."
          : "Try widening the search or changing the filters."}
      </p>
      {onClear && (
        <button
          type="button"
          onClick={onClear}
          className="mt-1 rounded-md px-2 py-1 text-sm font-medium text-[var(--primary)] transition-colors hover:bg-muted focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--primary)]"
        >
          Clear all filters
        </button>
      )}
    </div>
  );
}

/**
 * Something failed.
 *
 * Distinct from an empty list on purpose: empty means "there is nothing here yet", this means "we
 * could not find out". Conflating them tells an operator their data is gone when the query simply
 * timed out. Always offers the way to try again.
 */
export function ErrorState({
  title = "That did not load",
  detail,
  action,
}: {
  title?: string;
  /** What failed, in the operator's terms. Never a stack trace. */
  detail: string;
  action?: ReactNode;
}) {
  return (
    <div className="flex flex-col items-center gap-2 px-6 py-12 text-center">
      <p className="text-sm font-semibold text-[var(--error)]">{title}</p>
      <p className="max-w-[52ch] text-sm text-muted-foreground">{detail}</p>
      {action && <div className="mt-2">{action}</div>}
    </div>
  );
}

/**
 * The shape of the rows that are coming, held for as long as the query takes.
 *
 * A spinner in the middle of a table tells the reader nothing about what will appear; this keeps
 * the page from jumping when it does. Hidden from screen readers — the live region announcing
 * "Loading" is the accessible signal, not a grid of grey bars.
 */
export function LoadingRows({ rows = 5, columns = 4 }: { rows?: number; columns?: number }) {
  return (
    <div aria-hidden="true" className="divide-y divide-border">
      {Array.from({ length: rows }).map((_, row) => (
        <div key={row} className="flex items-center gap-4 px-4 py-3.5">
          {Array.from({ length: columns }).map((_, column) => (
            <span
              key={column}
              className="h-3 animate-pulse rounded-full bg-muted motion-reduce:animate-none"
              style={{ width: column === 0 ? "28%" : `${Math.max(10, 22 - column * 3)}%` }}
            />
          ))}
        </div>
      ))}
    </div>
  );
}
