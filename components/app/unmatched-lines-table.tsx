"use client";

/**
 * LA-4.3 · the unmatched queue: every statement line, across every statement that is not voided,
 * still without a match. "Re-match" proposes again against the book as it is now (policy number,
 * then insured name + carrier); ticking "Include N left unmatched" adds the lines a person set aside
 * on purpose (user decision 2026-10-06, option c). Each proposal is still accepted on its own statement.
 *
 * 2026-10-06 redesign: one fact per column, a pager sized to the window, a full-height card.
 *
 * Round 7 (owner pick 1·A, 2026-11-10): the Statements page's "Lines to match" tab. A row opens its statement with
 * that line's dialog open; the outcome of a re-match is a toast, never a box on the page. Policy numbers read
 * without Excel's text guard.
 */

import { useMemo, useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";

import { Button } from "@/components/ui/button";
import { cleanPolicyNumber, statementHref, statementName } from "@/components/app/commissions/statements/list-order";
import { ClearFiltersButton, DataToolbar, RefreshButton, ToolbarCheckbox, ToolbarSearch, toolbarControl } from "@/components/ui/data-toolbar";
import { EmptyState, NoMatches } from "@/components/ui/page-states";
import { Pager, paginate } from "@/components/ui/pager";
import { TableCard } from "@/components/ui/table-card";
import { useFittingPageSize } from "@/components/app/book-of-business-views";
import { STATEMENT_KIND_LABELS, statementMoney, statementPeriod, type UnmatchedStatementLine } from "@/lib/ledger/statementConstants";
import { notify } from "@/lib/notify";

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
  const [includeLeft, setIncludeLeft] = useState(false);
  const rematchCount = lines.length + (includeLeft ? leftUnmatchedCount : 0);
  const pageSize = useFittingPageSize(420, 49);

  const carriers = useMemo(() => [...new Set(lines.map((line) => line.carrierName))].sort((a, b) => a.localeCompare(b)), [lines]);
  const visible = useMemo(() => {
    const needle = query.trim().toLowerCase();
    return lines.filter((line) =>
      (!needle || `${cleanPolicyNumber(line.policyNumber) ?? ""} ${line.insuredName ?? ""} ${line.carrierName}`.toLowerCase().includes(needle)) &&
      (!carrier || line.carrierName === carrier),
    );
  }, [lines, query, carrier]);
  const { current, rows: shown } = paginate(visible, page, pageSize);
  const filtered = Boolean(query.trim() || carrier);
  const clear = () => { setQuery(""); setCarrier(""); setPage(1); };

  async function rematchAll() {
    setBusy(true);
    try {
      const response = await fetch("/api/app/statements/unmatched", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(includeLeft ? { action: "rematch", include_left_unmatched: true } : { action: "rematch" }) });
      const data = (await response.json().catch(() => ({}))) as { proposed?: number; statements?: number; error?: string };
      if (!response.ok) throw new Error(data.error ?? "The lines were not re-matched.");
      const proposed = data.proposed ?? 0;
      if (proposed) notify.done(`${proposed.toLocaleString("en-US")} ${proposed === 1 ? "line has" : "lines have"} a proposed match now, on ${data.statements ?? 0} ${data.statements === 1 ? "statement" : "statements"}.`, { detail: "Accept each one on its statement." });
      else notify.warn("Still no policy in your book matches these lines.");
      setIncludeLeft(false);
      router.refresh();
    } catch (reason) {
      notify.fail(reason instanceof Error ? reason.message : "The lines were not re-matched.", { detail: "Nothing was changed." });
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex flex-col gap-3">
      <TableCard
        className="flex min-h-[calc(100dvh-var(--top-bar-h)-220px)] flex-col [&>.overflow-x-auto]:flex-1"
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
        footer={visible.length > 0 ? <Pager page={current} pageSize={pageSize} total={visible.length} onPage={setPage} noun="lines" suffix="in statement order" /> : undefined}
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
                <th>Carrier · period</th>
                <th className="w-[180px]">Policy number</th>
                <th>Insured</th>
                <th className="w-[120px]">Kind</th>
                <th className="w-[130px] text-right">Amount</th>
                <th className="w-[110px]">Next step</th>
              </tr>
            </thead>
            <tbody>
              {shown.map((line) => {
                const open = statementHref(line.statementId, "unmatched", { line: line.id });
                const number = cleanPolicyNumber(line.policyNumber);
                // A row is a link to its statement, the line's dialog open (board 1·A); the links inside keep their own way.
                return (
                  <tr key={line.id} className="m-row cursor-pointer" onClick={(event) => { if (!(event.target as HTMLElement).closest("a, button")) router.push(open); }}>
                    <td className="whitespace-nowrap font-medium text-foreground">
                      <Link href={statementHref(line.statementId, "unmatched")} className="hover:underline" title={`Open the ${line.carrierName} statement, row ${line.lineNumber}`}>{statementName(line.carrierName, statementPeriod(line.periodStart, line.periodEnd))}</Link>
                    </td>
                    <td className="whitespace-nowrap">
                      {number
                        ? <Link href={`/app/policies?q=${encodeURIComponent(number)}`} className="hover:underline" title={`Search your book for ${number}`}>{number}</Link>
                        : <span className="text-muted-foreground">—</span>}
                    </td>
                    <td className="whitespace-nowrap">{line.insuredName ?? <span className="text-muted-foreground">—</span>}</td>
                    <td className="whitespace-nowrap">{line.kind ? STATEMENT_KIND_LABELS[line.kind] : <span className="text-muted-foreground">—</span>}</td>
                    <td className="whitespace-nowrap text-right tabular-nums">{line.amountCents === null ? <span className="text-muted-foreground">—</span> : statementMoney(line.amountCents)}</td>
                    <td><Link href={open} className="whitespace-nowrap hover:underline">{canWrite ? "Match ›" : "Open ›"}</Link></td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </TableCard>
    </div>
  );
}
