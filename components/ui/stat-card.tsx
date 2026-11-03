import type { ComponentType, ReactNode, SVGProps } from "react";

import { StatStrip, StatTile, type MeterTone } from "@/components/ui/stat";

/**
 * StatRow and StatCard draw the mockups' figure strip (owner 2026-10-30: "don't use the foundation
 * cards, use the same cards that we have on the mockups"): one card, cells split by hairlines, an
 * uppercase label, the figure, one short line under it. They are StatStrip and StatTile under
 * another name, so the pages that adopted the v3 cards look like every other page without a rewrite.
 *
 * `icon` is accepted and not drawn (the mockups have none). `period` and `fact` become the line
 * under the figure; `tone="warn"` colours the figure amber, as "Owed back" on the Source board.
 */

/** One row of figures under the page header. */
export function StatRow({ children, label, className }: { children: ReactNode; label?: string; className?: string }) {
  return <StatStrip label={label} className={className}>{children}</StatStrip>;
}

type Icon = ComponentType<SVGProps<SVGSVGElement>>;

export function StatCard({
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
  /** Accepted and not drawn (the mockups' figures have no icon). */
  icon?: Icon;
  label: string;
  /** What the figure covers: "today", "7 days". The line under the figure when there is no fact. */
  period?: string;
  labelTitle?: string;
  value: ReactNode;
  unit?: string;
  delta?: { value: number; unit?: string; goodWhen?: "up" | "down" | "neither" };
  meter?: { value: number; max?: number; tone?: MeterTone; label: string };
  /** The line under the figure: "Top source · Facebook 38". */
  fact?: { label: ReactNode; value?: ReactNode };
  action?: ReactNode;
  /** "warn" colours the figure amber: it needs action. One per row at most. */
  tone?: "default" | "warn";
  className?: string;
}) {
  const footnote = fact
    ? <>{fact.label}{fact.value !== undefined && <> · <span className="font-semibold text-foreground">{fact.value}</span></>}</>
    : period;
  return (
    <StatTile
      label={label}
      labelTitle={labelTitle}
      value={value}
      unit={unit}
      delta={delta}
      meter={meter}
      footnote={footnote}
      action={action}
      valueTone={tone === "warn" ? "warning" : undefined}
      className={className}
    />
  );
}
