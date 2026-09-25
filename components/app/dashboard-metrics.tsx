import Link from "next/link";
import { Suspense } from "react";
import {
  BookOpen, BriefcaseBusiness, CalendarCheck, ContactRound, ListChecks, PhoneIncoming, PhoneOutgoing, RadioTower, Receipt, Route, SquareStack,
  type LucideIcon,
} from "lucide-react";

import type { DashboardTile } from "@/lib/dashboard/tiles";
import { tileMetric } from "@/lib/dashboard/summaries";

/**
 * The dashboard's metrics grid: one compact cell per registered tile, each a live number with a
 * caption, linking to the screen behind it. It replaces the "Your workspace" card grid — the same
 * registry, filtered by feature and role exactly as before, so nobody loses a way in; each cell now
 * leads with the figure instead of a paragraph. The full sentence is the cell's hover text.
 *
 * Every figure streams in on its own, so one slow read holds one cell, not the grid.
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
};

const TONE = { danger: "text-[var(--error-ink)]", warning: "text-[var(--warning-ink)]", good: "text-[var(--success-ink)]" } as const;

async function MetricFigure({ tile, tenantId }: { tile: DashboardTile; tenantId: string }) {
  const metric = await tileMetric(tile.key, tenantId);
  return (
    <>
      <span className="mt-2 block text-2xl font-semibold leading-[1.2] tracking-[-0.025em] tabular-nums text-foreground" title={metric?.detail}>
        {metric ? metric.value.toLocaleString("en-US") : "—"}
      </span>
      <span className={`mt-0.5 block truncate text-xs leading-normal ${metric?.tone ? TONE[metric.tone] : "text-muted-foreground"}`} title={metric?.detail ?? tile.description}>
        {metric ? metric.caption : tile.action_label}
      </span>
    </>
  );
}

function MetricFallback() {
  return (
    <>
      <span className="m-skel mt-2 block h-[29px] w-14 rounded" />
      <span className="m-skel mt-1 block h-3.5 w-24 rounded" />
    </>
  );
}

export function DashboardMetrics({ tiles, tenantId }: { tiles: DashboardTile[]; tenantId: string }) {
  if (!tiles.length) return null;
  return (
    <section aria-labelledby="metrics-heading" className="space-y-3">
      <div className="flex items-baseline justify-between gap-3">
        <h2 id="metrics-heading" className="text-sm font-semibold leading-normal tracking-[-0.01em] text-foreground">Across the agency</h2>
        <p className="text-xs text-muted-foreground">Live counts · select one to open it</p>
      </div>
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4 2xl:grid-cols-6">
        {tiles.map((tile) => {
          const Icon = ICONS[tile.icon] ?? SquareStack;
          return (
            <Link
              key={tile.key}
              href={tile.path}
              aria-label={`${tile.label} — ${tile.action_label}`}
              className="m-card group relative flex min-w-0 flex-col rounded-xl border border-border bg-card px-4 py-3.5 text-inherit no-underline outline-none transition-colors hover:border-[color-mix(in_srgb,var(--primary)_45%,var(--border))] focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background"
            >
              <span className="flex items-center gap-2">
                <Icon className="size-4 shrink-0 text-muted-foreground transition-colors group-hover:text-[var(--primary)]" aria-hidden="true" />
                <span className="min-w-0 flex-1 truncate text-xs font-semibold text-muted-foreground">{tile.label}</span>
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"
                  className="size-3.5 shrink-0 -translate-x-1 text-foreground opacity-0 transition-[opacity,transform] duration-150 group-hover:translate-x-0 group-hover:opacity-100 motion-reduce:transition-none">
                  <path d="M5 12h13M13 6l6 6-6 6" />
                </svg>
              </span>
              <Suspense fallback={<MetricFallback />}>
                <MetricFigure tile={tile} tenantId={tenantId} />
              </Suspense>
            </Link>
          );
        })}
      </div>
    </section>
  );
}
