"use client";

/**
 * LA-4.3 · the unmatched queue: every statement line, across every statement that is not voided,
 * still without a match. "Re-match" proposes again against the book as it is now (policy number,
 * then insured name + carrier); ticking "Include N left unmatched" adds the lines a person set aside
 * on purpose (user decision 2026-10-06, option c). Each proposal is still accepted on its own statement.
 *
 * 2026-10-06 redesign: one fact per column, a pager sized to the window, a full-height card.
 */

import { useMemo, useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";

import { Button } from "@/components/ui/button";
import { ClearFiltersButton, DataToolbar, RefreshButton, ToolbarCheckbox, ToolbarSearch, toolbarControl } from "@/components/ui/data-toolbar";
import { EmptyState, NoMatches } from "@/components/ui/page-states";
import { Pager, paginate } from "@/components/ui/pager";
import { TableCard } from "@/components/ui/table-card";
import { useFittingPageSize } from "@/components/app/book-of-business-views";
import { STATEMENT_KIND_LABELS, statementMoney, statementPeriod, type UnmatchedStatementLine } from "@/lib/ledger/statementConstants";

export function UnmatchedLinesTable({ lines, leftUnmatchedCount = 0, canWrite, writeBlockedReason }: {
  lines: UnmatchedStatementLine[];
  /** Lines set aside on purpose across the statements; they join "Re-match all" only when ticked (LA-4.3 option c). */
  leftUnmatchedCount?: number;
  canWrite: boolean;
  writeBlockedReason: string | null;
}) {
  const router = useRouter();
  const [refreshing, startRefresh] = useTransition();
  const [query, setQuery] = useState("");
  const [carrier, setCarrier] = useState("");
  const [page, setPage] = useState(1);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [includeLeft, setIncludeLeft] = useState(false);
  const rematchCount = lines.length + (includeLeft ? leftUnmatchedCount : 0);
  const pageSize = useFittingPageSize(420, 49);

  const carriers = useMemo(() => [...new Set(lines.map((line) => line.carrierName))].sort((a, b) => a.localeCompare(b)), [lines]);
  const visible = useMemo(() => {
    const needle = query.trim().toLowerCase();
    return lines.filter((line) =>
      (!needle || `${line.policyNumber ?? ""} ${line.insuredName ?? ""}`.toLowerCase().includes(needle)) &&
      (!carrier || line.carrierName === carrier),
    );
  }, [lines, query, carrier]);
  const { current, rows: shown } = paginate(visible, page, pageSize);
  const filtered = Boolean(query.trim() || carrier);
  const clear = () => { setQuery(""); setCarrier(""); setPage(1); };

  async function rematchAll() {
    setBusy(true); setError(null); setNotice(null);
    try {
      const response = await fetch("/api/app/statements/unmatched", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(includeLeft ? { action: "rematch", include_left_unmatched: true } : { action: "rematch" }) });
      const data = (await response.json().catch(() => ({}))) as { proposed?: number; statements?: number; error?: string };
      if (!response.ok) throw new Error(data.error ?? "The lines were not re-matched.");
      const proposed = data.proposed ?? 0;
      setNotice(proposed ? `${proposed.toLocaleString("en-US")} ${proposed === 1 ? "line has" : "lines have"} a proposed match now, on ${data.statements ?? 0} ${data.statements === 1 ? "statement" : "statements"}. Accept each one on its statement.` : "Still no policy in your book matches these lines.");
      setIncludeLeft(false);
      router.refresh();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "The lines were not re-matched.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex flex-col gap-3">
      {notice && <p role="status" className="rounded-md bg-[var(--success-surface)] px-3 py-2 text-sm text-[var(--success-ink)]">{notice}</p>}
      {error && <p role="alert" className="rounded-md bg-[var(--error-surface)] px-3 py-2 text-sm text-[var(--error-ink)]">{error}</p>}
      <TableCard
        className="flex min-h-[calc(100dvh-var(--top-bar-h)-332px)] flex-col [&>.overflow-x-auto]:flex-1"
        toolbar={
          <DataToolbar
            actions={<>
              {canWrite && leftUnmatchedCount > 0 && (
                <ToolbarCheckbox
                  checked={includeLeft}
                  disabled={busy}
                  onChange={setIncludeLeft}
                  label={`Include ${leftUnmatchedCount.toLocaleString("en-US")} left unmatched`}
                  title="Also propose matches for the lines you set aside on purpose. A policy you already turned down for a line is never proposed for it again."
                />
              )}
              {lines.length + leftUnmatchedCount > 0 && (
                <Button type="button" variant="outline" disabled={!canWrite || busy || rematchCount === 0} title={!canWrite ? writeBlockedReason ?? undefined : rematchCount === 0 ? "Tick “Include left unmatched” to re-match the lines you set aside" : "Propose matches again against your book as it is now"} onClick={() => void rematchAll()}>
                  {busy ? "Re-matching…" : `Re-match ${rematchCount.toLocaleString("en-US")}`}
                </Button>
              )}
              {filtered && <ClearFiltersButton onClick={clear} />}
              <RefreshButton onClick={() => startRefresh(() => router.refresh())} refreshing={refreshing} />
            </>}
          >
            <ToolbarSearch value={query} onChange={(value) => { setQuery(value); setPage(1); }} placeholder="Search policy or insured" />
            <select aria-label="Filter unmatched lines by carrier" className={toolbarControl} value={carrier} onChange={(event) => { setCarrier(event.target.value); setPage(1); }}>
              <option value="">All carriers</option>
              {carriers.map((name) => <option key={name} value={name}>{name}</option>)}
            </select>
          </DataToolbar>
        }
        footer={visible.length > 0 ? <Pager page={current} pageSize={pageSize} total={visible.length} onPage={setPage} noun="lines" /> : undefined}
      >
        {lines.length === 0 ? (
          leftUnmatchedCount > 0 ? (
            <EmptyState title="No line is waiting for a match" hint={`${leftUnmatchedCount.toLocaleString("en-US")} ${leftUnmatchedCount === 1 ? "line was" : "lines were"} left unmatched on purpose. Tick “Include left unmatched” to propose matches for them again.`} />
          ) : (
            <EmptyState title="Every statement line has a match" hint="Lines without a match on any statement that is not voided appear here." />
          )
        ) : visible.length === 0 ? (
          <NoMatches noun="lines" onClear={clear} />
        ) : (
          <table className="portal-lead-table w-full min-w-[960px] text-left text-sm">
            <thead>
              <tr>
                <th>Carrier</th>
                <th className="w-[170px]">Period</th>
                <th className="w-[64px] text-right">Row</th>
                <th className="w-[170px]">Policy number</th>
                <th>Insured</th>
                <th className="w-[120px]">Kind</th>
                <th className="w-[130px] text-right">Amount</th>
                <th className="w-[90px] text-right"><span className="sr-only">Open</span></th>
              </tr>
            </thead>
            <tbody>
              {shown.map((line) => (
                <tr key={line.id}>
                  <td className="max-w-[220px] truncate font-semibold text-foreground" title={line.carrierName}>{line.carrierName}</td>
                  <td className="tabular-nums">{statementPeriod(line.periodStart, line.periodEnd)}</td>
                  <td className="text-right tabular-nums text-muted-foreground">{line.lineNumber}</td>
                  <td className="font-semibold text-foreground">{line.policyNumber ?? "No policy number"}</td>
                  <td className="max-w-[240px] truncate" title={line.insuredName ?? undefined}>{line.insuredName ?? "—"}</td>
                  <td>{line.kind ? STATEMENT_KIND_LABELS[line.kind] : "—"}</td>
                  <td className={`text-right font-semibold tabular-nums ${line.amountCents !== null && line.amountCents < 0 ? "text-[var(--error-ink)]" : "text-foreground"}`}>{line.amountCents === null ? "—" : statementMoney(line.amountCents)}</td>
                  <td className="text-right">
                    <Button asChild size="sm" variant="outline"><Link href={`/app/statements/${line.statementId}`}>Open</Link></Button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </TableCard>
    </div>
  );
}
