"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { ChevronLeft, ChevronRight, Download } from "lucide-react";

import { Button } from "@/components/ui/button";
import { DataToolbar, toolbarControl } from "@/components/ui/data-toolbar";
import { EmptyState } from "@/components/ui/page-states";
import { StatStrip, StatTile } from "@/components/ui/stat";
import { StatusChip } from "@/components/ui/status-chip";
import { TableCard } from "@/components/ui/table-card";
import { fillLine } from "@/components/ui/table-card-layout";
import { Segmented } from "@/components/ui/view-tabs";
import { csvCellMinimal } from "@/lib/csv/cell";
import type { Basis } from "@/lib/accounting/costLedgerCore";
import {
  changeOf, inBankTotal, lastYearLabel, periodWords, readableDate, shortMonth,
  type InBank, type PerPolicy, type Persisting, type PeriodKind, type PnlLine, type Range, type Statement, type StatementRow, type StatementRows,
} from "@/lib/accounting/pnlCore";
import { BANK_ACCOUNTS_HREF, entriesHref, lineLabel, monthHref, pnlHref, queryFor, type PnlQuery, type PnlTab } from "@/lib/accounting/pnlLinks";
import { formatCentsAsCurrency } from "@/lib/money";

/**
 * LA-7.7 · money in, money out, what is left — and the two cost-per-policy numbers whose gap is the
 * chargeback tax. Reported and received sit side by side and are never added together; every amount
 * opens the entries behind it.
 *
 * Round 7 (owner 2026-11-10, docs/la4/mockups-r7/accounting.html 5·A, 5·1, 5·3): a full statement. Every line is
 * filled across This period · Period before · Change · Last year · In the bank, and each amount opens that line's
 * entries for its column's period. Four tiles. The period controls show only where they apply: Period on the
 * Statement, Basis on the Statement and Last six months, none on Persisting cost. The table fills the window;
 * its toolbar and headers stay put while the rows scroll inside.
 */
type Totals = { range: Range; inCents: number; acquisitionCents: number; overheadCents: number; splitsCents: number; netProfitCents: number; perIssued: PerPolicy };
export type PnlView = {
  range: Range;
  kind: PeriodKind;
  basis: Basis;
  settings: { horizon: number; threshold: number; fyStartMonth: number };
  statement: Statement;
  rows: StatementRows;
  previous: Totals;
  lastYear: Totals;
  moneyIn: { reportedCents: number; received: { imported: false } | { imported: true; cents: number } };
  issued: number;
  perIssued: PerPolicy;
  persisting: Persisting;
  chargebackTaxCents: number | null;
  trend: { month: string; inCents: number; acquisitionCents: number; overheadCents: number; splitsCents: number; netCents: number }[];
};
type Query = PnlQuery;

const money = (c: number) => formatCentsAsCurrency(c);
const signed = (c: number) => (c > 0 ? `+${money(c)}` : money(c));
// One line per row, one text colour (owner 2026-11-11): amounts and changes in the normal colour, links plain until
// hovered; only net profit may say "Loss", in a chip.
const AMOUNT = "text-foreground underline-offset-2 hover:underline";
const LABEL = "font-medium text-foreground underline-offset-2 hover:underline";
const num = "whitespace-nowrap text-right tabular-nums";

function perPolicyText(p: PerPolicy): { value: string; footnote: string } {
  if (p.kind === "none") return { value: "—", footnote: "no policies issued" };
  if (p.kind === "counts") return { value: `${money(p.spendCents)} · ${p.policies}`, footnote: `${p.policies} polic${p.policies === 1 ? "y" : "ies"}: too few to divide` };
  return { value: money(p.cents), footnote: `over ${p.policies} policies` };
}

export type PnlCohort = { month: string; label: string; acquisitionCents: number; issued: number; alive: number; perIssued: PerPolicy; persisting: Persisting; chargebackTaxCents: number | null };

/** The card ends at the window's foot (the rail's foot on this merged page); its rows scroll inside, as Book setup's rules list. */
function useFillBox() {
  const box = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = box.current;
    if (!el) return;
    const fit = () => {
      el.style.height = "";
      if (window.innerWidth < 1024) return;
      const bottom = fillLine(el) ?? window.innerHeight - 32;
      el.style.height = `${Math.max(360, Math.floor(bottom - el.getBoundingClientRect().top - 2))}px`;
    };
    fit();
    window.addEventListener("resize", fit);
    return () => window.removeEventListener("resize", fit);
  }, []);
  return box;
}
const STICKY_HEAD = "[&_th]:sticky [&_th]:top-0 [&_th]:z-10 [&_th]:!bg-[var(--surface-alt)]";

/** The columns' periods: this one, the one before and last year, each as the address its links open. */
function columns(data: PnlView, query: Query) {
  return {
    current: query,
    previous: queryFor(data.kind, query.basis, data.previous.range),
    lastYear: queryFor(data.kind, query.basis, data.lastYear.range),
    words: periodWords(data.kind),
    lastYearLabel: lastYearLabel(data.kind, data.lastYear.range, data.settings.fyStartMonth),
  };
}

/** Net profit in the bank: received less what was paid, only when every part of it is known. */
function bankNet(data: PnlView): number | null {
  const received = data.moneyIn.received;
  if (!received.imported) return null;
  const parts = [data.rows.acquisition, data.rows.overhead, data.rows.splits].map(inBankTotal);
  if (parts.some((p) => p === null)) return null;
  return parts.reduce<number>((total, p) => total + (p ?? 0), received.cents);
}

export function PnlBoard({ data, query, view = "statement", cohorts = null }: { data: PnlView; query: Query; view?: PnlTab; cohorts?: PnlCohort[] | null }) {
  const router = useRouter();
  const box = useFillBox();
  const [custom, setCustom] = useState({ from: query.from || data.range.from, to: query.to || data.range.to });
  const go = (next: Partial<Query>) => {
    const q = { ...query, ...next };
    const p = new URLSearchParams({ kind: q.kind, basis: q.basis });
    if (q.kind === "custom") { p.set("from", q.from); p.set("to", q.to); } else p.set("anchor", q.anchor);
    if (view !== "statement") p.set("view", view);
    router.push(`/app/pnl?${p}`);
  };
  const step = (dir: -1 | 1) => {
    const months = query.kind === "month" ? 1 : query.kind === "quarter" ? 3 : 12;
    const [y, m] = data.range.from.slice(0, 7).split("-").map(Number);
    const total = y * 12 + (m - 1) + dir * months;
    go({ anchor: `${Math.floor(total / 12)}-${String((total % 12) + 1).padStart(2, "0")}` });
  };
  const basis = <Segmented label="Basis" value={query.basis} onChange={(b) => go({ basis: b })} options={[{ key: "accrual", label: "Accrual" }, { key: "cash", label: "Cash" }]} />;

  if (view === "cohorts") {
    return (
      <div ref={box} className="flex min-h-0 flex-col">
        <CohortCard cohorts={cohorts ?? []} data={data} />
      </div>
    );
  }
  if (view === "trend") {
    return (
      <div ref={box} className="flex min-h-0 flex-col">
        <TableCard className="min-h-0 flex-1" bodyClassName="min-h-0 overflow-y-auto" toolbar={<DataToolbar actions={basis} />} footer={<span>A month opens the Statement on that month.</span>}>
          <TrendTable trend={data.trend} basis={query.basis} />
        </TableCard>
      </div>
    );
  }

  const s = data.statement;
  const cols = columns(data, query);
  const issuedText = perPolicyText(data.perIssued);
  const received = data.moneyIn.received;
  const empty = (["in", "held", "acquisition", "overhead", "splits"] as const).every((k) => data.rows[k].length === 0);

  return (
    <>
      <StatStrip label="Profit and loss">
        <StatTile label="Net profit" value={money(s.netProfitCents)} footnote={s.netProfitCents < 0 ? <><StatusChip tone="danger">Loss</StatusChip> {money(data.previous.netProfitCents)} {cols.words.before}</> : `${money(data.previous.netProfitCents)} ${cols.words.before}`} />
        <StatTile label="Commission reported" value={money(data.moneyIn.reportedCents)} footnote={received.imported ? `${money(received.cents)} in the bank` : "in the bank: not imported"} href="/app/bank" />
        <StatTile label="Acquisition cost" value={money(-s.acquisitionCents)} footnote={`${data.issued} polic${data.issued === 1 ? "y" : "ies"} issued`} href="/app/vendor-bills" />
        <StatTile label="Cost per issued policy" value={issuedText.value} footnote={issuedText.footnote} />
      </StatStrip>

      <div ref={box} className="flex min-h-0 flex-col">
        <TableCard
          className="min-h-0 flex-1"
          bodyClassName="min-h-0 overflow-y-auto"
          toolbar={
            <DataToolbar actions={basis}>
              <Segmented label="Period" value={query.kind} onChange={(k) => go({ kind: k })} options={[{ key: "month", label: "Month" }, { key: "quarter", label: "Quarter" }, { key: "year", label: "Year" }, { key: "custom", label: "Custom" }]} />
              {query.kind === "custom" ? (
                <span className="inline-flex items-center gap-2">
                  <input aria-label="From" type="date" className={toolbarControl} value={custom.from} onChange={(e) => setCustom((c) => ({ ...c, from: e.target.value }))} />
                  <input aria-label="To" type="date" className={toolbarControl} value={custom.to} onChange={(e) => setCustom((c) => ({ ...c, to: e.target.value }))} />
                  <Button variant="outline" onClick={() => go({ from: custom.from, to: custom.to })}>Show</Button>
                </span>
              ) : (
                <span className="inline-flex items-center gap-1">
                  <Button variant="outline" size="icon" aria-label="Previous period" onClick={() => step(-1)}><ChevronLeft aria-hidden="true" /></Button>
                  <span className="min-w-[150px] text-center text-sm font-semibold">{data.range.label}</span>
                  <Button variant="outline" size="icon" aria-label="Next period" onClick={() => step(1)}><ChevronRight aria-hidden="true" /></Button>
                </span>
              )}
            </DataToolbar>
          }
          footer={!empty ? <><span>Reported and in the bank are never added together. Every amount opens its entries.</span><span>{query.basis === "cash" ? "Cash basis" : "Accrual basis"}</span></> : undefined}
        >
          {empty ? (
            <EmptyState title={`Nothing recorded in ${data.range.label}`} hint="Commission arrives with the carriers' files; costs with Vendor bills and Expenses." action={<Button asChild variant="outline"><Link href="/app/vendor-bills">Open Vendor bills</Link></Button>} />
          ) : (
            <>
              <StatementTable data={data} query={query} />
              <PhoneStatement data={data} query={query} />
            </>
          )}
        </TableCard>
      </div>
    </>
  );
}

function Amount({ cents, href }: { cents: number | null; href: string }) {
  if (cents === null) return <span className="text-muted-foreground">—</span>;
  return <Link className={AMOUNT} href={href}>{money(cents)}</Link>;
}

function Change({ cur, prev }: { cur: number | null; prev: number | null }) {
  const delta = changeOf(cur, prev);
  if (delta === null) return <span className="text-muted-foreground">—</span>;
  return <>{signed(delta)}</>;
}

function Bank({ bank, href }: { bank: InBank; href: string }) {
  if (bank.kind === "not_imported") return <Link className={AMOUNT} href={BANK_ACCOUNTS_HREF} title="No bank file for this period: add one in Bank deposits › Accounts">Not imported</Link>;
  if (bank.kind === "gap") return <span className="text-muted-foreground">—</span>;
  return <Link className={AMOUNT} href={href} title={`${bank.paid} of ${bank.of} paid`}>{money(bank.cents)}</Link>;
}

/** The statement: every line across the columns, the section bands, the totals and net profit, then cost per issued policy. */
function StatementTable({ data, query }: { data: PnlView; query: Query }) {
  const cols = columns(data, query);
  const s = data.statement;
  const received = data.moneyIn.received;

  // Readability pass (owner 2026-11-03): each section opens on a tinted band with its name, its lines are
  // indented under it, every total sits on a hairline with its comparisons in full ink, and net profit is
  // the last band, coloured by its sign. Amounts read in one right-aligned column per period.
  const row = (r: StatementRow) => {
    const l: PnlLine = r.line;
    return (
      <tr key={r.key} className="hover:bg-[var(--surface-alt)]">
        <td className="whitespace-nowrap pl-8"><Link className="font-medium text-foreground underline-offset-2 hover:underline" href={entriesHref(l, query)}>{lineLabel(l)}</Link></td>
        <td className={num}><Amount cents={r.cur} href={entriesHref(l, cols.current)} /></td>
        <td className={num}><Amount cents={r.prev} href={entriesHref(l, cols.previous)} /></td>
        <td className={num}><Change cur={r.cur} prev={r.prev} /></td>
        <td className={num}><Amount cents={r.lastYear} href={entriesHref(l, cols.lastYear)} /></td>
        <td className={num}><Bank bank={r.bank} href={entriesHref(l, cols.current)} /></td>
      </tr>
    );
  };
  const none = (text: string) => <tr><td className="pl-8 text-muted-foreground" colSpan={6}>{text}</td></tr>;
  // A total's comparisons open the Statement on that period: there is no one line's entries behind a total.
  const subtotal = (label: string, cur: number, prev: number, ly: number, bank: ReactNode) => (
    <tr className="border-t border-border">
      <td className="whitespace-nowrap font-medium">{label}</td>
      <td className={num}>{money(cur)}</td>
      <td className={num}><Link className={AMOUNT} href={pnlHref(cols.previous)}>{money(prev)}</Link></td>
      <td className={num}><Change cur={cur} prev={prev} /></td>
      <td className={num}><Link className={AMOUNT} href={pnlHref(cols.lastYear)}>{money(ly)}</Link></td>
      <td className={num}>{bank}</td>
    </tr>
  );
  const bankTotal = (rows: StatementRow[]) => {
    const t = inBankTotal(rows);
    return t === null ? <span className="text-muted-foreground">—</span> : money(t);
  };
  // A section's band: its name alone on the line; what the section means is its tooltip.
  const heading = (label: string, note?: string) => (
    <tr className="bg-[var(--surface-alt)]">
      <td colSpan={6} className="whitespace-nowrap font-medium text-foreground" title={note}>{label}</td>
    </tr>
  );
  const net = bankNet(data);
  // The policy count is the tooltip, not a second grey figure in the cell.
  const perPolicyCell = (p: PerPolicy) => (
    <span className={p.kind === "none" ? "text-muted-foreground" : undefined} title={perPolicyText(p).footnote}>{p.kind === "rate" ? money(p.cents) : perPolicyText(p).value}</span>
  );
  const rate = (p: PerPolicy) => (p.kind === "rate" ? p.cents : null);
  const r = data.rows;

  return (
    <table className="portal-lead-table hidden w-full min-w-[960px] text-left text-sm sm:table">
      <thead className={STICKY_HEAD}>
        <tr>
          <th>{data.range.label}</th>
          <th className="w-[140px] text-right">{cols.words.current}</th>
          <th className="w-[140px] text-right">{cols.words.previous}</th>
          <th className="w-[140px] text-right">Change</th>
          <th className="w-[140px] text-right">{cols.lastYearLabel}</th>
          <th className="w-[140px] text-right">{received.imported ? "In the bank" : <Link className="underline-offset-2 hover:underline" href={BANK_ACCOUNTS_HREF} title="No bank file for this period: add one in Bank deposits › Accounts">In the bank</Link>}</th>
        </tr>
      </thead>
      <tbody>
        {heading("Money in", "as the carriers reported it")}
        {r.in.length ? r.in.map(row) : none("No commission recorded in this period.")}
        {subtotal("Net commission", s.inCents, data.previous.inCents, data.lastYear.inCents, received.imported ? money(received.cents) : <Link className={AMOUNT} href={BANK_ACCOUNTS_HREF}>Not imported</Link>)}
        {r.held.length ? (
          <>
            {heading("Held by the carriers", "not in net commission or net profit")}
            {r.held.map(row)}
            <tr className="border-t border-border"><td className="whitespace-nowrap font-medium">Total held</td><td className={num}>{money(s.heldCents)}</td><td colSpan={4} /></tr>
          </>
        ) : null}
        {heading("Acquisition cost", "divides into cost per policy")}
        {r.acquisition.length ? r.acquisition.map(row) : none("No acquisition cost recorded.")}
        {subtotal("Total acquisition cost", s.acquisitionCents, data.previous.acquisitionCents, data.lastYear.acquisitionCents, bankTotal(r.acquisition))}
        {heading("Overhead", "net profit only")}
        {r.overhead.length ? r.overhead.map(row) : none("No overhead recorded.")}
        {subtotal("Total overhead", s.overheadCents, data.previous.overheadCents, data.lastYear.overheadCents, bankTotal(r.overhead))}
        {r.splits.length || data.previous.splitsCents || data.lastYear.splitsCents ? (
          <>
            {heading("Producer splits")}
            {r.splits.length ? r.splits.map(row) : none("No splits in this period.")}
            {subtotal("Total splits", s.splitsCents, data.previous.splitsCents, data.lastYear.splitsCents, bankTotal(r.splits))}
          </>
        ) : null}
        <tr className="border-t-2 border-border bg-[var(--surface-alt)]">
          <td className="whitespace-nowrap font-medium"><span className="inline-flex items-center gap-2">Net profit{data.statement.netProfitCents < 0 ? <StatusChip tone="danger">Loss</StatusChip> : null}</span></td>
          <td className={num}>{money(data.statement.netProfitCents)}</td>
          <td className={num}><Link className={AMOUNT} href={pnlHref(cols.previous)}>{money(data.previous.netProfitCents)}</Link></td>
          <td className={num}><Change cur={data.statement.netProfitCents} prev={data.previous.netProfitCents} /></td>
          <td className={num}><Link className={AMOUNT} href={pnlHref(cols.lastYear)}>{money(data.lastYear.netProfitCents)}</Link></td>
          <td className={num}>{net === null ? <span className="text-muted-foreground">—</span> : money(net)}</td>
        </tr>
        <tr>
          <td className="whitespace-nowrap font-medium">Cost per issued policy</td>
          <td className={num}>{perPolicyCell(data.perIssued)}</td>
          <td className={num}>{perPolicyCell(data.previous.perIssued)}</td>
          <td className={num}><Change cur={rate(data.perIssued)} prev={rate(data.previous.perIssued)} /></td>
          <td className={num}>{perPolicyCell(data.lastYear.perIssued)}</td>
          <td className={num}><span className="text-muted-foreground">—</span></td>
        </tr>
      </tbody>
    </table>
  );
}

/** 5·3 phone: the net, then each section's total over its lines, every amount still a link. */
function PhoneStatement({ data, query }: { data: PnlView; query: Query }) {
  const cols = columns(data, query);
  const s = data.statement;
  const block = (title: string, total: number, rows: StatementRow[]) => rows.length ? (
    <div className="space-y-2 border-b border-border px-4 py-3">
      <div className="flex justify-between text-sm"><span className="font-medium">{title}</span><span className="tabular-nums">{money(total)}</span></div>
      {rows.filter((r) => r.cur !== null).map((r) => (
        <div key={r.key} className="flex justify-between gap-3 text-sm">
          <span className="min-w-0">{lineLabel(r.line)}</span>
          <Amount cents={r.cur} href={entriesHref(r.line, cols.current)} />
        </div>
      ))}
    </div>
  ) : null;
  return (
    <div className="sm:hidden">
      <div className="space-y-2 border-b border-border px-4 py-3">
        <div className="flex items-center justify-between gap-3 text-sm"><span className="inline-flex items-center gap-2 font-medium">Net profit{s.netProfitCents < 0 ? <StatusChip tone="danger">Loss</StatusChip> : null}</span><span className="tabular-nums">{money(s.netProfitCents)}</span></div>
        <div className="flex justify-between text-sm"><span>{cols.words.previous}</span><Link className={AMOUNT} href={pnlHref(cols.previous)}>{money(data.previous.netProfitCents)}</Link></div>
      </div>
      {block("Net commission", s.inCents, data.rows.in)}
      {block("Acquisition cost", s.acquisitionCents, data.rows.acquisition)}
      {block("Overhead", s.overheadCents, data.rows.overhead)}
      {block("Producer splits", s.splitsCents, data.rows.splits)}
    </div>
  );
}

/** Last six months, the direction the spec cares about more than any one month (LA-7.7). Splits have their own column. */
function TrendTable({ trend, basis }: { trend: PnlView["trend"]; basis: Basis }) {
  return (
    <table className="portal-lead-table w-full min-w-[760px] text-left text-sm">
      <thead className={STICKY_HEAD}><tr><th>Month</th><th className="text-right">Money in</th><th className="text-right">Acquisition</th><th className="text-right">Overhead</th><th className="text-right">Splits</th><th className="text-right">Net profit</th></tr></thead>
      <tbody>
        {trend.length === 0 ? <tr><td colSpan={6} className="text-muted-foreground">Nothing recorded in the last six months.</td></tr> : [...trend].reverse().map((m) => (
          <tr key={m.month} className="hover:bg-[var(--surface-alt)]">
            <td className="whitespace-nowrap"><Link className={LABEL} href={monthHref(m.month, basis)}>{shortMonth(m.month)}</Link></td>
            <td className={num}>{money(m.inCents)}</td>
            <td className={num}>{money(m.acquisitionCents)}</td>
            <td className={num}>{money(m.overheadCents)}</td>
            <td className={num}>{money(m.splitsCents)}</td>
            <td className={num}>{m.netCents < 0 ? <StatusChip tone="danger" className="ml-auto">{money(-m.netCents)} loss</StatusChip> : money(m.netCents)}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

/**
 * LA-7.7 · the trailing view: the six months old enough to have a cost per persisting policy, newest first.
 * The gap between the two per-policy figures is the chargeback tax. Acquisition cost only; under the sample
 * threshold a cell shows counts, not a rate. Round 7 (5·1): while no month is old enough the tab is its empty
 * state ("Building · m of h months"), and the footnotes that were hover titles sit in the table's foot.
 */
function CohortCard({ cohorts, data }: { cohorts: PnlCohort[]; data: PnlView }) {
  const horizon = data.settings.horizon;
  const ready = cohorts.some((c) => c.persisting.kind === "figure");
  if (!ready) {
    const b = data.persisting;
    return (
      <TableCard className="min-h-0 flex-1">
        {b.kind === "building" ? (
          <EmptyState
            title={`Building · ${b.monthsElapsed} of ${b.horizon} months`}
            hint={`Cost per persisting policy needs policies ${b.horizon} months old. The first month is ready ${readableDate(b.readyOn)}. Change the month in Accounting settings.`}
            action={<Button asChild variant="outline"><Link href="/app/accounting-settings">Open Accounting settings</Link></Button>}
          />
        ) : (
          <EmptyState title="No month is old enough yet" hint={`Cost per persisting policy needs policies ${horizon} months old.`} />
        )}
      </TableCard>
    );
  }
  return (
    <TableCard
      className="min-h-0 flex-1"
      bodyClassName="min-h-0 overflow-y-auto"
      footer={<span>Acquisition cost only. Lasting {horizon} mo: policies still paying at month {horizon}. Under {data.settings.threshold} policies a cell shows the spend and the count, not a rate. Chargeback tax: cost per persisting less cost per issued. Building: the month&apos;s policies are not yet {horizon} months old.</span>}
    >
      <table className="portal-lead-table w-full min-w-[760px] text-left text-sm">
        <thead className={STICKY_HEAD}><tr><th>Issued in</th><th className="text-right">Acquisition cost</th><th className="text-right">Issued</th><th className="text-right">Cost per issued</th><th className="text-right">Lasting {horizon} mo</th><th className="text-right">Cost per persisting</th><th className="text-right">Chargeback tax</th></tr></thead>
        <tbody>
          {cohorts.map((c) => {
            const issued = perPolicyText(c.perIssued);
            const lasting = c.persisting.kind === "building" ? { value: "Building" } : perPolicyText(c.persisting.perPolicy);
            return (
              <tr key={c.month} className="hover:bg-[var(--surface-alt)]">
                <td className="whitespace-nowrap"><Link className={LABEL} href={monthHref(c.month, data.basis)}>{c.label}</Link></td>
                <td className={num}>{money(-c.acquisitionCents)}</td>
                <td className={num}>{c.issued}</td>
                <td className={num} title={issued.footnote}>{issued.value}</td>
                <td className={num}>{c.persisting.kind === "figure" ? c.alive : <span className="text-muted-foreground">—</span>}</td>
                <td className={num} title={"footnote" in lasting ? lasting.footnote : undefined}>{lasting.value}</td>
                <td className={num}>{c.chargebackTaxCents !== null ? money(c.chargebackTaxCents) : <span className="text-muted-foreground">—</span>}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </TableCard>
  );
}

// ─── Download (CSV): what is on screen, built in the browser from the data already here ───────────────────────

const dollars = (c: number | null) => (c === null ? "" : (c / 100).toFixed(2));
const bankCell = (b: InBank) => (b.kind === "cents" ? dollars(b.cents) : b.kind === "not_imported" ? "Not imported" : "");
const policyCell = (p: PerPolicy) => (p.kind === "rate" ? dollars(p.cents) : p.kind === "counts" ? `${dollars(p.spendCents)} over ${p.policies}` : "");

/** The rows of the tab on screen, as the CSV writes them (exported for its test). */
export function pnlCsv(view: PnlTab, data: PnlView, query: Query, cohorts: PnlCohort[] | null): string[][] {
  if (view === "trend") {
    return [["Month", "Money in", "Acquisition", "Overhead", "Splits", "Net profit"], ...[...data.trend].reverse().map((m) => [shortMonth(m.month), dollars(m.inCents), dollars(m.acquisitionCents), dollars(m.overheadCents), dollars(m.splitsCents), dollars(m.netCents)])];
  }
  if (view === "cohorts") {
    return [["Issued in", "Acquisition cost", "Issued", "Cost per issued", `Lasting ${data.settings.horizon} mo`, "Cost per persisting", "Chargeback tax"], ...(cohorts ?? []).map((c) => [
      c.label, dollars(-c.acquisitionCents), String(c.issued), policyCell(c.perIssued), c.persisting.kind === "figure" ? String(c.alive) : "", c.persisting.kind === "figure" ? policyCell(c.persisting.perPolicy) : "Building", dollars(c.chargebackTaxCents),
    ])];
  }
  const cols = columns(data, query);
  const s = data.statement;
  const out: string[][] = [[data.range.label, cols.words.current, cols.words.previous, "Change", cols.lastYearLabel, "In the bank"]];
  const lines = (rows: StatementRow[]) => rows.forEach((r) => out.push([lineLabel(r.line), dollars(r.cur), dollars(r.prev), dollars(changeOf(r.cur, r.prev)), dollars(r.lastYear), bankCell(r.bank)]));
  const total = (label: string, cur: number, prev: number, ly: number, bank: string) => out.push([label, dollars(cur), dollars(prev), dollars(changeOf(cur, prev)), dollars(ly), bank]);
  const received = data.moneyIn.received;
  out.push(["Money in"]); lines(data.rows.in);
  total("Net commission", s.inCents, data.previous.inCents, data.lastYear.inCents, received.imported ? dollars(received.cents) : "Not imported");
  if (data.rows.held.length) { out.push(["Held by the carriers"]); lines(data.rows.held); out.push(["Total held", dollars(s.heldCents)]); }
  out.push(["Acquisition cost"]); lines(data.rows.acquisition);
  total("Total acquisition cost", s.acquisitionCents, data.previous.acquisitionCents, data.lastYear.acquisitionCents, dollars(inBankTotal(data.rows.acquisition)));
  out.push(["Overhead"]); lines(data.rows.overhead);
  total("Total overhead", s.overheadCents, data.previous.overheadCents, data.lastYear.overheadCents, dollars(inBankTotal(data.rows.overhead)));
  if (data.rows.splits.length) { out.push(["Producer splits"]); lines(data.rows.splits); total("Total splits", s.splitsCents, data.previous.splitsCents, data.lastYear.splitsCents, dollars(inBankTotal(data.rows.splits))); }
  total("Net profit", s.netProfitCents, data.previous.netProfitCents, data.lastYear.netProfitCents, dollars(bankNet(data)));
  out.push(["Cost per issued policy", policyCell(data.perIssued), policyCell(data.previous.perIssued), "", policyCell(data.lastYear.perIssued), ""]);
  out.push([], [query.basis === "cash" ? "Cash basis" : "Accrual basis"]);
  return out;
}

/** The title line's Download (CSV): the tab on screen, as a file. Nothing is fetched. */
export function PnlDownload({ data, query, view, cohorts }: { data: PnlView; query: Query; view: PnlTab; cohorts: PnlCohort[] | null }) {
  const save = () => {
    const text = pnlCsv(view, data, query, cohorts).map((line) => line.map(csvCellMinimal).join(",")).join("\r\n") + "\r\n";
    const url = URL.createObjectURL(new Blob([text], { type: "text/csv;charset=utf-8" }));
    const a = document.createElement("a");
    a.href = url;
    a.download = `profit-and-loss-${view === "statement" ? `${data.range.from}-${data.basis}` : view === "trend" ? `six-months-${data.range.from.slice(0, 7)}-${data.basis}` : "persisting-cost"}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };
  return <Button variant="outline" onClick={save}><Download aria-hidden="true" />Download (CSV)</Button>;
}

/** The basis on a line's entries page (5·2): a view switch, as on the statement. */
export function PnlBasisChips({ value, hrefs }: { value: Basis; hrefs: Record<Basis, string> }) {
  const router = useRouter();
  return <Segmented label="Basis" value={value} onChange={(b) => router.push(hrefs[b])} options={[{ key: "accrual", label: "Accrual" }, { key: "cash", label: "Cash" }]} />;
}
