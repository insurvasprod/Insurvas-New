import type { ReactNode } from "react";

/**
 * One chip, every table.
 *
 * Tone rather than colour in the API. A caller says what the state MEANS — `danger` for money that
 * failed, `good` for a subscription that is running — and this decides how that looks. That is what
 * lets the palette shift every chip in one place, and it stops a table inventing a seventh shade of
 * amber.
 *
 * `info` is deliberately neutral rather than the action colour: a column of orange chips would put
 * the loudest thing in the product on rows nobody needs to act on.
 */
export type StatusTone = "neutral" | "good" | "info" | "warning" | "danger";

const TONE: Record<StatusTone, string> = {
  neutral: "bg-muted text-muted-foreground",
  good: "bg-[color-mix(in_srgb,var(--success)_12%,transparent)] text-[var(--success)]",
  info: "bg-muted text-[var(--body)]",
  warning: "bg-[color-mix(in_srgb,var(--warning)_12%,transparent)] text-[var(--warning)]",
  danger: "bg-[color-mix(in_srgb,var(--error)_12%,transparent)] text-[var(--error)]",
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
      className={`inline-flex w-fit items-center gap-1.5 whitespace-nowrap rounded-full px-2.5 py-0.5 text-[11px] font-semibold ${TONE[tone]}`}
    >
      {dot && <span className="size-1.5 shrink-0 rounded-full bg-current" aria-hidden="true" />}
      {children}
    </span>
  );
}
