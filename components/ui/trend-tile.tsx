import type { ReactNode } from "react";

import { cn } from "@/lib/utils";

export type TrendTone = "neutral" | "good" | "warning" | "danger";
const INK: Record<TrendTone, string> = { neutral: "var(--primary)", good: "var(--success)", warning: "var(--warning)", danger: "var(--error)" };
const VALUE: Record<TrendTone, string> = { neutral: "text-foreground", good: "text-[var(--success-ink)]", warning: "text-[var(--warning-ink)]", danger: "text-[var(--error-ink)]" };

/**
 * A figure with its recent trend (Leads A2, redesign 2026-10-25): the dashboard's glass tile with a
 * small area line of the last few days on the right. `trend` is oldest first; with fewer than two
 * points no line is drawn, so a tile never shows a shape the data does not have.
 */
export function TrendTile({ label, value, footnote, tone = "neutral", trend, trendLabel }: { label: string; value: ReactNode; footnote?: ReactNode; tone?: TrendTone; trend?: number[] | null; trendLabel?: string }) {
  return (
    <div className="m-glass flex min-w-0 items-end justify-between gap-3 rounded-xl border border-border px-4 py-3.5">
      <div className="min-w-0">
        <p className="m-0 text-xs leading-[1.5] font-semibold tracking-[0.06em] uppercase text-muted-foreground">{label}</p>
        <p className={cn("m-0 mt-1 text-2xl leading-tight font-semibold tracking-[-0.02em] tabular-nums", tone === "neutral" ? "text-foreground" : VALUE[tone])}>{value}</p>
        {footnote && <p className="m-0 mt-0.5 text-xs leading-[1.5] text-muted-foreground">{footnote}</p>}
      </div>
      {trend && trend.length > 1 && <Sparkline values={trend} color={INK[tone]} label={trendLabel} />}
    </div>
  );
}

export function Sparkline({ values, color, label, width = 110, height = 32 }: { values: number[]; color: string; label?: string; width?: number; height?: number }) {
  const max = Math.max(...values);
  const min = Math.min(...values);
  const span = max - min || 1;
  const points = values.map((value, index) => `${((index / (values.length - 1)) * width).toFixed(1)},${(height - 3 - ((value - min) / span) * (height - 6)).toFixed(1)}`);
  const [lastX, lastY] = points[points.length - 1].split(",");
  return (
    <svg viewBox={`0 0 ${width} ${height}`} width={width} height={height} className="shrink-0" role={label ? "img" : undefined} aria-label={label} aria-hidden={label ? undefined : true}>
      <polyline points={`0,${height} ${points.join(" ")} ${width},${height}`} fill={color} fillOpacity={0.12} stroke="none" />
      <polyline points={points.join(" ")} fill="none" stroke={color} strokeWidth={1.8} strokeLinejoin="round" />
      <circle cx={lastX} cy={lastY} r={2.8} fill={color} />
    </svg>
  );
}
