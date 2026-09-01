import type { ReactNode } from "react";

/**
 * One chip, six tables.
 *
 * Every table that shows a status was hand-rolling `<Badge variant="outline" className="border-transparent
 * bg-[var(--color-success)]/10 text-[10px] text-[var(--color-success)]">`. Six copies of the same
 * idea drift, and they had: some carried `text-[10px]` and some did not, some tinted with
 * `--color-blue-faint` and some with a `/10` alpha of the same hue. None of it was wrong; all of it
 * was slightly different, which is what makes a set of screens feel unmaintained.
 *
 * Tone rather than colour in the API. A caller says what the state MEANS — `danger` for money that
 * failed, `good` for a subscription that is running — and this decides how that looks. That is what
 * lets the dark palette shift every chip in one place, and it stops a table inventing a seventh
 * shade of amber.
 */
export type StatusTone = "neutral" | "good" | "info" | "warning" | "danger";

const TONE: Record<StatusTone, string> = {
  // Muted rather than grey-on-grey: a neutral state is still a state worth reading.
  neutral: "bg-muted text-muted-foreground",
  good: "bg-[var(--color-success)]/12 text-[var(--color-success)]",
  info: "bg-[var(--color-blue)]/12 text-[var(--color-blue)]",
  warning: "bg-[var(--color-warning)]/12 text-[var(--color-warning)]",
  danger: "bg-[var(--color-danger)]/12 text-[var(--color-danger)]",
};

export function StatusChip({
  tone = "neutral",
  children,
  title,
  /** A dot carries the state for anyone who cannot separate the hues. */
  dot = false,
}: {
  tone?: StatusTone;
  children: ReactNode;
  title?: string;
  dot?: boolean;
}) {
  return (
    <span
      title={title}
      className={`inline-flex w-fit items-center gap-1.5 whitespace-nowrap rounded-full px-2 py-0.5 text-[11px] font-semibold ${TONE[tone]}`}
    >
      {dot && <span className="size-1.5 shrink-0 rounded-full bg-current" aria-hidden="true" />}
      {children}
    </span>
  );
}

/**
 * Tone for a subscription status.
 *
 * `past_due` is warning rather than danger deliberately: the customer still has access and a
 * payment may yet land. `suspended` and `cancelled` are the ones where something has actually been
 * taken away.
 */
export function subscriptionTone(status: string | null): StatusTone {
  switch (status) {
    case "active":
      return "good";
    case "trialing":
      return "info";
    case "past_due":
    case "cancelling":
    case "paused":
      return "warning";
    case "suspended":
    case "cancelled":
      return "danger";
    default:
      return "neutral";
  }
}

/**
 * Tone for an invoice status.
 *
 * `void` is neutral, not danger. Voiding is a deliberate act by an operator and the invoice is
 * closed correctly; colouring it red puts it in the same visual bucket as one nobody has paid.
 */
export function invoiceTone(status: string | null): StatusTone {
  switch (status) {
    case "paid":
      return "good";
    case "issued":
      return "info";
    case "draft":
    case "void":
      return "neutral";
    case "overdue":
      return "warning";
    case "uncollectible":
      return "danger";
    default:
      return "neutral";
  }
}

/** Tone for a tenant or user account state. */
export function accountTone(status: string | null): StatusTone {
  switch (status) {
    case "active":
      return "good";
    case "invited":
    case "pending":
      return "info";
    case "suspended":
      return "warning";
    case "deactivated":
    case "inactive":
      return "danger";
    default:
      return "neutral";
  }
}

/**
 * Tone for how an invoice reconciled against what the provider actually charged.
 *
 * `mismatched` is danger and stays danger. It means our records and the money disagree, which is
 * the one thing on an invoice screen that should never be quiet.
 */
export function reconciliationTone(state: string | null): StatusTone {
  switch (state) {
    case "matched":
      return "good";
    case "pending":
      return "info";
    case "mismatched":
      return "danger";
    default:
      return "neutral";
  }
}
