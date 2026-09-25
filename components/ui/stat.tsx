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
      // 12px/600 rather than the board's 11px/700: 12px is the smallest text the system allows, and
      // 400/600 are the only weights the product sets. The tight 1×6 pill is the board's.
      className={cn(
        "inline-flex w-fit items-center gap-0.5 whitespace-nowrap rounded-full px-1.5 py-px",
        "text-xs font-semibold leading-normal tabular-nums",
        tone
      )}
    >
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3.5" strokeLinecap="round" strokeLinejoin="round" className="size-[9px]" aria-hidden="true">
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

// `primary` is the one orange bar allowed: progress the reader is actively working through
// (a setup checklist), never a measurement they merely observe.
export type MeterTone = "neutral" | "good" | "info" | "warning" | "danger" | "primary";

const VALUE_TONE: Record<MeterTone, string> = {
  neutral: "text-foreground",
  good: "text-[var(--success-ink)]",
  info: "text-[var(--info-ink)]",
  warning: "text-[var(--warning-ink)]",
  danger: "text-[var(--error-ink)]",
  primary: "text-[var(--accent-ink)]",
};

const METER: Record<MeterTone, string> = {
  neutral: "bg-[var(--muted)]",
  good: "bg-[var(--success)]",
  info: "bg-[var(--info)]",
  warning: "bg-[var(--warning)]",
  danger: "bg-[var(--error)]",
  primary: "bg-[var(--primary)]",
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
      // m-meter grows the fill from the left, once, 280ms after the page settles — so the bar is
      // read as a value rather than mistaken for a loader.
      className={cn("m-meter block h-[5px] w-full overflow-hidden rounded-full bg-[var(--surface-alt)]", className)}
    >
      <span
        className={cn("block h-[5px] rounded-full", METER[tone])}
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
  labelTitle,
  value,
  valueTone,
  action,
  unit,
  delta,
  trend,
  meter,
  footnote,
  reserveFootnote,
  className,
}: {
  label: string;
  /** Hover explanation for a label that needs one. The footnote is still the accessible answer. */
  labelTitle?: string;
  value: ReactNode;
  /**
   * Colour on the figure itself, for a tile whose whole point is that the number is good or bad —
   * suspended tenants, mismatched invoices. Used sparingly: a strip where every figure is coloured
   * is a strip where none of them is.
   */
  valueTone?: MeterTone;
  /** A way into the rows behind the figure, drawn beside the footnote. */
  action?: ReactNode;
  /**
   * Hold the footnote line open on a tile that has nothing to say there, so a strip of five tiles
   * where four have a footnote does not come out with one tile a line shorter than the rest.
   */
  reserveFootnote?: boolean;
  unit?: string;
  delta?: { value: number; unit?: string; goodWhen?: "up" | "down" };
  trend?: { points: number[]; tone?: MeterTone };
  /** A figure that is a fraction of something — seats used, capacity filled — draws its bar here. */
  meter?: { value: number; max?: number; tone?: MeterTone; label: string };
  footnote?: ReactNode;
  className?: string;
}) {
  return (
    <div
      className={cn(
        "rounded-lg border border-border bg-card px-[15px] py-[13px] shadow-[var(--shadow-rest)]",
        className
      )}
    >
      {/* The system's `label` style (12px/600, 0.02em, uppercase), not the board's 10.5px: 12px is
          the smallest text the system allows, and a label is read before the figure it names. */}
      <div title={labelTitle} className="text-xs font-semibold leading-[1.33] uppercase tracking-[0.02em] text-muted-foreground">{label}</div>

      {/* 30px, not 40. Five of these sit across a list page above the table they describe; at 40px
          the strip competes with the rows it is meant to introduce, and a 6-figure count wraps. */}
      <div className="mt-1.5 flex items-end justify-between gap-3">
        <span className={cn("text-[30px] font-semibold leading-none tracking-[-0.03em] tabular-nums", valueTone && VALUE_TONE[valueTone])}>
          {value}
          {unit && <span className="text-[17px] text-muted-foreground">{unit}</span>}
        </span>
        {trend && <Sparkline points={trend.points} tone={trend.tone} />}
      </div>

      {meter && (
        <Meter
          className="mt-2"
          value={meter.value}
          max={meter.max}
          tone={meter.tone}
          label={meter.label}
        />
      )}

      {(delta || footnote || action || reserveFootnote) && (
        <div className="mt-2 flex flex-wrap items-center gap-x-1.5 gap-y-1">
          {delta && <DeltaChip value={delta.value} unit={delta.unit} goodWhen={delta.goodWhen} />}
          {footnote && <span className="text-xs text-muted-foreground">{footnote}</span>}
          {action && <span className="ml-auto text-xs">{action}</span>}
          {!delta && !footnote && !action && <span className="text-xs" aria-hidden="true">&nbsp;</span>}
        </div>
      )}
    </div>
  );
}
