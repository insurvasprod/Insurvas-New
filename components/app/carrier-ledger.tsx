"use client";

import Link from "next/link";
import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";

import { ClearFiltersButton, DataToolbar, FilterButton, FilterField, FilterPanel, RefreshButton, ToolbarSearch, toolbarControl } from "@/components/ui/data-toolbar";
import { MoreMenu } from "@/components/ui/more-menu";
import { EmptyState, NoMatches } from "@/components/ui/page-states";
import { Pager, paginate } from "@/components/ui/pager";
import { StatStrip, StatTile } from "@/components/ui/stat";
import { StatusChip } from "@/components/ui/status-chip";
import { TableCard } from "@/components/ui/table-card";
import { ToggleChip } from "@/components/ui/toggle-chip";
import { useFittingPageSize } from "@/components/ui/use-fitting-page-size";
import { StepSlot } from "@/components/app/step-frame/step-slot";
import { LEDGER_SLOT } from "@/components/app/commissions/slots";
import { centsText, ENTRY_LABELS, ENTRY_TYPES, rollup, type EntryType } from "@/lib/ingestion/commissionLedger";
import { fileDay } from "@/lib/ingestion/constants";
import { toCsv } from "@/lib/ingestion/policyBook";
import { rowHref } from "@/lib/ingestion/trace";
import type { LedgerRow } from "@/lib/ingestion/commissionLedgerStore";

/** A ledger line with the people it belongs to (lib/commissions/ledgerNames.ts): null when not known. */
export type LedgerLine = LedgerRow & { clientName?: string | null; agentName?: string | null };

const signed = (cents: number) => `${cents < 0 ? "−" : ""}$${(Math.abs(cents) / 100).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const whole = (cents: number) => `${cents < 0 ? "−" : ""}$${Math.round(Math.abs(cents) / 100).toLocaleString("en-US")}`;
const kindOf = (row: LedgerRow) => row.correctsType ?? row.type;
const typeWord = (row: LedgerRow) => (row.type === "adjustment" ? "Adjustment" : row.type === "reversal" ? (row.correctsType ? `Reversal of ${ENTRY_LABELS[row.correctsType as EntryType]?.label.toLowerCase() ?? row.correctsType}` : "Reversal") : ENTRY_LABELS[row.type as EntryType]?.label ?? row.type);
const policyHref = (row: LedgerRow) => row.policyHref ?? `/app/policies/carrier/${row.carrierId}/${encodeURIComponent(row.policyNumber)}`;
const payeeWord = (row: LedgerRow) => (row.payeeLevel === "upline" ? "Upline" : row.payeeLevel === "writing_agent" ? "Writing agent" : null);
/** The board's two quick choices beside All; every other type is in the filters. */
const QUICK_TYPES = [["", "All"], ["advance", "Advances"], ["chargeback", "Chargebacks"]] as const;

/**
 * LA-4.12 (Notion sprint) · the commission ledger: every line, newest statement first, with the
 * source behind it. Lines from the carriers' own files are never edited (a correction arrives as a
 * reversal line); since the 2026-10-08 overlap merge the accepted lines of statements imported by
 * hand are here too, and a source filter shows either.
 *
 * Board 12 (2026-11-03): a column that is empty on every row is not drawn (Payee, Client, Agent each show only
 * when a line has one); the file and row fold into the Statement cell; the whole row opens its line (the file's
 * row, or the hand statement) with a hover tint and a "›"; the strip's figures are links to their lines. Export
 * sits in the title line's More through the `LEDGER_SLOT`; the ledger's views (Lines · Carrier accounts ·
 * Expected) are tabs on the title line on every view, so the ledger page passes no `more`.
 */
export function CarrierLedger({ entries, scoped, initialSource = "", initialType = "", more = [] }: {
  entries: LedgerLine[];
  scoped: boolean;
  initialSource?: string;
  initialType?: string;
  /** Extra links for the title line's More, before Export (none on the ledger page: its views are tabs). */
  more?: Array<{ label: string; href: string }>;
}) {
  const router = useRouter();
  const [refreshing, startRefresh] = useTransition();
  const [query, setQuery] = useState("");
  const [carrier, setCarrier] = useState("");
  const [type, setType] = useState(initialType === "adjustment" || (ENTRY_TYPES as readonly string[]).includes(initialType) ? initialType : "");
  const [source, setSource] = useState(initialSource === "hand" || initialSource === "carrier" ? initialSource : "");
  const [filtersOpen, setFiltersOpen] = useState(false);
  const anyHand = entries.some((row) => row.source === "hand");
  const [page, setPage] = useState(1);

  const carriers = useMemo(() => [...new Map(entries.map((row) => [row.carrierId, row.carrierName])).entries()].sort((a, b) => a[1].localeCompare(b[1])), [entries]);
  const others = useMemo(() => {
    const needle = query.trim().toLowerCase();
    return entries.filter((row) => (!needle || `${row.account ? "account-level" : row.policyNumber} ${row.description ?? ""} ${row.agentIdentifier ?? ""} ${row.fileName ?? ""} ${row.clientName ?? ""} ${row.agentName ?? ""}`.toLowerCase().includes(needle)) && (!carrier || row.carrierId === carrier) && (!source || (source === "hand" ? row.source === "hand" : row.source !== "hand")));
  }, [entries, query, carrier, source]);
  const visible = useMemo(() => others.filter((row) => !type || kindOf(row) === type), [others, type]);
  // A line whose statement doesn't add up is held out of every total, here as on the policy page.
  const sum = useMemo(() => rollup(visible.filter((row) => !row.heldByStatement).map((row) => ({ entry_type: row.type, corrects_type: row.correctsType, amount_cents: row.amountCents }))), [visible]);
  const pageSize = useFittingPageSize(480, 45);
  const { current, rows } = paginate(visible, page, pageSize);
  const filtered = Boolean(query.trim() || carrier || type || source);
  // A column empty on every line is not drawn (board 12: Payee read "—" on every row).
  const anyPayee = entries.some((row) => row.payeeLevel);
  const anyClient = entries.some((row) => row.clientName);
  const anyAgent = entries.some((row) => row.agentName || row.agentIdentifier);
  const clear = () => { setQuery(""); setCarrier(""); setType(""); setSource(""); setPage(1); };
  const lineHref = (row: LedgerRow) => row.href ?? rowHref(row.fileId, row.rowNumber);
  // The strip's figures are links to the lines behind them (board 10): the same address with the type filter on.
  const tileHref = (kind: string) => `/app/ledger${kind || source ? `?${new URLSearchParams({ ...(kind ? { type: kind } : {}), ...(source ? { source } : {}) })}` : ""}`;

  function exportCsv() {
    const csv = toCsv(
      ["Statement date", "Transaction date", "Carrier", "Policy number", "Client", "Entry", "Amount", "Payee", "Agent", "Agent code", "Rate (bp)", "Months advanced", "File", "Row", "Reversal reason", "Source"],
      visible.map((row) => [row.statementDate, row.transactionDate, row.carrierName, row.account ? "Account-level" : row.policyNumber, row.clientName ?? null, typeWord(row), centsText(row.amountCents), payeeWord(row), row.agentName ?? null, row.agentIdentifier, row.rateBp, row.monthsAdvanced, row.fileName, row.rowNumber, row.reversalReason, row.source === "hand" ? "Statement imported by hand" : "Carrier file"]),
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
      <StepSlot id={LEDGER_SLOT}>
        <MoreMenu items={[...more, { label: "Export CSV", onSelect: exportCsv, disabled: !visible.length }]} />
      </StepSlot>

      {/* No lines yet means unknown, not $0: the totals appear with the first line. */}
      {entries.length > 0 && <StatStrip label={source === "hand" ? "Commission from statements imported by hand" : source === "carrier" ? "Commission from carrier files" : "Commission, every source"}>
        <StatTile label="Advanced" value={whole(sum.advancedCents)} footnote="paid ahead of earning" href={tileHref("advance")} />
        <StatTile label="Earned" value={whole(sum.earnedCents)} footnote={sum.overrideCents ? `plus ${whole(sum.overrideCents)} overrides` : "from premiums paid"} href={tileHref("earned")} />
        <StatTile label="Charged back" value={whole(sum.chargedBackCents)} footnote={sum.chargedBackCents ? <span title="Unearned advance taken back"><StatusChip tone="danger">Taken back</StatusChip></span> : "unearned advance taken back"} href={tileHref("chargeback")} />
        <StatTile label="Net received" value={whole(sum.netReceivedCents)} footnote={sum.feeCents || sum.interestCents ? `after ${whole(Math.abs(sum.feeCents + sum.interestCents))} of fees and interest` : "everything but held"} href={tileHref("")} />
        <StatTile label="Held" value={whole(sum.heldCents)} footnote="earned, not paid yet" href={tileHref("held")} />
      </StatStrip>}

      <TableCard
        toolbar={
          <DataToolbar actions={<>
            {filtered && <ClearFiltersButton onClick={clear} />}
            <RefreshButton onClick={() => startRefresh(() => router.refresh())} refreshing={refreshing} />
          </>}>
            <ToolbarSearch value={query} onChange={(value) => { setQuery(value); setPage(1); }} placeholder="Policy, client, agent code or file" />
            <span role="radiogroup" aria-label="Entry" className="inline-flex flex-wrap gap-2">
              {QUICK_TYPES.map(([value, label]) => (
                <ToggleChip key={label} role="radio" selected={type === value} count={(value ? others.filter((row) => kindOf(row) === value).length : others.length).toLocaleString("en-US")} onClick={() => { setType(value); setPage(1); }}>{label}</ToggleChip>
              ))}
            </span>
            <FilterButton open={filtersOpen} onClick={() => setFiltersOpen((open) => !open)} count={(carrier ? 1 : 0) + (type && !QUICK_TYPES.some(([value]) => value === type) ? 1 : 0) + (source ? 1 : 0)} controls="ledger-filters" />
          </DataToolbar>
        }
        filters={
          <FilterPanel id="ledger-filters" open={filtersOpen}>
            <FilterField label="Carrier" htmlFor="ledger-carrier"><select id="ledger-carrier" className={toolbarControl} value={carrier} onChange={(event) => { setCarrier(event.target.value); setPage(1); }}>
              <option value="">All carriers</option>
              {carriers.map(([id, name]) => <option key={id} value={id}>{name}</option>)}
            </select></FilterField>
            <FilterField label="Entry type" htmlFor="ledger-type"><select id="ledger-type" className={toolbarControl} value={type} onChange={(event) => { setType(event.target.value); setPage(1); }} title="A reversal counts with the type it corrects">
              <option value="">Every entry type</option>
              {ENTRY_TYPES.filter((key) => key !== "reversal").map((key) => <option key={key} value={key}>{ENTRY_LABELS[key].label}</option>)}
              {entries.some((row) => row.type === "adjustment") && <option value="adjustment">Adjustment</option>}
            </select></FilterField>
            {(anyHand || source) && (
              <FilterField label="Source" htmlFor="ledger-source"><select id="ledger-source" className={toolbarControl} value={source} onChange={(event) => { setSource(event.target.value); setPage(1); }}>
                <option value="">Every source</option>
                <option value="carrier">From carrier files</option>
                <option value="hand">Statements imported by hand</option>
              </select></FilterField>
            )}
          </FilterPanel>
        }
        footer={entries.length ? <Pager page={current} pageSize={pageSize} total={visible.length} onPage={setPage} noun={visible.length === 1 ? "line" : "lines"} suffix="newest statement first" /> : undefined}
      >
        {entries.length === 0 ? (
          <EmptyState title={scoped ? "No commission lines credited to you yet" : "No commission file has been read yet"} hint="Upload a carrier's commission file in Carrier files. Once its layout is set up, every line lands here with the file and row it came from." />
        ) : visible.length === 0 ? (
          <NoMatches noun="lines" onClear={clear} />
        ) : (
          <table className="portal-lead-table w-full min-w-[860px] text-left text-sm">
            <thead>
              <tr>
                {/* Owner 2026-11-10: the statement shows whole ("Dec 15, 2026 · American Amicable"); Entry and Amount give up the room. */}
                <th className="w-[250px]">Statement</th>
                <th className="w-[130px]">Policy</th>
                {anyClient && <th className="min-w-[140px]">Client</th>}
                <th className="w-[120px]">Entry</th>
                <th className="w-[90px] text-right">Amount</th>
                {anyAgent && <th className="w-[130px]">Agent</th>}
                {anyPayee && <th className="w-[90px]">Payee</th>}
                {/* Owner 2026-11-10: the statement's file is its own column at the end, not a line under the date. */}
                <th className="w-[230px]">File</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                // The whole row opens its line (board 10); the policy and the file's row are links of their own.
                <tr key={row.id} className="cursor-pointer" onClick={() => router.push(lineHref(row))}>
                  {/* Owner 2026-11-11: one line, one colour, the statement whole. A line's description is its Entry's
                      tooltip, "Policy not seen yet" its Policy's; a held line says so in the File column's one chip,
                      its file and row that chip's tooltip. Amounts are plain: a minus sign, no red. */}
                  <td className="whitespace-nowrap font-medium text-foreground"><span className="tabular-nums">{fileDay(row.statementDate ?? row.transactionDate)}</span> · {row.carrierName}</td>
                  <td className="whitespace-nowrap tabular-nums" title={row.orphan ? "Policy not seen yet: no policy file has shown this policy. The line joins it the moment it arrives." : undefined}>{row.account ? <span className="font-sans" title="Money the carrier moved on the agency's account, naming no policy">Account-level</span> : <Link href={policyHref(row)} onClick={(event) => event.stopPropagation()} className="text-foreground hover:underline">{row.policyNumber}</Link>}</td>
                  {anyClient && <td className="whitespace-nowrap">{row.clientName ?? ""}</td>}
                  <td className="whitespace-nowrap" title={[ENTRY_LABELS[kindOf(row) as EntryType]?.meaning, row.description].filter(Boolean).join(" · ") || undefined}>{typeWord(row)}</td>
                  <td className="whitespace-nowrap text-right tabular-nums" title={row.type === "held" ? "Held: not part of net received" : undefined}>{signed(row.amountCents)}</td>
                  {anyAgent && <td className="whitespace-nowrap">{row.agentName ? row.agentName : row.agentIdentifier ? <span title="No producer is mapped to this writing number yet">{row.agentIdentifier}</span> : null}</td>}
                  {anyPayee && <td className="whitespace-nowrap">{payeeWord(row) ?? ""}</td>}
                  <td className="whitespace-nowrap" title={row.fileName ? `${row.fileName}, ${row.source === "hand" ? "line" : "row"} ${row.rowNumber}` : undefined}>
                    {row.heldByStatement ? <StatusChip tone="warning">Held: its statement doesn&apos;t add up</StatusChip> : (
                      <Link href={row.href ?? rowHref(row.fileId, row.rowNumber)} onClick={(event) => event.stopPropagation()} className="text-foreground hover:underline">
                        {row.fileName ?? "The file"} · {row.source === "hand" ? `line ${row.rowNumber}` : `row ${row.rowNumber}`}
                      </Link>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </TableCard>
    </>
  );
}
