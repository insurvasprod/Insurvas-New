import type { ReactNode } from "react";

import { cn } from "@/lib/utils";

/**
 * The admin boards' figure tile: 1px border, 12px radius, 16/18 padding, a 12px uppercase label, a
 * 32px tabular figure and a 12px footnote. Local to the staff console on purpose — components/ui/stat
 * serves the agent app at 30px and is shared, so the boards' size lives here instead of there.
 *
 * `tone` colours the figure only, and only means something: callers pass it when the number is a
 * signal (a failure count above zero, the last super admin), never for decoration.
 */
export type BoardStatTone = "default" | "success" | "warning" | "error";

const FIGURE_TONE: Record<BoardStatTone, string> = {
  default: "text-[var(--ink)]",
  success: "text-[var(--success-ink)]",
  warning: "text-[var(--warning-ink)]",
  error: "text-[var(--error-ink)]",
};

export function BoardStatTile({
  label,
  value,
  footnote,
  tone = "default",
  title,
}: {
  label: string;
  value: ReactNode;
  footnote?: ReactNode;
  tone?: BoardStatTone;
  /** Hover text: where the number comes from, when that is not obvious. */
  title?: string;
}) {
  return (
    <div title={title} className="min-w-0 rounded-[12px] border border-[var(--border)] bg-[var(--surface)] px-[18px] py-4">
      <div className="text-[12px] leading-[1.33] font-semibold tracking-[0.02em] uppercase text-[var(--muted)]">{label}</div>
      <div className={cn("mt-1 text-[32px] leading-[1.13] font-semibold tracking-[-0.025em] tabular-nums", FIGURE_TONE[tone])}>{value}</div>
      {footnote !== undefined && footnote !== null && (
        <div className="mt-1 text-[12px] leading-[1.5] tracking-[-0.01em] text-[var(--muted)]">{footnote}</div>
      )}
    </div>
  );
}

/** Four across on a wide screen, two on a tablet, one on a phone — the boards' 16px gap. */
export function BoardStatGrid({ children, className }: { children: ReactNode; className?: string }) {
  return <div className={cn("grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4", className)}>{children}</div>;
}
