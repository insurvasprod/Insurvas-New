"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";

import { DataToolbar, RefreshButton, ToolbarSearch } from "@/components/ui/data-toolbar";
import { EmptyState, ErrorState, NoMatches, SectionLoading } from "@/components/ui/page-states";
import { StatusChip, type StatusTone } from "@/components/ui/status-chip";
import { TableCard } from "@/components/ui/table-card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Pager, paginate } from "@/components/ui/pager";
import { ageLabel, ageTone } from "@/lib/agency/routingCore";

type PoolLead = { workItemId: string; leadId: string; name: string; state: string | null; productLine: string | null; queuedAt: string; ageMinutes: number };

/**
 * AG-0.10 · the agency's unassigned pool, oldest first, every lead with its age — an unassigned lead is a lead
 * the agency paid for and nobody called. Owner and admin only (the route refuses anyone else). Routing itself
 * is the rule chain above it on the same page.
 */
export function UnassignedPool() {
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
      else setRows(body.pool ?? []);
    } catch {
      setError("Could not load the unassigned pool. Check your connection and try again.");
    } finally {
      setRefreshing(false);
    }
  }, []);

  // eslint-disable-next-line react-hooks/set-state-in-effect -- fetch on mount
  useEffect(() => { void load(); }, [load]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return (rows ?? []).filter((r) => !q || r.name.toLowerCase().includes(q) || (r.state ?? "").toLowerCase().includes(q));
  }, [rows, search]);
  const { rows: pageRows, current: safePage } = paginate(filtered, page, 10);

  return (
    <TableCard
      title="Unassigned pool"
      description="Leads nobody has been given yet, oldest first."
      toolbar={
        <DataToolbar actions={<RefreshButton onClick={() => void load()} refreshing={refreshing} />}>
          <ToolbarSearch value={search} onChange={(value) => { setSearch(value); setPage(1); }} placeholder="Search name or state" label="Search the pool" />
        </DataToolbar>
      }
      footer={rows && filtered.length > 10 ? <Pager page={safePage} total={filtered.length} noun="leads" onPage={setPage} /> : undefined}
    >
      {error ? (
        <ErrorState detail={error} />
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
      )}
    </TableCard>
  );
}
