"use client";

import { useMemo, useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";

import { DataToolbar, RefreshButton, ToolbarSearch, toolbarControl } from "@/components/ui/data-toolbar";
import { NoMatches } from "@/components/ui/page-states";
import { TableCard } from "@/components/ui/table-card";
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
 */

const KIND_CHIP = {
  advance: "bg-[var(--info-surface)] text-[var(--info-ink)]",
  commission: "bg-[var(--success-surface)] text-[var(--success-ink)]",
  chargeback: "bg-[var(--error-surface)] text-[var(--error-ink)]",
  adjustment: "bg-[var(--surface-alt)] text-[var(--body)]",
} as const;

const EXPECTED_KIND: Record<LedgerEntryKind, string> = { advance: "Advance", commission: "Commission", chargeback: "Chargeback" };

const RECONCILE: Record<ReconciliationStatus, { label: string; chip: string }> = {
  agrees: { label: "Agrees", chip: "bg-[var(--success-surface)] text-[var(--success-ink)]" },
  short: { label: "Paid short", chip: "bg-[var(--error-surface)] text-[var(--error-ink)]" },
  over: { label: "Paid over", chip: "bg-[var(--warning-surface)] text-[var(--warning-ink)]" },
  unpriced: { label: "No expected figure", chip: "bg-[var(--surface-alt)] text-[var(--body)]" },
};

const SHOWN = 200;

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

export function StatementEntriesTable({ entries, canOpenStatements }: { entries: StatementLedgerEntry[]; canOpenStatements: boolean }) {
  const { refreshing, refresh } = useRefresh();
  const [query, setQuery] = useState("");
  const [kind, setKind] = useState<"all" | StatementLedgerEntry["kind"]>("all");
  const visible = useMemo(() => {
    const needle = query.trim().toLowerCase();
    return entries.filter((entry) => (kind === "all" || entry.kind === kind) && matches(needle, entry.policyNumber, entry.insuredName, entry.carrierName, entry.fileName, entry.acceptedByName));
  }, [entries, query, kind]);
  const shown = visible.slice(0, SHOWN);
  return (
    <TableCard
      title="Reported by carriers"
      toolbar={
        <DataToolbar actions={<RefreshButton onClick={refresh} refreshing={refreshing} />}>
          <ToolbarSearch value={query} onChange={setQuery} placeholder="Search reported entries" />
          <select aria-label="Filter reported entries by kind" className={toolbarControl} value={kind} onChange={(event) => setKind(event.target.value as typeof kind)}>
            <option value="all">All kinds</option>
            {(Object.keys(KIND_CHIP) as Array<keyof typeof KIND_CHIP>).map((key) => <option key={key} value={key}>{STATEMENT_KIND_LABELS[key]}</option>)}
          </select>
        </DataToolbar>
      }
      footer={<span>{visible.length > SHOWN ? `Newest ${SHOWN} of ${visible.length.toLocaleString("en-US")} entries` : `${visible.length.toLocaleString("en-US")} of ${entries.length.toLocaleString("en-US")} ${entries.length === 1 ? "entry" : "entries"} · newest first`}</span>}
    >
      {visible.length === 0 ? (
        <NoMatches noun="entries" onClear={() => { setQuery(""); setKind("all"); }} />
      ) : (
        <table className="portal-lead-table w-full min-w-[1040px] text-left text-sm">
          <thead>
            <tr>
              <th className="w-[110px]">Posted</th>
              <th>Policy</th>
              <th className="w-[120px]">Kind</th>
              <th className="w-[130px] text-right">Amount</th>
              <th>Source statement</th>
              <th>Accepted by</th>
            </tr>
          </thead>
          <tbody className="m-seq">
            {shown.map((entry) => (
              <tr key={entry.id} className="m-row">
                <td className="tabular-nums">{statementDay(entry.postedOn)}</td>
                <td>
                  <span className="block font-semibold text-foreground">{entry.policyNumber}</span>
                  <span className="block text-xs text-muted-foreground">{entry.insuredName}</span>
                </td>
                <td><span className={`inline-flex rounded-full px-2.5 py-[3px] text-xs font-semibold ${KIND_CHIP[entry.kind]}`}>{STATEMENT_KIND_LABELS[entry.kind]}</span></td>
                <td className={`text-right font-semibold tabular-nums ${entry.amountCents < 0 ? "text-[var(--error-ink)]" : "text-foreground"}`}>{statementMoney(entry.amountCents)}</td>
                <td>
                  {canOpenStatements ? (
                    <Link href={`/app/statements/${entry.statementId}`} className="block font-semibold text-foreground underline-offset-2 hover:underline">{entry.carrierName} · {statementPeriod(entry.periodStart, entry.periodEnd)}</Link>
                  ) : (
                    <span className="block font-semibold text-foreground">{entry.carrierName} · {statementPeriod(entry.periodStart, entry.periodEnd)}</span>
                  )}
                  <span className="block text-xs text-muted-foreground">{entry.fileName} · row {entry.lineNumber}</span>
                </td>
                <td>
                  <span className="block text-foreground">{entry.acceptedByName ?? "A former member"}</span>
                  <span className="block text-xs text-muted-foreground">{statementDay(entry.acceptedAt)} · {entry.method === "manual" ? "matched by hand" : "exact match"}</span>
                </td>
              </tr>
            ))}
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
  const needsLook = rows.filter((row) => row.status === "short" || row.status === "over").length;
  const visible = useMemo(() => {
    const needle = query.trim().toLowerCase();
    return rows.filter((row) => {
      const policy = policies[row.policyId];
      return (status === "all" || row.status === status) && matches(needle, policy?.policyNumber, policy?.insuredName, policy?.carrierName);
    });
  }, [rows, policies, query, status]);
  return (
    <TableCard
      title="Expected against reported"
      toolbar={
        <DataToolbar actions={<RefreshButton onClick={refresh} refreshing={refreshing} />}>
          <ToolbarSearch value={query} onChange={setQuery} placeholder="Search policies" />
          <select aria-label="Filter reconciliation by status" className={toolbarControl} value={status} onChange={(event) => setStatus(event.target.value as typeof status)}>
            <option value="all">All statuses</option>
            {(Object.keys(RECONCILE) as ReconciliationStatus[]).map((key) => <option key={key} value={key}>{RECONCILE[key].label}</option>)}
          </select>
        </DataToolbar>
      }
      footer={<span>{rows.length.toLocaleString("en-US")} {rows.length === 1 ? "policy" : "policies"} on both sides · {needsLook.toLocaleString("en-US")} {needsLook === 1 ? "differs" : "differ"} by a dollar or more · differences first</span>}
    >
      {visible.length === 0 ? (
        <NoMatches noun="policies" onClear={() => { setQuery(""); setStatus("all"); }} />
      ) : (
        <table className="portal-lead-table w-full min-w-[900px] text-left text-sm">
          <thead>
            <tr>
              <th>Policy</th>
              <th>Periods reported</th>
              <th className="w-[130px] text-right">Expected</th>
              <th className="w-[130px] text-right">Reported</th>
              <th className="w-[130px] text-right">Difference</th>
              <th className="w-[160px]">Status</th>
            </tr>
          </thead>
          <tbody className="m-seq">
            {visible.slice(0, SHOWN).map((row) => {
              const policy = policies[row.policyId];
              return (
                <tr key={row.policyId} className="m-row">
                  <td>
                    <span className="block font-semibold text-foreground">{policy?.policyNumber ?? "Policy"}</span>
                    <span className="block text-xs text-muted-foreground">{policy ? `${policy.insuredName} · ${policy.carrierName}` : ""}</span>
                  </td>
                  <td className="text-xs text-muted-foreground">{row.periods.map((period) => statementPeriod(period.start, period.end)).join(", ")}</td>
                  <td className="text-right tabular-nums">{row.status === "unpriced" ? "—" : statementMoney(row.expectedCents)}</td>
                  <td className="text-right tabular-nums">{statementMoney(row.receivedCents)}</td>
                  <td className={`text-right font-semibold tabular-nums ${row.status === "short" ? "text-[var(--error-ink)]" : "text-foreground"}`}>{row.status === "unpriced" ? "—" : `${row.differenceCents > 0 ? "+" : ""}${statementMoney(row.differenceCents)}`}</td>
                  <td><span className={`inline-flex rounded-full px-2.5 py-[3px] text-xs font-semibold ${RECONCILE[row.status].chip}`}>{RECONCILE[row.status].label}</span></td>
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
  const sorted = useMemo(() => [...entries].sort((a, b) => b.postedOn.localeCompare(a.postedOn)), [entries]);
  const visible = useMemo(() => {
    const needle = query.trim().toLowerCase();
    return sorted.filter((entry) => (kind === "all" || entry.kind === kind) && matches(needle, entry.policyNumber, entry.insuredName, entry.carrierName, entry.productName));
  }, [sorted, query, kind]);
  return (
    <TableCard
      title="Expected from your book"
      description={summary}
      toolbar={
        <DataToolbar actions={<RefreshButton onClick={refresh} refreshing={refreshing} />}>
          <ToolbarSearch value={query} onChange={setQuery} placeholder="Search expected entries" />
          <select aria-label="Filter expected entries by kind" className={toolbarControl} value={kind} onChange={(event) => setKind(event.target.value as typeof kind)}>
            <option value="all">All kinds</option>
            {(Object.keys(EXPECTED_KIND) as LedgerEntryKind[]).map((key) => <option key={key} value={key}>{EXPECTED_KIND[key]}</option>)}
          </select>
        </DataToolbar>
      }
      footer={<span>{visible.length.toLocaleString("en-US")} of {entries.length.toLocaleString("en-US")} {entries.length === 1 ? "entry" : "entries"} · newest first</span>}
    >
      {visible.length === 0 ? (
        <NoMatches noun="entries" onClear={() => { setQuery(""); setKind("all"); }} />
      ) : (
        <table className="portal-lead-table w-full min-w-[900px] text-left text-sm">
          <thead>
            <tr>
              <th className="w-[110px]">Posted</th>
              <th>Policy</th>
              <th>Carrier · product</th>
              <th className="w-[120px]">Kind</th>
              <th className="w-[80px] text-right">Year</th>
              <th className="w-[90px] text-right">Rate</th>
              <th className="w-[130px] text-right">Amount</th>
            </tr>
          </thead>
          <tbody className="m-seq">
            {visible.map((entry) => (
              <tr key={entry.id} className="m-row">
                <td className="tabular-nums">{day(entry.postedOn)}</td>
                <td>
                  <span className="block font-semibold text-foreground">{entry.policyNumber}</span>
                  <span className="block text-xs text-muted-foreground">{entry.insuredName}</span>
                </td>
                <td>{entry.carrierName} · {entry.productName}</td>
                <td><span className={`inline-flex rounded-full px-2.5 py-[3px] text-xs font-semibold ${KIND_CHIP[entry.kind]}`}>{EXPECTED_KIND[entry.kind]}</span></td>
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
