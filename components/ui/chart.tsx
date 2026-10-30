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
  className?: string;
  minHeight?: number;
}) {
  const top = chartTop(max ?? bars.reduce((high, bar) => Math.max(high, bar.value), 0));
  const labelAt = new Set([0, Math.floor((bars.length - 1) / 2), bars.length - 1]);
  // The axis gutter is as wide as the widest tick actually reads: a fixed 36px clipped "$4,500"
  // on a phone, and a fixed wide one wastes a third of a narrow chart on whitespace.
  const tickText = ticks(top).map(format);
  const gutter = Math.max(36, Math.max(...tickText.map((text) => text.length)) * 7 + 10);

  if (!bars.length) return null;

  return (
    <figure className={cn("m-0 flex min-h-0 flex-col", className)}>
      <figcaption className="sr-only">{summary}</figcaption>

      <div className="relative flex-1" style={{ minHeight, paddingRight: gutter }} aria-hidden="true">
        {ticks(top).map((tick, index) => (
          <span key={tick} className="absolute inset-x-0 flex items-center" style={{ top: `${(index / 2) * 100}%` }}>
            <span className={cn("h-px flex-1", tick === 0 ? "bg-[var(--border)]" : "border-t border-dashed border-[var(--border)]")} />
            <span className="-translate-y-px whitespace-nowrap pl-2 text-xs leading-none tabular-nums text-muted-foreground" style={{ width: gutter }}>{tickText[index]}</span>
          </span>
        ))}
        <ol className="relative m-0 grid h-full list-none items-end gap-[clamp(2px,0.5vw,8px)] p-0" style={{ gridTemplateColumns: `repeat(${bars.length}, minmax(0, 1fr))` }}>
          {bars.map((bar) => {
            const height = top > 0 ? (bar.value / top) * 100 : 0;
            const accentShare = bar.accent !== undefined && bar.value > 0 ? (bar.accent / bar.value) * 100 : null;
            return (
              <li key={bar.key} className="flex h-full flex-col justify-end" title={`${bar.label}: ${format(bar.value)}${unit ? ` ${unit}` : ""}${bar.partial ? " (so far)" : ""}`}>
                <span
                  className={cn(
                    "m-bar-rise flex flex-col justify-end overflow-hidden rounded-t-[4px] rounded-b-[2px]",
                    accentShare === null ? CHART_TONES.strong : CHART_TONES.faint,
                    bar.partial && "opacity-60",
                  )}
                  // A bar with something in it is never invisible: 2% is the thinnest mark that still reads.
                  style={{ height: `${Math.max(bar.value > 0 ? 2 : 0, height)}%` }}
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
          <span key={bar.key} className={cn("whitespace-nowrap", index === 0 ? "text-left" : index === bars.length - 1 ? "text-right" : "text-center")}>
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

      <ul className="m-0 grid list-none grid-cols-[repeat(auto-fit,minmax(9rem,1fr))] gap-x-4 gap-y-2 p-0">
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
