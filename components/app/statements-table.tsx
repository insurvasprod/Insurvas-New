"use client";

import { useMemo, useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";

import { Button } from "@/components/ui/button";
import { ClearFiltersButton, DataToolbar, RefreshButton, ToolbarSearch, toolbarControl } from "@/components/ui/data-toolbar";
import { EmptyState, NoMatches } from "@/components/ui/page-states";
import { Pager, paginate } from "@/components/ui/pager";
import { StatusChip, type StatusTone } from "@/components/ui/status-chip";
import { TableCard } from "@/components/ui/table-card";
import { useFittingPageSize } from "@/components/app/book-of-business-views";
import {
  statementDay,
  statementMoney,
  statementPeriod,
  type StatementStatus,
  type StatementSummary,
} from "@/lib/ledger/statementConstants";

const STATUS: Record<StatementStatus, { label: string; tone: StatusTone }> = {
  awaiting_entry: { label: "Lines to type in", tone: "info" },
  review: { label: "Waiting for review", tone: "action" },
  reviewed: { label: "Reviewed", tone: "good" },
  voided: { label: "Voided", tone: "neutral" },
};

/**
 * The statement history as the standard list: search, carrier and status filters, Refresh, and one
 * row per statement with its Review/Open link last. The rows come from the server page; Refresh
 * re-renders it.
 *
 * 2026-10-06 redesign: one fact per column (carrier, period, file, who imported it), even rows, a
 * pager sized to the window, and the card fills the screen under the header.
 */
export function StatementsTable({ statements, emptyTitle, emptyHint, readOnly = false }: { statements: StatementSummary[]; emptyTitle: string; emptyHint: string; readOnly?: boolean }) {
  const router = useRouter();
  const [refreshing, startRefresh] = useTransition();
  const [query, setQuery] = useState("");
  const [carrier, setCarrier] = useState("");
  const [status, setStatus] = useState<"all" | StatementStatus>("all");
  const [page, setPage] = useState(1);
  const pageSize = useFittingPageSize(420, 49);

  const carriers = useMemo(() => [...new Set(statements.map((statement) => statement.carrierName))].sort((a, b) => a.localeCompare(b)), [statements]);
  const visible = useMemo(() => {
    const needle = query.trim().toLowerCase();
    return statements.filter((statement) =>
      (!needle || `${statement.carrierName} ${statement.fileName} ${statement.uploadedByName ?? ""}`.toLowerCase().includes(needle)) &&
      (!carrier || statement.carrierName === carrier) &&
      (status === "all" || statement.status === status),
    );
  }, [statements, query, carrier, status]);
  const { current, rows } = paginate(visible, page, pageSize);
  const filtered = Boolean(query.trim() || carrier || status !== "all");
  const clear = () => { setQuery(""); setCarrier(""); setStatus("all"); setPage(1); };

  return (
    <TableCard
      className="flex min-h-[calc(100dvh-var(--top-bar-h)-332px)] flex-col [&>.overflow-x-auto]:flex-1"
      toolbar={
        <DataToolbar actions={<>
          {filtered && <ClearFiltersButton onClick={clear} />}
          <RefreshButton onClick={() => startRefresh(() => router.refresh())} refreshing={refreshing} />
        </>}>
          <ToolbarSearch value={query} onChange={(value) => { setQuery(value); setPage(1); }} placeholder="Search statements" />
          <select aria-label="Filter statements by carrier" className={toolbarControl} value={carrier} onChange={(event) => { setCarrier(event.target.value); setPage(1); }}>
            <option value="">All carriers</option>
            {carriers.map((name) => <option key={name} value={name}>{name}</option>)}
          </select>
          <select aria-label="Filter statements by status" className={toolbarControl} value={status} onChange={(event) => { setStatus(event.target.value as typeof status); setPage(1); }}>
            <option value="all">All statuses</option>
            {(Object.keys(STATUS) as StatementStatus[]).map((key) => <option key={key} value={key}>{STATUS[key].label}</option>)}
          </select>
        </DataToolbar>
      }
      footer={statements.length ? <Pager page={current} pageSize={pageSize} total={visible.length} onPage={setPage} noun={visible.length === 1 ? "statement" : "statements"} suffix="newest first" /> : undefined}
    >
      {statements.length === 0 ? (
        <EmptyState title={emptyTitle} hint={emptyHint} />
      ) : visible.length === 0 ? (
        <NoMatches noun="statements" onClear={clear} />
      ) : (
        <table className="portal-lead-table w-full min-w-[1180px] text-left text-sm">
          <thead>
            <tr>
              <th>Carrier</th>
              <th className="w-[170px]">Period</th>
              <th>File</th>
              <th className="w-[110px]">Imported</th>
              <th className="w-[150px]">Imported by</th>
              <th className="w-[70px] text-right">Lines</th>
              <th className="w-[90px] text-right">Accepted</th>
              <th className="w-[80px] text-right">Waiting</th>
              <th className="w-[100px] text-right">Unreadable</th>
              <th className="w-[130px] text-right">Accepted amount</th>
              <th className="w-[170px]">Status</th>
              <th className="w-[110px] text-right"><span className="sr-only">Actions</span></th>
            </tr>
          </thead>
          <tbody className="m-seq">
            {rows.map((statement) => (
              <tr key={statement.id} className="m-row">
                <td className="max-w-[220px] truncate font-semibold text-foreground" title={statement.carrierName}>{statement.carrierName}</td>
                <td className="tabular-nums">{statementPeriod(statement.periodStart, statement.periodEnd)}</td>
                <td className="max-w-[240px] truncate text-muted-foreground" title={statement.fileName}>{statement.fileName}</td>
                <td className="tabular-nums">{statementDay(statement.uploadedAt)}</td>
                <td className="max-w-[150px] truncate" title={statement.uploadedByName ?? "A former member"}>{statement.uploadedByName ?? "A former member"}</td>
                <td className="text-right tabular-nums">{statement.counts.lines.toLocaleString("en-US")}</td>
                <td className="text-right tabular-nums">{statement.counts.accepted.toLocaleString("en-US")}</td>
                <td className="text-right tabular-nums">{statement.status === "voided" ? "—" : (statement.counts.proposed + statement.counts.unmatched).toLocaleString("en-US")}</td>
                <td className={`text-right tabular-nums ${statement.counts.errors > 0 ? "text-[var(--warning-ink)]" : "text-muted-foreground"}`} title={statement.counts.errors > 0 ? `${statement.counts.errors.toLocaleString("en-US")} could not be read` : undefined}>{statement.counts.errors.toLocaleString("en-US")}</td>
                <td className="text-right font-semibold tabular-nums">{statementMoney(statement.acceptedCents)}</td>
                <td><StatusChip tone={STATUS[statement.status].tone}>{STATUS[statement.status].label}</StatusChip></td>
                <td className="text-right">
                  <Button asChild type="button" variant="outline" size="sm">
                    <Link href={`/app/statements/${statement.id}`}>{readOnly ? "Open" : statement.status === "review" ? "Review" : statement.status === "awaiting_entry" ? "Enter lines" : "Open"}</Link>
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
