"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, type ReactNode } from "react";
import { ChevronLeft, ChevronRight } from "lucide-react";

import { Callout } from "@/components/app/settings/primitives";
import { Button } from "@/components/ui/button";
import { DataToolbar, toolbarControl } from "@/components/ui/data-toolbar";
import { StatStrip, StatTile } from "@/components/ui/stat";
import { TableCard } from "@/components/ui/table-card";
import { Segmented } from "@/components/ui/view-tabs";
import type { Basis } from "@/lib/accounting/costLedgerCore";
import { type PerPolicy, type Persisting, type PeriodKind, type PnlLine, type Range, type Statement } from "@/lib/accounting/pnlCore";
import { entriesHref, lineLabel, pnlHref, type PnlQuery, type PnlTab } from "@/lib/accounting/pnlLinks";
import { formatCentsAsCurrency } from "@/lib/money";

/**
 * LA-7.7 · money in, money out, what is left — and the two cost-per-policy numbers whose gap is the
 * chargeback tax. Reported and received sit side by side and are never added together; every line
 * opens the entries behind it.
 *
 * Foundation pass (2026-11-03): the statement and the six-month trend are the step's two tabs on the title
 * line (`view`); a line opens its entries as a page (/app/pnl/entries), never a side sheet; the sentences
 * that sat in the table (basis, acquisition only, the threshold) are the title's (i), on the page.
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
type Query = PnlQuery;

const money = (c: number) => formatCentsAsCurrency(c);
const MONTH_NAMES = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const monthLabel = (ym: string) => `${MONTH_NAMES[Number(ym.slice(5, 7)) - 1]} ${ym.slice(0, 4)}`;

function perPolicyText(p: PerPolicy): { value: string; footnote: string } {
  if (p.kind === "none") return { value: "—", footnote: "no policies issued" };
  if (p.kind === "counts") return { value: `${money(p.spendCents)} · ${p.policies}`, footnote: `${p.policies} polic${p.policies === 1 ? "y" : "ies"}: too few to divide` };
  return { value: money(p.cents), footnote: `over ${p.policies} policies` };
}

export type PnlCohort = { month: string; label: string; acquisitionCents: number; issued: number; alive: number; perIssued: PerPolicy; persisting: Persisting; chargebackTaxCents: number | null };

export function PnlBoard({ data, query, view = "statement", taxMissing = 0, cohorts = null }: { data: PnlView; query: Query; view?: PnlTab; taxMissing?: number; cohorts?: PnlCohort[] | null }) {
  const router = useRouter();
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
  const s = data.statement;
  const issuedText = perPolicyText(data.perIssued);
  const lasting = data.persisting;
  const lastingText = lasting.kind === "building"
    ? { value: "Building", footnote: `${lasting.monthsElapsed} of ${lasting.horizon} months; ready ${lasting.readyOn}` }
    : perPolicyText(lasting.perPolicy);
  const received = data.moneyIn.received;

  // Readability pass (owner 2026-11-03): each section opens on a tinted band with its name, its lines are
  // indented under it, every total sits on a hairline with its comparisons in full ink, and net profit is
  // the last band, coloured by its sign. Amounts read in one right-aligned column per period.
  const num = "text-right tabular-nums";
  const row = (l: PnlLine) => (
    <tr key={`${l.section}-${l.entryType}-${l.sourceId ?? l.sourceName ?? ""}`} className="hover:bg-[var(--surface-alt)]">
      <td className="pl-8"><Link className="text-[var(--body)] underline-offset-2 hover:text-[var(--accent-ink)] hover:underline" href={entriesHref(l, query)}>{lineLabel(l)}</Link></td>
      <td className={num}>{money(l.amountCents)}</td>
      <td colSpan={3} />
    </tr>
  );
  const none = (text: string) => <tr><td className="pl-8 text-muted-foreground" colSpan={5}>{text}</td></tr>;
  const subtotal = (label: string, cur: number, prev: number, ly: number, received?: ReactNode) => (
    <tr className="border-t border-border font-semibold">
      <td>{label}</td>
      <td className={num}>{money(cur)}</td>
      <td className={num}>{money(prev)}</td>
      <td className={num}>{money(ly)}</td>
      <td className={num}>{received}</td>
    </tr>
  );
  const heading = (label: string, note?: string) => (
    <tr className="bg-[var(--surface-alt)]">
      <td colSpan={5} className="font-semibold text-[var(--ink)]">{label}{note ? <span className="font-normal text-muted-foreground"> · {note}</span> : null}</td>
    </tr>
  );
  const tone = (cents: number) => (cents < 0 ? "text-[var(--error-ink)]" : "");

  return (
    <>
      {/* LA-7.8: missing W-9s and tax IDs surface during the year, while they are easy to chase — in the bell. */}
      {taxMissing ? <Callout tone="warning" title={`${taxMissing} contractor${taxMissing === 1 ? " needs" : "s need"} a 1099 and ${taxMissing === 1 ? "is" : "are"} missing a W-9, tax ID or legal name.`}><Link className="underline" href="/app/tax">Open Tax summaries</Link></Callout> : null}
      <StatStrip label="Profit and loss">
        <StatTile label="Net profit" value={money(s.netProfitCents)} valueTone={s.netProfitCents < 0 ? "danger" : undefined} footnote={`${money(data.previous.netProfitCents)} the period before`} />
        <StatTile label="Commission reported" value={money(data.moneyIn.reportedCents)} footnote={received.imported ? `${money(received.cents)} received in the bank` : "received: not imported"} href="/app/bank" />
        <StatTile label="Acquisition cost" value={money(-s.acquisitionCents)} footnote={`${data.issued} polic${data.issued === 1 ? "y" : "ies"} issued`} href="/app/vendor-bills" />
        <StatTile label="Cost per issued policy" value={issuedText.value} footnote={issuedText.footnote} />
        <StatTile label={`Cost per persisting policy (${data.settings.horizon} mo)`} value={lastingText.value} footnote={data.chargebackTaxCents !== null ? `chargeback tax ${money(data.chargebackTaxCents)}` : lastingText.footnote} href={pnlHref(query, "cohorts")} />
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
                <Button variant="outline" size="icon" aria-label="Previous period" onClick={() => step(-1)}><ChevronLeft aria-hidden="true" /></Button>
                <span className="min-w-[150px] text-center text-sm font-semibold">{data.range.label}</span>
                <Button variant="outline" size="icon" aria-label="Next period" onClick={() => step(1)}><ChevronRight aria-hidden="true" /></Button>
              </span>
            )}
          </DataToolbar>
        }
      >
        {view === "trend" ? <TrendTable trend={data.trend} /> : view === "cohorts" ? <CohortTable cohorts={cohorts ?? []} horizon={data.settings.horizon} /> : (
        <table className="portal-lead-table w-full min-w-[760px] text-left text-sm">
          <thead><tr><th>{data.range.label}</th><th className="w-[140px] text-right">This period</th><th className="w-[140px] text-right">Period before</th><th className="w-[140px] text-right">Last year</th><th className="w-[140px] text-right">Received</th></tr></thead>
          <tbody>
            {heading("Money in", "as the carriers reported it")}
            {s.in.length ? s.in.map(row) : none("No commission recorded in this period.")}
            {subtotal("Net commission", s.inCents, data.previous.inCents, data.lastYear.inCents, received.imported ? money(received.cents) : <span className="font-normal text-muted-foreground">Not imported</span>)}
            {s.held.length ? (
              <>
                {heading("Held by the carriers", "not in net commission or net profit")}
                {s.held.map(row)}
                <tr className="border-t border-border font-semibold"><td>Total held</td><td className={num}>{money(s.heldCents)}</td><td colSpan={3} /></tr>
              </>
            ) : null}
            {heading("Acquisition cost", "divides into cost per policy")}
            {s.acquisition.length ? s.acquisition.map(row) : none("No acquisition cost recorded.")}
            {subtotal("Total acquisition cost", s.acquisitionCents, data.previous.acquisitionCents, data.lastYear.acquisitionCents)}
            {heading("Overhead", "net profit only")}
            {s.overhead.length ? s.overhead.map(row) : none("No overhead recorded.")}
            {subtotal("Total overhead", s.overheadCents, data.previous.overheadCents, data.lastYear.overheadCents)}
            {s.splits.length || data.previous.splitsCents || data.lastYear.splitsCents ? (
              <>
                {heading("Producer splits")}
                {s.splits.length ? s.splits.map(row) : none("No splits in this period.")}
                {subtotal("Total splits", s.splitsCents, data.previous.splitsCents, data.lastYear.splitsCents)}
              </>
            ) : null}
            <tr className="border-t-2 border-border bg-[var(--surface-alt)] text-base font-semibold">
              <td>Net profit</td>
              <td className={`${num} ${tone(s.netProfitCents)}`}>{money(s.netProfitCents)}</td>
              <td className={`${num} ${tone(data.previous.netProfitCents)}`}>{money(data.previous.netProfitCents)}</td>
              <td className={`${num} ${tone(data.lastYear.netProfitCents)}`}>{money(data.lastYear.netProfitCents)}</td>
              <td />
            </tr>
            {heading("Per policy", "acquisition cost only")}
            <tr>
              <td className="pl-8">Cost per issued policy</td>
              <td className={num}>{issuedText.value}</td>
              <td colSpan={3} className="text-muted-foreground">{issuedText.footnote}</td>
            </tr>
            <tr>
              <td className="pl-8">Cost per persisting policy ({data.settings.horizon} months)</td>
              <td className={num}>{lastingText.value}</td>
              <td colSpan={3} className="text-muted-foreground">{lastingText.footnote}{data.chargebackTaxCents !== null ? ` · chargeback tax ${money(data.chargebackTaxCents)} a policy` : ""}</td>
            </tr>
          </tbody>
        </table>
        )}
      </TableCard>
    </>
  );
}

/** Last six months, the direction the spec cares about more than any one month (LA-7.7). */
function TrendTable({ trend }: { trend: PnlView["trend"] }) {
  return (
    <table className="portal-lead-table w-full min-w-[760px] text-left text-sm">
      <thead><tr><th>Month</th><th className="text-right">Money in</th><th className="text-right">Acquisition</th><th className="text-right">Overhead</th><th className="text-right">Net profit</th></tr></thead>
      <tbody>
        {trend.length === 0 ? <tr><td colSpan={5} className="text-muted-foreground">Nothing recorded in the last six months.</td></tr> : trend.map((m) => (
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
  );
}

/**
 * LA-7.7 · the trailing view: the six months old enough to have a cost per persisting policy, newest first.
 * The gap between the two per-policy figures is the chargeback tax. Acquisition cost only; under the sample
 * threshold a cell shows counts, not a rate.
 */
function CohortTable({ cohorts, horizon }: { cohorts: PnlCohort[]; horizon: number }) {
  return (
    <table className="portal-lead-table w-full min-w-[760px] text-left text-sm">
      <thead><tr><th>Issued in</th><th className="text-right">Acquisition cost</th><th className="text-right">Issued</th><th className="text-right">Cost per issued</th><th className="text-right">Lasting {horizon} mo</th><th className="text-right">Cost per persisting</th><th className="text-right">Chargeback tax</th></tr></thead>
      <tbody>
        {cohorts.length === 0 ? <tr><td colSpan={7} className="text-muted-foreground">No month is old enough yet.</td></tr> : cohorts.map((c) => {
          const issued = perPolicyText(c.perIssued);
          const lasting = c.persisting.kind === "building" ? { value: "Building", footnote: "" } : perPolicyText(c.persisting.perPolicy);
          return (
            <tr key={c.month}>
              <td>{c.label}</td>
              <td className="text-right tabular-nums">{money(-c.acquisitionCents)}</td>
              <td className="text-right tabular-nums">{c.issued}</td>
              <td className="text-right tabular-nums" title={issued.footnote}>{issued.value}</td>
              <td className="text-right tabular-nums">{c.persisting.kind === "figure" ? c.alive : "—"}</td>
              <td className="text-right tabular-nums" title={lasting.footnote}>{lasting.value}</td>
              <td className="text-right tabular-nums">{c.chargebackTaxCents !== null ? money(c.chargebackTaxCents) : "—"}</td>
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}
