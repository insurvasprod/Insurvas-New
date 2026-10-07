"use client";

import Link from "next/link";
import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Download } from "lucide-react";

import { Button } from "@/components/ui/button";
import { ClearFiltersButton, DataToolbar, RefreshButton, ToolbarSearch, toolbarControl } from "@/components/ui/data-toolbar";
import { EmptyState, NoMatches } from "@/components/ui/page-states";
import { Pager, paginate } from "@/components/ui/pager";
import { StatStrip, StatTile } from "@/components/ui/stat";
import { TableCard } from "@/components/ui/table-card";
import { centsText, ENTRY_LABELS, ENTRY_TYPES, rollup, type EntryType } from "@/lib/ingestion/commissionLedger";
import { fileDay } from "@/lib/ingestion/constants";
import { toCsv } from "@/lib/ingestion/policyBook";
import type { LedgerRow } from "@/lib/ingestion/commissionLedgerStore";

const signed = (cents: number) => `${cents < 0 ? "−" : ""}$${(Math.abs(cents) / 100).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const whole = (cents: number) => `${cents < 0 ? "−" : ""}$${Math.round(Math.abs(cents) / 100).toLocaleString("en-US")}`;
const kindOf = (row: LedgerRow) => row.correctsType ?? row.type;
const typeWord = (row: LedgerRow) => (row.type === "reversal" ? (row.correctsType ? `Reversal of ${ENTRY_LABELS[row.correctsType as EntryType]?.label.toLowerCase() ?? row.correctsType}` : "Reversal") : ENTRY_LABELS[row.type as EntryType]?.label ?? row.type);
const policyHref = (row: LedgerRow) => `/app/policies/carrier/${row.carrierId}/${encodeURIComponent(row.policyNumber)}`;

/**
 * LA-4.12 (Notion sprint) · the commission ledger from the carriers' own files: every line, newest
 * statement first, with the file and row it came from. Nothing here is typed in or edited; a
 * correction arrives as a reversal line.
 */
export function CarrierLedger({ entries, scoped }: { entries: LedgerRow[]; scoped: boolean }) {
  const router = useRouter();
  const [refreshing, startRefresh] = useTransition();
  const [query, setQuery] = useState("");
  const [carrier, setCarrier] = useState("");
  const [type, setType] = useState("");
  const [page, setPage] = useState(1);

  const carriers = useMemo(() => [...new Map(entries.map((row) => [row.carrierId, row.carrierName])).entries()].sort((a, b) => a[1].localeCompare(b[1])), [entries]);
  const visible = useMemo(() => {
    const needle = query.trim().toLowerCase();
    return entries.filter((row) => (!needle || `${row.policyNumber} ${row.agentIdentifier ?? ""} ${row.fileName ?? ""}`.toLowerCase().includes(needle)) && (!carrier || row.carrierId === carrier) && (!type || kindOf(row) === type));
  }, [entries, query, carrier, type]);
  const sum = useMemo(() => rollup(visible.map((row) => ({ entry_type: row.type, corrects_type: row.correctsType, amount_cents: row.amountCents }))), [visible]);
  const { current, rows } = paginate(visible, page, 25);
  const filtered = Boolean(query.trim() || carrier || type);
  const clear = () => { setQuery(""); setCarrier(""); setType(""); setPage(1); };

  function exportCsv() {
    const csv = toCsv(
      ["Statement date", "Transaction date", "Carrier", "Policy number", "Entry", "Amount", "Paid to", "Agent code", "Rate (bp)", "Months advanced", "File", "Row", "Reversal reason"],
      visible.map((row) => [row.statementDate, row.transactionDate, row.carrierName, row.policyNumber, typeWord(row), centsText(row.amountCents), row.payeeLevel === "upline" ? "Upline" : row.payeeLevel === "writing_agent" ? "Writing agent" : null, row.agentIdentifier, row.rateBp, row.monthsAdvanced, row.fileName, row.rowNumber, row.reversalReason]),
    );
    const url = URL.createObjectURL(new Blob([`﻿${csv}`], { type: "text/csv;charset=utf-8" }));
    const link = document.createElement("a");
    link.href = url;
    link.download = `commission-ledger-${new Date().toISOString().slice(0, 10)}.csv`;
    link.click();
    URL.revokeObjectURL(url);
  }

  return (
    <>
      {/* No lines yet means unknown, not $0: the totals appear with the first line. */}
      {entries.length > 0 && <StatStrip label="Commission from carrier files">
        <StatTile label="Advanced" value={whole(sum.advancedCents)} footnote="paid ahead of earning" />
        <StatTile label="Earned" value={whole(sum.earnedCents)} footnote={sum.overrideCents ? `plus ${whole(sum.overrideCents)} overrides` : "from premiums paid"} />
        <StatTile label="Charged back" value={whole(sum.chargedBackCents)} valueTone={sum.chargedBackCents ? "danger" : undefined} footnote="unearned advance taken back" />
        <StatTile label="Net received" value={whole(sum.netReceivedCents)} footnote={sum.feeCents || sum.interestCents ? `after ${whole(sum.feeCents + sum.interestCents)} fees and interest` : "everything but held"} />
        <StatTile label="Held" value={whole(sum.heldCents)} footnote="earned, not paid yet" />
      </StatStrip>}

      <TableCard
        toolbar={
          <DataToolbar actions={<>
            {filtered && <ClearFiltersButton onClick={clear} />}
            <Button type="button" variant="outline" disabled={!visible.length} onClick={exportCsv} title="The lines shown, in the order shown"><Download aria-hidden="true" />Export CSV</Button>
            <RefreshButton onClick={() => startRefresh(() => router.refresh())} refreshing={refreshing} />
          </>}>
            <ToolbarSearch value={query} onChange={(value) => { setQuery(value); setPage(1); }} placeholder="Search policy, agent code or file" />
            <select aria-label="Filter by carrier" className={toolbarControl} value={carrier} onChange={(event) => { setCarrier(event.target.value); setPage(1); }}>
              <option value="">All carriers</option>
              {carriers.map(([id, name]) => <option key={id} value={id}>{name}</option>)}
            </select>
            <select aria-label="Filter by entry type" className={toolbarControl} value={type} onChange={(event) => { setType(event.target.value); setPage(1); }} title="A reversal counts with the type it corrects">
              <option value="">Every entry type</option>
              {ENTRY_TYPES.filter((key) => key !== "reversal").map((key) => <option key={key} value={key}>{ENTRY_LABELS[key].label}</option>)}
            </select>
          </DataToolbar>
        }
        footer={entries.length ? <Pager page={current} pageSize={25} total={visible.length} onPage={setPage} noun={visible.length === 1 ? "line" : "lines"} suffix="newest statement first" /> : undefined}
      >
        {entries.length === 0 ? (
          <EmptyState title={scoped ? "No commission lines credited to you yet" : "No commission file has been read yet"} hint="Upload a carrier's commission file in Carrier files. Once its layout is set up, every line lands here with the file and row it came from." />
        ) : visible.length === 0 ? (
          <NoMatches noun="lines" onClear={clear} />
        ) : (
          <table className="portal-lead-table w-full min-w-[900px] text-left text-sm">
            <thead>
              <tr>
                <th className="w-[120px]">Statement</th>
                <th className="w-[140px]">Carrier</th>
                <th className="w-[130px]">Policy</th>
                <th>Entry</th>
                <th className="w-[120px] text-right">Amount</th>
                <th className="w-[110px]">Paid to</th>
                <th className="w-[200px]">Source</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr key={row.id}>
                  <td className="tabular-nums">{fileDay(row.statementDate ?? row.transactionDate)}</td>
                  <td className="max-w-[140px] truncate" title={row.carrierName}>{row.carrierName}</td>
                  <td className="font-mono text-xs"><Link href={policyHref(row)} className="hover:underline">{row.policyNumber}</Link></td>
                  <td title={ENTRY_LABELS[kindOf(row) as EntryType]?.meaning}>
                    <span className="text-foreground">{typeWord(row)}</span>
                    {row.reversalReason && <span className="block text-xs text-muted-foreground">{row.reversalReason}</span>}
                  </td>
                  <td className={`text-right font-semibold tabular-nums ${row.type === "held" ? "text-muted-foreground" : row.amountCents < 0 ? "text-[var(--error-ink)]" : "text-foreground"}`} title={row.type === "held" ? "Held: not part of net received" : undefined}>{signed(row.amountCents)}</td>
                  <td>{row.payeeLevel === "upline" ? "Upline" : row.payeeLevel === "writing_agent" ? "Writing agent" : <span className="text-muted-foreground">—</span>}</td>
                  <td className="max-w-[200px] truncate text-xs text-muted-foreground" title={row.fileName ? `${row.fileName}, row ${row.rowNumber}` : undefined}>{row.fileName ?? "—"}, row {row.rowNumber}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </TableCard>
    </>
  );
}
