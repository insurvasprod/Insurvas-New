import type { ReactNode } from "react";
import Link from "next/link";

import { Card } from "@/components/ui/card";
import { ChartHeading } from "@/components/ui/chart";

/**
 * One chart on Team activity's chart view (Reports round 7, owner pick 2·A, 2026-11-11): the kit's heading (what it
 * shows, the period and the figure the card used to carry) with "Open as a table ›" on its right, then the drawing.
 * No hooks, so the Team activity workspace and an agent's page both draw it.
 */
export function ActivityChartCard({ title, period, tableHref, action, children }: { title: string; period?: string; tableHref?: string; action?: ReactNode; children: ReactNode }) {
  return (
    <Card className="min-w-0 px-4">
      <ChartHeading
        title={title}
        period={period}
        action={action ?? (tableHref ? <Link href={tableHref} className="whitespace-nowrap text-sm font-medium text-[var(--accent-ink)] hover:underline">Open as a table ›</Link> : undefined)}
      />
      {children}
    </Card>
  );
}
