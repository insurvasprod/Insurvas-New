import type { ReactNode } from "react";

import { cn } from "@/lib/utils";
import type { MeterTone } from "@/components/ui/stat";

const STROKE: Record<MeterTone, string> = {
  neutral: "var(--muted)",
  good: "var(--success)",
  info: "var(--info)",
  warning: "var(--warning)",
  danger: "var(--error)",
  primary: "var(--primary)",
};

/**
 * A progress ring — how much of something is done: setup steps, appointments closed out, a quota.
 *
 * The round sibling of <Meter>, for a figure that stands alone rather than sitting under a number.
 * The arc draws itself once on load (m-ring, app/globals.css). `children` sits in the centre; by
 * default it is the percentage.
 */
export function Ring({
  value,
  max = 100,
  tone = "primary",
  size = 44,
  label,
  children,
  className,
}: {
  value: number;
  max?: number;
  tone?: MeterTone;
  size?: number;
  /** Announced to screen readers; the ring itself is decorative. */
  label: string;
  children?: ReactNode;
  className?: string;
}) {
  const pct = max <= 0 ? 0 : Math.max(0, Math.min(100, (value / max) * 100));
  const r = 15.9155; // circumference 100, so the dash array is the percentage
  return (
    <span
      role="meter"
      aria-label={label}
      aria-valuenow={Math.round(pct)}
      aria-valuemin={0}
      aria-valuemax={100}
      className={cn("relative inline-grid shrink-0 place-items-center", className)}
      style={{ width: size, height: size }}
    >
      <svg viewBox="0 0 36 36" width={size} height={size} className="-rotate-90" aria-hidden="true">
        <circle cx="18" cy="18" r={r} fill="none" stroke="var(--surface-alt)" strokeWidth="3.5" />
        <circle
          className="m-ring"
          cx="18"
          cy="18"
          r={r}
          fill="none"
          stroke={STROKE[tone]}
          strokeWidth="3.5"
          strokeLinecap="round"
          strokeDasharray={`${pct} 100`}
          style={{ ["--ring-pct" as string]: pct }}
        />
      </svg>
      <span className="absolute text-xs font-semibold tabular-nums" aria-hidden="true">
        {children ?? `${Math.round(pct)}%`}
      </span>
    </span>
  );
}
