import type { ReactNode } from "react";

import { StatStrip, StatTile, type MeterTone } from "@/components/ui/stat";

/**
 * The admin boards' figure tile: 1px border, 12px radius, 16/18 padding, a 12px uppercase label, a
 * 32px tabular figure and a 12px footnote. Local to the staff console on purpose — components/ui/stat
 * serves the agent app at 30px and is shared, so the boards' size lives here instead of there.
 *
 * `tone` colours the figure only, and only means something: callers pass it when the number is a
 * signal (a failure count above zero, the last super admin), never for decoration.
 */
export type BoardStatTone = "default" | "success" | "warning" | "error";

// The admin tiles are the shared StatTile now (2026-09-28: one compact figure style everywhere).
const FIGURE_TONE: Record<BoardStatTone, MeterTone | undefined> = {
  default: undefined,
  success: "good",
  warning: "warning",
  error: "danger",
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
  return <StatTile label={label} labelTitle={title} value={value} valueTone={FIGURE_TONE[tone]} footnote={footnote ?? undefined} />;
}

/** The admin boards' figures: one compact strip (StatStrip), not a grid of boxes. */
export function BoardStatGrid({ children, className }: { children: ReactNode; className?: string }) {
  return <StatStrip className={className}>{children}</StatStrip>;
}
