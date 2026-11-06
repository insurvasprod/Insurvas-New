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

/**
 * A half ring — how far a day's count has come toward its target (owner 2026-11-06, the dashboard's
 * "On the phone today": dials against the daily target). The figure sits in the bowl, the target under it.
 */
export function HalfRing({
  value,
  max,
  tone = "primary",
  width = 200,
  label,
  caption,
  className,
}: {
  value: number;
  max: number;
  tone?: MeterTone;
  width?: number;
  /** Announced to screen readers. */
  label: string;
  /** Under the figure: "of 120 dials". */
  caption?: ReactNode;
  className?: string;
}) {
  const pct = max <= 0 ? 0 : Math.max(0, Math.min(100, (value / max) * 100));
  // A half circle of radius 40 is 125.66 long; the dash is its share of that.
  const length = Math.PI * 40;
  return (
    <span role="meter" aria-label={label} aria-valuenow={value} aria-valuemin={0} aria-valuemax={max} className={cn("relative inline-flex shrink-0 flex-col items-center", className)} style={{ width }}>
      <svg viewBox="0 0 100 56" width={width} height={width * 0.56} aria-hidden="true">
        <path d="M10 50 A40 40 0 0 1 90 50" fill="none" stroke="var(--surface-alt)" strokeWidth="8" strokeLinecap="round" />
        <path d="M10 50 A40 40 0 0 1 90 50" fill="none" stroke={STROKE[tone]} strokeWidth="8" strokeLinecap="round" strokeDasharray={`${(pct / 100) * length} ${length}`} />
      </svg>
      <span className="absolute bottom-1 flex flex-col items-center" aria-hidden="true">
        <span className="font-[family-name:var(--font-display)] text-[1.75rem] font-bold leading-none tabular-nums text-foreground">{value.toLocaleString("en-US")}</span>
        {caption && <span className="mt-1 text-xs text-muted-foreground">{caption}</span>}
      </span>
    </span>
  );
}

/**
 * A three-quarter gauge (dashboard mockups, round 2): the track opens at the bottom, the figure and its caption
 * sit in the middle. "58 of 120 dials".
 */
export function GaugeRing({
  value,
  max,
  tone = "primary",
  size = 132,
  label,
  caption,
  className,
}: {
  value: number;
  max: number;
  tone?: MeterTone;
  size?: number;
  /** Announced to screen readers. */
  label: string;
  caption?: ReactNode;
  className?: string;
}) {
  const pct = max <= 0 ? 0 : Math.max(0, Math.min(100, (value / max) * 100));
  const round = 2 * Math.PI * 40;
  const track = round * 0.75;
  return (
    <span role="meter" aria-label={label} aria-valuenow={value} aria-valuemin={0} aria-valuemax={max} className={cn("relative inline-grid shrink-0 place-items-center", className)} style={{ width: size, height: size }}>
      <svg viewBox="0 0 100 100" width={size} height={size} aria-hidden="true" className="absolute inset-0 rotate-[135deg]">
        <circle cx="50" cy="50" r="40" fill="none" stroke="var(--surface-alt)" strokeWidth="9" strokeLinecap="round" strokeDasharray={`${track} ${round}`} />
        <circle cx="50" cy="50" r="40" fill="none" stroke={STROKE[tone]} strokeWidth="9" strokeLinecap="round" strokeDasharray={`${(pct / 100) * track} ${round}`} />
      </svg>
      <span className="relative flex flex-col items-center" aria-hidden="true">
        <span className="font-[family-name:var(--font-display)] text-[1.875rem] font-bold leading-none tabular-nums text-foreground">{value.toLocaleString("en-US")}</span>
        {caption && <span className="mt-1 text-xs text-muted-foreground">{caption}</span>}
      </span>
    </span>
  );
}
