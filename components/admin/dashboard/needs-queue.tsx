"use client";

import { useState, type ReactNode } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";

import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { useClockSeconds } from "@/components/ui/live-stamp";
import { setParamsInPlace } from "@/components/ui/nav-pending";
import { EmptyState } from "@/components/ui/page-states";
import { StatusChip } from "@/components/ui/status-chip";
import { Segmented } from "@/components/ui/view-tabs";
import { DashboardRefresh } from "@/components/admin/dashboard-refresh";
import { cn } from "@/lib/utils";
import type { DailyCheck } from "@/lib/adminDashboard/dailyChecks";
import {
  CHECK_CHIP,
  CHECK_EXPLAIN,
  NEEDS_VIEW_LABELS,
  NEEDS_VIEWS,
  groupForView,
  needsCounts,
  resolveSelection,
  shortTitle,
  type NeedsView,
} from "@/lib/adminDashboard/needsQueue";

const EMPTY: Record<NeedsView, { title: string; hint: string }> = {
  todo: { title: "Nothing to do", hint: "No check is failing or needs a look. FYI and Clear hold the rest." },
  fyi: { title: "Nothing to note", hint: "No check has anything to tell you today." },
  clear: { title: "No check is clear", hint: "Every check needs a look or has something to tell you." },
};

function checkedAgo(at: number, nowSeconds: number | null): string {
  if (nowSeconds === null) return "checked just now";
  const seconds = Math.max(0, nowSeconds - Math.floor(at / 1000));
  if (seconds < 60) return "checked just now";
  const minutes = Math.floor(seconds / 60);
  return minutes < 60 ? `checked ${minutes} minute${minutes === 1 ? "" : "s"} ago` : `checked ${Math.floor(minutes / 60)} hour${minutes < 120 ? "" : "s"} ago`;
}

/**
 * Needs you's work queue (admin round 1 §2, the board's B): the role's daily checks grouped by area, worst
 * first, one chip each, with the To do · FYI · Clear switch; the selected check on the right with its plain
 * explanation, its rows (rendered on the server, passed in as `panes`) and its real action. The view and the
 * check live in the address (?view=, ?check=) and switch in place, without a trip to the server.
 */
export function NeedsQueue({ checks, panes, checkedAt }: { checks: DailyCheck[]; panes: Record<string, ReactNode>; checkedAt: number }) {
  const params = useSearchParams();
  const nowSeconds = useClockSeconds();
  // The address on arrival, then the reader's picks: held here, and written back with setParamsInPlace (no server trip).
  const [asked, setAsked] = useState<{ view: string | null; check: string | null }>(() => ({ view: params.get("view"), check: params.get("check") }));
  const { view, check: selected } = resolveSelection(checks, asked.view, asked.check);
  const counts = needsCounts(checks);
  const groups = groupForView(checks, view);

  const pick = (next: { view?: NeedsView; check?: string | null }) => {
    const chosen = { view: next.view ?? view, check: next.check ?? null };
    setAsked(chosen);
    setParamsInPlace({ tab: "needs", ...chosen });
  };

  const summary = [
    counts.failing ? `${counts.failing} failing` : null,
    counts.look ? `${counts.look} to look at` : null,
    counts.unknown ? `${counts.unknown} couldn't be checked` : null,
    checkedAgo(checkedAt, nowSeconds),
  ].filter(Boolean);

  return (
    <div className="flex min-w-0 flex-col gap-3">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-xs text-muted-foreground tabular-nums">{summary.join(" · ")}</p>
        <div className="flex flex-wrap items-center gap-2">
          <Segmented
            label="Which checks"
            value={view}
            onChange={(next) => pick({ view: next })}
            options={NEEDS_VIEWS.map((key) => ({ key, label: NEEDS_VIEW_LABELS[key], count: counts[key], tone: key === "todo" && counts.failing ? ("danger" as const) : undefined }))}
          />
          <DashboardRefresh />
        </div>
      </div>

      {groups.length === 0 ? (
        <Card className="py-0">
          <EmptyState title={EMPTY[view].title} hint={EMPTY[view].hint} />
        </Card>
      ) : (
        <div className="grid min-w-0 gap-3 lg:grid-cols-[minmax(260px,340px)_minmax(0,1fr)]">
          <Card className="min-w-0 gap-0 py-2" aria-label="Checks">
            {groups.map((group) => (
              <section key={group.area} aria-label={group.area} className="py-1">
                <h3 className="px-4 pb-1 pt-2 text-xs font-semibold text-muted-foreground">
                  {group.area} · {group.checks.length}
                </h3>
                <ul>
                  {group.checks.map((check) => {
                    const on = selected?.key === check.key;
                    const chip = CHECK_CHIP[check.status];
                    return (
                      <li key={check.key}>
                        <button
                          type="button"
                          aria-current={on ? "true" : undefined}
                          onClick={() => pick({ check: check.key })}
                          className={cn(
                            "flex w-full items-center gap-3 px-4 py-2 text-left outline-none transition-colors focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring",
                            on ? "bg-[var(--primary-soft)]" : "hover:bg-[var(--hover-wash)]",
                          )}
                        >
                          <span className="min-w-0 flex-1">
                            <span className="block truncate text-sm font-medium text-foreground">{shortTitle(check)}</span>
                            <span className="block truncate text-xs text-muted-foreground">{check.detail}</span>
                          </span>
                          <StatusChip tone={chip.tone}>{chip.label}</StatusChip>
                        </button>
                      </li>
                    );
                  })}
                </ul>
              </section>
            ))}
          </Card>

          {selected && (
            <Card key={selected.key} className={cn("m-content-in min-w-0 gap-3", panes[selected.key] && "pb-0")} aria-label={selected.title}>
              <div className="flex flex-wrap items-center gap-2 px-4">
                <h2 className="text-card-title text-[var(--ink)]">{selected.title}</h2>
                <StatusChip tone={CHECK_CHIP[selected.status].tone}>{CHECK_CHIP[selected.status].label}</StatusChip>
                <div className="ml-auto">
                  <Button asChild variant={selected.status === "failing" || selected.status === "look" ? "default" : "secondary"}>
                    <Link href={selected.href}>{selected.actionLabel}</Link>
                  </Button>
                </div>
              </div>
              <div className="flex flex-col gap-1 px-4">
                <p className="text-sm text-foreground">{selected.detail}</p>
                {CHECK_EXPLAIN[selected.key] && <p className="text-sm text-muted-foreground">{CHECK_EXPLAIN[selected.key]}</p>}
              </div>
              {panes[selected.key] && <div className="min-w-0 border-t border-[var(--rule)] pb-2">{panes[selected.key]}</div>}
            </Card>
          )}
        </div>
      )}
    </div>
  );
}
