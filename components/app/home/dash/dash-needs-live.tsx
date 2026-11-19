"use client";

import { useEffect, useState } from "react";

import { DashNeeds, DashNeedsBar, type DashNeed } from "@/components/app/home/dash/dash-kit";
import { useArrivals } from "@/components/ui/use-arrivals";
import { useDepartures } from "@/components/ui/use-row-exit";
import type { PendingSummary } from "@/lib/applications/listRules";

/**
 * The Overview's Needs you: the server's tiles at once, plus the two counts the browser reads from their own
 * routes (the same reads and rules as HomeAttention): appointments to close out and pending cases.
 *
 * Tier 1 motion (2026-11-17): a tile handled since the last read (a refresh, or a read of its route) plays out in
 * its place; one that comes in afterwards arrives tinted. The first answer of the browser's reads is part of the
 * page opening, so it is the baseline and lights nothing.
 */
export function DashNeedsLive({ items, pendingHref, closeOutHref, note, compact = false }: { items: DashNeed[]; pendingHref: string | null; closeOutHref: string | null; note?: string; /** The compact Home's low strip (DashNeedsBar). */ compact?: boolean }) {
  const [live, setLive] = useState<DashNeed[] | null>(null);

  useEffect(() => {
    let active = true;
    const reads: Array<Promise<DashNeed | null>> = [];
    if (closeOutHref) {
      reads.push(
        fetch("/api/app/appointments/close-out", { cache: "no-store" })
          .then(async (response) => (response.ok ? ((await response.json().catch(() => null)) as { appointments?: unknown[] } | null) : null))
          .then((body) => {
            const count = Array.isArray(body?.appointments) ? body.appointments.length : 0;
            return count ? { key: "closeOut", count, label: count === 1 ? "Appointment to close out" : "Appointments to close out", detail: "Record how each one went", tone: "warning" as const, href: closeOutHref } : null;
          })
          .catch(() => null),
      );
    }
    if (pendingHref) {
      reads.push(
        fetch("/api/app/pending/summary", { cache: "no-store" })
          .then(async (response) => (response.ok ? ((await response.json().catch(() => null)) as { summary?: PendingSummary } | null)?.summary ?? null : null))
          .then((summary) => {
            if (!summary) return null;
            const count = summary.awaitingPolicyNumber.count + summary.waitingOnClient.count + summary.counteroffersExpiring.count;
            if (!count) return null;
            const urgent = summary.awaitingPolicyNumber.count + summary.waitingOnClient.overdue;
            return {
              key: "pending",
              count,
              label: count === 1 ? "Pending case" : "Pending cases",
              detail: summary.waitingOnClient.overdue ? `${summary.waitingOnClient.overdue} overdue` : summary.counteroffersExpiring.count ? `${summary.counteroffersExpiring.count} expiring` : "Between submitted and issued",
              tone: urgent ? ("danger" as const) : ("warning" as const),
              href: pendingHref,
            };
          })
          .catch(() => null),
      );
    }
    if (!reads.length) return;
    void Promise.all(reads).then((found) => {
      if (active) setLive(found.filter((item): item is DashNeed => item !== null));
    });
    return () => { active = false; };
  }, [pendingHref, closeOutHref]);

  const rank = { danger: 0, warning: 1, info: 2, good: 3, neutral: 4 } as const;
  const all = [...items, ...(live ?? [])].filter((item) => item.count > 0).sort((a, b) => rank[a.tone] - rank[b.tone]);
  const left = useDepartures(all, (item) => item.key);
  const isNew = useArrivals(all.map((item) => item.key), live === null);
  const tiles = left.rows.map((item) => ({ ...item, motion: left.isLeaving(item.key) ? left.rowProps(item.key) : isNew(item.key) ? { "data-row-new": "" as const } : undefined }));
  return compact ? <DashNeedsBar items={tiles} /> : <DashNeeds items={tiles} note={note} />;
}
