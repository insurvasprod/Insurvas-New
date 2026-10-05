"use client";

/**
 * The dashboard's LA-3 card (LA-3.15, 3.18, 3.26): Awaiting policy number, Waiting on the client /
 * overdue, Counteroffers expiring — each a way into its Pending cases tab. Reads
 * /api/app/pending/summary (tenant-scoped); renders nothing for a tenant without Applications or a
 * role outside owner / producer (the route answers 403), and nothing until the schema is live.
 */

import { useEffect, useState } from "react";
import Link from "next/link";

import { Card, CardContent } from "@/components/ui/card";
import { LinkArrow } from "@/components/ui/link-arrow";
import { SectionLoading } from "@/components/ui/page-states";
import { StatusChip } from "@/components/ui/status-chip";
import { expiryCountdown, type PendingSummary } from "@/lib/applications/listRules";

type State = { status: "loading" } | { status: "hidden" } | { status: "error" } | { status: "ready"; summary: PendingSummary };

export function PendingSummaryCard({ initial = null, className }: { initial?: PendingSummary | null; className?: string }) {
  const [state, setState] = useState<State>(initial ? { status: "ready", summary: initial } : { status: "loading" });
  const [now] = useState(() => Date.now());

  useEffect(() => {
    let live = true;
    fetch("/api/app/pending/summary", { cache: "no-store" })
      .then(async (r) => ({ ok: r.ok, status: r.status, body: (await r.json().catch(() => null)) as { summary?: PendingSummary } | null }))
      .then(({ ok, status, body }) => {
        if (!live) return;
        if (ok && body?.summary) setState({ status: "ready", summary: body.summary });
        else if (status === 403 || status === 401 || status === 503) setState({ status: "hidden" });
        else setState((s) => (s.status === "ready" ? s : { status: "error" }));
      })
      .catch(() => { if (live) setState((s) => (s.status === "ready" ? s : { status: "error" })); });
    return () => { live = false; };
  }, []);

  if (state.status === "hidden") return null;

  return (
    <Card className={`m-card h-full ${className ?? ""}`}>
      <CardContent className="flex h-full flex-col p-5">
        <div className="flex items-baseline justify-between gap-3 pb-3">
          <h2 className="text-sm font-semibold leading-normal tracking-[-0.01em]">Pending cases</h2>
          <LinkArrow href="/app/pending" className="shrink-0 text-xs">Open pending cases</LinkArrow>
        </div>
        {state.status === "loading" && <SectionLoading rows={3} columns={2} label="Loading pending cases" />}
        {state.status === "error" && <p className="text-sm text-muted-foreground">Could not load the pending figures. Open Pending cases to see them.</p>}
        {state.status === "ready" && (() => {
          const s = state.summary;
          const soonest = expiryCountdown(s.counteroffersExpiring.soonestExpiresAt, now);
          const rows = [
            {
              key: "awaiting", href: "/app/pending?tab=awaiting", label: "Awaiting policy number", value: s.awaitingPolicyNumber.count,
              detail: s.awaitingPolicyNumber.count ? `${s.awaitingPolicyNumber.missingReference} no carrier reference · ${s.awaitingPolicyNumber.missingPolicyNumber} issued, no policy #` : "Every application has its number",
              tone: s.awaitingPolicyNumber.count ? ("danger" as const) : null,
            },
            {
              key: "client", href: "/app/pending", label: "Waiting on the client", value: s.waitingOnClient.count,
              detail: s.waitingOnClient.overdue ? `${s.waitingOnClient.overdue} overdue — older than ${s.waitingOnClient.overdueAfterDays} days` : "Nothing overdue",
              tone: s.waitingOnClient.overdue ? ("danger" as const) : s.waitingOnClient.count ? ("warning" as const) : null,
            },
            {
              key: "counteroffers", href: "/app/pending?tab=counteroffers", label: "Counteroffers expiring", value: s.counteroffersExpiring.count,
              detail: s.counteroffersExpiring.count ? `Inside ${s.counteroffersExpiring.withinDays} days${soonest ? ` · first ${soonest.label}` : ""}` : `None inside ${s.counteroffersExpiring.withinDays} days`,
              tone: s.counteroffersExpiring.count ? ("warning" as const) : null,
            },
          ];
          return (
            <div>
              {rows.map((row, index) => (
                <Link key={row.key} href={row.href} aria-label={`${row.label}: ${row.value}`} className={`m-row flex items-center gap-3 px-3 py-2 text-inherit no-underline ${index ? "border-t border-border" : ""}`}>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm font-semibold">{row.label}</span>
                    <span className="block truncate text-xs text-muted-foreground">{row.detail}</span>
                  </span>
                  {row.tone ? <StatusChip tone={row.tone} dot={false}>{row.value}</StatusChip> : <span className="text-sm font-semibold tabular-nums text-muted-foreground">{row.value}</span>}
                </Link>
              ))}
            </div>
          );
        })()}
      </CardContent>
    </Card>
  );
}
