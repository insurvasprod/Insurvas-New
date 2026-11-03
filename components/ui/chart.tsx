import type { ReactNode } from "react";

import { chartTop, ticks } from "@/lib/chart/scale";
import { cn } from "@/lib/utils";

/**
 * The charts (UI-CONSISTENCY §5b: one kit, one look).
 *
 * The product had no chart library. The agent dashboard's fourteen-day calls chart was the only
 * chart in it, hand-built from CSS bars in `components/app/home/home-activity.tsx`; this is that
 * drawing generalised, so the partner portal's charts are recognisably the same object.
 *
 * Everything comes from tokens, so both themes and any future brand follow without a second pass,
 * and every shape carries its numbers in text behind the picture: a chart nobody can read aloud is
 * decoration.
 *
 * Deliberately one file with a narrow surface. If a real charting library earns its place later,
 * it goes in here and the pages do not change.
 */

/**
 * The ramp a series is drawn in: one family, so a chart never looks like a pie of stickers.
 *
 * The steps mix toward `--border-strong`, not toward the page surface. Mixed toward the surface the
 * palest step measured 1.71:1 against the dark card and 1.38:1 against the light one — a segment
 * you cannot see is not a segment. Every step now clears 3:1 against both grounds (measured, 30
 * Oct). Neighbouring steps of one hue cannot also clear 3:1 against each other — that is arithmetic
 * — so a stacked bar separates its segments with a gap rather than relying on the fills alone, and
 * the legend carries the name and the figure either way (§12).
 *
 * `quiet` is `--muted`, a different neutral: "Closed" is not a paler kind of progress.
 */
export const CHART_TONES = {
  strong: "bg-[var(--primary)]",
  mid: "bg-[color-mix(in_srgb,var(--primary)_72%,var(--border-strong))]",
  soft: "bg-[color-mix(in_srgb,var(--primary)_50%,var(--border-strong))]",
  faint: "bg-[color-mix(in_srgb,var(--primary)_32%,var(--border-strong))]",
  quiet: "bg-[var(--muted)]",
  /** A state that is waiting on someone, and one that is done: the donut's meaning-carrying tones. */
  warning: "bg-[var(--warning-ink)]",
  success: "bg-[var(--success-ink)]",
} as const;

export type ChartTone = keyof typeof CHART_TONES;

const count = (value: number) => value.toLocaleString("en-US");

/* ── Bars over time ──────────────────────────────────────────────────────────────────────────── */

export type ChartBar = {
  key: string;
  /** The axis label. Only the first, middle and last are drawn, so they cannot collide. */
  label: string;
  value: number;
  /** The part of `value` drawn solid, when a bar carries two layers (reached of dialled, say). */
  accent?: number;
  /** A period that is not over yet, drawn paler so it is not read as a fall. */
  partial?: boolean;
};

/**
 * A bar a period, with a rounded gridline above and a baseline below.
 *
 * `summary` is the sentence a screen reader hears before the figures; the figures themselves follow
 * it as a list, so the chart is readable without seeing it.
 */
export function BarSeries({
  bars,
  summary,
  format = count,
  unit,
  max,
  barMaxWidth,
  labels = "ends",
  className,
  minHeight = 132,
}: {
  bars: readonly ChartBar[];
  summary: string;
  format?: (value: number) => string;
  /** What one bar counts, for the figures behind the picture: "leads", "statements". */
  unit?: string;
  /** Override the scale's top — for two charts that must share an axis. */
  max?: number;
  /** Keep sparse series readable by capping each bar while its grid cell keeps the time slot. */
  barMaxWidth?: number;
  /**
   * Which bars get an axis label. `"ends"` (the default) draws the first, middle and last, which
   * is what a run of dates wants — the ends anchor it and the rest would collide. `"all"` is for
   * a **categorical** series, where every bar is a different thing and an unlabelled bar cannot
   * be identified at all: one bar per producer, per carrier, per product.
   */
  labels?: "ends" | "all";
  className?: string;
  minHeight?: number;
}) {
  const top = chartTop(max ?? bars.reduce((high, bar) => Math.max(high, bar.value), 0));
  const labelAt = labels === "all"
    ? new Set(bars.map((_, index) => index))
    : new Set([0, Math.floor((bars.length - 1) / 2), bars.length - 1]);
  // The axis gutter is as wide as the widest tick actually reads: a fixed 36px clipped "$4,500"
  // on a phone, and a fixed wide one wastes a third of a narrow chart on whitespace.
  const tickText = ticks(top).map(format);
  const gutter = Math.max(36, Math.max(...tickText.map((text) => text.length)) * 7 + 10);

  if (!bars.length) return null;

  return (
    <figure className={cn("m-0 flex min-h-0 flex-col", className)}>
      <figcaption className="sr-only">{summary}</figcaption>

      <div className="relative flex-1" style={{ minHeight }} aria-hidden="true">
        {ticks(top).map((tick, index) => (
          <span key={tick} className="absolute inset-x-0 flex items-center" style={{ top: `${(index / 2) * 100}%` }}>
            <span className={cn("h-px flex-1", tick === 0 ? "bg-[var(--border)]" : "border-t border-dashed border-[var(--border)]")} />
            <span className="-translate-y-px whitespace-nowrap pl-2 text-xs leading-none tabular-nums text-muted-foreground" style={{ width: gutter }}>{tickText[index]}</span>
          </span>
        ))}
        {/* Laid out against the box rather than a percentage of it: `h-full` resolves to nothing when
            the plot's height comes from min-height, which drew a chart with an axis and no bars. */}
        <ol className="absolute inset-y-0 left-0 m-0 grid list-none items-end gap-[clamp(2px,0.5vw,8px)] p-0" style={{ right: gutter, gridTemplateColumns: `repeat(${bars.length}, minmax(0, 1fr))` }}>
          {bars.map((bar) => {
            const height = top > 0 ? (bar.value / top) * 100 : 0;
            const accentShare = bar.accent !== undefined && bar.value > 0 ? (bar.accent / bar.value) * 100 : null;
            return (
              <li key={bar.key} className={cn("flex h-full flex-col justify-end", barMaxWidth && "items-center")} title={`${bar.label}: ${format(bar.value)}${unit ? ` ${unit}` : ""}${bar.partial ? " (so far)" : ""}`}>
                <span
                  className={cn(
                    "m-bar-rise flex flex-col justify-end overflow-hidden rounded-t-[4px] rounded-b-[2px]",
                    accentShare === null ? CHART_TONES.strong : CHART_TONES.faint,
                    bar.partial && "opacity-60",
                  )}
                  // A bar with something in it is never invisible: 2% is the thinnest mark that still reads.
                  style={{ height: `${Math.max(bar.value > 0 ? 2 : 0, height)}%`, width: barMaxWidth ? "100%" : undefined, maxWidth: barMaxWidth }}
                >
                  {accentShare !== null && <span className={cn("block", CHART_TONES.strong)} style={{ height: `${accentShare}%` }} />}
                </span>
              </li>
            );
          })}
        </ol>
      </div>

      <div aria-hidden="true" className="grid pt-1.5 text-xs leading-none tabular-nums text-muted-foreground" style={{ paddingRight: gutter, gridTemplateColumns: `repeat(${bars.length}, minmax(0, 1fr))` }}>
        {bars.map((bar, index) => (
          <span
            key={bar.key}
            title={labels === "all" ? bar.label : undefined}
            className={cn(
              labels === "all" ? "min-w-0 truncate px-0.5 text-center" : "whitespace-nowrap",
              labels === "all" || bars.length === 1 ? "text-center" : index === 0 ? "text-left" : index === bars.length - 1 ? "text-right" : "text-center",
            )}
          >
            {labelAt.has(index) ? bar.label : ""}
          </span>
        ))}
      </div>

      <ChartFigures items={bars.map((bar) => ({ key: bar.key, label: bar.label, value: format(bar.value) }))} unit={unit} />
    </figure>
  );
}

/* ── One bar, split by share ─────────────────────────────────────────────────────────────────── */

export type ShareSegment = { key: string; label: string; value: number; tone: ChartTone; href?: string };

/**
 * Where a total ended up: one horizontal bar, and a legend that carries the name and the figure.
 * §12 — the colour is never the only thing saying which segment is which.
 */
export function ShareBar({
  segments,
  summary,
  format = count,
  unit,
  className,
}: {
  segments: readonly ShareSegment[];
  summary: string;
  format?: (value: number) => string;
  unit?: string;
  className?: string;
}) {
  const total = segments.reduce((sum, segment) => sum + segment.value, 0);
  if (total <= 0) return null;
  const shown = segments.filter((segment) => segment.value > 0);

  return (
    <figure className={cn("m-0 flex min-w-0 flex-col gap-3", className)}>
      <figcaption className="sr-only">{summary}</figcaption>

      {/* A 2px gap, not a hairline: it survives both themes, and it is what makes two neighbouring
          steps of one hue tell themselves apart. */}
      <div className="flex h-3 min-w-0 gap-0.5" aria-hidden="true">
        {shown.map((segment) => (
          <span
            key={segment.key}
            className={cn("rounded-[2px]", CHART_TONES[segment.tone])}
            style={{ width: `${(segment.value / total) * 100}%` }}
            title={`${segment.label}: ${format(segment.value)}${unit ? ` ${unit}` : ""} · ${Math.round((segment.value / total) * 100)}%`}
          />
        ))}
      </div>

      {/* 11rem, not 9: a legend cell holds a dot, a name, a figure and a percentage, and at 9rem
          two of them fit into a narrow panel and clip every name to "Overr…". Falling to one
          row per segment sooner costs a little height and keeps the names readable. */}
      <ul className="m-0 grid list-none grid-cols-[repeat(auto-fit,minmax(11rem,1fr))] gap-x-4 gap-y-2 p-0">
        {segments.map((segment) => (
          <li key={segment.key} className="flex min-w-0 items-center gap-2 text-sm">
            <span className={cn("size-2.5 shrink-0 rounded-[3px]", CHART_TONES[segment.tone])} aria-hidden="true" />
            <span className="min-w-0 truncate text-muted-foreground">{segment.label}</span>
            <span className="ml-auto shrink-0 font-medium tabular-nums text-foreground">{format(segment.value)}</span>
            <span className="w-10 shrink-0 text-right tabular-nums text-muted-foreground">{Math.round((segment.value / total) * 100)}%</span>
          </li>
        ))}
      </ul>
    </figure>
  );
}

/* ── A strip, for beside a figure ────────────────────────────────────────────────────────────── */

/** The shape of a series at a glance, with no axis: it sits beside the number it belongs to. */
export function Sparkline({ values, summary, className }: { values: readonly number[]; summary: string; className?: string }) {
  if (!values.length) return null;
  const top = Math.max(...values, 1);
  return (
    <figure className={cn("m-0 flex h-8 min-w-0 items-end gap-px", className)} title={summary}>
      <figcaption className="sr-only">{summary}</figcaption>
      {values.map((value, index) => (
        <span
          key={index}
          aria-hidden="true"
          className={cn("min-w-[2px] flex-1 rounded-t-[2px]", value > 0 ? CHART_TONES.strong : CHART_TONES.faint)}
          style={{ height: `${Math.max(value > 0 ? 8 : 4, (value / top) * 100)}%` }}
        />
      ))}
    </figure>
  );
}

/* ── The figures behind every picture ────────────────────────────────────────────────────────── */

/**
 * The same numbers as text, for a screen reader and for anyone who cannot tell two bars apart.
 * A list rather than a table: it reads as prose in a screen reader's browse mode, and a chart's
 * figures are a sequence, not a grid.
 */
function ChartFigures({ items, unit }: { items: ReadonlyArray<{ key: string; label: string; value: string }>; unit?: string }) {
  return (
    <ul className="sr-only">
      {items.map((item) => (
        <li key={item.key}>{item.label}: {item.value}{unit ? ` ${unit}` : ""}</li>
      ))}
    </ul>
  );
}

/* ── The frame a chart sits in ───────────────────────────────────────────────────────────────── */

/**
 * A chart's heading: what it shows, over what period, with the one action that follows from it.
 * Kept here so every chart on every page wears the same hat.
 */
export function ChartHeading({ title, period, action, children }: { title: string; period?: string; action?: ReactNode; children?: ReactNode }) {
  return (
    <div className="flex min-w-0 flex-wrap items-start justify-between gap-x-4 gap-y-1">
      <div className="min-w-0">
        <h3 className="m-0 text-card-title font-semibold text-foreground">{title}</h3>
        {period && <p className="m-0 mt-0.5 text-xs text-muted-foreground">{period}</p>}
        {children}
      </div>
      {action}
    </div>
  );
}

/* ── A wheel: where a total went (owner, 2026-11-04: wheels and lines, never rows of bars) ───── */

const DONUT_STROKE: Record<ChartTone, string> = {
  strong: "var(--primary)",
  mid: "color-mix(in srgb, var(--primary) 72%, var(--border-strong))",
  soft: "color-mix(in srgb, var(--primary) 50%, var(--border-strong))",
  faint: "color-mix(in srgb, var(--primary) 32%, var(--border-strong))",
  quiet: "var(--muted)",
  warning: "var(--warning-ink)",
  success: "var(--success-ink)",
};

export type DonutSegment = { key: string; label: string; value: number; tone: ChartTone; /** Words after the figure in the legend ("38% convert"). */ detail?: string };

/**
 * A ring split by share, the total in its middle, and a legend that carries every name and figure
 * (§12: colour is never the only thing saying which slice is which).
 */
export function DonutChart({
  segments,
  summary,
  centerValue,
  centerLabel,
  format = count,
  unit,
  className,
}: {
  segments: readonly DonutSegment[];
  summary: string;
  centerValue?: string;
  centerLabel?: string;
  format?: (value: number) => string;
  unit?: string;
  className?: string;
}) {
  const total = segments.reduce((sum, segment) => sum + segment.value, 0);
  if (total <= 0) return null;
  const shown = segments.filter((segment) => segment.value > 0);
  const radius = 46;
  const circumference = 2 * Math.PI * radius;
  const gap = shown.length > 1 ? 3 : 0;
  const arcs = shown.reduce<Array<{ segment: DonutSegment; length: number; start: number }>>((list, segment) => {
    const start = list.length ? list[list.length - 1].start + list[list.length - 1].length : 0;
    return [...list, { segment, length: (segment.value / total) * circumference, start }];
  }, []);

  return (
    <figure className={cn("m-0 flex min-w-0 flex-col items-center gap-4", className)}>
      <figcaption className="sr-only">{summary}</figcaption>
      <div className="relative size-32 shrink-0" aria-hidden="true">
        <svg viewBox="0 0 120 120" className="size-full -rotate-90">
          <circle cx="60" cy="60" r={radius} fill="none" stroke="var(--surface-alt)" strokeWidth="14" />
          {arcs.map(({ segment, length, start }) => {
            const dash = Math.max(length - gap, 0.5);
            return (
              <circle
                key={segment.key}
                cx="60"
                cy="60"
                r={radius}
                fill="none"
                stroke={DONUT_STROKE[segment.tone]}
                strokeWidth="14"
                strokeDasharray={`${dash} ${circumference - dash}`}
                strokeDashoffset={-start}
              >
                <title>{`${segment.label}: ${format(segment.value)}${unit ? ` ${unit}` : ""} · ${Math.round((segment.value / total) * 100)}%`}</title>
              </circle>
            );
          })}
        </svg>
        <div className="absolute inset-0 flex flex-col items-center justify-center text-center">
          <span className="font-[family-name:var(--font-display)] text-2xl font-semibold leading-none tabular-nums text-foreground">{centerValue ?? format(total)}</span>
          {centerLabel && <span className="mt-1 text-xs text-muted-foreground">{centerLabel}</span>}
        </div>
      </div>
      <ul className="m-0 flex w-full min-w-0 list-none flex-col gap-1.5 p-0">
        {segments.map((segment) => (
          <li key={segment.key} className="flex min-w-0 items-center gap-2 text-sm">
            <span className={cn("size-2.5 shrink-0 rounded-full", CHART_TONES[segment.tone])} aria-hidden="true" />
            <span className="min-w-0 flex-1 truncate text-foreground">{segment.label}</span>
            <span className="shrink-0 tabular-nums text-muted-foreground"><b className="font-semibold text-foreground">{format(segment.value)}</b>{segment.detail ? ` · ${segment.detail}` : ` · ${Math.round((segment.value / total) * 100)}%`}</span>
          </li>
        ))}
      </ul>
      <ChartFigures items={segments.map((segment) => ({ key: segment.key, label: segment.label, value: format(segment.value) }))} unit={unit} />
    </figure>
  );
}

/* ── A line over time ────────────────────────────────────────────────────────────────────────── */

export type LinePoint = { key: string; label: string; value: number };

/**
 * One value a period as a line with a soft area under it, on the same gridlines and gutter as
 * `BarSeries`. The last point is marked so "now" is where the eye lands; every point has its own
 * hover target and its figure in text.
 */
export function LineSeries({
  points,
  summary,
  format = count,
  unit,
  labels = "ends",
  className,
  minHeight = 160,
}: {
  points: readonly LinePoint[];
  summary: string;
  format?: (value: number) => string;
  unit?: string;
  labels?: "ends" | "all";
  className?: string;
  minHeight?: number;
}) {
  if (!points.length) return null;
  const top = chartTop(points.reduce((high, point) => Math.max(high, point.value), 0));
  const tickText = ticks(top).map(format);
  const gutter = Math.max(36, Math.max(...tickText.map((text) => text.length)) * 7 + 10);
  const labelAt = labels === "all"
    ? new Set(points.map((_, index) => index))
    : new Set([0, Math.floor((points.length - 1) / 2), points.length - 1]);
  const width = 1000;
  const height = 200;
  const x = (index: number) => (points.length === 1 ? width / 2 : (index / (points.length - 1)) * width);
  const y = (value: number) => height - (top > 0 ? (value / top) * height : 0);
  const line = points.map((point, index) => `${index === 0 ? "M" : "L"}${x(index).toFixed(1)} ${y(point.value).toFixed(1)}`).join(" ");
  const area = `${line} L${x(points.length - 1).toFixed(1)} ${height} L${x(0).toFixed(1)} ${height} Z`;
  const last = points[points.length - 1];

  return (
    <figure className={cn("m-0 flex min-h-0 flex-col", className)}>
      <figcaption className="sr-only">{summary}</figcaption>

      <div className="relative flex-1" style={{ minHeight }} aria-hidden="true">
        {ticks(top).map((tick, index) => (
          <span key={tick} className="absolute inset-x-0 flex items-center" style={{ top: `${(index / 2) * 100}%` }}>
            <span className={cn("h-px flex-1", tick === 0 ? "bg-[var(--border)]" : "border-t border-dashed border-[var(--border)]")} />
            <span className="-translate-y-px whitespace-nowrap pl-2 text-xs leading-none tabular-nums text-muted-foreground" style={{ width: gutter }}>{tickText[index]}</span>
          </span>
        ))}
        <div className="absolute inset-y-0 left-0" style={{ right: gutter }}>
          <svg viewBox={`0 0 ${width} ${height}`} preserveAspectRatio="none" className="size-full overflow-visible">
            <path d={area} fill="var(--primary)" fillOpacity="0.12" />
            <path d={line} fill="none" stroke="var(--primary)" strokeWidth="2.5" strokeLinejoin="round" strokeLinecap="round" vectorEffect="non-scaling-stroke" />
          </svg>
          <span className="absolute size-2.5 -translate-x-1/2 -translate-y-1/2 rounded-full bg-[var(--primary)] ring-2 ring-[var(--surface)]" style={{ left: `${(x(points.length - 1) / width) * 100}%`, top: `${(y(last.value) / height) * 100}%` }} />
          <ol className="absolute inset-0 m-0 grid list-none p-0" style={{ gridTemplateColumns: `repeat(${points.length}, minmax(0, 1fr))` }}>
            {points.map((point) => <li key={point.key} className="h-full" title={`${point.label}: ${format(point.value)}${unit ? ` ${unit}` : ""}`} />)}
          </ol>
        </div>
      </div>

      <div aria-hidden="true" className="grid pt-1.5 text-xs leading-none tabular-nums text-muted-foreground" style={{ paddingRight: gutter, gridTemplateColumns: `repeat(${points.length}, minmax(0, 1fr))` }}>
        {points.map((point, index) => (
          <span
            key={point.key}
            className={cn(
              labels === "all" ? "min-w-0 truncate px-0.5 text-center" : "whitespace-nowrap",
              labels === "all" || points.length === 1 ? "text-center" : index === 0 ? "text-left" : index === points.length - 1 ? "text-right" : "text-center",
            )}
          >
            {labelAt.has(index) ? point.label : ""}
          </span>
        ))}
      </div>

      <ChartFigures items={points.map((point) => ({ key: point.key, label: point.label, value: format(point.value) }))} unit={unit} />
    </figure>
  );
}

/* ── A small line beside a figure ────────────────────────────────────────────────────────────── */

/** The shape of a series as a line with a soft area and its last point marked; no axis, it sits inside a tile. */
export function SparkLine({ values, summary, className }: { values: readonly number[]; summary: string; className?: string }) {
  if (values.length < 2) return null;
  const top = Math.max(...values, 1);
  const width = 200;
  const height = 40;
  const pad = 3;
  const x = (index: number) => (index / (values.length - 1)) * width;
  const y = (value: number) => height - pad - (value / top) * (height - pad * 2);
  const line = values.map((value, index) => `${index === 0 ? "M" : "L"}${x(index).toFixed(1)} ${y(value).toFixed(1)}`).join(" ");
  return (
    <figure className={cn("relative m-0 h-10 min-w-0", className)} title={summary}>
      <figcaption className="sr-only">{summary}</figcaption>
      <svg viewBox={`0 0 ${width} ${height}`} preserveAspectRatio="none" className="size-full overflow-visible" aria-hidden="true">
        <path d={`${line} L${width} ${height} L0 ${height} Z`} fill="var(--primary)" fillOpacity="0.12" />
        <path d={line} fill="none" stroke="var(--primary)" strokeWidth="2" strokeLinejoin="round" strokeLinecap="round" vectorEffect="non-scaling-stroke" />
      </svg>
      <span aria-hidden="true" className="absolute size-2 -translate-x-1/2 -translate-y-1/2 rounded-full bg-[var(--primary)]" style={{ left: "100%", top: `${(y(values[values.length - 1]) / height) * 100}%` }} />
    </figure>
  );
}
