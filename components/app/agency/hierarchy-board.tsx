"use client";

import { useMemo, useState } from "react";
import Link from "next/link";

import { PageHeader } from "@/components/ui/page-header";
import { StatStrip, StatTile } from "@/components/ui/stat";
import { TableCard } from "@/components/ui/table-card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { DataToolbar, RefreshButton, ToolbarCheckbox, ToolbarSearch, toolbarControl } from "@/components/ui/data-toolbar";
import { EmptyState, ErrorState, NoMatches, SectionLoading } from "@/components/ui/page-states";
import { StatusChip } from "@/components/ui/status-chip";
import { Button } from "@/components/ui/button";
import { Pager, paginate } from "@/components/ui/pager";
import { dollars } from "@/lib/agency/constants";
import { BasisChip, Level, Money } from "./money";
import { ManagerDialog } from "./producer-dialogs";
import { useAgencyData } from "./use-agency-data";

type Row = {
  producerId: string; producerUserId: string; producerName: string; managerProducerId: string | null; managerName: string;
  carrierId: string; carrierName: string; agencyLevelBps: number | null; producerLevelBps: number | null; spreadBps: number | null; overrideCents: number | null;
};

/**
 * AG-1.2 · Hierarchy & Overrides. Two levels, so a list: per producer and carrier, his manager, the agency's level,
 * his, the spread and what the agency kept on his business this month. The override is COMPUTED — nobody types
 * one; splits are a different screen. A missing level is "—" and a Set level button; a negative spread (he is paid
 * more than the agency receives) is a red row.
 */
export function HierarchyBoard({ canEdit }: { canEdit: boolean }) {
  const { data, error, loading, refreshing, reload } = useAgencyData<{ rows: Row[] }>("/api/app/agency/overrides");
  const [search, setSearch] = useState("");
  const [carrier, setCarrier] = useState("");
  const [issuesOnly, setIssuesOnly] = useState(false);
  const [moving, setMoving] = useState<Row | null>(null);
  const [page, setPage] = useState(1);
  const rows = useMemo(() => data?.rows ?? [], [data]);
  const carriers = useMemo(() => [...new Map(rows.map((r) => [r.carrierId, r.carrierName])).entries()].sort((a, b) => a[1].localeCompare(b[1])), [rows]);
  const filtered = rows.filter((r) =>
    (!carrier || r.carrierId === carrier) &&
    (!issuesOnly || r.producerLevelBps === null || (r.spreadBps !== null && r.spreadBps < 0)) &&
    (!search.trim() || `${r.producerName} ${r.carrierName}`.toLowerCase().includes(search.trim().toLowerCase())));
  const { rows: pageRows, current } = paginate(filtered, page, 15);
  const total = rows.reduce((s, r) => s + (r.overrideCents ?? 0), 0);
  const missing = rows.filter((r) => r.producerLevelBps === null).length;
  const negative = rows.filter((r) => r.spreadBps !== null && r.spreadBps < 0).length;
  const people = [...new Map(rows.map((r) => [r.producerId, r.producerName])).entries()].map(([id, name]) => ({ id, name }));

  return (
    <div className="m-stagger flex min-h-0 flex-grow flex-col gap-6">
      <PageHeader title="Hierarchy & Overrides" description="Who reports to whom, and what the agency keeps on each producer's business." />
      {data && (
        <StatStrip label="Overrides">
          <StatTile label="Override this month · reported" value={dollars(total)} valueTone={total < 0 ? "danger" : undefined} />
          <StatTile label="Missing levels" value={String(missing)} valueTone={missing ? "warning" : undefined} footnote={missing ? "No override until each is set" : undefined} reserveFootnote />
          <StatTile label="Negative spreads" value={String(negative)} valueTone={negative ? "danger" : undefined} footnote={negative ? "Paying out more than received" : undefined} reserveFootnote />
        </StatStrip>
      )}
      <TableCard toolbar={
        <DataToolbar actions={<RefreshButton onClick={reload} refreshing={refreshing} />}>
          <ToolbarSearch value={search} onChange={(v) => { setSearch(v); setPage(1); }} placeholder="Search producer or carrier" label="Search" />
          <select aria-label="Carrier" className={toolbarControl} value={carrier} onChange={(e) => { setCarrier(e.target.value); setPage(1); }}>
            <option value="">All carriers</option>
            {carriers.map(([id, name]) => <option key={id} value={id}>{name}</option>)}
          </select>
          <ToolbarCheckbox checked={issuesOnly} onChange={(v) => { setIssuesOnly(v); setPage(1); }} label="Issues only" />
        </DataToolbar>
      } footer={filtered.length > 15 ? <Pager page={current} total={filtered.length} noun="rows" onPage={setPage} pageSize={15} /> : undefined}>
        {error ? <ErrorState detail={error} /> : loading ? <SectionLoading rows={5} columns={8} label="Loading overrides" /> : rows.length === 0 ? (
          <EmptyState title="Nothing to show yet" hint="Add your carrier contracts on the rate card and your producers' levels on each producer's Carriers tab." />
        ) : filtered.length === 0 ? <NoMatches noun="rows" onClear={() => { setSearch(""); setCarrier(""); setIssuesOnly(false); }} /> : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Producer</TableHead>
                <TableHead>Reports to</TableHead>
                <TableHead>Carrier</TableHead>
                <TableHead className="text-right">Agency</TableHead>
                <TableHead className="text-right">Producer</TableHead>
                <TableHead className="text-right">Spread</TableHead>
                <TableHead className="text-right">Override this month <BasisChip basis="reported" /></TableHead>
                <TableHead className="text-right" />
              </TableRow>
            </TableHeader>
            <TableBody>
              {pageRows.map((r) => {
                const negativeSpread = r.spreadBps !== null && r.spreadBps < 0;
                return (
                  <TableRow key={`${r.producerId}-${r.carrierId}`} className={negativeSpread ? "bg-[var(--error-surface)]" : r.producerLevelBps === null ? "bg-[var(--warning-surface)]" : undefined}>
                    <TableCell className="font-medium"><Link className="hover:underline" href={`/app/producers/${r.producerId}`}>{r.producerName}</Link></TableCell>
                    <TableCell>{r.managerName}</TableCell>
                    <TableCell>{r.carrierName}</TableCell>
                    <TableCell className="text-right"><Level bps={r.agencyLevelBps} /></TableCell>
                    <TableCell className="text-right"><Level bps={r.producerLevelBps} /></TableCell>
                    <TableCell className="text-right"><Level bps={r.spreadBps} /></TableCell>
                    <TableCell className="text-right"><Money cents={r.overrideCents} /></TableCell>
                    <TableCell className="text-right">
                      {negativeSpread ? <StatusChip tone="danger">Pays out more than received</StatusChip>
                        : r.producerLevelBps === null && canEdit ? <Button asChild size="sm" variant="outline"><Link href={`/app/producers/${r.producerId}`}>Set level</Link></Button>
                        : canEdit ? <Button size="sm" variant="outline" onClick={() => setMoving(r)}>Change manager</Button> : null}
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        )}
      </TableCard>
      {moving && <ManagerDialog producerId={moving.producerId} name={moving.producerName} managers={people} open onOpenChange={(o) => { if (!o) setMoving(null); }} onDone={reload} />}
    </div>
  );
}
