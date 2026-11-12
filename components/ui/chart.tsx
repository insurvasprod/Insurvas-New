import type { CSSProperties, ReactNode } from "react";
import Link from "next/link";

import { barListScale, chartTop, signedScale, ticks } from "@/lib/chart/scale";
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
 *
 * Load motion (Reports round 7 foundation, owner 2026-11-11: "short animations, smooth, that seems premium"):
 * every chart animates in once when it mounts, in CSS only (app/globals.css, "Chart load"): bars grow from their
 * zero line (`m-chart-y`, `m-chart-y-down`, `m-chart-x`), lines draw left to right (`m-chart-reveal`), shares
 * widen, and areas and end dots fade in (`m-chart-fade`, `m-chart-dot`). A stretched line (preserveAspectRatio
 * "none" with a non-scaling stroke) reveals by a clip, not its dash offset: Chrome measures a non-scaling dash in
 * screen space, so a dash offset drawn on a widened line stopped short of its end (seen 2026-11-11). A line drawn
 * at its own size (StatTile's sparkline) draws by its dash offset (`m-chart-line`).
 * 600ms on the ease-out, rows and bars 30ms apart (`--m-i`, capped at the twelfth); reduced motion stands them still.
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
  /** The categorical palette (--cat-1…6, BRAND.md): one hue per thing that is not a rank — carriers, sources. */
  cat1: "bg-[var(--cat-1)]",
  cat2: "bg-[var(--cat-2)]",
  cat3: "bg-[var(--cat-3)]",
  cat4: "bg-[var(--cat-4)]",
  cat5: "bg-[var(--cat-5)]",
  cat6: "bg-[var(--cat-6)]",
  /** Blue, for a series that means "in progress". (The comparison line is `highlight`, below.) */
  info: "bg-[var(--info)]",
  /** The third brand colour (gold, 2026-11-12): the second line on a chart, the comparison line. */
  highlight: "bg-[var(--highlight-mark)]",
} as const;

export type ChartTone = keyof typeof CHART_TONES;

const count = (value: number) => value.toLocaleString("en-US");

/** A mark's place in its chart's load stagger (30ms apart in CSS), capped so a long chart is whole in under a second. */
const stagger = (index: number): CSSProperties => ({ ["--m-i" as string]: Math.min(Math.max(index, 0), 12) }) as CSSProperties;

/* ── Bars over time ──────────────────────────────────────────────────────────────────────────── */

export type ChartBar = {
  key: string;
  /** The axis label. Only the first, middle and last are drawn, so they cannot collide. */
  label: string;
  /**
   * The bar's figure. Below zero (a net loss, a chargeback week) the bar goes down from the zero line in
   * `belowTone` (the warning tone by default) and the chart draws its zero line where it falls.
   */
  value: number;
  /** The part of `value` drawn solid, when a bar carries two layers (reached of dialled, say). */
  accent?: number;
  /** A period that is not over yet, drawn paler so it is not read as a fall. */
  partial?: boolean;
  /**
   * A second bar beside this one in the same period (issued beside submitted), in `pairTone`, on the same
   * scale. Name it in `names.pair` so its figure reads in the hover and behind the picture.
   */
  pair?: number;
  /**
   * A layer under the zero line in the same period (chargebacks under the week's advances), as an amount
   * (the sign is ignored). Use this or a negative `value`, not both.
   */
  below?: number;
};

/**
 * A bar a period, with a rounded gridline above and a baseline below.
 *
 * `summary` is the sentence a screen reader hears before the figures; the figures themselves follow
 * it as a list, so the chart is readable without seeing it.
 *
 * Round 7 (2026-11-11), all optional so every existing chart draws as it did: negative values and `below`
 * (bars down from a zero line), `pair` (two bars a period), `hrefFor` (a bar opens the rows behind it) and a
 * `legend` row under the axis.
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
  hrefFor,
  pairTone = "quiet",
  belowTone = "warning",
  names,
  legend,
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
  /** Where each bar opens (owner 2026-11-06: every element opens the rows behind it): the whole period's column is the link. */
  hrefFor?: (bar: ChartBar) => string | null;
  /** The tone of a `pair` bar. */
  pairTone?: ChartTone;
  /** The tone of anything under the zero line (a negative `value`, `below`). */
  belowTone?: ChartTone;
  /** What each layer is, for the hover and the figures behind the picture: { value: "Advances", below: "Chargebacks" }. */
  names?: { value?: string; accent?: string; pair?: string; below?: string };
  /** A key under the axis, one row a layer; each row can carry its figure and be a link (ChartLegend). */
  legend?: readonly ChartLegendItem[];
}) {
  const downOf = (bar: ChartBar) => (bar.value < 0 ? -bar.value : 0) + Math.abs(bar.below ?? 0);
  const signed = bars.some((bar) => downOf(bar) > 0);
  const top = chartTop(max ?? bars.reduce((high, bar) => Math.max(high, bar.value, bar.pair ?? 0), 0));
  const scale = signed ? signedScale(bars.map((bar) => Math.max(bar.value, bar.pair ?? 0)), bars.map(downOf)) : null;
  const upTop = scale ? scale.top : top;
  const tickList = scale ? scale.ticks : ticks(top).map((value, index) => ({ value, at: index / 2 }));
  const labelAt = labels === "all"
    ? new Set(bars.map((_, index) => index))
    : new Set([0, Math.floor((bars.length - 1) / 2), bars.length - 1]);
  // The axis gutter is as wide as the widest tick actually reads: a fixed 36px clipped "$4,500"
  // on a phone, and a fixed wide one wastes a third of a narrow chart on whitespace.
  const tickText = tickList.map((tick) => format(tick.value));
  const gutter = Math.max(36, Math.max(...tickText.map((text) => text.length)) * 7 + 10);

  if (!bars.length) return null;

  const figureOf = (bar: ChartBar) => {
    const parts = [`${names?.value ? `${names.value} ` : ""}${format(bar.value)}`];
    if (bar.accent !== undefined && names?.accent) parts.push(`${names.accent} ${format(bar.accent)}`);
    if (bar.pair !== undefined) parts.push(`${names?.pair ?? "Second"} ${format(bar.pair)}`);
    if (bar.below) parts.push(`${names?.below ?? "Below"} ${format(-Math.abs(bar.below))}`);
    return parts.join(" · ");
  };

  /** One upward bar: the kit's rounded column, its accent layer inside, rising from the line on load. */
  const upBar = (value: number, accent: number | undefined, tone: ChartTone | null, partial: boolean | undefined, index: number, fill: boolean) => {
    const height = upTop > 0 ? (Math.max(value, 0) / upTop) * 100 : 0;
    const accentShare = accent !== undefined && value > 0 ? (accent / value) * 100 : null;
    return (
      <span
        className={cn(
          "m-chart-y m-chart-tween flex flex-col justify-end overflow-hidden rounded-t-[4px] rounded-b-[2px]",
          tone ? CHART_TONES[tone] : accentShare === null ? CHART_TONES.strong : CHART_TONES.faint,
          partial && "opacity-60",
          !fill && "min-w-0 flex-1",
        )}
        // A bar with something in it is never invisible: 2% is the thinnest mark that still reads.
        style={{ ...stagger(index), height: `${Math.max(value > 0 ? 2 : 0, height)}%`, width: fill && barMaxWidth ? "100%" : undefined, maxWidth: fill ? barMaxWidth : undefined }}
      >
        {accentShare !== null && <span className={cn("block", CHART_TONES.strong)} style={{ height: `${accentShare}%` }} />}
      </span>
    );
  };

  /** The period's bars above the line: one, or two side by side when it has a pair. */
  const ups = (bar: ChartBar, index: number) => bar.pair === undefined
    ? upBar(bar.value, bar.accent, null, bar.partial, index, true)
    : (
      <span className="flex h-full w-full items-end gap-px" style={{ maxWidth: barMaxWidth }}>
        {upBar(bar.value, bar.accent, null, bar.partial, index, false)}
        {upBar(bar.pair, undefined, pairTone, bar.partial, index, false)}
      </span>
    );

  const columnClass = cn("flex h-full flex-col justify-end", barMaxWidth && "items-center");

  return (
    <figure className={cn("m-0 flex min-h-0 flex-col", className)}>
      <figcaption className="sr-only">{summary}</figcaption>

      <div className="relative flex-1" style={{ minHeight }} aria-hidden="true">
        {tickList.map((tick, index) => (
          <span key={`${tick.value}-${index}`} className="absolute inset-x-0 flex items-center" style={{ top: `${tick.at * 100}%` }}>
            <span className={cn("h-px flex-1", tick.value === 0 ? "bg-[var(--border)]" : "border-t border-dashed border-[var(--border)]")} />
            <span className="-translate-y-px whitespace-nowrap pl-2 text-xs leading-none tabular-nums text-muted-foreground" style={{ width: gutter }}>{tickText[index]}</span>
          </span>
        ))}
        {/* Laid out against the box rather than a percentage of it: `h-full` resolves to nothing when
            the plot's height comes from min-height, which drew a chart with an axis and no bars. */}
        <ol className="absolute inset-y-0 left-0 m-0 grid list-none items-end gap-[clamp(2px,0.5vw,8px)] p-0" style={{ right: gutter, gridTemplateColumns: `repeat(${bars.length}, minmax(0, 1fr))` }}>
          {bars.map((bar, index) => {
            const title = `${bar.label}: ${figureOf(bar)}${unit ? ` ${unit}` : ""}${bar.partial ? " (so far)" : ""}`;
            const href = hrefFor?.(bar) ?? null;
            const down = downOf(bar);
            const body = scale ? (
              <>
                <span className={cn("flex flex-col justify-end", barMaxWidth && "items-center")} style={{ height: `${scale.zero * 100}%` }}>
                  {Math.max(bar.value, bar.pair ?? 0) > 0 ? ups(bar, index) : null}
                </span>
                <span className={cn("flex flex-col justify-start", barMaxWidth && "items-center")} style={{ height: `${(1 - scale.zero) * 100}%` }}>
                  {down > 0 && (
                    <span
                      className={cn("m-chart-y-down m-chart-tween block rounded-b-[4px] rounded-t-[2px]", CHART_TONES[belowTone], bar.partial && "opacity-60")}
                      style={{ ...stagger(index), height: `${Math.max(2, scale.bottom > 0 ? (down / scale.bottom) * 100 : 0)}%`, width: "100%", maxWidth: barMaxWidth }}
                    />
                  )}
                </span>
              </>
            ) : ups(bar, index);
            const column = scale ? "flex h-full flex-col" : columnClass;
            return href ? (
              <li key={bar.key} className="h-full">
                <Link href={href} aria-label={title} tabIndex={-1} title={title} className={cn(column, "rounded-t-[4px] outline-none hover:bg-[color-mix(in_srgb,var(--primary)_8%,transparent)]")}>{body}</Link>
              </li>
            ) : (
              <li key={bar.key} className={column} title={title}>{body}</li>
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

      {legend?.length ? <ChartLegend items={legend} className="mt-3" /> : null}

      <ChartFigures items={bars.map((bar) => ({ key: bar.key, label: bar.label, value: figureOf(bar) }))} unit={unit} />
    </figure>
  );
}

/* ── A key: one row a series, each with its figure, each a link ──────────────────────────────── */

export type ChartLegendItem = {
  key: string;
  label: string;
  tone: ChartTone;
  /** The series' figure, after its name ("278"). */
  figure?: string;
  /** Muted words after the figure ("of 312", "38%"). */
  detail?: string;
  /** Where the row opens: the table view filtered to this series. */
  href?: string;
  /** A line series' swatch is a short stroke (dashed for a dashed line) rather than a square. */
  mark?: "box" | "line" | "dashed";
};

/**
 * The key under a chart (§12: colour is never the only thing saying which series is which): a swatch, the
 * name and its figure, and the row is the link to the rows behind that series. LineSeries and BarSeries draw
 * it from their `legend`; a page can draw it under a BarList whose colours are categories.
 */
export function ChartLegend({ items, className }: { items: readonly ChartLegendItem[]; className?: string }) {
  if (!items.length) return null;
  return (
    <ul className={cn("m-0 flex min-w-0 list-none flex-wrap gap-x-5 gap-y-1 p-0", className)}>
      {items.map((item) => {
        const row = (
          <>
            {item.mark === "line" || item.mark === "dashed"
              ? <span aria-hidden="true" className="h-0 w-3.5 shrink-0 border-t-2" style={{ borderColor: CHART_STROKE[item.tone], borderTopStyle: item.mark === "dashed" ? "dashed" : "solid" }} />
              : <span aria-hidden="true" className={cn("size-2.5 shrink-0 rounded-[3px]", CHART_TONES[item.tone])} />}
            <span className="min-w-0 truncate text-muted-foreground">{item.label}</span>
            {item.figure !== undefined && <b className="shrink-0 font-medium tabular-nums text-foreground">{item.figure}</b>}
            {item.detail && <span className="shrink-0 tabular-nums text-muted-foreground">{item.detail}</span>}
          </>
        );
        return (
          <li key={item.key} className="min-w-0 text-sm">
            {item.href
              ? <Link href={item.href} className="-mx-1.5 flex min-w-0 items-center gap-2 rounded-md px-1.5 py-0.5 no-underline hover:bg-[color-mix(in_srgb,var(--primary)_8%,transparent)]">{row}</Link>
              : <span className="flex min-w-0 items-center gap-2 py-0.5">{row}</span>}
          </li>
        );
      })}
    </ul>
  );
}

/* ── Rows of horizontal bars ─────────────────────────────────────────────────────────────────── */

export type BarListSegment = { key: string; label: string; value: number; tone: ChartTone };

export type BarListRow = {
  key: string;
  /** The name on the left (a carrier, an agent, a stage). Truncates; the full name is its hover. */
  label: string;
  /**
   * The outer value: the bar's length against the list's scale (sent, opened, cases). Below zero the row
   * takes the warning tone unless it names its own, and the bar's length is the amount.
   */
  value: number;
  /** A second value drawn inside the outer bar, solid (submitted inside sent, saved inside opened). */
  inner?: number;
  /** In place of one bar, the row split into parts (ShareBar's segments on a row: a lead's score by signal). */
  segments?: readonly BarListSegment[];
  /** A range drawn as a whisker over the bar (a 95% interval), on the same scale. */
  interval?: readonly [number, number];
  /** The figure on the right. Defaults to `format(value)`. */
  figure?: ReactNode;
  /** Muted words after the figure, smaller: a rate, a sample ("27", "of 4 · 1 accepted"). */
  caption?: ReactNode;
  /** One chip after the name (a StatusChip): the row's one coloured word, if it has one. */
  chip?: ReactNode;
  /** The row's colour, overriding the list's (`warning` for a loss). */
  tone?: ChartTone;
  /** Where the row opens: the whole row is the link (the table view filtered to it, or its record). */
  href?: string;
};

/**
 * Horizontal bars, one row an item: the name on the left, the bar in the middle, the figure on the right
 * (Reports round 7, owner 2026-11-11, the kit's answer wherever a direction drew a donut). Two layers when a
 * row has an `inner` value (the outer drawn faint, the inner solid, as BarSeries draws `accent`); segments
 * when it is made of parts; a whisker for an interval. `color`: `"rank"` (the default) draws every row in
 * the primary family, for a list ordered by its figure; `"categorical"` gives each row its own hue
 * (--cat-1…6) for things that are not ranks. A `total` row closes the list over a hairline.
 *
 * The rows share one grid (subgrid), so every bar starts and every figure ends on the same line. Bars grow
 * from the left on load, 30ms a row apart.
 */
export function BarList({
  rows,
  summary,
  format = count,
  unit,
  max,
  color = "rank",
  total,
  labelWidth = "12.5rem",
  className,
}: {
  rows: readonly BarListRow[];
  summary: string;
  format?: (value: number) => string;
  /** What a row counts, for the figures behind the picture: "cases", "dials". */
  unit?: string;
  /** The value a full track stands for; two lists that must compare share one. Defaults to the longest row. */
  max?: number;
  color?: "rank" | "categorical";
  /** The closing row: "All carriers" and its figure, over a hairline; a link when it has `href`. */
  total?: { label: string; figure: ReactNode; caption?: ReactNode; href?: string };
  /** The widest the name column grows to (it shrinks to 7.5rem on a narrow card). */
  labelWidth?: string;
  className?: string;
}) {
  if (!rows.length && !total) return null;
  const scale = barListScale(rows, max);
  const share = (value: number) => `${Math.min(100, Math.max(0, (Math.abs(value) / scale) * 100))}%`;
  const CATEGORY: ChartTone[] = ["cat1", "cat2", "cat3", "cat4", "cat5", "cat6"];
  const rowClass = "col-span-full grid min-h-[30px] grid-cols-subgrid items-center rounded-md px-1.5 text-sm text-foreground no-underline";

  return (
    <figure className={cn("m-0 min-w-0", className)}>
      <figcaption className="sr-only">{summary}</figcaption>
      <div className="grid min-w-0 gap-x-3.5 gap-y-0.5" style={{ gridTemplateColumns: `minmax(7.5rem, ${labelWidth}) minmax(0, 1fr) auto` }}>
        {rows.map((row, index) => {
          const tone: ChartTone = row.tone ?? (row.value < 0 ? "warning" : color === "categorical" ? CATEGORY[index % CATEGORY.length] : "strong");
          const twoLayers = row.inner !== undefined;
          const title = `${row.label}: ${format(row.value)}${twoLayers ? ` · ${format(row.inner ?? 0)} inside` : ""}${unit ? ` ${unit}` : ""}`;
          const body = (
            <>
              <span className="flex min-w-0 items-center gap-2">
                <span className="min-w-0 truncate" title={row.label}>{row.label}</span>
                {row.chip ? <span className="shrink-0">{row.chip}</span> : null}
              </span>
              <span className="relative h-3 min-w-0" aria-hidden="true">
                {row.segments?.length ? (
                  <span className="m-chart-x m-chart-tween absolute inset-y-0 left-0 flex gap-0.5" style={{ ...stagger(index), width: share(row.segments.reduce((sum, segment) => sum + Math.max(0, segment.value), 0)) }}>
                    {row.segments.filter((segment) => segment.value > 0).map((segment) => (
                      <span key={segment.key} className={cn("h-full rounded-[2px]", CHART_TONES[segment.tone])} style={{ flexGrow: segment.value, flexBasis: 0 }} title={`${segment.label}: ${format(segment.value)}`} />
                    ))}
                  </span>
                ) : (
                  <>
                    <span
                      className={cn("m-chart-x m-chart-tween absolute inset-y-0 left-0 rounded-[2px]", twoLayers && tone === "strong" ? CHART_TONES.faint : CHART_TONES[tone], twoLayers && tone !== "strong" && "opacity-40")}
                      style={{ ...stagger(index), width: row.value !== 0 ? `max(2px, ${share(row.value)})` : "0%" }}
                    />
                    {twoLayers && (row.inner ?? 0) !== 0 && (
                      <span className={cn("m-chart-x m-chart-tween absolute inset-y-0 left-0 rounded-[2px]", CHART_TONES[tone])} style={{ ...stagger(index), width: `max(2px, ${share(row.inner ?? 0)})` }} />
                    )}
                  </>
                )}
                {row.interval && (
                  <span className="m-chart-fade absolute top-1/2 h-2.5 -translate-y-1/2 border-x-2 border-[var(--color-foreground)]" style={{ left: share(row.interval[0]), width: `calc(${share(row.interval[1])} - ${share(row.interval[0])})` }}>
                    <span className="absolute inset-x-0 top-1/2 h-0.5 -translate-y-1/2 bg-[var(--color-foreground)]" />
                  </span>
                )}
              </span>
              <span className="whitespace-nowrap text-right tabular-nums">
                {row.figure ?? format(row.value)}
                {row.caption !== undefined && row.caption !== null && <small className="ml-1.5 text-xs text-muted-foreground">{row.caption}</small>}
              </span>
            </>
          );
          return row.href
            ? <Link key={row.key} href={row.href} title={title} className={cn(rowClass, "outline-none hover:bg-[color-mix(in_srgb,var(--primary)_6%,transparent)] focus-visible:ring-2 focus-visible:ring-ring")}>{body}</Link>
            : <div key={row.key} title={title} className={rowClass}>{body}</div>;
        })}
        {total && (() => {
          const body = (
            <>
              <span className="min-w-0 truncate text-muted-foreground">{total.label}</span>
              <span aria-hidden="true" />
              <span className="whitespace-nowrap text-right tabular-nums">
                {total.figure}
                {total.caption !== undefined && total.caption !== null && <small className="ml-1.5 text-xs text-muted-foreground">{total.caption}</small>}
              </span>
            </>
          );
          const cls = cn(rowClass, "mt-1 rounded-none border-t border-border pt-1.5");
          return total.href
            ? <Link href={total.href} className={cn(cls, "outline-none hover:bg-[color-mix(in_srgb,var(--primary)_6%,transparent)] focus-visible:ring-2 focus-visible:ring-ring")}>{body}</Link>
            : <div className={cls}>{body}</div>;
        })()}
      </div>
      <ChartFigures items={rows.map((row) => ({ key: row.key, label: row.label, value: `${format(row.value)}${row.inner !== undefined ? `, ${format(row.inner)} inside` : ""}` }))} unit={unit} />
    </figure>
  );
}

/* ── One bar, split by share ─────────────────────────────────────────────────────────────────── */

export type ShareSegment = { key: string; label: string; value: number; tone: ChartTone; /** Where the segment opens: its legend row and its part of the bar are the link. */ href?: string };

/**
 * Where a total ended up: one horizontal bar, and a legend that carries the name and the figure.
 * §12 — the colour is never the only thing saying which segment is which. The bar widens from the
 * left on load; a segment with `href` opens from its legend row (and its part of the bar, by pointer).
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
      <div className="m-chart-x flex h-3 min-w-0 gap-0.5" aria-hidden="true">
        {shown.map((segment) => {
          const title = `${segment.label}: ${format(segment.value)}${unit ? ` ${unit}` : ""} · ${Math.round((segment.value / total) * 100)}%`;
          const cls = cn("m-chart-tween rounded-[2px]", CHART_TONES[segment.tone]);
          const style = { width: `${(segment.value / total) * 100}%` };
          // The bar is aria-hidden and out of the tab order: the legend row below is the link a keyboard reaches.
          return segment.href
            ? <Link key={segment.key} href={segment.href} tabIndex={-1} className={cn(cls, "block hover:opacity-80")} style={style} title={title} />
            : <span key={segment.key} className={cls} style={style} title={title} />;
        })}
      </div>

      {/* 11rem, not 9: a legend cell holds a dot, a name, a figure and a percentage, and at 9rem
          two of them fit into a narrow panel and clip every name to "Overr…". Falling to one
          row per segment sooner costs a little height and keeps the names readable. */}
      <ul className="m-0 grid list-none grid-cols-[repeat(auto-fit,minmax(11rem,1fr))] gap-x-4 gap-y-2 p-0">
        {segments.map((segment) => {
          const row = (
            <>
              <span className={cn("size-2.5 shrink-0 rounded-[3px]", CHART_TONES[segment.tone])} aria-hidden="true" />
              <span className="min-w-0 truncate text-muted-foreground">{segment.label}</span>
              <span className="ml-auto shrink-0 font-medium tabular-nums text-foreground">{format(segment.value)}</span>
              <span className="w-10 shrink-0 text-right tabular-nums text-muted-foreground">{Math.round((segment.value / total) * 100)}%</span>
            </>
          );
          return segment.href ? (
            <li key={segment.key} className="min-w-0 text-sm">
              <Link href={segment.href} className="-mx-1.5 flex min-w-0 items-center gap-2 rounded-md px-1.5 no-underline hover:bg-[color-mix(in_srgb,var(--primary)_8%,transparent)]">{row}</Link>
            </li>
          ) : (
            <li key={segment.key} className="flex min-w-0 items-center gap-2 text-sm">{row}</li>
          );
        })}
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
          className={cn("m-chart-y min-w-[2px] flex-1 rounded-t-[2px]", value > 0 ? CHART_TONES.strong : CHART_TONES.faint)}
          style={{ ...stagger(index), height: `${Math.max(value > 0 ? 8 : 4, (value / top) * 100)}%` }}
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

/** Each tone as a stroke or inline colour (a donut's arc, a line, a legend swatch). */
const CHART_STROKE: Record<ChartTone, string> = {
  strong: "var(--primary)",
  mid: "color-mix(in srgb, var(--primary) 72%, var(--border-strong))",
  soft: "color-mix(in srgb, var(--primary) 50%, var(--border-strong))",
  faint: "color-mix(in srgb, var(--primary) 32%, var(--border-strong))",
  quiet: "var(--muted)",
  warning: "var(--warning-ink)",
  success: "var(--success-ink)",
  cat1: "var(--cat-1)",
  cat2: "var(--cat-2)",
  cat3: "var(--cat-3)",
  cat4: "var(--cat-4)",
  cat5: "var(--cat-5)",
  cat6: "var(--cat-6)",
  info: "var(--info)",
  highlight: "var(--highlight-mark)",
};
const DONUT_STROKE = CHART_STROKE;

export type DonutSegment = { key: string; label: string; value: number; tone: ChartTone; /** Words after the figure in the legend ("38% convert"). */ detail?: string; /** Where the slice opens: its legend row becomes the link (owner 2026-11-06). */ href?: string };

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
  legend = "both",
  className,
}: {
  segments: readonly DonutSegment[];
  summary: string;
  centerValue?: string;
  centerLabel?: string;
  format?: (value: number) => string;
  unit?: string;
  /** "share": the legend carries each slice's percentage alone ("38%"), as the dashboard mockups draw it. */
  legend?: "both" | "share";
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
        <svg viewBox="0 0 120 120" className="m-sweep m-chart-tween size-full -rotate-90">
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
          {/* Sized to the figure so "$1,659,471" stays inside the ring. */}
          <span className={cn("font-[family-name:var(--font-display)] font-semibold leading-none tabular-nums text-foreground", (centerValue ?? format(total)).length > 9 ? "text-sm" : (centerValue ?? format(total)).length > 6 ? "text-base" : "text-2xl")}>{centerValue ?? format(total)}</span>
          {centerLabel && <span className="mt-1 text-xs text-muted-foreground">{centerLabel}</span>}
        </div>
      </div>
      <ul className="m-0 flex w-full min-w-0 list-none flex-col gap-1.5 p-0">
        {segments.map((segment) => {
          const row = (
            <>
              <span className={cn("size-2.5 shrink-0 rounded-full", CHART_TONES[segment.tone])} aria-hidden="true" />
              <span className="min-w-0 flex-1 truncate text-foreground">{segment.label}</span>
              {legend === "share"
                ? <b className="shrink-0 font-semibold tabular-nums text-foreground">{Math.round((segment.value / total) * 100)}%</b>
                : <span className="shrink-0 tabular-nums text-muted-foreground"><b className="font-semibold text-foreground">{format(segment.value)}</b>{segment.detail ? ` · ${segment.detail}` : ` · ${Math.round((segment.value / total) * 100)}%`}</span>}
            </>
          );
          return (
            <li key={segment.key} className="min-w-0 text-sm">
              {segment.href
                ? <Link href={segment.href} className="-mx-1.5 flex min-w-0 items-center gap-2 rounded-md px-1.5 py-0.5 no-underline hover:bg-[color-mix(in_srgb,var(--primary)_8%,transparent)]">{row}</Link>
                : <span className="flex min-w-0 items-center gap-2">{row}</span>}
            </li>
          );
        })}
      </ul>
      <ChartFigures items={segments.map((segment) => ({ key: segment.key, label: segment.label, value: format(segment.value) }))} unit={unit} />
    </figure>
  );
}

/** A smooth line through the points (a Catmull-Rom spline as cubic Béziers), the mockups' curve. */
function smoothPath(pts: ReadonlyArray<readonly [number, number]>): string {
  if (!pts.length) return "";
  if (pts.length < 3) return pts.map(([px, py], index) => `${index === 0 ? "M" : "L"}${px.toFixed(1)} ${py.toFixed(1)}`).join(" ");
  let d = `M${pts[0][0].toFixed(1)} ${pts[0][1].toFixed(1)}`;
  for (let i = 0; i < pts.length - 1; i += 1) {
    const p0 = pts[Math.max(0, i - 1)];
    const p1 = pts[i];
    const p2 = pts[i + 1];
    const p3 = pts[Math.min(pts.length - 1, i + 2)];
    const c1x = p1[0] + (p2[0] - p0[0]) / 6;
    const c1y = p1[1] + (p2[1] - p0[1]) / 6;
    const c2x = p2[0] - (p3[0] - p1[0]) / 6;
    const c2y = p2[1] - (p3[1] - p1[1]) / 6;
    // Never overshoot below the baseline or above the top: a premium is never negative.
    const clamp = (v: number) => Math.max(0, Math.min(200, v));
    d += ` C${c1x.toFixed(1)} ${clamp(c1y).toFixed(1)} ${c2x.toFixed(1)} ${clamp(c2y).toFixed(1)} ${p2[0].toFixed(1)} ${p2[1].toFixed(1)}`;
  }
  return d;
}

/* ── A line over time ────────────────────────────────────────────────────────────────────────── */

export type LinePoint = { key: string; label: string; value: number };

/** A further line on a LineSeries' axes (issued under submitted, a cohort): its own tone, optionally dashed. */
export type LineSeriesLine = {
  key: string;
  label: string;
  /** One point a period, in the same periods as the main line's `points`. */
  points: readonly LinePoint[];
  /** Defaults by position: `quiet`, then `cat2`, `cat3`. */
  tone?: ChartTone;
  /** Dashed, for a line that is a reference rather than a result (the plain order, a target). */
  dashed?: boolean;
  /** The line's figure in the legend ("224"). */
  figure?: string;
  /** Where its legend row opens. */
  href?: string;
};

const LINE_TONES: ChartTone[] = ["quiet", "cat2", "cat3"];

/**
 * One value a period as a line with a soft area under it, on the same gridlines and gutter as
 * `BarSeries`. The last point is marked so "now" is where the eye lands; every point has its own
 * hover target and its figure in text.
 *
 * Round 7 (2026-11-11), all optional: `lines` adds up to three more lines (four in all, counting `compare`),
 * and `legend` names the main line; with either, a key under the axis carries each line's name and figure,
 * and its rows are links. The drawing reveals left to right on load; the areas fade in under it.
 */
export function LineSeries({
  points,
  summary,
  format = count,
  unit,
  labels = "ends",
  className,
  minHeight = 160,
  compare,
  hrefFor,
  lines,
  legend,
}: {
  points: readonly LinePoint[];
  summary: string;
  format?: (value: number) => string;
  unit?: string;
  labels?: "ends" | "all";
  className?: string;
  minHeight?: number;
  /** A second series on the same axes (last month, submitted), drawn quieter under the main line. */
  compare?: { points: readonly LinePoint[]; label: string; figure?: string; href?: string };
  /** Where each point opens (owner 2026-11-06: every element opens the rows behind it). */
  hrefFor?: (point: LinePoint) => string | null;
  /** More lines on the same axes, no area under them; at most four lines are drawn in all. */
  lines?: readonly LineSeriesLine[];
  /** The main line's row in the key: its name, figure and link. */
  legend?: { label: string; figure?: string; href?: string };
}) {
  if (!points.length) return null;
  const extra = (lines ?? []).slice(0, compare ? 2 : 3).map((line, index) => ({ ...line, tone: line.tone ?? LINE_TONES[index] }));
  const high = (list: readonly LinePoint[]) => list.reduce((most, point) => Math.max(most, point.value), 0);
  const top = chartTop(Math.max(high(points), compare ? high(compare.points) : 0, ...extra.map((line) => high(line.points))));
  const tickText = ticks(top).map(format);
  const gutter = Math.max(36, Math.max(...tickText.map((text) => text.length)) * 7 + 10);
  const labelAt = labels === "all"
    ? new Set(points.map((_, index) => index))
    : new Set([0, Math.floor((points.length - 1) / 2), points.length - 1]);
  const width = 1000;
  const height = 200;
  const x = (index: number) => (points.length === 1 ? width / 2 : (index / (points.length - 1)) * width);
  const y = (value: number) => height - (top > 0 ? (value / top) * height : 0);
  const line = smoothPath(points.map((point, index) => [x(index), y(point.value)]));
  const area = `${line} L${x(points.length - 1).toFixed(1)} ${height} L${x(0).toFixed(1)} ${height} Z`;
  const last = points[points.length - 1];
  const xc = (index: number) => (compare && compare.points.length > 1 ? (index / (compare.points.length - 1)) * width : width / 2);
  const compareLine = compare?.points.length ? smoothPath(compare.points.map((point, index) => [xc(index), y(point.value)])) : null;
  const compareAt = (index: number) => compare?.points[index] ?? null;
  const pathOf = (list: readonly LinePoint[]) => smoothPath(list.map((point, index) => [list.length === 1 ? width / 2 : (index / (list.length - 1)) * width, y(point.value)]));
  const keyed = Boolean(legend || extra.length);
  const key: ChartLegendItem[] = keyed
    ? [
        { key: "main", label: legend?.label ?? summary, tone: "strong", figure: legend?.figure, href: legend?.href, mark: "line" },
        ...(compare ? [{ key: "compare", label: compare.label, tone: "highlight" as ChartTone, figure: compare.figure, href: compare.href, mark: "line" as const }] : []),
        ...extra.map((one) => ({ key: one.key, label: one.label, tone: one.tone, figure: one.figure, href: one.href, mark: one.dashed ? ("dashed" as const) : ("line" as const) })),
      ]
    : [];

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
          <svg viewBox={`0 0 ${width} ${height}`} preserveAspectRatio="none" className="m-chart-reveal m-chart-tween size-full overflow-visible">
            {compareLine && <path className="m-chart-fade" d={`${compareLine} L${width} ${height} L0 ${height} Z`} fill="var(--highlight-mark)" fillOpacity="0.08" />}
            {compareLine && <path d={compareLine} fill="none" stroke="var(--highlight-mark)" strokeWidth="2" strokeLinejoin="round" strokeLinecap="round" vectorEffect="non-scaling-stroke" />}
            {extra.map((one) => (
              one.points.length ? (
                <path key={one.key} d={pathOf(one.points)} fill="none" stroke={CHART_STROKE[one.tone]} strokeWidth="2" strokeDasharray={one.dashed ? "6 5" : undefined} strokeLinejoin="round" strokeLinecap="round" vectorEffect="non-scaling-stroke" />
              ) : null
            ))}
            <path className="m-chart-fade" d={area} fill="var(--primary)" fillOpacity="0.12" />
            <path d={line} fill="none" stroke="var(--primary)" strokeWidth="2.5" strokeLinejoin="round" strokeLinecap="round" vectorEffect="non-scaling-stroke" />
          </svg>
          <span className="m-chart-dot absolute size-2.5 -translate-x-1/2 -translate-y-1/2 rounded-full bg-[var(--primary)] ring-2 ring-[var(--surface)]" style={{ left: `${(x(points.length - 1) / width) * 100}%`, top: `${(y(last.value) / height) * 100}%` }} />
          {/* Hover (owner 2026-11-06, as the round 2 mockup draws it): each point owns the strip of the chart nearest to
              it; under the pointer it shows a dashed guide, a dot on the line, and a card with the period and figures.
              CSS only, so it works on a server-rendered page; the strip is also the link to the rows behind the point. */}
          <ol className="absolute inset-0 m-0 list-none p-0">
            {points.map((point, index) => {
              const title = `${point.label}: ${format(point.value)}${unit ? ` ${unit}` : ""}`;
              const href = hrefFor?.(point) ?? null;
              const from = index === 0 ? 0 : (x(index - 1) + x(index)) / 2;
              const to = index === points.length - 1 ? width : (x(index) + x(index + 1)) / 2;
              const span = Math.max(1, to - from);
              const at = `${((x(index) - from) / span) * 100}%`;
              const top = `${(y(point.value) / height) * 100}%`;
              const other = compareAt(index);
              const edge = points.length > 1 && index === 0 ? "left-0" : points.length > 1 && index === points.length - 1 ? "right-0" : "left-1/2 -translate-x-1/2";
              const body = (
                <>
                  <span className="pointer-events-none absolute inset-y-0 w-0 border-l border-dashed border-[var(--primary)] opacity-0 transition-opacity group-hover:opacity-70 group-focus-visible:opacity-70" style={{ left: at }} />
                  <span className="pointer-events-none absolute size-3 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-[var(--primary)] bg-[var(--surface)] opacity-0 transition-opacity group-hover:opacity-100 group-focus-visible:opacity-100" style={{ left: at, top }} />
                  <span className="pointer-events-none absolute z-10 opacity-0 transition-opacity group-hover:opacity-100 group-focus-visible:opacity-100" style={{ left: at, top }}>
                    <span className={cn("absolute bottom-3 flex w-max flex-col gap-0.5 rounded-lg border border-border bg-[var(--surface)] px-2.5 py-1.5 text-left shadow-[var(--shadow-rest)]", edge)}>
                      <span className="text-[0.6875rem] leading-none text-muted-foreground">{point.label}</span>
                      <span className="text-xs font-semibold leading-tight tabular-nums text-foreground">{keyed && legend ? `${legend.label} ` : ""}{format(point.value)}{unit ? ` ${unit}` : ""}</span>
                      {other && compare && <span className="text-[0.6875rem] leading-tight tabular-nums text-muted-foreground">{compare.label} {format(other.value)}</span>}
                      {extra.map((one) => one.points[index] ? <span key={one.key} className="text-[0.6875rem] leading-tight tabular-nums text-muted-foreground">{one.label} {format(one.points[index].value)}</span> : null)}
                    </span>
                  </span>
                </>
              );
              const cls = "group absolute inset-y-0 block outline-none";
              const style = { left: `${(from / width) * 100}%`, width: `${(span / width) * 100}%` };
              return (
                <li key={point.key} className="contents">
                  {href
                    ? <Link href={href} aria-label={title} tabIndex={-1} className={cls} style={style}>{body}</Link>
                    : <span title={title} className={cls} style={style}>{body}</span>}
                </li>
              );
            })}
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

      {keyed && <ChartLegend items={key} className="mt-3" />}

      <ChartFigures items={points.map((point) => ({ key: point.key, label: point.label, value: format(point.value) }))} unit={unit} />
      {extra.map((one) => (
        <ChartFigures key={one.key} items={one.points.map((point) => ({ key: point.key, label: `${one.label}, ${point.label}`, value: format(point.value) }))} unit={unit} />
      ))}
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
      <svg viewBox={`0 0 ${width} ${height}`} preserveAspectRatio="none" className="m-chart-reveal m-chart-tween size-full overflow-visible" aria-hidden="true">
        <path className="m-chart-fade" d={`${line} L${width} ${height} L0 ${height} Z`} fill="var(--primary)" fillOpacity="0.12" />
        <path d={line} fill="none" stroke="var(--primary)" strokeWidth="2" strokeLinejoin="round" strokeLinecap="round" vectorEffect="non-scaling-stroke" />
      </svg>
      <span aria-hidden="true" className="m-chart-dot absolute size-2 -translate-x-1/2 -translate-y-1/2 rounded-full bg-[var(--primary)]" style={{ left: "100%", top: `${(y(values[values.length - 1]) / height) * 100}%` }} />
    </figure>
  );
}
