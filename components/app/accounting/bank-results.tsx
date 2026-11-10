"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useMemo, useState, useTransition } from "react";

import { DataToolbar, RefreshButton, ToolbarSearch, toolbarControl } from "@/components/ui/data-toolbar";
import { EmptyState, NoMatches } from "@/components/ui/page-states";
import { Pager, paginate } from "@/components/ui/pager";
import { StatStrip, StatTile } from "@/components/ui/stat";
import { StatusChip } from "@/components/ui/status-chip";
import { TableCard } from "@/components/ui/table-card";
import { Segmented } from "@/components/ui/view-tabs";
import { useFittingPageSize } from "@/components/ui/use-fitting-page-size";
import { lagWords, resultsSummary, VERDICT_LABELS, VERDICT_ORDER, VERDICT_TONES, type PaymentVerdict } from "@/lib/accounting/bankResultsCore";
import { formatCentsAsCurrency } from "@/lib/money";

/**
 * Bank deposits › Results (owner's Accounting doc, "The Bank Matchmaker", round 1 board B2, 2026-11-07).
 * One row per carrier payment: what the carrier said, what landed, how many policies were paid right, and
 * one verdict — All good, Missing money or Bad math (with "to confirm", "waiting" and "rate missing" for
 * the honest in-between). A row opens the payment's own page.
 */
export type ResultListRow = {
  id: string;
  carrierName: string;
  statementDate: string;
  paidCents: number;
  verdict: PaymentVerdict;
  missingCents: number;
  shortCents: number;
  dueBy: string;
  deposit: { postedOn: string; amountCents: number; account: string } | null;
  depositCount: number;
  policies: { total: number; ok: number; short: number; noPromise: number };
};

const FILTERS = ["all", "missing_money", "bad_math", "all_good"] as const;
type Filter = (typeof FILTERS)[number];
const money = (c: number) => formatCentsAsCurrency(c);

export function BankResults({ rows, period, show, bankThrough, hasAccounts }: { rows: ResultListRow[]; period: string; show: string | undefined; bankThrough: string | null; hasAccounts: boolean }) {
  const router = useRouter();
  const [q, setQ] = useState("");
  const [filter, setFilter] = useState<Filter>(FILTERS.find((f) => f === show) ?? "all");
  const [page, setPage] = useState(1);
  const pageSize = useFittingPageSize(520, 52);
  const [refreshing, startRefresh] = useTransition();
  const sum = resultsSummary(rows);
  const needle = q.trim().toLowerCase();
  const shown = useMemo(() => rows
    .filter((r) => filter === "all" || r.verdict === filter)
    .filter((r) => !needle || r.carrierName.toLowerCase().includes(needle) || r.statementDate.includes(needle))
    .sort((a, b) => VERDICT_ORDER.indexOf(a.verdict) - VERDICT_ORDER.indexOf(b.verdict) || b.statementDate.localeCompare(a.statementDate)), [rows, filter, needle]);
  const paged = paginate(shown, page, pageSize);
  const pick = (f: Filter) => { setFilter(f); setPage(1); };

  return (
    <>
      <StatStrip label="Carrier payments">
        <StatTile label="Carrier payments checked" value={String(sum.checked)} footnote={money(sum.checkedCents)} href={`/app/bank?view=results&period=${period}`} />
        <StatTile label="All good" value={String(sum.good)} valueTone={sum.good ? "good" : undefined} footnote={money(sum.goodCents)} href={`/app/bank?view=results&period=${period}&show=all_good`} />
        <StatTile label="Missing money" value={String(sum.missing)} valueTone={sum.missing ? "danger" : undefined} footnote={sum.missing ? `${money(sum.missingCents)} not in the bank` : "Nothing missing"} href={`/app/bank?view=results&period=${period}&show=missing_money`} />
        <StatTile label="Bad math" value={String(sum.badMath)} valueTone={sum.badMath ? "danger" : undefined} footnote={sum.badMath ? `${money(sum.shortCents)} short` : "Every policy paid right"} href={`/app/bank?view=results&period=${period}&show=bad_math`} />
      </StatStrip>
      <TableCard
        toolbar={
          <DataToolbar actions={<>
            <select aria-label="Period" className={toolbarControl} value={period} onChange={(e) => router.push(`/app/bank?view=results&period=${e.target.value}`)}>
              <option value="30">Last 30 days</option>
              <option value="90">Last 90 days</option>
              <option value="365">Last 12 months</option>
            </select>
            <RefreshButton onClick={() => startRefresh(() => router.refresh())} refreshing={refreshing} />
          </>}>
            <ToolbarSearch value={q} onChange={(v) => { setQ(v); setPage(1); }} placeholder="Search carrier" />
            <Segmented label="Result" value={filter} onChange={pick} options={[
              { key: "all", label: "All", count: rows.length },
              { key: "missing_money", label: "Missing money", count: sum.missing || null, tone: "danger" },
              { key: "bad_math", label: "Bad math", count: sum.badMath || null, tone: "danger" },
              { key: "all_good", label: "All good", count: sum.good || null },
            ]} />
          </DataToolbar>
        }
        footer={shown.length > pageSize ? <Pager page={paged.current} total={shown.length} noun="payments" pageSize={pageSize} onPage={setPage} /> : undefined}
      >
        {rows.length === 0 ? (
          <EmptyState title="No carrier payments in this period" hint={hasAccounts ? "A carrier payment appears here once its commission file is in, or its statement is entered under Commissions." : "Start with Check a payment: drop the carrier's commission file and the bank statement."} action={<Link className="text-sm font-medium text-[var(--accent-ink)] underline-offset-2 hover:underline" href="/app/bank/check">Check a payment</Link>} />
        ) : shown.length === 0 ? (
          <NoMatches noun="payments" onClear={() => { setQ(""); pick("all"); }} />
        ) : (
          <table className="portal-lead-table w-full min-w-[860px] text-left text-sm">
            <thead><tr><th>Carrier payment</th><th className="w-[130px] text-right">Carrier says</th><th className="w-[230px]">Bank deposit</th><th className="w-[170px]">Policies</th><th className="w-[190px]">Result</th></tr></thead>
            <tbody>
              {paged.rows.map((r) => (
                <tr key={r.id} className="cursor-pointer" onClick={() => router.push(`/app/bank/payments/${r.id}`)}>
                  <td><Link href={`/app/bank/payments/${r.id}`} className="font-medium hover:underline" onClick={(e) => e.stopPropagation()}>{r.carrierName}</Link><div className="text-xs text-muted-foreground">Statement {r.statementDate} · {r.policies.total} {r.policies.total === 1 ? "policy" : "policies"}</div></td>
                  <td className="text-right tabular-nums">{money(r.paidCents)}</td>
                  <td>{r.deposit ? <>{money(r.deposit.amountCents)} · {r.deposit.postedOn}{r.depositCount > 1 ? ` + ${r.depositCount - 1} more` : ""}<div className="text-xs text-muted-foreground">{r.deposit.account} · {lagWords(r.statementDate, r.deposit.postedOn)}</div></> : <span className="text-muted-foreground">{r.verdict === "missing_money" ? `Nothing landed by ${r.dueBy}` : bankThrough && bankThrough < r.dueBy ? `Bank file reaches ${bankThrough}` : `Due by ${r.dueBy}`}</span>}</td>
                  <td>{r.policies.total === 0 ? <span className="text-muted-foreground">No policy lines</span> : <>{r.policies.ok} right{r.policies.short ? <> · <strong className="text-[var(--error-ink)]">{r.policies.short} short</strong></> : null}{r.policies.noPromise ? <span className="text-muted-foreground"> · {r.policies.noPromise} no promise</span> : null}</>}</td>
                  <td><StatusChip tone={VERDICT_TONES[r.verdict]}>{VERDICT_LABELS[r.verdict]}{r.verdict === "bad_math" ? ` · ${money(r.shortCents)}` : r.verdict === "missing_money" ? ` · ${money(r.missingCents)}` : ""}</StatusChip></td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </TableCard>
    </>
  );
}
