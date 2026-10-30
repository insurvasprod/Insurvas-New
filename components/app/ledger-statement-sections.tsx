"use client";

import { useMemo, useState, useTransition, type ReactNode } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";

import { ClearFiltersButton, DataToolbar, RefreshButton, ToolbarSearch, toolbarControl } from "@/components/ui/data-toolbar";
import { NoMatches } from "@/components/ui/page-states";
import { Pager, paginate } from "@/components/ui/pager";
import { StatusChip, type StatusTone } from "@/components/ui/status-chip";
import { TableCard } from "@/components/ui/table-card";
import { useFittingPageSize, ViewTabs } from "@/components/app/book-of-business-views";
import type { LedgerEntry, LedgerEntryKind } from "@/lib/ledger/compute";
import {
  STATEMENT_KIND_LABELS,
  statementDay,
  statementMoney,
  statementPeriod,
  type StatementLedgerEntry,
} from "@/lib/ledger/statementConstants";
import type { ReconciliationRow, ReconciliationStatus } from "@/lib/ledger/statementMatch";

/**
 * The commission ledger's tables: what carriers REPORTED (accepted statement lines), how that
 * compares with what the book EXPECTED where a policy has both, and the expected entries themselves.
 *
 * Kept apart on purpose. The expected table is a derivation — premium × a schedule row — and the
 * reported one is a record: a carrier's line, the policy a person matched it to, and who accepted
 * it. Each is the standard list: search, one filter, Refresh (which re-renders the server page).
 *
 * 2026-10-06 redesign: the three tables were stacked down the page; LedgerViews shows one at a time
 * as tabs under the title, with the page's actions on the right of the same row. Each list is a
 * full-height card with one fact per column and a pager sized to the window.
 */

const KIND_TONE: Record<"advance" | "commission" | "chargeback" | "adjustment", StatusTone> = {
  advance: "info",
  commission: "good",
  chargeback: "danger",
  adjustment: "neutral",
};

const EXPECTED_KIND: Record<LedgerEntryKind, string> = { advance: "Advance", commission: "Commission", chargeback: "Chargeback" };

const RECONCILE: Record<ReconciliationStatus, { label: string; tone: StatusTone }> = {
  agrees: { label: "Agrees", tone: "good" },
  short: { label: "Paid short", tone: "danger" },
  over: { label: "Paid over", tone: "warning" },
  unpriced: { label: "No expected figure", tone: "neutral" },
};

/** Header, tabs and the toolbar above a list; the card fills the rest of the window. */
const FILL = "flex min-h-[calc(100dvh-var(--top-bar-h)-362px)] flex-col [&>.overflow-x-auto]:flex-1";
const RESERVED = 500;
const ROW = 41;

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const day = (iso: string) => { const [y, m, d] = iso.split("-").map(Number); return y && m && d ? `${d} ${MONTHS[m - 1]} ${y}` : iso; };
const money = (cents: number) => `${cents < 0 ? "−" : ""}$${(Math.abs(cents) / 100).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

function useRefresh() {
  const router = useRouter();
  const [refreshing, start] = useTransition();
  return { refreshing, refresh: () => start(() => router.refresh()) };
}

const matches = (needle: string, ...values: Array<string | null | undefined>) =>
  !needle || values.some((value) => value?.toLowerCase().includes(needle));

type LedgerView = "reconciliation" | "reported" | "expected";

/**
 * The ledger's lists as tabs, one at a time: Expected against reported (where a policy has both),
 * Reported by carriers, Expected from your book. Only the lists with rows get a tab; the first one
 * is open on arrival. `children` (the page's notices and its stat strip) sits between the tab row
 * and the open list, so the tabs stay directly under the title.
 */
export function LedgerViews({ reconciliation, policies, reported, canOpenStatements, expected, expectedSummary, actions, children }: {
  reconciliation: ReconciliationRow[];
  policies: Record<string, { policyNumber: string; insuredName: string; carrierName: string }>;
  reported: StatementLedgerEntry[];
  canOpenStatements: boolean;
  expected: LedgerEntry[];
  expectedSummary: string;
  actions?: ReactNode;
  children?: ReactNode;
}) {
  const tabs = [
    ...(reconciliation.length > 0 ? [{ key: "reconciliation" as const, label: "Expected against reported", count: reconciliation.length }] : []),
    ...(reported.length > 0 ? [{ key: "reported" as const, label: "Reported by carriers", count: reported.length }] : []),
    ...(expected.length > 0 ? [{ key: "expected" as const, label: "Expected from your book", count: expected.length }] : []),
  ];
  const [chosen, setChosen] = useState<LedgerView | null>(null);
  const view = tabs.find((tab) => tab.key === chosen)?.key ?? tabs[0]?.key ?? null;

  return (
    <>
      <div className="flex flex-wrap items-center justify-between gap-3">
        {tabs.length > 0 ? <ViewTabs label="Ledger views" tabs={tabs} active={view ?? tabs[0].key} onChange={setChosen} controls="ledger-panel" /> : <span />}
        {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
      </div>
      {children}
      <div id="ledger-panel" role={tabs.length > 0 ? "tabpanel" : undefined} aria-labelledby={view ? `ledger-panel-tab-${view}` : undefined}>
        {view === "reconciliation" && <ReconciliationTable rows={reconciliation} policies={policies} />}
        {view === "reported" && <StatementEntriesTable entries={reported} canOpenStatements={canOpenStatements} />}
        {view === "expected" && <ExpectedEntriesTable entries={expected} summary={expectedSummary} />}
      </div>
    </>
  );
}

export function StatementEntriesTable({ entries, canOpenStatements }: { entries: StatementLedgerEntry[]; canOpenStatements: boolean }) {
  const { refreshing, refresh } = useRefresh();
  const [query, setQuery] = useState("");
  const [kind, setKind] = useState<"all" | StatementLedgerEntry["kind"]>("all");
  const [page, setPage] = useState(1);
  const pageSize = useFittingPageSize(RESERVED, ROW);
  const visible = useMemo(() => {
    const needle = query.trim().toLowerCase();
    return entries.filter((entry) => (kind === "all" || entry.kind === kind) && matches(needle, entry.policyNumber, entry.insuredName, entry.carrierName, entry.fileName, entry.acceptedByName));
  }, [entries, query, kind]);
  const { current, rows } = paginate(visible, page, pageSize);
  const filtered = Boolean(query.trim()) || kind !== "all";
  const clear = () => { setQuery(""); setKind("all"); setPage(1); };
  return (
    <TableCard
      className={FILL}
      toolbar={
        <DataToolbar actions={<>{filtered && <ClearFiltersButton onClick={clear} />}<RefreshButton onClick={refresh} refreshing={refreshing} /></>}>
          <ToolbarSearch value={query} onChange={(value) => { setQuery(value); setPage(1); }} placeholder="Search reported entries" />
          <select aria-label="Filter reported entries by kind" className={toolbarControl} value={kind} onChange={(event) => { setKind(event.target.value as typeof kind); setPage(1); }}>
            <option value="all">All kinds</option>
            {(Object.keys(KIND_TONE) as Array<keyof typeof KIND_TONE>).map((key) => <option key={key} value={key}>{STATEMENT_KIND_LABELS[key]}</option>)}
          </select>
        </DataToolbar>
      }
      footer={<Pager page={current} pageSize={pageSize} total={visible.length} onPage={setPage} noun={visible.length === 1 ? "entry" : "entries"} suffix={filtered ? `${entries.length.toLocaleString("en-US")} in all · newest first` : "newest first"} />}
    >
      {visible.length === 0 ? (
        <NoMatches noun="entries" onClear={clear} />
      ) : (
        <table className="portal-lead-table w-full min-w-[1240px] text-left text-sm">
          <thead>
            <tr>
              <th className="w-[110px]">Posted</th>
              <th className="w-[150px]">Policy</th>
              <th>Insured</th>
              <th className="w-[120px]">Kind</th>
              <th className="w-[120px] text-right">Amount</th>
              <th>Source statement</th>
              <th>File</th>
              <th className="w-[64px] text-right">Row</th>
              <th className="w-[150px]">Accepted by</th>
              <th className="w-[110px]">Accepted</th>
              <th className="w-[130px]">Match</th>
            </tr>
          </thead>
          <tbody className="m-seq">
            {rows.map((entry) => {
              const source = `${entry.carrierName} · ${statementPeriod(entry.periodStart, entry.periodEnd)}`;
              return (
                <tr key={entry.id} className="m-row">
                  <td className="tabular-nums">{statementDay(entry.postedOn)}</td>
                  <td className="font-semibold text-foreground">{entry.policyNumber}</td>
                  <td className="max-w-[200px] truncate" title={entry.insuredName}>{entry.insuredName}</td>
                  <td><StatusChip tone={KIND_TONE[entry.kind]} dot={false}>{STATEMENT_KIND_LABELS[entry.kind]}</StatusChip></td>
                  <td className={`text-right font-semibold tabular-nums ${entry.amountCents < 0 ? "text-[var(--error-ink)]" : "text-foreground"}`}>{statementMoney(entry.amountCents)}</td>
                  <td className="max-w-[240px] truncate" title={source}>
                    {canOpenStatements ? (
                      <Link href={`/app/statements/${entry.statementId}`} className="font-semibold text-foreground underline-offset-2 hover:underline">{source}</Link>
                    ) : (
                      <span className="font-semibold text-foreground">{source}</span>
                    )}
                  </td>
                  <td className="max-w-[200px] truncate text-muted-foreground" title={entry.fileName}>{entry.fileName}</td>
                  <td className="text-right tabular-nums text-muted-foreground">{entry.lineNumber}</td>
                  <td className="max-w-[150px] truncate" title={entry.acceptedByName ?? "A former member"}>{entry.acceptedByName ?? "A former member"}</td>
                  <td className="tabular-nums">{statementDay(entry.acceptedAt)}</td>
                  <td className="text-muted-foreground">{entry.method === "manual" ? "matched by hand" : "exact match"}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      )}
    </TableCard>
  );
}

export function ReconciliationTable({ rows, policies }: { rows: ReconciliationRow[]; policies: Record<string, { policyNumber: string; insuredName: string; carrierName: string }> }) {
  const { refreshing, refresh } = useRefresh();
  const [query, setQuery] = useState("");
  const [status, setStatus] = useState<"all" | ReconciliationStatus>("all");
  const [page, setPage] = useState(1);
  const pageSize = useFittingPageSize(RESERVED, ROW);
  const needsLook = rows.filter((row) => row.status === "short" || row.status === "over").length;
  const visible = useMemo(() => {
    const needle = query.trim().toLowerCase();
    return rows.filter((row) => {
      const policy = policies[row.policyId];
      return (status === "all" || row.status === status) && matches(needle, policy?.policyNumber, policy?.insuredName, policy?.carrierName);
    });
  }, [rows, policies, query, status]);
  const { current, rows: shown } = paginate(visible, page, pageSize);
  const filtered = Boolean(query.trim()) || status !== "all";
  const clear = () => { setQuery(""); setStatus("all"); setPage(1); };
  return (
    <TableCard
      className={FILL}
      toolbar={
        <DataToolbar actions={<>{filtered && <ClearFiltersButton onClick={clear} />}<RefreshButton onClick={refresh} refreshing={refreshing} /></>}>
          <ToolbarSearch value={query} onChange={(value) => { setQuery(value); setPage(1); }} placeholder="Search policies" />
          <select aria-label="Filter reconciliation by status" className={toolbarControl} value={status} onChange={(event) => { setStatus(event.target.value as typeof status); setPage(1); }}>
            <option value="all">All statuses</option>
            {(Object.keys(RECONCILE) as ReconciliationStatus[]).map((key) => <option key={key} value={key}>{RECONCILE[key].label}</option>)}
          </select>
        </DataToolbar>
      }
      footer={<Pager page={current} pageSize={pageSize} total={visible.length} onPage={setPage} noun={visible.length === 1 ? "policy" : "policies"} suffix={`${rows.length.toLocaleString("en-US")} ${rows.length === 1 ? "policy" : "policies"} on both sides · ${needsLook.toLocaleString("en-US")} ${needsLook === 1 ? "differs" : "differ"} by a dollar or more · differences first`} />}
    >
      {visible.length === 0 ? (
        <NoMatches noun="policies" onClear={clear} />
      ) : (
        <table className="portal-lead-table w-full min-w-[1080px] text-left text-sm">
          <thead>
            <tr>
              <th className="w-[150px]">Policy</th>
              <th>Insured</th>
              <th>Carrier</th>
              <th>Periods reported</th>
              <th className="w-[120px] text-right">Expected</th>
              <th className="w-[120px] text-right">Reported</th>
              <th className="w-[120px] text-right">Difference</th>
              <th className="w-[170px]">Status</th>
            </tr>
          </thead>
          <tbody className="m-seq">
            {shown.map((row) => {
              const policy = policies[row.policyId];
              const periods = row.periods.map((period) => statementPeriod(period.start, period.end)).join(", ");
              return (
                <tr key={row.policyId} className="m-row">
                  <td className="font-semibold text-foreground">{policy?.policyNumber ?? "Policy"}</td>
                  <td className="max-w-[200px] truncate" title={policy?.insuredName}>{policy?.insuredName ?? "—"}</td>
                  <td className="max-w-[180px] truncate" title={policy?.carrierName}>{policy?.carrierName ?? "—"}</td>
                  <td className="max-w-[260px] truncate text-muted-foreground" title={periods}>{periods}</td>
                  <td className="text-right tabular-nums">{row.status === "unpriced" ? "—" : statementMoney(row.expectedCents)}</td>
                  <td className="text-right tabular-nums">{statementMoney(row.receivedCents)}</td>
                  <td className={`text-right font-semibold tabular-nums ${row.status === "short" ? "text-[var(--error-ink)]" : "text-foreground"}`}>{row.status === "unpriced" ? "—" : `${row.differenceCents > 0 ? "+" : ""}${statementMoney(row.differenceCents)}`}</td>
                  <td><StatusChip tone={RECONCILE[row.status].tone}>{RECONCILE[row.status].label}</StatusChip></td>
                </tr>
              );
            })}
          </tbody>
        </table>
      )}
    </TableCard>
  );
}

export function ExpectedEntriesTable({ entries, summary }: { entries: LedgerEntry[]; summary: string }) {
  const { refreshing, refresh } = useRefresh();
  const [query, setQuery] = useState("");
  const [kind, setKind] = useState<"all" | LedgerEntryKind>("all");
  const [page, setPage] = useState(1);
  const pageSize = useFittingPageSize(RESERVED, ROW);
  const sorted = useMemo(() => [...entries].sort((a, b) => b.postedOn.localeCompare(a.postedOn)), [entries]);
  const visible = useMemo(() => {
    const needle = query.trim().toLowerCase();
    return sorted.filter((entry) => (kind === "all" || entry.kind === kind) && matches(needle, entry.policyNumber, entry.insuredName, entry.carrierName, entry.productName));
  }, [sorted, query, kind]);
  const { current, rows } = paginate(visible, page, pageSize);
  const filtered = Boolean(query.trim()) || kind !== "all";
  const clear = () => { setQuery(""); setKind("all"); setPage(1); };
  return (
    <TableCard
      className={FILL}
      toolbar={
        <DataToolbar actions={<>{filtered && <ClearFiltersButton onClick={clear} />}<RefreshButton onClick={refresh} refreshing={refreshing} /></>}>
          <ToolbarSearch value={query} onChange={(value) => { setQuery(value); setPage(1); }} placeholder="Search expected entries" />
          <select aria-label="Filter expected entries by kind" className={toolbarControl} value={kind} onChange={(event) => { setKind(event.target.value as typeof kind); setPage(1); }}>
            <option value="all">All kinds</option>
            {(Object.keys(EXPECTED_KIND) as LedgerEntryKind[]).map((key) => <option key={key} value={key}>{EXPECTED_KIND[key]}</option>)}
          </select>
        </DataToolbar>
      }
      footer={<>
        <Pager page={current} pageSize={pageSize} total={visible.length} onPage={setPage} noun={visible.length === 1 ? "entry" : "entries"} suffix="newest first" />
        <span className="basis-full">{summary}</span>
      </>}
    >
      {visible.length === 0 ? (
        <NoMatches noun="entries" onClear={clear} />
      ) : (
        <table className="portal-lead-table w-full min-w-[1000px] text-left text-sm">
          <thead>
            <tr>
              <th className="w-[110px]">Posted</th>
              <th className="w-[150px]">Policy</th>
              <th>Insured</th>
              <th>Carrier</th>
              <th>Product</th>
              <th className="w-[120px]">Kind</th>
              <th className="w-[70px] text-right">Year</th>
              <th className="w-[80px] text-right">Rate</th>
              <th className="w-[120px] text-right">Amount</th>
            </tr>
          </thead>
          <tbody className="m-seq">
            {rows.map((entry) => (
              <tr key={entry.id} className="m-row">
                <td className="tabular-nums">{day(entry.postedOn)}</td>
                <td className="font-semibold text-foreground">{entry.policyNumber}</td>
                <td className="max-w-[200px] truncate" title={entry.insuredName}>{entry.insuredName}</td>
                <td className="max-w-[180px] truncate" title={entry.carrierName}>{entry.carrierName}</td>
                <td className="max-w-[200px] truncate" title={entry.productName}>{entry.productName}</td>
                <td><StatusChip tone={KIND_TONE[entry.kind]} dot={false}>{EXPECTED_KIND[entry.kind]}</StatusChip></td>
                <td className="text-right tabular-nums">{entry.policyYear}</td>
                <td className="text-right tabular-nums">{entry.rateBp == null ? "—" : `${(entry.rateBp / 100).toFixed(2)}%`}</td>
                <td className={`text-right font-semibold tabular-nums ${entry.amountCents < 0 ? "text-[var(--error-ink)]" : "text-foreground"}`}>{money(entry.amountCents)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </TableCard>
  );
}
