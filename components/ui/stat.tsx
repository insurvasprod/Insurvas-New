import type { ReactNode } from "react";

import { cn } from "@/lib/utils";

/**
 * The pieces a figure is made of.
 *
 * The product had none of these. Every number on every screen was rendered as body text beside a
 * grey label, which is why a queue read like a spreadsheet: nothing said whether 31% was good, and
 * nothing showed its shape over time. A figure is the point of the tile it sits in, so it gets the
 * size, the tabular figures and the colour — and the colour means direction, not decoration.
 */

/* ── Delta ──────────────────────────────────────────────────────────────────────────────────── */

/**
 * Up is not automatically good.
 *
 * A rising contact rate is good and a rising cost per policy is not, so the caller says what an
 * increase MEANS with `goodWhen` rather than letting the arrow pick the colour. Getting this
 * backwards is the single most common way a dashboard lies.
 */
export function DeltaChip({
  value,
  unit = "%",
  goodWhen = "up",
  title,
}: {
  /** Signed. 0 renders as the flat, neutral state. */
  value: number;
  unit?: string;
  goodWhen?: "up" | "down";
  title?: string;
}) {
  const direction = value === 0 ? "flat" : value > 0 ? "up" : "down";
  const good = direction === "flat" ? null : direction === goodWhen;

  const tone =
    good === null
      ? "bg-[var(--surface-alt)] text-[var(--body)]"
      : good
        ? "bg-[var(--success-surface)] text-[var(--success-ink)]"
        : "bg-[var(--error-surface)] text-[var(--error-ink)]";

  // The arrow is a second encoding, so direction survives without colour.
  const path =
    direction === "flat" ? "M5 12h14" : direction === "up" ? "M12 19V5M5 12l7-7 7 7" : "M12 5v14M19 12l-7 7-7-7";

  return (
    <span
      title={title}
      className={cn(
        "inline-flex w-fit items-center gap-1 whitespace-nowrap rounded-full px-2 py-0.5",
        "text-[11px] font-bold tabular-nums",
        tone
      )}
    >
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" className="size-2.5" aria-hidden="true">
        <path d={path} />
      </svg>
      {Math.abs(value)}
      {unit}
      <span className="sr-only">
        {direction === "flat" ? " unchanged" : direction === "up" ? " higher" : " lower"}
      </span>
    </span>
  );
}

/* ── Meter ──────────────────────────────────────────────────────────────────────────────────── */

export type MeterTone = "neutral" | "good" | "info" | "warning" | "danger";

const METER: Record<MeterTone, string> = {
  neutral: "bg-[var(--muted)]",
  good: "bg-[var(--success)]",
  info: "bg-[var(--info)]",
  warning: "bg-[var(--warning)]",
  danger: "bg-[var(--error)]",
};

/**
 * A bar against a target — an SLA countdown, a quota, seats used.
 *
 * `tone` is the caller's, because only the caller knows which end is bad: 90% of an SLA window
 * spent is danger, 90% of a quota met is good, and no rule here could tell them apart.
 */
export function Meter({
  value,
  max = 100,
  tone = "neutral",
  label,
  className,
}: {
  value: number;
  max?: number;
  tone?: MeterTone;
  /** Announced to screen readers; the bar itself is decorative. */
  label: string;
  className?: string;
}) {
  const pct = max <= 0 ? 0 : Math.max(0, Math.min(100, (value / max) * 100));
  return (
    <span
      role="meter"
      aria-label={label}
      aria-valuenow={Math.round(pct)}
      aria-valuemin={0}
      aria-valuemax={100}
      className={cn("block h-1.5 w-full overflow-hidden rounded-full bg-[var(--surface-alt)]", className)}
    >
      <span
        className={cn("block h-1.5 rounded-full", METER[tone])}
        style={{ width: `${pct}%` }}
        aria-hidden="true"
      />
    </span>
  );
}

/* ── Sparkline ──────────────────────────────────────────────────────────────────────────────── */

/**
 * Shape, not values.
 *
 * Deliberately unlabelled and unreadable as data: it says "climbing" or "falling" at a glance and
 * nothing more. Anyone who needs the numbers opens the report, so this stays decorative and is
 * hidden from screen readers — the figure beside it is the accessible fact.
 */
export function Sparkline({
  points,
  tone = "neutral",
  width = 88,
  height = 30,
}: {
  points: number[];
  tone?: MeterTone;
  width?: number;
  height?: number;
}) {
  if (points.length < 2) return null;

  const stroke =
    tone === "good"
      ? "var(--success)"
      : tone === "danger"
        ? "var(--error)"
        : tone === "warning"
          ? "var(--warning)"
          : tone === "info"
            ? "var(--info)"
            : "var(--muted)";

  const min = Math.min(...points);
  const max = Math.max(...points);
  const span = max - min || 1;
  const pad = 3;
  const step = (width - pad * 2) / (points.length - 1);
  const y = (v: number) => pad + (1 - (v - min) / span) * (height - pad * 2);

  const d = points.map((v, i) => `${i === 0 ? "M" : "L"}${(pad + i * step).toFixed(1)} ${y(v).toFixed(1)}`).join(" ");
  const lastX = pad + (points.length - 1) * step;
  const lastY = y(points[points.length - 1]);

  return (
    <svg width={width} height={height} viewBox={`0 0 ${width} ${height}`} fill="none" aria-hidden="true" focusable="false">
      <path d={d} stroke={stroke} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
      {/* The ring is the card's own ground, so the head reads as a dot rather than a blob. */}
      <circle cx={lastX} cy={lastY} r="3" fill={stroke} stroke="var(--surface)" strokeWidth="2" />
    </svg>
  );
}

/* ── StatTile ───────────────────────────────────────────────────────────────────────────────── */

/**
 * Label, figure, and what the figure is doing — in that order of size.
 *
 * `unit` renders inside the figure at a smaller size so "31%" stays one object rather than a
 * number with a stray character after it.
 */
export function StatTile({
  label,
  value,
  unit,
  delta,
  trend,
  footnote,
  className,
}: {
  label: string;
  value: ReactNode;
  unit?: string;
  delta?: { value: number; unit?: string; goodWhen?: "up" | "down" };
  trend?: { points: number[]; tone?: MeterTone };
  footnote?: string;
  className?: string;
}) {
  return (
    <div
      className={cn(
        "rounded-lg border border-border bg-card px-4 py-4 shadow-[var(--shadow-rest)]",
        className
      )}
    >
      <div className="text-[11px] font-semibold uppercase tracking-[0.05em] text-muted-foreground">{label}</div>

      <div className="mt-2 flex items-end justify-between gap-3">
        <span className="text-[2.5rem] font-semibold leading-none tracking-[-0.03em] tabular-nums">
          {value}
          {unit && <span className="text-[1.375rem] text-muted-foreground">{unit}</span>}
        </span>
        {trend && <Sparkline points={trend.points} tone={trend.tone} />}
      </div>

      {(delta || footnote) && (
        <div className="mt-2.5 flex items-center gap-2">
          {delta && <DeltaChip value={delta.value} unit={delta.unit} goodWhen={delta.goodWhen} />}
          {footnote && <span className="text-xs text-muted-foreground">{footnote}</span>}
        </div>
      )}
    </div>
  );
}
