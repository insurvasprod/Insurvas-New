import type { ComponentType, ReactNode, SVGProps } from "react";
import { ArrowDown, ArrowUp } from "lucide-react";

import { SparkLine } from "@/components/ui/chart";
import { InfoTip } from "@/components/ui/info-tip";
import { cn } from "@/lib/utils";

type Icon = ComponentType<SVGProps<SVGSVGElement>>;

/**
 * A headline figure for a dashboard (owner pick B, 2026-11-04): the label top left and a round icon
 * top right, the number as large as the tile allows, a small line of how it moved through the
 * period, and the change in colour with one plain sentence. `StatCard` is the compact strip tile for
 * list pages; this one is for a page whose figures are the point.
 */
export function KpiRow({ children, label, className }: { children: ReactNode; label?: string; className?: string }) {
  return (
    <section aria-label={label} className={cn("grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4", className)}>
      {children}
    </section>
  );
}

export function KpiTile({
  icon: Glyph,
  label,
  value,
  series,
  seriesSummary,
  info,
  change,
  note,
  tone: figureTone = "default",
  className,
}: {
  icon: Icon;
  label: string;
  value: ReactNode;
  /** The figure through the period, drawn as the small line. */
  series?: readonly number[];
  seriesSummary?: string;
  /** Why the figure is what it is, behind an (i) beside the label. */
  info?: ReactNode;
  /** Percent against the period before. Nothing to compare against is no pill. */
  change?: { value: number; good: "up" | "down" | "neither" };
  /** The plain sentence after the change. */
  note?: ReactNode;
  /** "warn" colours the figure amber: it is money or work waiting on someone. One per row at most. */
  tone?: "default" | "warn";
  className?: string;
}) {
  const up = change ? change.value > 0 : false;
  const flat = change ? change.value === 0 : false;
  const good = change && !flat && (change.good === "neither" ? null : change.good === (up ? "up" : "down"));
  const tone = good === null || flat || !change ? "text-[var(--body)]" : good ? "text-[var(--highlight-ink)]" : "text-[var(--error-ink)]";
  return (
    <div className={cn("m-glass flex min-w-0 flex-col rounded-lg border border-border px-4 py-3", className)}>
      <div className="flex items-center justify-between gap-3">
        <span className="flex min-w-0 items-center gap-1 text-sm font-medium text-foreground">{label}{info && <InfoTip label={`About ${label.toLowerCase()}`}>{info}</InfoTip>}</span>
        <span className="grid size-8 shrink-0 place-items-center rounded-full bg-[var(--primary-soft)] text-[var(--accent-ink)]" aria-hidden="true"><Glyph className="size-4" /></span>
      </div>
      <div className="mt-1 flex items-center gap-4">
        <div className={cn("shrink-0 font-[family-name:var(--font-display)] text-[2rem] font-semibold leading-none tracking-[-0.035em] tabular-nums", figureTone === "warn" ? "text-[var(--warning-ink)]" : "text-foreground")}>{value}</div>
        {series && series.length > 1 ? <SparkLine className="h-7 flex-1" values={series} summary={seriesSummary ?? `${label} through the period`} /> : <div className="h-7 flex-1" aria-hidden="true" />}
      </div>
      {/* Always one line, filled or not, so a row of tiles is one height and the figures sit on one line. */}
      <p className="m-0 mt-1.5 flex min-h-[1.3125rem] flex-wrap items-center gap-x-1.5 text-sm leading-normal text-[var(--body)]">
          {change && (
            <span className={cn("inline-flex items-center gap-0.5 font-semibold tabular-nums", tone)}>
              {!flat && (up ? <ArrowUp className="size-3.5" aria-hidden="true" /> : <ArrowDown className="size-3.5" aria-hidden="true" />)}
              {Math.abs(change.value)}%
              <span className="sr-only">{flat ? " unchanged" : up ? " higher" : " lower"} than the period before</span>
            </span>
          )}
          {note}
        </p>
    </div>
  );
}
