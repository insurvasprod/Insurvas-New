"use client";

/**
 * LA-4.3 · the unmatched queue: every statement line, across every statement that is not voided,
 * still without a match. "Re-match all" proposes again against the book as it is now (policy number,
 * then insured name + carrier). Each proposal is still accepted on its own statement.
 */

import { useMemo, useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";

import { Button } from "@/components/ui/button";
import { DataToolbar, RefreshButton, ToolbarSearch, toolbarControl } from "@/components/ui/data-toolbar";
import { EmptyState, NoMatches } from "@/components/ui/page-states";
import { Pager, paginate } from "@/components/ui/pager";
import { TableCard } from "@/components/ui/table-card";
import { STATEMENT_KIND_LABELS, statementMoney, statementPeriod, type UnmatchedStatementLine } from "@/lib/ledger/statementConstants";

const PAGE = 50;

export function UnmatchedLinesTable({ lines, canWrite, writeBlockedReason }: { lines: UnmatchedStatementLine[]; canWrite: boolean; writeBlockedReason: string | null }) {
  const router = useRouter();
  const [refreshing, startRefresh] = useTransition();
  const [query, setQuery] = useState("");
  const [carrier, setCarrier] = useState("");
  const [page, setPage] = useState(1);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const carriers = useMemo(() => [...new Set(lines.map((line) => line.carrierName))].sort((a, b) => a.localeCompare(b)), [lines]);
  const visible = useMemo(() => {
    const needle = query.trim().toLowerCase();
    return lines.filter((line) =>
      (!needle || `${line.policyNumber ?? ""} ${line.insuredName ?? ""}`.toLowerCase().includes(needle)) &&
      (!carrier || line.carrierName === carrier),
    );
  }, [lines, query, carrier]);
  const { current, rows: shown } = paginate(visible, page, PAGE);

  async function rematchAll() {
    setBusy(true); setError(null); setNotice(null);
    try {
      const response = await fetch("/api/app/statements/unmatched", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "rematch" }) });
      const data = (await response.json().catch(() => ({}))) as { proposed?: number; statements?: number; error?: string };
      if (!response.ok) throw new Error(data.error ?? "The lines were not re-matched.");
      const proposed = data.proposed ?? 0;
      setNotice(proposed ? `${proposed.toLocaleString("en-US")} ${proposed === 1 ? "line has" : "lines have"} a proposed match now, on ${data.statements ?? 0} ${data.statements === 1 ? "statement" : "statements"}. Accept each one on its statement.` : "Still no policy in your book matches these lines.");
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
        toolbar={
          <DataToolbar
            actions={<>
              {lines.length > 0 && (
                <Button type="button" variant="outline" disabled={!canWrite || busy} title={!canWrite ? writeBlockedReason ?? undefined : "Propose matches again against your book as it is now"} onClick={() => void rematchAll()}>
                  {busy ? "Re-matching…" : "Re-match all"}
                </Button>
              )}
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
        footer={visible.length > 0 ? <Pager page={current} pageSize={PAGE} total={visible.length} onPage={setPage} noun="lines" /> : undefined}
      >
        {lines.length === 0 ? (
          <EmptyState title="Every statement line has a match" hint="Lines without a match on any statement that is not voided appear here." />
        ) : visible.length === 0 ? (
          <NoMatches noun="lines" onClear={() => { setQuery(""); setCarrier(""); }} />
        ) : (
          <table className="portal-lead-table w-full min-w-[860px] text-left text-sm">
            <thead>
              <tr>
                <th>Carrier · period</th>
                <th className="w-[64px] text-right">Row</th>
                <th>On the statement</th>
                <th className="w-[120px]">Kind</th>
                <th className="w-[130px] text-right">Amount</th>
                <th className="w-[110px] text-right"><span className="sr-only">Open</span></th>
              </tr>
            </thead>
            <tbody>
              {shown.map((line) => (
                <tr key={line.id}>
                  <td>
                    <span className="block font-semibold text-foreground">{line.carrierName}</span>
                    <span className="block text-xs text-muted-foreground">{statementPeriod(line.periodStart, line.periodEnd)}</span>
                  </td>
                  <td className="text-right tabular-nums text-muted-foreground">{line.lineNumber}</td>
                  <td>
                    <span className="block font-semibold text-foreground">{line.policyNumber ?? "No policy number"}</span>
                    {line.insuredName && <span className="block text-xs text-muted-foreground">{line.insuredName}</span>}
                  </td>
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
