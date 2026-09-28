"use client";

import { useMemo, useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";

import { Button } from "@/components/ui/button";
import { DataToolbar, RefreshButton, ToolbarSearch, toolbarControl } from "@/components/ui/data-toolbar";
import { EmptyState, NoMatches } from "@/components/ui/page-states";
import { TableCard } from "@/components/ui/table-card";
import {
  statementDay,
  statementMoney,
  statementPeriod,
  type StatementStatus,
  type StatementSummary,
} from "@/lib/ledger/statementConstants";

const STATUS: Record<StatementStatus, { label: string; chip: string }> = {
  review: { label: "Waiting for review", chip: "bg-[var(--soft-orange-surface)] text-[var(--accent-ink)]" },
  reviewed: { label: "Reviewed", chip: "bg-[var(--success-surface)] text-[var(--success-ink)]" },
  voided: { label: "Voided", chip: "bg-[var(--surface-alt)] text-[var(--body)]" },
};

/**
 * The statement history as the standard list: search, carrier and status filters, Refresh, and one
 * row per statement with its Review/Open link last. The rows come from the server page; Refresh
 * re-renders it.
 */
export function StatementsTable({ statements, emptyTitle, emptyHint }: { statements: StatementSummary[]; emptyTitle: string; emptyHint: string }) {
  const router = useRouter();
  const [refreshing, startRefresh] = useTransition();
  const [query, setQuery] = useState("");
  const [carrier, setCarrier] = useState("");
  const [status, setStatus] = useState<"all" | StatementStatus>("all");

  const carriers = useMemo(() => [...new Set(statements.map((statement) => statement.carrierName))].sort((a, b) => a.localeCompare(b)), [statements]);
  const visible = useMemo(() => {
    const needle = query.trim().toLowerCase();
    return statements.filter((statement) =>
      (!needle || `${statement.carrierName} ${statement.fileName} ${statement.uploadedByName ?? ""}`.toLowerCase().includes(needle)) &&
      (!carrier || statement.carrierName === carrier) &&
      (status === "all" || statement.status === status),
    );
  }, [statements, query, carrier, status]);

  return (
    <TableCard
      toolbar={
        <DataToolbar actions={<RefreshButton onClick={() => startRefresh(() => router.refresh())} refreshing={refreshing} />}>
          <ToolbarSearch value={query} onChange={setQuery} placeholder="Search statements" />
          <select aria-label="Filter statements by carrier" className={toolbarControl} value={carrier} onChange={(event) => setCarrier(event.target.value)}>
            <option value="">All carriers</option>
            {carriers.map((name) => <option key={name} value={name}>{name}</option>)}
          </select>
          <select aria-label="Filter statements by status" className={toolbarControl} value={status} onChange={(event) => setStatus(event.target.value as typeof status)}>
            <option value="all">All statuses</option>
            {(Object.keys(STATUS) as StatementStatus[]).map((key) => <option key={key} value={key}>{STATUS[key].label}</option>)}
          </select>
        </DataToolbar>
      }
      footer={statements.length ? <span>Showing {visible.length.toLocaleString("en-US")} of {statements.length.toLocaleString("en-US")} {statements.length === 1 ? "statement" : "statements"} · newest first</span> : undefined}
    >
      {statements.length === 0 ? (
        <EmptyState title={emptyTitle} hint={emptyHint} />
      ) : visible.length === 0 ? (
        <NoMatches noun="statements" onClear={() => { setQuery(""); setCarrier(""); setStatus("all"); }} />
      ) : (
        <table className="portal-lead-table w-full min-w-[1000px] text-left text-sm">
          <thead>
            <tr>
              <th>Statement</th>
              <th className="w-[150px]">Imported</th>
              <th className="w-[80px] text-right">Lines</th>
              <th className="w-[90px] text-right">Accepted</th>
              <th className="w-[90px] text-right">Waiting</th>
              <th className="w-[130px] text-right">Accepted amount</th>
              <th className="w-[170px]">Status</th>
              <th className="w-[100px] text-right">Actions</th>
            </tr>
          </thead>
          <tbody className="m-seq">
            {visible.map((statement) => (
              <tr key={statement.id} className="m-row">
                <td>
                  <span className="block font-semibold text-foreground">{statement.carrierName} · {statementPeriod(statement.periodStart, statement.periodEnd)}</span>
                  <span className="block text-xs text-muted-foreground">{statement.fileName}</span>
                </td>
                <td>
                  <span className="block tabular-nums">{statementDay(statement.uploadedAt)}</span>
                  <span className="block text-xs text-muted-foreground">{statement.uploadedByName ?? "A former member"}</span>
                </td>
                <td className="text-right tabular-nums">{statement.counts.lines.toLocaleString("en-US")}</td>
                <td className="text-right tabular-nums">{statement.counts.accepted.toLocaleString("en-US")}</td>
                <td className="text-right tabular-nums">{statement.status === "voided" ? "—" : (statement.counts.proposed + statement.counts.unmatched).toLocaleString("en-US")}</td>
                <td className="text-right font-semibold tabular-nums">{statementMoney(statement.acceptedCents)}</td>
                <td>
                  <span className={`inline-flex rounded-full px-2.5 py-[3px] text-xs font-semibold ${STATUS[statement.status].chip}`}>{STATUS[statement.status].label}</span>
                  {statement.counts.errors > 0 && <span className="mt-0.5 block text-xs text-muted-foreground">{statement.counts.errors.toLocaleString("en-US")} could not be read</span>}
                </td>
                <td className="text-right">
                  <Button asChild type="button" variant="outline" size="sm">
                    <Link href={`/app/statements/${statement.id}`}>{statement.status === "review" ? "Review" : "Open"}</Link>
                  </Button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </TableCard>
  );
}
