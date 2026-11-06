"use client";

import { useEffect, useState } from "react";

import { DashNeeds, type DashNeed } from "@/components/app/home/dash/dash-kit";
import type { PendingSummary } from "@/lib/applications/listRules";

/**
 * The Overview's Needs you: the server's tiles at once, plus the two counts the browser reads from their own
 * routes (the same reads and rules as HomeAttention): appointments to close out and pending cases.
 */
export function DashNeedsLive({ items, pendingHref, closeOutHref, note }: { items: DashNeed[]; pendingHref: string | null; closeOutHref: string | null; note?: string }) {
  const [live, setLive] = useState<DashNeed[]>([]);

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
  const all = [...items, ...live].sort((a, b) => rank[a.tone] - rank[b.tone]);
  return <DashNeeds items={all} note={note} />;
}
