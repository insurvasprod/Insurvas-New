"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";

import { Button } from "@/components/ui/button";
import { DataToolbar, RefreshButton, ToolbarSearch } from "@/components/ui/data-toolbar";
import { EmptyState, ErrorState, NoMatches, SectionLoading } from "@/components/ui/page-states";
import { StatusChip, type StatusTone } from "@/components/ui/status-chip";
import { TableCard } from "@/components/ui/table-card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Pager, paginate } from "@/components/ui/pager";
import { useFittingPageSize } from "@/components/ui/use-fitting-page-size";
import { ageLabel, ageTone } from "@/lib/agency/routingCore";

type PoolLead = { workItemId: string; leadId: string; name: string; state: string | null; productLine: string | null; queuedAt: string; ageMinutes: number };

/**
 * AG-0.10 · the agency's unassigned pool, oldest first, every lead with its age — an unassigned lead is a lead
 * the agency paid for and nobody called. Owner and admin only (the route refuses anyone else). Routing itself
 * is the rule chain beside it on the same page.
 */
export function UnassignedPool({ onCount, fill = false, bare = false, refreshKey = 0 }: {
  /** The pool's size, for the step's "N waiting for someone". */
  onCount?: (count: number) => void;
  /** Fill the step's height (Lead sources frame): the table scrolls inside, the pager stays at the foot. */
  fill?: boolean;
  /** Inside another card (Route's Pool tab): search, table and pager, without a card of its own or a Refresh. */
  bare?: boolean;
  /** Bumped by the page's one Refresh to reload the pool. */
  refreshKey?: number;
} = {}) {
  const [rows, setRows] = useState<PoolLead[] | null>(null);
  const [error, setError] = useState("");
  const [refreshing, setRefreshing] = useState(false);
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(1);

  const load = useCallback(async () => {
    setRefreshing(true);
    setError("");
    try {
      const res = await fetch("/api/app/agency/pool", { cache: "no-store" });
      const body = await res.json().catch(() => null);
      if (!res.ok) setError(body?.error ?? "Could not load the unassigned pool");
      else { const pool: PoolLead[] = body.pool ?? []; setRows(pool); onCount?.(pool.length); }
    } catch {
      setError("Could not load the unassigned pool. Check your connection and try again.");
    } finally {
      setRefreshing(false);
    }
  }, [onCount]);

  // eslint-disable-next-line react-hooks/set-state-in-effect -- fetch on mount, and again on the page's Refresh
  useEffect(() => { void load(); }, [load, refreshKey]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return (rows ?? []).filter((r) => !q || r.name.toLowerCase().includes(q) || (r.state ?? "").toLowerCase().includes(q));
  }, [rows, search]);
  const pageSize = useFittingPageSize(480, 45);
  const { rows: pageRows, current: safePage } = paginate(filtered, page, pageSize);

  const searchBox = <ToolbarSearch value={search} onChange={(value) => { setSearch(value); setPage(1); }} placeholder="Search name or state" label="Search the pool" />;
  const pager = rows && filtered.length ? <Pager page={safePage} total={filtered.length} noun="leads" pageSize={pageSize} onPage={setPage} /> : undefined;
  const body = error ? (
    <ErrorState detail={error} action={<Button type="button" variant="outline" onClick={() => void load()}>Try again</Button>} />
  ) : rows === null ? (
    <SectionLoading rows={4} columns={4} label="Loading the pool" />
  ) : rows.length === 0 ? (
    <EmptyState title="Every lead is assigned" hint="New leads land here until a rule or a person gives them to a producer." />
  ) : filtered.length === 0 ? (
    <NoMatches noun="leads" by="search" onClear={() => setSearch("")} />
  ) : (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>Lead</TableHead>
          <TableHead>State</TableHead>
          <TableHead>Product</TableHead>
          <TableHead className="text-right">Waiting</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {pageRows.map((lead) => (
          <TableRow key={lead.workItemId}>
            <TableCell className="font-medium"><Link className="hover:underline" href={`/app/leads/${lead.leadId}`}>{lead.name}</Link></TableCell>
            <TableCell>{lead.state ?? "—"}</TableCell>
            <TableCell>{lead.productLine ?? "—"}</TableCell>
            <TableCell className="text-right"><StatusChip tone={ageTone(lead.ageMinutes) as StatusTone}>{ageLabel(lead.ageMinutes)}</StatusChip></TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );

  if (bare) {
    return (
      <div className="flex min-w-0 flex-col gap-2">
        {rows && rows.length > 0 && searchBox}
        <div className="overflow-x-auto">{body}</div>
        {pager && <div className="flex flex-wrap items-center justify-between gap-3 text-xs text-muted-foreground">{pager}</div>}
      </div>
    );
  }

  return (
    <TableCard
      title="Unassigned pool"
      className={fill ? "flex min-w-0 flex-col lg:min-h-0 lg:flex-1 [&>.overflow-x-auto]:flex-1 lg:[&>.overflow-x-auto]:min-h-0 lg:[&>.overflow-x-auto]:overflow-y-auto" : undefined}
      toolbar={
        <DataToolbar actions={<RefreshButton onClick={() => void load()} refreshing={refreshing} />}>
          {searchBox}
        </DataToolbar>
      }
      footer={pager}
    >
      {body}
    </TableCard>
  );
}
