import type { ComponentType, ReactNode, SVGProps } from "react";

import { cn } from "@/lib/utils";
import { CountUp } from "@/components/ui/count-up";
import { InfoTip } from "@/components/ui/info-tip";
import { DeltaChip, Meter, type MeterTone } from "@/components/ui/stat";

/**
 * The v3 stat figure (docs/design/UI-CONSISTENCY.md §4a): the glossy "footer fact" card from the
 * foundation review (docs/design/foundation-v3/mockup.html).
 *
 * It sits beside StatStrip/StatTile rather than replacing them: a page moves to StatRow/StatCard
 * when someone reworks it, and never mixes the two (decision 2026-10-27). The anatomy is fixed —
 * header, value with its change, footer with one supporting fact or the action the card needs — so
 * every card on every reworked page reads the same way. There is deliberately no trend chart: the
 * manager rejected the small sparkline in the corner.
 */

/* ── StatRow ────────────────────────────────────────────────────────────────────────────────── */

/** One row of stat cards under the page header: 4 across on a wide screen, 2 on a tablet, 1 on a phone. */
export function StatRow({ children, label, className }: { children: ReactNode; label?: string; className?: string }) {
  return (
    <section aria-label={label} className={cn("grid grid-cols-[repeat(auto-fit,minmax(220px,1fr))] gap-3", className)}>
      {children}
    </section>
  );
}

/* ── StatCard ───────────────────────────────────────────────────────────────────────────────── */

type Icon = ComponentType<SVGProps<SVGSVGElement>>;

export function StatCard({
  icon: IconComponent,
  label,
  period,
  labelTitle,
  value,
  unit,
  delta,
  meter,
  fact,
  action,
  tone = "default",
  className,
}: {
  /** A Lucide icon, drawn in the glossy tile. Optional: a row is either all icons or none. */
  icon?: Icon;
  /** Sentence case, short: "New leads". */
  label: string;
  /** What the figure covers, muted after the label: "today", "7 days", "pending". */
  period?: string;
  /** An explanation behind an InfoTip beside the label. */
  labelTitle?: string;
  /** A number counts up to its value; a string with a leading "$" draws the currency muted. */
  value: ReactNode;
  /** Drawn inside the figure at half size: "31%" stays one object. */
  unit?: string;
  /** The change pill beside the value. Its comparison belongs in `period` or the footer. */
  delta?: { value: number; unit?: string; goodWhen?: "up" | "down" | "neither" };
  /** Progress toward a goal, between the value and the footer. */
  meter?: { value: number; max?: number; tone?: MeterTone; label: string };
  /** The footer's one supporting fact: label on the left, value on the right. */
  fact?: { label: ReactNode; value?: ReactNode };
  /** A way into the rows behind the figure, at the right of the footer. */
  action?: ReactNode;
  /** "warn" paints the footer amber: the card needs action. One per row at most. */
  tone?: "default" | "warn";
  className?: string;
}) {
  const hasFooter = Boolean(fact || action);

  return (
    <div data-slot="stat-card" data-tone={tone} className={cn("m-stat-card flex min-w-0 flex-col rounded-lg border", className)}>
      <div className="flex flex-1 flex-col gap-3.5 px-4 pt-4" style={hasFooter ? undefined : { paddingBottom: "1rem" }}>
        <div className="flex min-w-0 items-center gap-2 text-[0.8125rem] font-medium leading-snug text-muted-foreground">
          {IconComponent && (
            <span className="m-stat-card-icon grid size-[26px] shrink-0 place-items-center rounded-md text-[var(--accent-ink)]" aria-hidden="true">
              <IconComponent className="size-3.5" />
            </span>
          )}
          <span className="truncate">
            {label}
            {period && <span className="font-normal"> · {period}</span>}
          </span>
          {labelTitle && <InfoTip label={`About ${label.toLowerCase()}`} className="size-4">{labelTitle}</InfoTip>}
        </div>

        <div className="flex flex-wrap items-center gap-x-2.5 gap-y-1">
          <span className="font-[family-name:var(--font-display)] text-[1.875rem] font-semibold leading-none tracking-[-0.035em] tabular-nums text-foreground">
            <Figure value={value} />
            {unit && <span className="ml-0.5 text-[0.55em] font-medium tracking-normal text-muted-foreground">{unit}</span>}
          </span>
          {delta && <DeltaChip value={delta.value} unit={delta.unit} goodWhen={delta.goodWhen} />}
        </div>

        {meter && <Meter value={meter.value} max={meter.max} tone={meter.tone} label={meter.label} />}
      </div>

      {hasFooter && (
        <div className="m-stat-card-foot mt-3.5 flex min-h-10 items-center justify-between gap-2 rounded-b-[calc(var(--radius-lg)-1px)] border-t px-4 py-2.5 text-xs text-muted-foreground">
          {fact && (
            <span className="flex min-w-0 flex-1 items-center justify-between gap-2">
              <span className="truncate">{fact.label}</span>
              {fact.value !== undefined && <span className="shrink-0 font-semibold tabular-nums text-foreground">{fact.value}</span>}
            </span>
          )}
          {action && <span className="shrink-0 font-semibold">{action}</span>}
        </div>
      )}
    </div>
  );
}

/** "$41,920" → a muted "$" and a figure that counts up; anything else counts up as given. */
function Figure({ value }: { value: ReactNode }) {
  if (typeof value === "number") return <CountUp text={value.toLocaleString("en-US")} />;
  if (typeof value !== "string" || !/\d/.test(value)) return <>{value}</>;
  const currency = /^[$€£]/.exec(value)?.[0];
  if (!currency) return <CountUp text={value} />;
  return (
    <>
      <span className="mr-0.5 align-[0.55em] text-[0.55em] font-medium tracking-normal text-muted-foreground">{currency}</span>
      <CountUp text={value.slice(1)} />
    </>
  );
}
