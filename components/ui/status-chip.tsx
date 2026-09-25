import type { ReactNode } from "react";

/**
 * One chip, every table.
 *
 * Tone rather than colour in the API. A caller says what the state MEANS — `danger` for money that
 * failed, `good` for a subscription that is running — and this decides how that looks. That is what
 * lets the palette shift every chip in one place, and it stops a table inventing a seventh shade of
 * amber.
 *
 * `info` is its own teal, not the action colour and not grey: "verifying", "in review" and
 * "scheduled" were all being told in the same grey as "nothing is happening", and a column of
 * ORANGE chips would put the loudest thing in the product on rows nobody needs to act on.
 *
 * Each tone is a named ground plus a named ink, not a colour-mix of the fill against whatever is
 * behind it. The mix version drifted with the surface it landed on and could not be measured; these
 * grounds are fixed values, and their inks clear 4.5:1 on them (6.1–6.4:1) in both themes.
 *
 * `action` is the one tone allowed to be orange, for a row the reader must do something about.
 */
export type StatusTone = "neutral" | "good" | "info" | "warning" | "danger" | "action";

const TONE: Record<StatusTone, { chip: string; dot: string }> = {
  neutral: { chip: "bg-[var(--surface-alt)] text-[var(--body)]",        dot: "bg-[var(--muted)]" },
  good:    { chip: "bg-[var(--success-surface)] text-[var(--success-ink)]", dot: "bg-[var(--success)]" },
  info:    { chip: "bg-[var(--info-surface)] text-[var(--info-ink)]",       dot: "bg-[var(--info)]" },
  warning: { chip: "bg-[var(--warning-surface)] text-[var(--warning-ink)]", dot: "bg-[var(--warning)]" },
  danger:  { chip: "bg-[var(--error-surface)] text-[var(--error-ink)]",     dot: "bg-[var(--error)]" },
  action:  { chip: "bg-[var(--soft-orange-surface)] text-[var(--accent-ink)]", dot: "bg-[var(--primary)]" },
};

export function StatusChip({
  tone = "neutral",
  children,
  title,
  /**
   * A dot carries the state for anyone who cannot separate the hues. It defaults to ON for every
   * tone that means something: colour alone is not an encoding, and a queue is scanned, not read.
   */
  dot,
}: {
  tone?: StatusTone;
  children: ReactNode;
  title?: string;
  dot?: boolean;
}) {
  const showDot = dot ?? tone !== "neutral";
  return (
    <span
      title={title}
      className={`inline-flex w-fit items-center gap-1.5 whitespace-nowrap rounded-full px-2.5 py-0.5 text-[11px] font-semibold ${TONE[tone].chip}`}
    >
      {showDot && (
        <span className={`size-1.5 shrink-0 rounded-full ${TONE[tone].dot}`} aria-hidden="true" />
      )}
      {children}
    </span>
  );
}
