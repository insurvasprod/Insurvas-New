"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useMemo, useState, useTransition, type MouseEvent } from "react";

import { DataToolbar, RefreshButton, ToolbarSearch, toolbarControl } from "@/components/ui/data-toolbar";
import { setParamsInPlace } from "@/components/ui/nav-pending";
import { EmptyState, NoMatches } from "@/components/ui/page-states";
import { Pager, paginate } from "@/components/ui/pager";
import { StatStrip, StatTile } from "@/components/ui/stat";
import { StatusChip } from "@/components/ui/status-chip";
import { TableCard } from "@/components/ui/table-card";
import { Segmented } from "@/components/ui/view-tabs";
import { useFittingPageSize } from "@/components/ui/use-fitting-page-size";
import { inPaymentFilter, lagWords, orderPayments, PAYMENT_FILTERS, paymentHref, paymentNextStep, paymentsFrom, readableDay, resultsSummary, shortDay, VERDICT_LABELS, VERDICT_TONES, type PaymentFilter, type PaymentVerdict } from "@/lib/accounting/bankResultsCore";
import { formatCentsAsCurrency } from "@/lib/money";

/**
 * Bank deposits › Payments (owner's Accounting doc, "The Bank Matchmaker", 2026-11-07; round 7 board 1·B,
 * 2026-11-10: the first of the two questions — did each carrier pay what it promised?). One row per carrier
 * payment: what the carrier said, what landed, how many policies were paid right, one verdict, and the next step
 * in words (the step is taken on the payment's page). Worst first. A row opens the payment's page carrying
 * `?from=`, so its ‹ › walk this list in this order and filter. The strip shows on this tab only.
 */
export type ResultListRow = {
  id: string;
  carrierId: string;
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

const money = (c: number) => formatCentsAsCurrency(c);

/** A payment's one chip (owner 2026-11-11: colour only in a chip): bad math and missing money say their money. */
function verdictWord(r: { verdict: PaymentVerdict; shortCents: number; missingCents: number }): string {
  if (r.verdict === "bad_math") return `${money(r.shortCents)} short`;
  if (r.verdict === "missing_money") return `${money(r.missingCents)} missing`;
  return VERDICT_LABELS[r.verdict];
}

/** A payment's Next step as a short verb (the sentence is its tooltip). */
function paymentStep(verdict: PaymentVerdict): string {
  if (verdict === "missing_money") return "Ask carrier";
  if (verdict === "bad_math") return "Review";
  if (verdict === "to_confirm") return "Confirm";
  if (verdict === "rate_missing") return "Add rate";
  return "Open";
}

export function BankResults({ rows, period, show, bankThrough, hasAccounts }: { rows: ResultListRow[]; period: string; show: string | undefined; bankThrough: string | null; hasAccounts: boolean }) {
  const router = useRouter();
  const [q, setQ] = useState("");
  const [filter, setFilter] = useState<PaymentFilter>(PAYMENT_FILTERS.find((f) => f === show) ?? "all");
  const [page, setPage] = useState(1);
  const pageSize = useFittingPageSize(600, 52);
  const [refreshing, startRefresh] = useTransition();
  const sum = resultsSummary(rows);
  const shortPolicies = rows.filter((r) => r.verdict === "bad_math").reduce((n, r) => n + r.policies.short, 0);
  const waiting = rows.filter((r) => inPaymentFilter(r.verdict, "waiting")).length;
  const needle = q.trim().toLowerCase();
  const shown = useMemo(() => orderPayments(rows.filter((r) => inPaymentFilter(r.verdict, filter)).filter((r) => !needle || r.carrierName.toLowerCase().includes(needle) || r.statementDate.includes(needle) || readableDay(r.statementDate).toLowerCase().includes(needle))), [rows, filter, needle]);
  const paged = paginate(shown, page, pageSize);
  const from = paymentsFrom(period, filter);
  const pick = (f: PaymentFilter) => { setFilter(f); setPage(1); setParamsInPlace({ show: f === "all" ? null : f }); };
  const tab = (show: PaymentFilter) => `/app/bank?view=payments&period=${period}${show === "all" ? "" : `&show=${show}`}`;
  const stop = { onClick: (e: MouseEvent) => e.stopPropagation() };

  return (
    <>
      <StatStrip label="Carrier payments">
        <StatTile label="Payments checked" value={String(sum.checked)} footnote={`${money(sum.checkedCents)} the carriers said they paid`} href={tab("all")} />
        <StatTile label="All good" value={String(sum.good)} footnote="landed, every policy paid right" href={tab("all_good")} />
        <StatTile label="Missing money" value={money(sum.missingCents)} footnote={sum.missing ? <StatusChip tone="danger">{sum.missing} payment{sum.missing === 1 ? "" : "s"} not in the bank</StatusChip> : "Nothing missing"} href={tab("missing_money")} />
        <StatTile label="Bad math" value={sum.badMath ? `${money(sum.shortCents)} short` : money(0)} footnote={sum.badMath ? <StatusChip tone="danger">{shortPolicies} {shortPolicies === 1 ? "policy" : "policies"} short</StatusChip> : "Every policy paid right"} href={tab("bad_math")} />
      </StatStrip>
      <TableCard
        toolbar={
          <DataToolbar actions={<>
            <select aria-label="Period" className={toolbarControl} value={period} onChange={(e) => router.push(`/app/bank?view=payments&period=${e.target.value}${filter === "all" ? "" : `&show=${filter}`}`)}>
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
              { key: "waiting", label: "Waiting", count: waiting || null },
              { key: "all_good", label: "All good", count: sum.good || null },
            ]} />
          </DataToolbar>
        }
        footer={shown.length > pageSize ? <Pager page={paged.current} total={shown.length} noun="payments" pageSize={pageSize} onPage={setPage} /> : shown.length ? <span className="text-sm text-muted-foreground">{shown.length} payment{shown.length === 1 ? "" : "s"} · worst first</span> : undefined}
      >
        {rows.length === 0 ? (
          <EmptyState title="No carrier payments in this period" hint={hasAccounts ? "A carrier payment appears here once its commission file is in, or its statement is entered under Commissions." : "Start with Check a payment: drop the carrier's commission file and the bank statement."} action={<Link className="text-sm font-medium text-[var(--accent-ink)] underline-offset-2 hover:underline" href="/app/bank/check">Check a payment</Link>} />
        ) : shown.length === 0 ? (
          <NoMatches noun="payments" onClear={() => { setQ(""); pick("all"); }} />
        ) : (
          <table className="portal-lead-table w-full min-w-[1040px] text-left text-sm">
            <thead><tr><th>Carrier payment</th><th>Statement</th><th className="text-right">Carrier says</th><th className="text-right">Bank deposit</th><th>Result</th><th>Next step</th></tr></thead>
            <tbody>
              {paged.rows.map((r) => {
                const open = paymentHref(r.id, from);
                const next = paymentNextStep({ verdict: r.verdict, carrierName: r.carrierName, dueBy: r.dueBy, shortPolicies: r.policies.short });
                // One line per row (owner 2026-11-11): the policy counts and the deposit's day, account and lag are tooltips;
                // the payment's page holds them in full (Policies and Deposit tabs).
                const policyWords = r.policies.total === 0 ? "No policy lines" : [`${r.policies.total} ${r.policies.total === 1 ? "policy" : "policies"}`, `${r.policies.ok} right`, r.policies.short ? `${r.policies.short} short` : null, r.policies.noPromise ? `${r.policies.noPromise} no promise` : null].filter(Boolean).join(" · ");
                const depositWords = r.deposit
                  ? `${shortDay(r.deposit.postedOn)}${r.depositCount > 1 ? ` + ${r.depositCount - 1} more` : ""} · ${r.deposit.account} · ${lagWords(r.statementDate, r.deposit.postedOn)}`
                  : r.verdict === "missing_money"
                    ? `Nothing landed by ${shortDay(r.dueBy)}${bankThrough ? ` · your bank file reaches ${shortDay(bankThrough)}` : ""}`
                    : bankThrough && bankThrough < r.dueBy ? `Bank file reaches ${shortDay(bankThrough)}` : `Due by ${shortDay(r.dueBy)}`;
                return (
                  <tr key={r.id} className="cursor-pointer" onClick={() => router.push(open)}>
                    <td className="whitespace-nowrap font-medium text-foreground" title={policyWords}><Link href={`/app/policies?carrier=${r.carrierId}`} className="hover:underline" {...stop}>{r.carrierName}</Link></td>
                    <td className="whitespace-nowrap tabular-nums text-muted-foreground">{readableDay(r.statementDate)}</td>
                    <td className="whitespace-nowrap text-right tabular-nums"><Link className="hover:underline" href={open} {...stop}>{money(r.paidCents)}</Link></td>
                    <td className="whitespace-nowrap text-right tabular-nums" title={depositWords}>{r.deposit
                      ? <Link className="hover:underline" href={paymentHref(r.id, from, "&tab=deposit")} {...stop}>{money(r.deposit.amountCents)}</Link>
                      : <span className="text-muted-foreground">—</span>}</td>
                    <td><StatusChip tone={VERDICT_TONES[r.verdict]}>{verdictWord(r)}</StatusChip></td>
                    <td className="whitespace-nowrap" title={next ?? undefined}>{paymentStep(r.verdict)} ›</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </TableCard>
    </>
  );
}

/** Check a payment's list (board 1·5): carrier payments already in, last 30 days, newest first; a row opens the payment. */
export function RecentPayments({ rows }: { rows: { id: string; carrierName: string; statementDate: string; paidCents: number; verdict: PaymentVerdict; missingCents: number; shortCents: number; href: string }[] }) {
  const router = useRouter();
  const [page, setPage] = useState(1);
  const pageSize = useFittingPageSize(520, 52);
  const paged = paginate(rows, page, pageSize);
  return (
    <TableCard title="Carrier payments already in, last 30 days" footer={rows.length > pageSize ? <Pager page={paged.current} total={rows.length} noun="payments" pageSize={pageSize} onPage={setPage} /> : undefined}>
      {rows.length === 0 ? <EmptyState title="No carrier payments in the last 30 days" hint="Each new payment appears here once its commission file is in; its row opens the payment page." /> : (
        <table className="portal-lead-table w-full min-w-[720px] text-left text-sm">
          <thead><tr><th>Carrier</th><th>Statement</th><th className="text-right">Carrier says</th><th>Result</th></tr></thead>
          <tbody>
            {paged.rows.map((r) => (
              <tr key={r.id} className="cursor-pointer" onClick={() => router.push(r.href)}>
                <td className="whitespace-nowrap font-medium text-foreground">{r.carrierName}</td>
                <td className="whitespace-nowrap tabular-nums text-muted-foreground">{readableDay(r.statementDate)}</td>
                <td className="whitespace-nowrap text-right tabular-nums"><Link className="hover:underline" href={r.href} onClick={(e) => e.stopPropagation()}>{money(r.paidCents)}</Link></td>
                <td><StatusChip tone={VERDICT_TONES[r.verdict]}>{verdictWord(r)}</StatusChip></td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </TableCard>
  );
}
