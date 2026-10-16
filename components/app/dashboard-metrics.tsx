import Link from "next/link";
import { Suspense } from "react";
import {
  ArrowRight, BookOpen, BriefcaseBusiness, CalendarCheck, ContactRound, ListChecks, PhoneIncoming, PhoneOutgoing, RadioTower, Receipt, Route, SquareStack, TriangleAlert,
  type LucideIcon,
} from "lucide-react";

import { CountUp } from "@/components/ui/count-up";
import { TableCard } from "@/components/ui/table-card";
import { tileFigureShown, type DashboardTile } from "@/lib/dashboard/tiles";
import { tileMetric } from "@/lib/dashboard/summaries";
import type { TenantRole } from "@/lib/tenantAuth/roles";

/**
 * "Your modules": one TableCard of linked cells, one per registered tile (LA-0.3: tiles registered
 * per module, gated by required_feature, absent when not entitled).
 *
 * Decision, 2026-10-13: this was "Across the agency", a grid of separate tile cards whose figures
 * were all tenant-wide, for every role — while the strip above it was personal for everyone but the
 * owner. That broke UI-CONSISTENCY §4 (never a grid of separate stat boxes) and showed a producer
 * the agency's number beside a link to their own page. Now it is one card (drawn like "Needs you
 * today"), and a cell carries its live figure only when the reader may read it at that scope:
 * the owner sees the agency's; anyone else sees a figure only for a queue the whole agency works
 * from (`shared` in lib/dashboard/tiles.ts), and otherwise the way in, without a number.
 *
 * Every figure streams in on its own, so one slow read holds one cell, not the card.
 */
const ICONS: Record<string, LucideIcon> = {
  "briefcase-business": BriefcaseBusiness,
  "calendar-check": CalendarCheck,
  "phone-incoming": PhoneIncoming,
  "radio-tower": RadioTower,
  "phone-outgoing": PhoneOutgoing,
  route: Route,
  "list-checks": ListChecks,
  "contact-round": ContactRound,
  "book-open": BookOpen,
  receipt: Receipt,
  "triangle-alert": TriangleAlert,
};

const TONE = { danger: "text-[var(--error-ink)]", warning: "text-[var(--warning-ink)]", good: "text-[var(--success-ink)]" } as const;

async function MetricFigure({ tile, tenantId }: { tile: DashboardTile; tenantId: string }) {
  const metric = await tileMetric(tile.key, tenantId);
  const shown = metric ? metric.display ?? metric.value.toLocaleString("en-US") : null;
  return (
    <>
      <span className="m-figure shrink-0 text-lg font-semibold leading-none tracking-[-0.02em] tabular-nums text-foreground" title={metric?.detail}>
        {shown && /\d/.test(shown) ? <CountUp text={shown} /> : shown ?? "—"}
      </span>
      <span className={`block truncate text-xs ${metric?.tone ? TONE[metric.tone] : "text-muted-foreground"}`} title={metric?.detail ?? tile.description}>
        {metric ? metric.caption : tile.action_label}
      </span>
    </>
  );
}

function MetricFallback() {
  return (
    <>
      <span className="m-skel block h-5 w-10 shrink-0 rounded" />
      <span className="m-skel block h-3.5 w-24 rounded" />
    </>
  );
}

export function DashboardMetrics({ tiles, tenantId, role }: { tiles: DashboardTile[]; tenantId: string; role: TenantRole }) {
  if (!tiles.length) return null;
  return (
    <TableCard title="Your modules">
      <ul className="m-0 grid list-none grid-cols-1 gap-px overflow-hidden border-t border-border bg-border p-0 sm:grid-cols-2 xl:grid-cols-3">
        {tiles.map((tile) => {
          const Icon = ICONS[tile.icon] ?? SquareStack;
          const figure = tileFigureShown(tile, role);
          return (
            <li key={tile.key} className="bg-card">
              <Link
                href={tile.path}
                aria-label={`${tile.label}: ${tile.action_label}`}
                className="m-row group flex min-w-0 items-center gap-3 px-4 py-3 text-inherit no-underline"
              >
                <Icon className="size-4 shrink-0 text-muted-foreground transition-colors group-hover:text-[var(--accent-ink)]" aria-hidden="true" />
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm font-semibold text-foreground">{tile.label}</span>
                  {!figure && <span className="block truncate text-xs text-muted-foreground" title={tile.description}>{tile.action_label}</span>}
                </span>
                {figure && (
                  <span className="flex min-w-0 max-w-[50%] flex-col items-end gap-1 text-right">
                    <Suspense fallback={<MetricFallback />}>
                      <MetricFigure tile={tile} tenantId={tenantId} />
                    </Suspense>
                  </span>
                )}
                <ArrowRight className="size-4 shrink-0 text-muted-foreground opacity-0 transition-opacity group-hover:opacity-100 group-focus-visible:opacity-100" aria-hidden="true" />
              </Link>
            </li>
          );
        })}
      </ul>
    </TableCard>
  );
}
