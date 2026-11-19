"use client";

import Link from "next/link";
import { useState, useTransition } from "react";
import { useRouter, useSearchParams } from "next/navigation";

import { Button } from "@/components/ui/button";
import { confirmAction } from "@/components/ui/confirm-dialog";
import { DataToolbar, RefreshButton } from "@/components/ui/data-toolbar";
import { FactTable } from "@/components/ui/fact-table";
import { setParamsInPlace } from "@/components/ui/nav-pending";
import { EmptyState } from "@/components/ui/page-states";
import { Pager, paginate } from "@/components/ui/pager";
import { Sheet } from "@/components/ui/sheet";
import { StatusChip, type StatusTone } from "@/components/ui/status-chip";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { TableCard } from "@/components/ui/table-card";
import { Segmented } from "@/components/ui/view-tabs";
import { formatUtcDateTime } from "@/lib/adminDashboard/figures";
import { notify } from "@/lib/notify";

export type ProviderEvent = {
  id: string;
  eventId: string;
  type: string;
  tenantId: string | null;
  tenantName: string | null;
  receivedAt: string;
  processedAt: string | null;
  error: string | null;
  attempts: number;
  /** The stored payload, pretty-printed and cut to a readable length. */
  payload: string;
  state: "processed" | "stuck" | "waiting";
};

type Show = "all" | "stuck" | "waiting";
const CHIP: Record<ProviderEvent["state"], { tone: StatusTone; label: string }> = {
  processed: { tone: "good", label: "Processed" },
  stuck: { tone: "danger", label: "Stuck" },
  waiting: { tone: "warning", label: "Not processed" },
};
const when = (iso: string | null) => formatUtcDateTime(iso) ?? "—";

/**
 * The provider's webhook events (admin round 1, billing-r2 screen 12), from the events table: newest first, and every
 * stuck one whatever its age. A stuck event (failed and never processed) can be replayed — today's processor run once
 * more on the stored event — from its row or its sheet, after a confirm. Super admin only, as the page.
 */
export function ProviderEvents({ events, truncatedAt }: { events: ProviderEvent[]; truncatedAt: number }) {
  const router = useRouter();
  const params = useSearchParams();
  const [refreshing, startRefresh] = useTransition();
  const [replaying, setReplaying] = useState<string | null>(null);
  const showParam = params.get("events");
  const show: Show = showParam === "stuck" || showParam === "waiting" ? showParam : "all";
  const page = Math.max(1, Number(params.get("page")) || 1);
  const openId = params.get("event");
  const visible = show === "all" ? events : events.filter((e) => e.state === show);
  const { current, rows } = paginate(visible, page, 12);
  const open = openId ? events.find((e) => e.id === openId) ?? null : null;
  const refresh = () => startRefresh(() => router.refresh());

  async function replay(event: ProviderEvent) {
    const ok = await confirmAction({
      title: `Replay ${event.type}?`,
      description: "Runs today's webhook processor once more on this event as Whop delivered it. Each step is idempotent on Whop's ids, so nothing is billed twice. The replay is recorded in the audit log.",
      confirmLabel: "Replay event",
      destructive: false,
    });
    if (!ok) return;
    setReplaying(event.id);
    const response = await fetch(`/api/admin/payments/webhooks/${event.id}/replay`, { method: "POST" }).catch(() => null);
    const body = response ? await response.json().catch(() => null) : null;
    setReplaying(null);
    if (!response || !response.ok) {
      notify.fail(body?.error ?? "The replay could not run.");
      return;
    }
    if (body?.ok) notify.done(`${event.type} processed`);
    else notify.fail(body?.error ?? "It failed again.");
    refresh();
  }

  const stuck = events.filter((e) => e.state === "stuck").length;
  const waiting = events.filter((e) => e.state === "waiting").length;

  return (
    <>
      <TableCard
        className="min-w-0"
        title="Webhook events"
        info={`What Whop has told us, newest first: the latest ${truncatedAt} and every stuck one. A stuck event failed and was never processed; replay it once the cause is fixed.`}
        footer={visible.length > 12 ? <Pager page={current} pageSize={12} total={visible.length} noun={visible.length === 1 ? "event" : "events"} suffix="newest first" onPage={(next) => setParamsInPlace({ page: next > 1 ? String(next) : null })} /> : undefined}
        toolbar={
          <DataToolbar actions={<RefreshButton onClick={refresh} refreshing={refreshing} />}>
            <Segmented
              label="Show events"
              value={show}
              onChange={(next) => setParamsInPlace({ events: next === "all" ? null : next, page: null })}
              options={[
                { key: "all", label: "All", count: events.length },
                { key: "stuck", label: "Stuck", count: stuck, tone: "danger" },
                { key: "waiting", label: "Not processed", count: waiting },
              ]}
            />
          </DataToolbar>
        }
      >
        {rows.length === 0 ? (
          <EmptyState title={show === "stuck" ? "Nothing is stuck" : events.length === 0 ? "No webhook has arrived yet" : "Nothing waits to be processed"} hint="Whop's events show here as they arrive." />
        ) : (
          <Table className="min-w-[640px]">
            <TableHeader>
              <TableRow>
                <TableHead>Event</TableHead>
                <TableHead>Customer</TableHead>
                <TableHead>Received</TableHead>
                <TableHead>Result</TableHead>
                <TableHead><span className="sr-only">Action</span></TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map((event) => (
                <TableRow key={event.id} className="cursor-pointer" onClick={() => setParamsInPlace({ event: event.id })}>
                  <TableCell className="font-medium text-foreground" title={event.error ?? undefined}>
                    <button type="button" className="hover:underline" onClick={(e) => { e.stopPropagation(); setParamsInPlace({ event: event.id }); }}>{event.type}</button>
                  </TableCell>
                  <TableCell className="max-w-[12rem] truncate">{event.tenantName ?? <span className="text-muted-foreground">—</span>}</TableCell>
                  <TableCell className="whitespace-nowrap tabular-nums">{when(event.receivedAt)}</TableCell>
                  <TableCell><StatusChip tone={CHIP[event.state].tone} dot>{CHIP[event.state].label}</StatusChip></TableCell>
                  <TableCell className="py-1 text-right">
                    {event.state === "processed" ? (
                      <span className="text-muted-foreground" aria-hidden="true">›</span>
                    ) : (
                      <Button type="button" variant="outline" size="sm" disabled={replaying === event.id} onClick={(e) => { e.stopPropagation(); void replay(event); }}>
                        {replaying === event.id ? "Replaying…" : "Replay"}
                      </Button>
                    )}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </TableCard>

      {open && (
        <Sheet
          key={open.id}
          title={open.type}
          subtitle={`Received ${when(open.receivedAt)}`}
          status={<StatusChip tone={CHIP[open.state].tone} dot>{CHIP[open.state].label}</StatusChip>}
          onClose={() => setParamsInPlace({ event: null })}
          footer={<>
            {open.state !== "processed" && (
              <Button type="button" variant="outline" disabled={replaying === open.id} onClick={() => void replay(open)}>
                {replaying === open.id ? "Replaying…" : "Replay"}
              </Button>
            )}
            <span className="flex-1" />
            <Button type="button" variant="ghost" onClick={() => setParamsInPlace({ event: null })}>Close</Button>
          </>}
        >
          <FactTable
            rows={[
              ["Whop event id", <code key="id" className="font-mono text-xs">{open.eventId}</code>],
              ["Customer", open.tenantId ? <Link key="t" href={`/admin/tenants/${open.tenantId}`} className="hover:underline">{open.tenantName ?? "Open the customer"}</Link> : "Not matched to a customer"],
              ["Processed", open.processedAt ? when(open.processedAt) : "Never"],
              ["Attempts", open.attempts.toLocaleString("en-US")],
              ["Last error", open.error],
            ]}
          />
          <section className="flex flex-col gap-2">
            <h3 className="m-0 text-sm font-semibold text-foreground">Payload</h3>
            <pre className="m-0 max-h-[50vh] overflow-auto rounded-md border border-border bg-[var(--surface-alt)] p-3 font-mono text-xs text-foreground">{open.payload}</pre>
          </section>
        </Sheet>
      )}
    </>
  );
}
