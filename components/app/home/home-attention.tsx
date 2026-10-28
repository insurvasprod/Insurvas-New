"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { CircleCheck } from "lucide-react";

import type { AttentionItem, AttentionTone } from "@/lib/dashboard/homeView";
import type { PendingSummary } from "@/lib/applications/listRules";
import { cn } from "@/lib/utils";

const DOT: Record<AttentionTone, string> = { danger: "bg-[var(--error)]", warning: "bg-[var(--warning)]", info: "bg-[var(--info)]" };
const COUNT: Record<AttentionTone, string> = { danger: "text-[var(--error-ink)]", warning: "text-[var(--warning-ink)]", info: "text-[var(--info-ink)]" };

/**
 * "Needs you": every count that costs money when nobody looks, as one row of small links — the
 * transfers past SLA, overdue callbacks, licences, lapse signals from the server, and the two that
 * load in the browser (appointments needing an outcome, pending cases; same routes and scoping as
 * before). Only counts above zero. Nothing waiting is one quiet line, not an empty card.
 */
export function HomeAttention({
  items,
  pendingHref,
  closeOutHref,
  preview,
}: {
  items: AttentionItem[];
  /** Pending cases' page, when this home shows them; its count loads here. */
  pendingHref?: string | null;
  /** Where appointments needing an outcome are closed out, when this home shows them. */
  closeOutHref?: string | null;
  /** `/design/home` only: the browser-loaded items as given, without calling the routes. */
  preview?: AttentionItem[];
}) {
  const [live, setLive] = useState<AttentionItem[]>(preview ?? []);
  const [settled, setSettled] = useState(Boolean(preview) || (!pendingHref && !closeOutHref));

  useEffect(() => {
    if (preview) return;
    let active = true;
    const reads: Array<Promise<AttentionItem | null>> = [];
    if (closeOutHref) {
      reads.push(
        fetch("/api/app/appointments/close-out", { cache: "no-store" })
          .then(async (response) => (response.ok ? ((await response.json().catch(() => null)) as { appointments?: unknown[] } | null) : null))
          .then((body) => {
            const count = Array.isArray(body?.appointments) ? body.appointments.length : 0;
            return count ? { key: "closeOut", count, label: "to close out", detail: count === 1 ? "1 appointment" : undefined, tone: "warning" as const, href: closeOutHref } : null;
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
              label: count === 1 ? "pending case" : "pending cases",
              detail: summary.waitingOnClient.overdue ? `${summary.waitingOnClient.overdue} overdue` : summary.counteroffersExpiring.count ? `${summary.counteroffersExpiring.count} expiring` : undefined,
              tone: urgent ? ("danger" as const) : ("warning" as const),
              href: pendingHref,
            };
          })
          .catch(() => null),
      );
    }
    void Promise.all(reads).then((found) => {
      if (!active) return;
      setLive(found.filter((item): item is AttentionItem => item !== null));
      setSettled(true);
    });
    return () => { active = false; };
  }, [preview, pendingHref, closeOutHref]);

  const rank: Record<AttentionTone, number> = { danger: 0, warning: 1, info: 2 };
  const all = [...items, ...live].sort((a, b) => rank[a.tone] - rank[b.tone]);

  if (all.length === 0) {
    if (!settled) return <div aria-hidden="true" className="h-9" />;
    return (
      <p className="m-0 flex h-9 items-center gap-2 text-sm text-muted-foreground">
        <CircleCheck className="size-4 text-[var(--success-ink)]" aria-hidden="true" />
        <span><span className="font-medium text-foreground">All caught up.</span> Nothing is waiting on you.</span>
      </p>
    );
  }

  return (
    <nav aria-label="Needs you" className="flex min-w-0 flex-wrap items-center gap-1.5">
      <span className="mr-1 text-[0.8125rem] font-medium text-muted-foreground">Needs you</span>
      {all.map((item) => (
        <Link
          key={item.key}
          href={item.href}
          title={item.detail ? `${item.count} ${item.label} · ${item.detail}` : undefined}
          className="group inline-flex h-8 max-w-full items-center gap-1.5 rounded-lg border border-[var(--gloss-edge)] bg-[var(--surface)] px-2.5 text-[0.8125rem] text-inherit no-underline shadow-[var(--gloss-shadow)] transition-colors hover:border-[var(--border-strong)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--ring-color)]"
        >
          <span className={cn("mr-0.5 size-2 shrink-0 rounded-full", DOT[item.tone])} aria-hidden="true" />
          <span className={cn("font-semibold tabular-nums", COUNT[item.tone])}>{item.count.toLocaleString("en-US")}</span>
          <span className="truncate text-foreground">{item.label}</span>
          {/* The extra fact only where it is the urgent part ("1 past SLA"); elsewhere it is in the hover text. */}
          {item.detail && item.tone === "danger" && <span className="hidden shrink-0 text-[var(--error-ink)] sm:inline">· {item.detail}</span>}
        </Link>
      ))}
    </nav>
  );
}
