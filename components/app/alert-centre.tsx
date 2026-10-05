"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { CircleCheck, TriangleAlert } from "lucide-react";

import { Button } from "@/components/ui/button";
import { RefreshButton } from "@/components/ui/data-toolbar";
import { EmptyState } from "@/components/ui/page-states";
import { TableCard } from "@/components/ui/table-card";
import type { CentreEntry } from "@/lib/agentAlerts/centre";
import { KBD_ITEM_ATTRIBUTE, KBD_LIST_ATTRIBUTE } from "@/lib/keyboard/listNavigation";
import { notify } from "@/lib/notify";
import { dateTime } from "@/lib/format/dates";
import { useViewerTimeZone } from "@/components/app/use-viewer-time-zone";

/**
 * The alert centre's two lists. Open alerts carry the action that resolves them — claiming the
 * lead, for a role that can claim — and resolved ones say what resolved them. Rows are J/K rows.
 */

/** A day or more back, the moment reads in `zone`: UTC in the server render, the viewer's own once mounted. */
function when(iso: string, zone: string) {
  const date = new Date(iso);
  const minutes = Math.round((Date.now() - date.getTime()) / 60_000);
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes} min ago`;
  if (minutes < 24 * 60) return `${Math.round(minutes / 60)} h ago`;
  return dateTime(date, zone, { weekday: true, clock: "12h" });
}

const ARROW = (
  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M5 12h13M13 6l6 6-6 6" /></svg>
);

function OpenAlert({ entry, canClaim }: { entry: CentreEntry; canClaim: boolean }) {
  const router = useRouter();
  const [claiming, setClaiming] = useState(false);
  const zone = useViewerTimeZone() ?? "UTC";

  async function claim() {
    if (!entry.workItemId) return;
    setClaiming(true);
    try {
      const response = await fetch("/api/app/inbound/claim", {
        method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ work_item_id: entry.workItemId }),
      });
      const body = (await response.json().catch(() => null)) as { error?: string } | null;
      if (!response.ok) {
        notify.block(body?.error ?? "That lead could not be claimed.");
        // Someone else may have claimed it: the list is re-read so the row moves to resolved.
        router.refresh();
        return;
      }
      notify.done("Claimed. The lead is yours.");
      router.push(entry.link);
    } catch {
      notify.fail("That lead could not be claimed. Nothing has changed; try again.");
    } finally {
      setClaiming(false);
    }
  }

  return (
    <li className="portal-top-alert" data-severity={entry.severity}>
      <TriangleAlert className="size-4 shrink-0" aria-hidden="true" />
      <span className="min-w-0 flex-1">
        <span className="portal-top-alert-title">{entry.title}</span>
        <span className="portal-top-alert-body">{entry.body}</span>
        <span className="portal-top-alert-body">Raised {when(entry.raisedAt, zone)}</span>
        <span className="mt-2 flex flex-wrap items-center gap-3">
          {canClaim && entry.workItemId && (
            <Button type="button" size="sm" onClick={() => void claim()} disabled={claiming} aria-busy={claiming} {...{ [KBD_ITEM_ATTRIBUTE]: "" }}>
              {claiming ? "Claiming…" : "Claim this lead"}
            </Button>
          )}
          <a href={entry.link} className="portal-top-alert-cta m-arrow" style={{ marginTop: 0 }} {...(canClaim && entry.workItemId ? {} : { [KBD_ITEM_ATTRIBUTE]: "" })}>
            Open the lead{ARROW}
          </a>
        </span>
      </span>
    </li>
  );
}

function ResolvedAlert({ entry }: { entry: CentreEntry }) {
  const zone = useViewerTimeZone() ?? "UTC";
  return (
    <li className="flex gap-2.5 border-b border-[var(--border)] px-3.5 py-3 last:border-b-0">
      <CircleCheck className="mt-0.5 size-4 shrink-0 text-[var(--success)]" aria-hidden="true" />
      <span className="min-w-0 flex-1">
        <span className="block text-sm font-semibold text-[var(--ink)]">{entry.title}</span>
        <span className="mt-0.5 block text-xs text-[var(--body)]">
          {entry.resolution}{entry.resolvedAt ? ` · ${when(entry.resolvedAt, zone)}` : ""} · raised {when(entry.raisedAt, zone)}
        </span>
        <a href={entry.link} {...{ [KBD_ITEM_ATTRIBUTE]: "" }} className="portal-top-alert-cta m-arrow">Open the lead{ARROW}</a>
      </span>
    </li>
  );
}

/** The alert centre is server-rendered; Refresh re-reads the whole page (lists, SLA job, digest). */
export function PageRefreshButton() {
  const router = useRouter();
  const [refreshing, startRefresh] = useTransition();
  return <RefreshButton onClick={() => startRefresh(() => router.refresh())} refreshing={refreshing} />;
}

export function AlertCentre({ open, resolved, canClaim }: { open: CentreEntry[]; resolved: CentreEntry[]; canClaim: boolean }) {
  return (
    <>
      <TableCard
        title="Open"
        action={<>
          <span className="text-xs text-[var(--muted)]">{open.length === 1 ? "1 alert open" : `${open.length} alerts open`}</span>
          <PageRefreshButton />
        </>}
      >
        {open.length
          ? <ul className="border-t border-[var(--border)]" {...{ [KBD_LIST_ATTRIBUTE]: "" }}>{open.map((entry) => <OpenAlert key={entry.leadId} entry={entry} canClaim={canClaim} />)}</ul>
          : <EmptyState title="Nothing is wrong with the queue" hint="Unclaimed leads and escalations appear here the moment they are raised." />}
      </TableCard>

      <TableCard title="Resolved this week" action={<span className="text-xs text-[var(--muted)]">Last 7 days</span>}>
        {resolved.length
          ? <ul className="border-t border-[var(--border)]" {...{ [KBD_LIST_ATTRIBUTE]: "" }}>{resolved.map((entry) => <ResolvedAlert key={entry.leadId} entry={entry} />)}</ul>
          : <EmptyState title="Nothing resolved this week" hint="A fixed alert moves here with what resolved it." />}
      </TableCard>
    </>
  );
}
