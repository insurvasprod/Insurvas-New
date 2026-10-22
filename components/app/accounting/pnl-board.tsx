"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState, type ReactNode } from "react";

import { Button } from "@/components/ui/button";
import { DataToolbar, toolbarControl } from "@/components/ui/data-toolbar";
import { DetailPanel } from "@/components/ui/detail-panel";
import { SectionLoading } from "@/components/ui/page-states";
import { Pager } from "@/components/ui/pager";
import { StatStrip, StatTile } from "@/components/ui/stat";
import { TableCard } from "@/components/ui/table-card";
import { Segmented } from "@/components/ui/view-tabs";
import { COST_ENTRY_LABELS, type Basis, type CostEntryType } from "@/lib/accounting/costLedgerCore";
import { EXPENSE_CATEGORY_LABELS, ACQUISITION_CONSEQUENCE, type ExpenseCategory } from "@/lib/accounting/expensesCore";
import { BASIS_NOTE, IN_LABELS, type PerPolicy, type Persisting, type PeriodKind, type PnlLine, type Range, type Statement } from "@/lib/accounting/pnlCore";
import { formatCentsAsCurrency } from "@/lib/money";

/**
 * LA-7.7 · money in, money out, what is left — and the two cost-per-policy numbers whose gap is the
 * chargeback tax. Reported and received sit side by side and are never added together; every line
 * opens the entries behind it.
 */
type Totals = { range: Range; inCents: number; acquisitionCents: number; overheadCents: number; splitsCents: number; netProfitCents: number };
export type PnlView = {
  range: Range;
  kind: PeriodKind;
  basis: Basis;
  settings: { horizon: number; threshold: number };
  statement: Statement;
  previous: Totals;
  lastYear: Totals;
  moneyIn: { reportedCents: number; received: { imported: false } | { imported: true; cents: number } };
  issued: number;
  perIssued: PerPolicy;
  persisting: Persisting;
  chargebackTaxCents: number | null;
  trend: { month: string; inCents: number; acquisitionCents: number; overheadCents: number; splitsCents: number; netCents: number }[];
};
type Query = { kind: PeriodKind; anchor: string; from: string; to: string; basis: Basis };

const money = (c: number) => formatCentsAsCurrency(c);
const MONTH_NAMES = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const monthLabel = (ym: string) => `${MONTH_NAMES[Number(ym.slice(5, 7)) - 1]} ${ym.slice(0, 4)}`;

function lineLabel(l: PnlLine): string {
  if (l.section === "in" || l.section === "held") return IN_LABELS[l.entryType] ?? l.entryType;
  if (l.sourceType === "expense_category" && l.sourceName) return EXPENSE_CATEGORY_LABELS[l.sourceName as ExpenseCategory] ?? l.sourceName;
  const kind = l.entryType === "lead_cost" ? "Lead costs" : l.entryType === "partner_payout" ? "Partner payouts" : l.entryType === "refund" ? "Refunds" : l.entryType === "tool_subscription" || l.entryType === "platform_fee" ? "Platform & tools" : COST_ENTRY_LABELS[l.entryType as CostEntryType] ?? l.entryType;
  return l.sourceName ? `${kind} — ${l.sourceName}` : l.entryType === "lead_cost" ? "Lead costs — no source" : kind;
}

function perPolicyText(p: PerPolicy): { value: string; footnote: string } {
  if (p.kind === "none") return { value: "—", footnote: "no policies issued" };
  if (p.kind === "counts") return { value: `${money(p.spendCents)} · ${p.policies}`, footnote: `${p.policies} polic${p.policies === 1 ? "y" : "ies"}: too few to divide` };
  return { value: money(p.cents), footnote: `over ${p.policies} policies` };
}

function Drill({ line, query, onClose }: { line: PnlLine; query: Query; onClose: () => void }) {
  const [rows, setRows] = useState<{ entryId: string; incurredOn: string | null; paidOn: string | null; amountCents: number; description: string | null; policyNumber: string | null; reversesEntryId: string | null; source: { label: string; href: string } | null }[] | null>(null);
  const [page, setPage] = useState(0);
  const [more, setMore] = useState(false);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    let live = true;
    const p = new URLSearchParams({ kind: query.kind, anchor: query.anchor, from: query.from, to: query.to, basis: query.basis, section: line.section, entry_type: line.entryType, page: String(page) });
    if (line.sourceType) p.set("source_type", line.sourceType);
    if (line.sourceId) p.set("source_id", line.sourceId);
    if (line.sourceType === "expense_category" && line.sourceName) p.set("category", line.sourceName);
    fetch(`/api/app/accounting/pnl/drill?${p}`).then(async (res) => {
      const body = await res.json().catch(() => null);
      if (!live) return;
      if (!res.ok) setError(body?.error ?? "Could not load the entries");
      else { setRows(body.rows); setMore(body.more); }
    });
    return () => { live = false; };
  }, [line, query, page]);
  return (
    <DetailPanel mode="overlay" title={lineLabel(line)} subtitle={`${money(line.amountCents)} · ${line.entries} entr${line.entries === 1 ? "y" : "ies"}`} onClose={onClose}>
      {error ? <p role="alert" className="text-sm text-[var(--error-ink)]">{error}</p> : null}
      {rows === null && !error ? <SectionLoading rows={6} columns={3} /> : null}
      {rows ? (
        <table className="w-full text-left text-sm">
          <thead className="text-xs text-muted-foreground"><tr><th className="py-1">{query.basis === "cash" ? "Paid" : "For"}</th><th>Entry</th><th className="text-right">Amount</th></tr></thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.entryId} className="border-t border-border align-top">
                <td className="py-1 whitespace-nowrap">{(query.basis === "cash" ? r.paidOn : r.incurredOn) ?? "—"}</td>
                <td>{r.description ?? (r.policyNumber ? `Policy ${r.policyNumber}` : "Entry")}{r.reversesEntryId ? <span className="text-xs text-muted-foreground"> · reversal</span> : null}{r.source ? <div><a className="text-xs underline" href={r.source.href}>{r.source.label}</a></div> : null}</td>
                <td className="text-right">{money(r.amountCents)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      ) : null}
      {page > 0 || more ? <Pager page={page + 1} pageSize={200} total={line.entries} noun="entries" onPage={(p) => setPage(p - 1)} /> : null}
    </DetailPanel>
  );
}

export function PnlBoard({ data, query, taxMissing = 0 }: { data: PnlView; query: Query; taxMissing?: number }) {
  const router = useRouter();
  const [open, setOpen] = useState<PnlLine | null>(null);
  const [custom, setCustom] = useState({ from: query.from || data.range.from, to: query.to || data.range.to });
  const go = (next: Partial<Query>) => {
    const q = { ...query, ...next };
    const p = new URLSearchParams({ kind: q.kind, basis: q.basis });
    if (q.kind === "custom") { p.set("from", q.from); p.set("to", q.to); } else p.set("anchor", q.anchor);
    router.push(`/app/pnl?${p}`);
  };
  const step = (dir: -1 | 1) => {
    const months = query.kind === "month" ? 1 : query.kind === "quarter" ? 3 : 12;
    const [y, m] = data.range.from.slice(0, 7).split("-").map(Number);
    const total = y * 12 + (m - 1) + dir * months;
    go({ anchor: `${Math.floor(total / 12)}-${String((total % 12) + 1).padStart(2, "0")}` });
  };
  const s = data.statement;
  const issuedText = perPolicyText(data.perIssued);
  const lasting = data.persisting;
  const lastingText = lasting.kind === "building"
    ? { value: "Building", footnote: `${lasting.monthsElapsed} of ${lasting.horizon} months; ready ${lasting.readyOn}` }
    : perPolicyText(lasting.perPolicy);
  const received = data.moneyIn.received;

  const row = (l: PnlLine) => (
    <tr key={`${l.section}-${l.entryType}-${l.sourceId ?? l.sourceName ?? ""}`} className="cursor-pointer hover:bg-[var(--surface-alt)]" onClick={() => setOpen(l)}>
      <td className="pl-6"><button type="button" className="text-left underline-offset-2 hover:underline" onClick={(e) => { e.stopPropagation(); setOpen(l); }}>{lineLabel(l)}</button></td>
      <td className="text-right tabular-nums">{money(l.amountCents)}</td>
      <td className="text-right text-muted-foreground" colSpan={3} />
    </tr>
  );
  const subtotal = (label: string, cur: number, prev: number, ly: number, extra?: ReactNode) => (
    <tr className="font-semibold">
      <td>{label}{extra}</td>
      <td className="text-right tabular-nums">{money(cur)}</td>
      <td className="text-right tabular-nums text-muted-foreground">{money(prev)}</td>
      <td className="text-right tabular-nums text-muted-foreground">{money(ly)}</td>
      <td />
    </tr>
  );
  const heading = (label: string) => <tr><td colSpan={5} className="pt-4 text-xs font-semibold uppercase tracking-wide text-muted-foreground">{label}</td></tr>;

  return (
    <>

      {taxMissing ? <p role="alert" className="rounded-lg border border-[var(--warning)] bg-[var(--warning-surface)] px-3 py-2 text-sm text-[var(--warning-ink)]">{taxMissing} contractor{taxMissing === 1 ? " needs" : "s need"} a 1099 this year and {taxMissing === 1 ? "is" : "are"} missing a W-9, tax ID or legal name. <Link className="underline" href="/app/tax">Chase it now</Link>, while it is easy.</p> : null}
      <StatStrip label="Profit and loss">
        <StatTile label="Net profit" value={money(s.netProfitCents)} valueTone={s.netProfitCents < 0 ? "danger" : undefined} footnote={`${money(data.previous.netProfitCents)} the period before`} />
        <StatTile label="Commission reported" value={money(data.moneyIn.reportedCents)} footnote={received.imported ? `${money(received.cents)} received in the bank` : "received: not imported"} />
        <StatTile label="Acquisition cost" value={money(-s.acquisitionCents)} footnote={`${data.issued} polic${data.issued === 1 ? "y" : "ies"} issued`} />
        <StatTile label="Cost per issued policy" value={issuedText.value} footnote={issuedText.footnote} />
        <StatTile label={`Cost per persisting policy (${data.settings.horizon} mo)`} value={lastingText.value} footnote={data.chargebackTaxCents !== null ? `chargeback tax ${money(data.chargebackTaxCents)}` : lastingText.footnote} />
      </StatStrip>

      <TableCard
        toolbar={
          <DataToolbar actions={<Segmented label="Basis" value={query.basis} onChange={(b) => go({ basis: b })} options={[{ key: "accrual", label: "Accrual" }, { key: "cash", label: "Cash" }]} />}>
            <Segmented label="Period" value={query.kind} onChange={(k) => go({ kind: k })} options={[{ key: "month", label: "Month" }, { key: "quarter", label: "Quarter" }, { key: "year", label: "Year" }, { key: "custom", label: "Custom" }]} />
            {query.kind === "custom" ? (
              <span className="inline-flex items-center gap-2">
                <input aria-label="From" type="date" className={toolbarControl} value={custom.from} onChange={(e) => setCustom((c) => ({ ...c, from: e.target.value }))} />
                <input aria-label="To" type="date" className={toolbarControl} value={custom.to} onChange={(e) => setCustom((c) => ({ ...c, to: e.target.value }))} />
                <Button variant="outline" onClick={() => go({ from: custom.from, to: custom.to })}>Show</Button>
              </span>
            ) : (
              <span className="inline-flex items-center gap-1">
                <Button variant="outline" aria-label="Previous period" onClick={() => step(-1)}>‹</Button>
                <span className="min-w-[150px] text-center text-sm font-semibold">{data.range.label}</span>
                <Button variant="outline" aria-label="Next period" onClick={() => step(1)}>›</Button>
              </span>
            )}
              </DataToolbar>
        }
        footer={<p className="text-xs text-muted-foreground">{BASIS_NOTE[data.basis]}</p>}
      >
        <table className="portal-lead-table w-full min-w-[760px] text-left text-sm">
          <thead><tr><th>{data.range.label}</th><th className="w-[150px] text-right">This period</th><th className="w-[150px] text-right">Period before</th><th className="w-[150px] text-right">Last year</th><th className="w-[150px] text-right">Received</th></tr></thead>
          <tbody>
            {heading("Money in — as the carriers reported it")}
            {s.in.length ? s.in.map(row) : <tr><td className="pl-6 text-muted-foreground" colSpan={5}>No commission recorded in this period.</td></tr>}
            <tr className="font-semibold">
              <td>Net commission</td>
              <td className="text-right tabular-nums">{money(s.inCents)}</td>
              <td className="text-right tabular-nums text-muted-foreground">{money(data.previous.inCents)}</td>
              <td className="text-right tabular-nums text-muted-foreground">{money(data.lastYear.inCents)}</td>
              <td className="text-right tabular-nums">{received.imported ? money(received.cents) : <span className="text-muted-foreground">Not imported</span>}</td>
            </tr>
            {s.held.length ? (
              <>
                {heading("Held by the carriers — not in net commission or net profit")}
                {s.held.map(row)}
                <tr className="font-semibold">
                  <td>Total held</td>
                  <td className="text-right tabular-nums">{money(s.heldCents)}</td>
                  <td colSpan={3} />
                </tr>
              </>
            ) : null}
            {heading("Acquisition cost")}
            {s.acquisition.length ? s.acquisition.map(row) : <tr><td className="pl-6 text-muted-foreground" colSpan={5}>No acquisition cost recorded.</td></tr>}
            {subtotal("Total acquisition cost", s.acquisitionCents, data.previous.acquisitionCents, data.lastYear.acquisitionCents)}
            {heading("Overhead")}
            {s.overhead.length ? s.overhead.map(row) : <tr><td className="pl-6 text-muted-foreground" colSpan={5}>No overhead recorded.</td></tr>}
            {subtotal("Total overhead", s.overheadCents, data.previous.overheadCents, data.lastYear.overheadCents)}
            {s.splits.length || data.previous.splitsCents || data.lastYear.splitsCents ? (
              <>
                {heading("Producer splits")}
                {s.splits.map(row)}
                {subtotal("Total splits", s.splitsCents, data.previous.splitsCents, data.lastYear.splitsCents)}
              </>
            ) : null}
            <tr className="border-t-2 border-border text-base font-semibold">
              <td className="pt-3">Net profit</td>
              <td className="pt-3 text-right tabular-nums">{money(s.netProfitCents)}</td>
              <td className="pt-3 text-right tabular-nums text-muted-foreground">{money(data.previous.netProfitCents)}</td>
              <td className="pt-3 text-right tabular-nums text-muted-foreground">{money(data.lastYear.netProfitCents)}</td>
              <td />
            </tr>
            <tr>
              <td className="pt-3">Cost per issued policy</td>
              <td className="pt-3 text-right tabular-nums">{issuedText.value}</td>
              <td colSpan={3} className="pt-3 text-xs text-muted-foreground">{issuedText.footnote}</td>
            </tr>
            <tr>
              <td>Cost per persisting policy ({data.settings.horizon} months)</td>
              <td className="text-right tabular-nums">{lastingText.value}</td>
              <td colSpan={3} className="text-xs text-muted-foreground">{lastingText.footnote}{data.chargebackTaxCents !== null ? ` · ↳ chargeback tax ${money(data.chargebackTaxCents)} a policy` : ""}</td>
            </tr>
            <tr><td colSpan={5} className="pt-2 text-xs text-muted-foreground">{ACQUISITION_CONSEQUENCE} Under {data.settings.threshold} policies the figures show counts, not a rate.</td></tr>
          </tbody>
        </table>
      </TableCard>

      <TableCard>
        <table className="portal-lead-table w-full min-w-[760px] text-left text-sm">
          <thead><tr><th>Last six months</th><th className="text-right">Money in</th><th className="text-right">Acquisition</th><th className="text-right">Overhead</th><th className="text-right">Net profit</th></tr></thead>
          <tbody>
            {data.trend.length === 0 ? <tr><td colSpan={5} className="text-muted-foreground">Nothing recorded in the last six months.</td></tr> : data.trend.map((m) => (
              <tr key={m.month}>
                <td>{monthLabel(m.month)}</td>
                <td className="text-right tabular-nums">{money(m.inCents)}</td>
                <td className="text-right tabular-nums">{money(m.acquisitionCents)}</td>
                <td className="text-right tabular-nums">{money(m.overheadCents + m.splitsCents)}</td>
                <td className={`text-right tabular-nums font-medium ${m.netCents < 0 ? "text-[var(--error-ink)]" : ""}`}>{money(m.netCents)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </TableCard>
      {open ? <Drill line={open} query={query} onClose={() => setOpen(null)} /> : null}
    </>
  );
}
