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
          className="mt-1 rounded-md px-2 py-1 text-sm font-medium text-[var(--color-blue)] transition-colors hover:bg-muted focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--color-blue)]"
        >
          Clear all filters
        </button>
      )}
    </div>
  );
}
