"use client";

import { useMemo, useState, useTransition, type ReactNode } from "react";
import { useRouter } from "next/navigation";

import { Button } from "@/components/ui/button";
import { ClearFiltersButton, DataToolbar, RefreshButton, ToolbarSearch } from "@/components/ui/data-toolbar";
import { EmptyState, ErrorState, NoMatches } from "@/components/ui/page-states";
import { Pager, paginate } from "@/components/ui/pager";
import { StatusChip } from "@/components/ui/status-chip";
import { TableCard } from "@/components/ui/table-card";
import { Segmented, ViewTabs } from "@/components/app/view-tabs";
import type { CentreEntry } from "@/lib/agentAlerts/centre";
import { KBD_ITEM_ATTRIBUTE, KBD_LIST_ATTRIBUTE } from "@/lib/keyboard/listNavigation";
import { notify } from "@/lib/notify";
import { dateTime } from "@/lib/format/dates";
import { useViewerTimeZone } from "@/components/app/use-viewer-time-zone";
import { useFittingPageSize } from "@/components/ui/use-fitting-page-size";

/**
 * The alert centre's lists. Open alerts carry the action that resolves them — claiming the lead,
 * for a role that can claim — and resolved ones say what resolved them. Rows are J/K rows.
 *
 * 2026-10-06 redesign: Open, Resolved this week and the daily digest are tabs on one row, each a
 * table with its own search, instead of three cards stacked down the page.
 */

type Tab = "open" | "resolved" | "digest";
type Severity = "all" | "critical" | "warning";

/** The tab's one card reaches the bottom of the window. */
const FILL = "flex min-h-[calc(100dvh-var(--top-bar-h)-330px)] flex-col [&>*:nth-child(2)]:flex-1";
const th = "bg-[var(--surface-alt)] px-3 py-2 text-left text-xs font-semibold uppercase leading-[1.33] tracking-[0.02em] whitespace-nowrap text-muted-foreground first:pl-4 last:pr-4";
const td = "border-t border-border px-3 py-2 text-sm leading-normal tracking-[-0.02em] text-[var(--body)] first:pl-4 last:pr-4";

/** A day or more back, the moment reads in `zone`: UTC in the server render, the viewer's own once mounted. */
function when(iso: string, zone: string) {
  const date = new Date(iso);
  const minutes = Math.round((Date.now() - date.getTime()) / 60_000);
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes} min ago`;
  if (minutes < 24 * 60) return `${Math.round(minutes / 60)} h ago`;
  return dateTime(date, zone, { weekday: true, clock: "12h" });
}


function OpenAlertRow({ entry, canClaim }: { entry: CentreEntry; canClaim: boolean }) {
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
        notify.block(body?.error ?? "That caller could not be taken.");
        // Someone else may have claimed it: the list is re-read so the row moves to resolved.
        router.refresh();
        return;
      }
      notify.done("Claimed. The lead is yours.");
      router.push(entry.link);
    } catch {
      notify.fail("That caller could not be taken. Nothing has changed; try again.");
    } finally {
      setClaiming(false);
    }
  }

  const claimable = canClaim && Boolean(entry.workItemId);
  return (
    <tr className="m-row">
      <td className={td}><StatusChip tone={entry.severity === "critical" ? "danger" : "warning"}>{entry.severity === "critical" ? "Critical" : "Warning"}</StatusChip></td>
      <td className={`${td} max-w-[260px] truncate font-semibold text-[var(--ink)]`} title={entry.title}>{entry.title}</td>
      <td className={`${td} max-w-[420px] truncate`} title={entry.body}>{entry.body}</td>
      <td className={`${td} whitespace-nowrap tabular-nums`}>{when(entry.raisedAt, zone)}</td>
      <td className={`${td} whitespace-nowrap text-right`}>
        <span className="inline-flex items-center gap-2">
          {claimable && (
            <Button type="button" size="sm" onClick={() => void claim()} disabled={claiming} aria-busy={claiming} {...{ [KBD_ITEM_ATTRIBUTE]: "" }}>
              {claiming ? "Taking…" : "Take this call"}
            </Button>
          )}
          <Button asChild variant="outline" size="sm">
            <a href={entry.link} {...(claimable ? {} : { [KBD_ITEM_ATTRIBUTE]: "" })}>Open the lead</a>
          </Button>
        </span>
      </td>
    </tr>
  );
}

function ResolvedAlertRow({ entry }: { entry: CentreEntry }) {
  const zone = useViewerTimeZone() ?? "UTC";
  return (
    <tr className="m-row">
      <td className={`${td} max-w-[260px] truncate font-semibold text-[var(--ink)]`} title={entry.title}>{entry.title}</td>
      <td className={`${td} max-w-[320px] truncate`} title={entry.resolution ?? undefined}>{entry.resolution ?? "—"}</td>
      <td className={`${td} whitespace-nowrap tabular-nums`}>{entry.resolvedAt ? when(entry.resolvedAt, zone) : "—"}</td>
      <td className={`${td} whitespace-nowrap tabular-nums`}>{when(entry.raisedAt, zone)}</td>
      <td className={`${td} text-right`}>
        <Button asChild variant="outline" size="sm"><a href={entry.link} {...{ [KBD_ITEM_ATTRIBUTE]: "" }}>Open the lead</a></Button>
      </td>
    </tr>
  );
}

/** The alert centre is server-rendered; Refresh re-reads the whole page (lists, SLA job, digest). */
export function PageRefreshButton() {
  const router = useRouter();
  const [refreshing, startRefresh] = useTransition();
  return <RefreshButton onClick={() => startRefresh(() => router.refresh())} refreshing={refreshing} />;
}

export function AlertCentre({ lists, canClaim, digest }: {
  /** Null when the queue could not be read: the lists say so instead of claiming nothing is open. */
  lists: { open: CentreEntry[]; resolved: CentreEntry[] } | null;
  canClaim: boolean;
  /** The daily digest (or the line saying it could not be read), drawn as the third tab. */
  digest?: ReactNode;
}) {
  const [tab, setTab] = useState<Tab>("open");
  const [search, setSearch] = useState("");
  const [severity, setSeverity] = useState<Severity>("all");
  const [page, setPage] = useState(1);
  const pageSize = useFittingPageSize(480, 45);
  const open = useMemo(() => lists?.open ?? [], [lists]);
  const resolved = useMemo(() => lists?.resolved ?? [], [lists]);

  const needle = search.trim().toLowerCase();
  const hit = (entry: CentreEntry) => !needle || [entry.title, entry.body, entry.resolution].some((value) => value?.toLowerCase().includes(needle));
  const shownOpen = open.filter((entry) => hit(entry) && (severity === "all" || entry.severity === severity));
  const shownResolved = resolved.filter(hit);
  const rows = tab === "open" ? shownOpen : shownResolved;
  const { current, rows: pageRows } = paginate(rows, page, pageSize);
  const filtered = Boolean(needle) || (tab === "open" && severity !== "all");
  const clear = () => { setSearch(""); setSeverity("all"); setPage(1); };
  const choose = (next: Tab) => { setTab(next); setPage(1); };
  const critical = open.filter((entry) => entry.severity === "critical").length;

  const toolbar = (
    <DataToolbar actions={<>
      {filtered && <ClearFiltersButton onClick={clear} />}
      <PageRefreshButton />
    </>}>
      <ToolbarSearch value={search} onChange={(value) => { setSearch(value); setPage(1); }} placeholder="Search alerts" />
      {tab === "open" && (
        <Segmented
          label="Severity"
          value={severity}
          onChange={(next) => { setSeverity(next); setPage(1); }}
          options={[
            { key: "all", label: "All" },
            { key: "critical", label: "Critical", count: critical, tone: "danger" },
            { key: "warning", label: "Warning", count: open.length - critical },
          ]}
        />
      )}
    </DataToolbar>
  );

  return (
    <>
      <ViewTabs
        label="Alert centre views"
        idPrefix="alert-view"
        value={tab}
        onChange={choose}
        tabs={[
          { key: "open", label: "Open", count: lists ? open.length : null, tone: "danger" },
          { key: "resolved", label: "Resolved this week", count: lists ? resolved.length : null },
          ...(digest ? [{ key: "digest" as const, label: "Daily digest" }] : []),
        ]}
      />

      <div role="tabpanel" aria-labelledby={`alert-view-${tab}`} className="flex min-w-0 flex-col">
      {tab === "digest" && digest ? digest : !lists ? (
        <TableCard className={FILL}>
          <ErrorState title="Open alerts did not load" detail="Reload the page to try again. Until then, which alerts are open is unknown." />
        </TableCard>
      ) : (
        <TableCard
          className={FILL}
          toolbar={toolbar}
          footer={rows.length > 0 ? <Pager page={current} total={rows.length} pageSize={pageSize} noun={rows.length === 1 ? "alert" : "alerts"} suffix={tab === "open" ? "most urgent first" : "last 7 days"} onPage={setPage} /> : undefined}
        >
          {rows.length === 0 ? (
            filtered ? <NoMatches noun="alerts" onClear={clear} />
              : tab === "open" ? <EmptyState title="Nothing is wrong with the queue" hint="Unclaimed leads and escalations show up here." />
              : <EmptyState title="Nothing resolved this week" hint="A fixed alert moves here with what resolved it." />
          ) : tab === "open" ? (
            <table className="w-full min-w-[900px] border-collapse text-left">
              <thead><tr><th className={th}>Severity</th><th className={th}>Alert</th><th className={th}>Detail</th><th className={th}>Raised</th><th className={`${th} text-right`}><span className="sr-only">Actions</span></th></tr></thead>
              <tbody {...{ [KBD_LIST_ATTRIBUTE]: "" }}>{pageRows.map((entry) => <OpenAlertRow key={entry.leadId} entry={entry} canClaim={canClaim} />)}</tbody>
            </table>
          ) : (
            <table className="w-full min-w-[820px] border-collapse text-left">
              <thead><tr><th className={th}>Alert</th><th className={th}>Resolved by</th><th className={th}>Resolved</th><th className={th}>Raised</th><th className={`${th} text-right`}><span className="sr-only">Open</span></th></tr></thead>
              <tbody {...{ [KBD_LIST_ATTRIBUTE]: "" }}>{pageRows.map((entry) => <ResolvedAlertRow key={entry.leadId} entry={entry} />)}</tbody>
            </table>
          )}
        </TableCard>
      )}
      </div>
    </>
  );
}
