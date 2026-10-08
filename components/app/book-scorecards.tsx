"use client";

import Link from "next/link";
import { useState, useTransition, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import { Download } from "lucide-react";

import { ViewTabs } from "@/components/app/book-of-business-views";
import { Button } from "@/components/ui/button";
import { DataToolbar, RefreshButton, toolbarControl } from "@/components/ui/data-toolbar";
import { EmptyState } from "@/components/ui/page-states";
import { StatStrip, StatTile } from "@/components/ui/stat";
import { StatusChip } from "@/components/ui/status-chip";
import { TableCard } from "@/components/ui/table-card";
import { QUIET_DAY, type SummaryInput } from "@/lib/ingestion/dailySummary";
import { readableDay, statusLabel, toCsv } from "@/lib/ingestion/policyBook";
import {
  CONTRACT_MONTH, CONTRACT_SHARE_PCT, DIMENSION_LABELS, centsText, chargebackText, costPerSale, drillParam, percentOf, persistencyText, shareText, trueCostPerSale, wholeDollars,
  type Bucket, type Dimension, type Drill, type Slicing, type WeekRow,
} from "@/lib/ingestion/scorecards";
import { fileHref, rowHref } from "@/lib/ingestion/trace";
import { notify } from "@/lib/notify";

/**
 * LA-4.18 (Notion sprint) · the book scorecards. Three views (overview, persistency, scorecards), each
 * table with its CSV of exactly what is on screen, and every figure a link to the rows behind it.
 * A share under the agency's sample size prints as a count; a persistency bucket the book's history
 * can't fill yet prints "Building".
 */

export type CellView = { month: Bucket; building: boolean; readyOn: string | null; eligible: number; alive: number; premiumEligibleCents: number; premiumAliveCents: number; premiumUnknown: number };
type SliceView = { key: string; name: string; policies: number; inForce: number; annualCents: number; annualUnknown: number };
type ChargebackView = { key: string; name: string; advancedCents: number; chargedBackCents: number; advancedPolicies: number };
type CardView = { key: string; name: string; policies: number; inForce: number; annualCents: number; issued: number; placed: number; contract: CellView; advancedCents: number; chargedBackCents: number; advancedPolicies: number; netCents: number; netKnown: boolean; spendCents?: number | null; sales?: number };

export type ScorecardsView = {
  view: "overview" | "persistency" | "scorecards";
  months: number;
  periods: number[];
  today: string;
  period: { from: string; to: string };
  start: string | null;
  minSample: number;
  canEditSettings: boolean;
  scoped: boolean;
  summary: SummaryInput;
  policies: number;
  overall: CellView[];
  whole: SliceView | null;
  book: Record<"carrier" | "product" | "status" | "agent" | "agency", SliceView[]>;
  placement: { issued: number; placed: number; notPlaced: number; submitted: number | null; submittedIssued: number | null };
  chargebacks: Record<Dimension | "all", ChargebackView[]>;
  weeks: WeekRow[] | null;
  persistencyBy: Record<Dimension, Array<{ key: string; name: string; policies: number; cells: CellView[] }>>;
  cards: Record<Dimension, CardView[]>;
  spendAvailable: boolean;
  buckets: number[];
};

const count = (n: number) => n.toLocaleString("en-US");
const dollars = (cents: number) => (cents / 100).toFixed(2);

function downloadCsv(name: string, header: string[], rows: Array<Array<string | number | null>>) {
  const blob = new Blob([`﻿${toCsv(header, rows)}`], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = `${name}-${new Date().toISOString().slice(0, 10)}.csv`;
  link.click();
  URL.revokeObjectURL(url);
}

function CsvButton({ name, header, rows }: { name: string; header: string[]; rows: Array<Array<string | number | null>> }) {
  return <Button type="button" variant="outline" disabled={!rows.length} onClick={() => downloadCsv(name, header, rows)} title="The rows shown, as shown"><Download aria-hidden="true" />Export CSV</Button>;
}

function SliceTabs<K extends string>({ label, value, options, onChange }: { label: string; value: K; options: readonly K[]; onChange: (k: K) => void }) {
  return <ViewTabs label={label} active={value} onChange={onChange} tabs={options.map((key) => ({ key, label: DIMENSION_LABELS[key as unknown as Slicing] ?? key }))} />;
}

const cellTitle = (c: CellView, minSample: number) =>
  c.building ? `Needs ${c.month} months of issue history${c.readyOn ? ` (from ${readableDay(c.readyOn)})` : ""}` : c.eligible === 0 ? "No policy issued since the history began is old enough yet" : c.eligible < minSample ? `${c.alive} of ${c.eligible} in force; a percentage needs ${minSample} policies` : `${c.alive} of ${c.eligible} in force at month ${c.month}`;

export function BookScorecards({ model }: { model: ScorecardsView }) {
  const router = useRouter();
  const [refreshing, startRefresh] = useTransition();
  const base = `/app/book-scorecards?view=${model.view}&months=${model.months}`;
  const drillHref = (d: Drill) => `${base}&drill=${encodeURIComponent(drillParam(d))}`;
  const Fig = ({ d, children }: { d: Drill; children: ReactNode }) => <Link href={drillHref(d)} className="tabular-nums underline-offset-2 hover:underline">{children}</Link>;
  const refresh = <RefreshButton onClick={() => startRefresh(() => router.refresh())} refreshing={refreshing} />;

  const tabs = (
    <div className="flex flex-wrap items-center gap-3">
      <ViewTabs label="Scorecard views" active={model.view} tabs={[
        { key: "overview", label: "Overview", href: `/app/book-scorecards?view=overview&months=${model.months}` },
        { key: "persistency", label: "Persistency", href: `/app/book-scorecards?view=persistency&months=${model.months}` },
        { key: "scorecards", label: "Scorecards", href: `/app/book-scorecards?view=scorecards&months=${model.months}` },
      ]} />
      <select aria-label="Period" className={toolbarControl} value={model.months} onChange={(e) => router.push(`/app/book-scorecards?view=${model.view}&months=${e.target.value}`)}>
        {model.periods.map((m) => <option key={m} value={m}>Last {m} months</option>)}
      </select>
    </div>
  );

  if (model.policies === 0) {
    return <>{tabs}<TableCard><EmptyState title="No policies in your carrier files yet" hint="Figures appear once a carrier's policy file has been read." /></TableCard></>;
  }

  return (
    <>
      {tabs}
      {model.view === "overview" && <Overview model={model} Fig={Fig} refresh={refresh} />}
      {model.view === "persistency" && <Persistency model={model} Fig={Fig} refresh={refresh} />}
      {model.view === "scorecards" && <Cards model={model} Fig={Fig} refresh={refresh} />}
    </>
  );
}

type Parts = { model: ScorecardsView; Fig: (props: { d: Drill; children: ReactNode }) => ReactNode; refresh: ReactNode };

// ─── overview ─────────────────────────────────────────────────────────────────────────────────

function Overview({ model, Fig, refresh }: Parts) {
  const [bookDim, setBookDim] = useState<keyof ScorecardsView["book"]>("carrier");
  const [cbDim, setCbDim] = useState<Dimension>("carrier");
  const m9 = model.overall.find((c) => c.month === CONTRACT_MONTH) as CellView;
  const cbAll = model.chargebacks.all[0];
  const pl = model.placement;
  const book = model.book[bookDim];
  const cbRows = model.chargebacks[cbDim];
  const weeks = model.weeks ?? [];

  return (
    <>
      <StatStrip label="Book">
        <StatTile label="Annualised premium" value={model.whole ? <Fig d={{ kind: "book", dim: "all", key: "all" }}>{centsText(model.whole.annualCents)}</Fig> : "—"} footnote={model.whole ? `${count(model.whole.inForce)} of ${count(model.whole.policies)} policies in force${model.whole.annualUnknown ? ` · ${model.whole.annualUnknown} with no premium on file` : ""}` : undefined} />
        <StatTile label={`Month-${CONTRACT_MONTH} persistency`} value={m9.building || !m9.eligible ? persistencyText(m9, "count", model.minSample) : <Fig d={{ kind: "persistency", month: CONTRACT_MONTH, dim: "all", key: "" }}>{persistencyText(m9, "count", model.minSample)}</Fig>} valueTone={!m9.building && m9.eligible >= model.minSample ? (percentOf(m9.alive, m9.eligible) < CONTRACT_SHARE_PCT ? "danger" : "good") : undefined} footnote={m9.building ? cellTitle(m9, model.minSample) : `carriers look for ${CONTRACT_SHARE_PCT}%`} />
        <StatTile label="Placed" value={pl.issued ? <Fig d={{ kind: "placement", set: "placed" }}>{shareText(pl.placed, pl.issued, model.minSample)}</Fig> : "—"} footnote={pl.issued ? `of ${count(pl.issued)} issued in the period paid at least once` : "nothing issued in the period"} />
        <StatTile label="Chargeback ratio" value={cbAll ? <Fig d={{ kind: "chargeback", dim: "all", key: "all" }}>{chargebackText(cbAll, model.minSample) ?? `${centsText(cbAll.chargedBackCents)}`}</Fig> : "—"} footnote={cbAll ? `${centsText(cbAll.chargedBackCents)} back of ${centsText(cbAll.advancedCents)} advanced` : "no advance on file yet"} />
      </StatStrip>

      <TableCard title="Today" description={readableDay(model.summary.date)}>
        {model.summary.facts.length === 0 ? <p className="m-0 px-4 pb-4 text-sm text-muted-foreground">{QUIET_DAY}</p> : (
          <ul className="m-0 grid list-none gap-2 px-4 pb-4 text-sm">
            {model.summary.facts.map((f) => <li key={f.id}><Link href={f.href} className="text-foreground underline-offset-2 hover:underline">{f.text}</Link></li>)}
          </ul>
        )}
      </TableCard>

      <TableCard title="Book of business" toolbar={<DataToolbar actions={<><CsvButton name={`book-by-${bookDim}`} header={[DIMENSION_LABELS[bookDim], "Policies", "In force", "Annualised premium", "No premium on file"]} rows={book.map((s) => [bookDim === "status" ? statusLabel(s.key) : s.name, s.policies, s.inForce, dollars(s.annualCents), s.annualUnknown])} />{refresh}</>}><SliceTabs label="Book by" value={bookDim} options={["carrier", "product", "status", "agent", "agency"] as const} onChange={setBookDim} /></DataToolbar>}>
        <table className="portal-lead-table w-full min-w-[640px] text-left text-sm">
          <thead><tr><th>{DIMENSION_LABELS[bookDim]}</th><th className="w-[110px] text-right">Policies</th><th className="w-[110px] text-right">In force</th><th className="w-[170px] text-right">Annualised premium</th></tr></thead>
          <tbody>
            {book.map((s) => (
              <tr key={s.key}>
                <td className="font-semibold text-foreground">{bookDim === "status" ? statusLabel(s.key) : s.name}</td>
                <td className="text-right"><Fig d={{ kind: "book", dim: bookDim, key: s.key }}>{count(s.policies)}</Fig></td>
                <td className="text-right tabular-nums">{count(s.inForce)}</td>
                <td className="text-right tabular-nums">{centsText(s.annualCents)}{s.annualUnknown ? <span className="block text-xs text-muted-foreground">{s.annualUnknown} with no premium on file</span> : null}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </TableCard>

      <TableCard title="Placement" description={`Issued ${readableDay(model.period.from)} – ${readableDay(model.period.to)}. Agents quote issued; placed is what pays.`} toolbar={<DataToolbar actions={<CsvButton name="placement" header={["Submitted", "Submitted and issued", "Issued", "Placed", "Issued, never paid"]} rows={[[pl.submitted, pl.submittedIssued, pl.issued, pl.placed, pl.notPlaced]]} />}><span className="text-sm text-muted-foreground">Placed = issued and paid at least once</span></DataToolbar>}>
        <table className="portal-lead-table w-full min-w-[640px] text-left text-sm">
          <thead><tr><th className="text-right">Submitted</th><th className="text-right">Issued</th><th className="text-right">Placed</th><th className="text-right">Issued, never paid</th><th className="text-right">Placement rate</th></tr></thead>
          <tbody>
            <tr>
              <td className="text-right tabular-nums">{pl.submitted === null ? <span className="text-muted-foreground" title="No applications were submitted through Insurvas in the period">—</span> : <>{count(pl.submitted)}<span className="block text-xs text-muted-foreground">{count(pl.submittedIssued ?? 0)} issued</span></>}</td>
              <td className="text-right"><Fig d={{ kind: "placement", set: "issued" }}>{count(pl.issued)}</Fig></td>
              <td className="text-right"><Fig d={{ kind: "placement", set: "placed" }}>{count(pl.placed)}</Fig></td>
              <td className="text-right"><Fig d={{ kind: "placement", set: "not_placed" }}>{count(pl.notPlaced)}</Fig></td>
              <td className="text-right tabular-nums">{pl.issued ? shareText(pl.placed, pl.issued, model.minSample) : "—"}</td>
            </tr>
          </tbody>
        </table>
      </TableCard>

      <TableCard title="Chargeback ratio" toolbar={<DataToolbar actions={<CsvButton name={`chargebacks-by-${cbDim}`} header={[DIMENSION_LABELS[cbDim], "Advanced", "Charged back", "Policies advanced", "Ratio"]} rows={cbRows.map((r) => [r.name, dollars(r.advancedCents), dollars(r.chargedBackCents), r.advancedPolicies, chargebackText(r, model.minSample)])} />}><SliceTabs label="Chargebacks by" value={cbDim} options={["carrier", "product", "agent", "source"] as const} onChange={setCbDim} /></DataToolbar>}>
        {cbRows.length === 0 ? <EmptyState title="No advances on file yet" hint="The ratio appears once a commission file with advances has been read." /> : (
          <table className="portal-lead-table w-full min-w-[640px] text-left text-sm">
            <thead><tr><th>{DIMENSION_LABELS[cbDim]}</th><th className="w-[150px] text-right">Advanced</th><th className="w-[150px] text-right">Charged back</th><th className="w-[120px] text-right">Ratio</th></tr></thead>
            <tbody>
              {cbRows.map((r) => (
                <tr key={r.key}>
                  <td className="font-semibold text-foreground">{r.name}</td>
                  <td className="text-right tabular-nums">{centsText(r.advancedCents)}<span className="block text-xs text-muted-foreground">{count(r.advancedPolicies)} {r.advancedPolicies === 1 ? "policy" : "policies"}</span></td>
                  <td className="text-right tabular-nums">{centsText(r.chargedBackCents)}</td>
                  <td className="text-right"><Fig d={{ kind: "chargeback", dim: cbDim, key: r.key }}>{chargebackText(r, model.minSample) ?? <span title={`A ratio needs ${model.minSample} advanced policies`}>{r.advancedPolicies} {r.advancedPolicies === 1 ? "policy" : "policies"}</span>}</Fig></td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </TableCard>

      <TableCard title="Net commission by week" description="Advances and earned, less chargebacks, fees and advance interest. Held money is shown apart: it hasn't been paid." toolbar={<DataToolbar actions={<CsvButton name="net-commission-by-week" header={["Week of", "Advances", "Earned and overrides", "Chargebacks", "Fees and interest", "Other", "Net", "Held"]} rows={weeks.map((w) => [w.week, dollars(w.parts.advance), dollars(w.parts.earned + w.parts.override), dollars(w.parts.chargeback), dollars(w.parts.fee + w.parts.advance_interest), dollars(w.parts.other), dollars(w.netCents), dollars(w.heldCents)])} />}><span className="text-sm text-muted-foreground">The last 13 weeks</span></DataToolbar>}>
        {model.weeks === null ? <EmptyState title="Not available yet" hint="This needs a database update (20261008270000)." /> : weeks.length === 0 ? <EmptyState title="No commission lines in the last 13 weeks" hint="Weeks appear once a commission file has been read." /> : (
          <table className="portal-lead-table w-full min-w-[820px] text-left text-sm">
            <thead><tr><th>Week of</th><th className="text-right">Advances</th><th className="text-right">Earned</th><th className="text-right">Chargebacks</th><th className="text-right">Fees and interest</th><th className="text-right">Net</th><th className="text-right">Held</th></tr></thead>
            <tbody>
              {weeks.map((w) => (
                <tr key={w.week}>
                  <td className="font-semibold text-foreground">{readableDay(w.week)}</td>
                  <td className="text-right tabular-nums">{centsText(w.parts.advance)}</td>
                  <td className="text-right tabular-nums">{centsText(w.parts.earned + w.parts.override)}</td>
                  <td className="text-right tabular-nums">{centsText(w.parts.chargeback)}</td>
                  <td className="text-right tabular-nums">{centsText(w.parts.fee + w.parts.advance_interest)}</td>
                  <td className="text-right font-semibold"><Fig d={{ kind: "week", week: w.week }}>{centsText(w.netCents)}</Fig></td>
                  <td className="text-right tabular-nums text-muted-foreground">{w.heldCents ? centsText(w.heldCents) : "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </TableCard>
    </>
  );
}

// ─── persistency ──────────────────────────────────────────────────────────────────────────────

function SampleSize({ model }: { model: ScorecardsView }) {
  const router = useRouter();
  const [value, setValue] = useState(String(model.minSample));
  const [busy, setBusy] = useState(false);
  if (!model.canEditSettings) return <span className="text-sm text-muted-foreground">A percentage needs {model.minSample} policies</span>;
  async function save() {
    setBusy(true);
    try {
      const response = await fetch("/api/app/book-scorecards", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "save_settings", min_sample: Number(value) }) });
      const data = (await response.json().catch(() => ({}))) as { error?: string };
      if (!response.ok) throw new Error(data.error ?? "The setting could not be saved.");
      notify.done("Saved. Shares under this many policies show as counts.");
      router.refresh();
    } catch (error) {
      notify.block(error instanceof Error ? error.message : "The setting could not be saved.");
    } finally {
      setBusy(false);
    }
  }
  return (
    <label className="flex items-center gap-2 text-sm text-muted-foreground">
      A percentage needs
      <input type="number" min={2} max={100} step={1} value={value} onChange={(e) => setValue(e.target.value)} className={`${toolbarControl} w-[72px]`} aria-label="Sample size" />
      policies
      <Button type="button" variant="outline" disabled={busy || value === String(model.minSample)} onClick={() => void save()}>{busy ? "Saving…" : "Save"}</Button>
    </label>
  );
}

function Persistency({ model, Fig, refresh }: Parts) {
  const [dim, setDim] = useState<Dimension>("carrier");
  const [by, setBy] = useState<"count" | "premium">("count");
  const rows = [{ key: "", name: "Whole book", policies: model.policies, cells: model.overall, all: true }, ...model.persistencyBy[dim].map((r) => ({ ...r, all: false }))];
  const cell = (c: CellView, key: string, all: boolean) => {
    const text = persistencyText(c, by, model.minSample);
    const tone = !c.building && c.eligible >= model.minSample && c.month === CONTRACT_MONTH && percentOf(c.alive, c.eligible) < CONTRACT_SHARE_PCT ? "font-semibold text-[var(--error-ink)]" : "";
    if (c.building || !c.eligible) return <span className="text-muted-foreground" title={cellTitle(c, model.minSample)}>{c.building ? "Building" : "—"}</span>;
    return <span title={cellTitle(c, model.minSample)} className={tone}><Fig d={{ kind: "persistency", month: c.month, dim: all ? "all" : dim, key }}>{text}</Fig></span>;
  };
  return (
    <>
      <StatStrip label="Persistency">
        {model.overall.map((c) => (
          <StatTile key={c.month} label={`Month ${c.month}`} value={c.building || !c.eligible ? <span className="text-muted-foreground">{c.building ? "Building" : "—"}</span> : <Fig d={{ kind: "persistency", month: c.month, dim: "all", key: "" }}>{persistencyText(c, "count", model.minSample)}</Fig>}
            footnote={c.building ? cellTitle(c, model.minSample) : c.eligible ? `${persistencyText(c, "premium", model.minSample)} by premium${c.premiumUnknown ? ` · ${c.premiumUnknown} with no premium` : ""}` : "none old enough yet"} />
        ))}
      </StatStrip>
      <TableCard
        toolbar={
          <DataToolbar actions={<><CsvButton name={`persistency-by-${dim}-${by}`} header={[DIMENSION_LABELS[dim], "Policies", ...model.buckets.map((b) => `Month ${b} (${by})`)]} rows={rows.map((r) => [r.name, r.policies, ...r.cells.map((c) => persistencyText(c, by, model.minSample))])} />{refresh}</>}>
            <SliceTabs label="Persistency by" value={dim} options={["carrier", "product", "agent", "agency", "source"] as const} onChange={setDim} />
            <ViewTabs label="Measured by" active={by} onChange={setBy} tabs={[{ key: "count", label: "By policies" }, { key: "premium", label: "By premium" }]} />
            <SampleSize model={model} />
          </DataToolbar>
        }
        footer={<span>{model.start ? `Counted on policies issued since your first carrier file, ${readableDay(model.start)}: older ones were only seen if they survived.` : ""}</span>}
      >
        <table className="portal-lead-table w-full min-w-[760px] text-left text-sm">
          <thead><tr><th>{DIMENSION_LABELS[dim]}</th><th className="w-[96px] text-right">Policies</th>{model.buckets.map((b) => <th key={b} className="w-[120px] text-right">Month {b}</th>)}</tr></thead>
          <tbody>
            {rows.map((r) => (
              <tr key={`${r.all}-${r.key}`}>
                <td className={r.all ? "font-semibold text-foreground" : "text-foreground"}>{r.name}</td>
                <td className="text-right tabular-nums">{count(r.policies)}</td>
                {r.cells.map((c) => <td key={c.month} className="text-right">{cell(c, r.key, r.all)}</td>)}
              </tr>
            ))}
          </tbody>
        </table>
      </TableCard>
    </>
  );
}

// ─── scorecards ───────────────────────────────────────────────────────────────────────────────

function Cards({ model, Fig, refresh }: Parts) {
  const [dim, setDim] = useState<Dimension>("source");
  const rows = model.cards[dim];
  const source = dim === "source";
  const m9 = (c: CardView) => persistencyText(c.contract, "count", model.minSample);
  const header = source
    ? ["Lead source", "Spend", "Sales", "Cost per sale", `Month-${CONTRACT_MONTH} persistency`, "True cost per sale", "Policies", "Chargeback ratio", "Net commission"]
    : [DIMENSION_LABELS[dim], "Policies", "In force", "Annualised premium", "Placed", `Month-${CONTRACT_MONTH} persistency`, "Chargeback ratio", "Net commission"];
  const csv = rows.map((c) => {
    const cb = chargebackText(c, model.minSample);
    if (source) {
      const cps = costPerSale(c.spendCents, c.sales);
      const tcs = trueCostPerSale(c.spendCents, c.sales, c.contract, model.minSample);
      return [c.name, c.spendCents == null ? null : dollars(c.spendCents), c.sales ?? 0, cps === null ? null : dollars(cps), m9(c), tcs === null ? null : dollars(tcs), c.policies, cb, c.netKnown ? dollars(c.netCents) : null];
    }
    return [c.name, c.policies, c.inForce, dollars(c.annualCents), c.issued ? shareText(c.placed, c.issued, model.minSample) : null, m9(c), cb, c.netKnown ? dollars(c.netCents) : null];
  });
  const persist = (c: CardView) => (c.contract.building || !c.contract.eligible
    ? <span className="text-muted-foreground" title={cellTitle(c.contract, model.minSample)}>{c.contract.building ? "Building" : "—"}</span>
    : <Fig d={{ kind: "persistency", month: CONTRACT_MONTH, dim, key: c.key }}>{m9(c)}</Fig>);
  const cbCell = (c: CardView) => (c.advancedCents || c.chargedBackCents ? <Fig d={{ kind: "chargeback", dim, key: c.key }}>{chargebackText(c, model.minSample) ?? `${centsText(c.chargedBackCents)} back`}</Fig> : <span className="text-muted-foreground">—</span>);

  return (
    <TableCard
      toolbar={<DataToolbar actions={<><CsvButton name={`scorecard-by-${dim}`} header={header} rows={csv} />{refresh}</>}><SliceTabs label="Scorecard by" value={dim} options={["source", "carrier", "product", "agent", "agency"] as const} onChange={setDim} />{source && <span className="text-sm text-muted-foreground">True cost per sale = spend ÷ (sales × month-{CONTRACT_MONTH} persistency)</span>}</DataToolbar>}
      footer={source ? <span>{model.scoped ? "Spend is the agency's and isn't shown on a producer's own scorecard." : !model.spendAvailable ? "Lead spend isn't available right now; refresh to try again." : `Spend and sales: ${readableDay(model.period.from)} – ${readableDay(model.period.to)}.`}</span> : undefined}
    >
      {rows.length === 0 ? <EmptyState title="Nothing to score yet" hint="Rows appear once policies are in your carrier files." /> : (
        <table className="portal-lead-table w-full min-w-[980px] text-left text-sm">
          <thead><tr>{header.map((h, i) => <th key={h} className={i === 0 ? "" : "text-right"}>{h}</th>)}</tr></thead>
          <tbody>
            {rows.map((c) => {
              if (source) {
                const cps = costPerSale(c.spendCents, c.sales);
                const tcs = trueCostPerSale(c.spendCents, c.sales, c.contract, model.minSample);
                return (
                  <tr key={c.key}>
                    <td className="font-semibold text-foreground">{c.name}</td>
                    <td className="text-right tabular-nums">{c.spendCents == null ? <span className="text-muted-foreground">—</span> : wholeDollars(c.spendCents)}</td>
                    <td className="text-right">{c.sales ? <Fig d={{ kind: "sales", key: c.key }}>{count(c.sales)}</Fig> : <span className="tabular-nums">0</span>}</td>
                    <td className="text-right tabular-nums">{cps === null ? <span className="text-muted-foreground">—</span> : wholeDollars(cps)}</td>
                    <td className="text-right">{persist(c)}</td>
                    <td className="text-right font-semibold tabular-nums">{tcs === null ? <span className="font-normal text-muted-foreground" title={c.contract.building ? cellTitle(c.contract, model.minSample) : `Needs spend, sales, and month-${CONTRACT_MONTH} persistency on ${model.minSample} policies`}>—</span> : wholeDollars(tcs)}</td>
                    <td className="text-right"><Fig d={{ kind: "book", dim, key: c.key }}>{count(c.policies)}</Fig></td>
                    <td className="text-right">{cbCell(c)}</td>
                    <td className="text-right tabular-nums">{c.netKnown ? centsText(c.netCents) : <span className="text-muted-foreground" title="No commission line for these policies is on file yet">—</span>}</td>
                  </tr>
                );
              }
              return (
                <tr key={c.key}>
                  <td className="font-semibold text-foreground">{c.name}</td>
                  <td className="text-right"><Fig d={{ kind: "book", dim, key: c.key }}>{count(c.policies)}</Fig></td>
                  <td className="text-right tabular-nums">{count(c.inForce)}</td>
                  <td className="text-right tabular-nums">{centsText(c.annualCents)}</td>
                  <td className="text-right tabular-nums">{c.issued ? shareText(c.placed, c.issued, model.minSample) : "—"}</td>
                  <td className="text-right">{persist(c)}</td>
                  <td className="text-right">{cbCell(c)}</td>
                  <td className="text-right tabular-nums">{c.netKnown ? centsText(c.netCents) : <span className="text-muted-foreground" title="No commission line for these policies is on file yet">—</span>}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      )}
    </TableCard>
  );
}

// ─── drill-through ────────────────────────────────────────────────────────────────────────────

type DrillPolicy = { key: string; note: string; tone: "good" | "danger" | "plain"; clientName: string | null; carrierId: string; carrierName: string; policyNumber: string; status: string | null; issueDate: string | null; annualCents: number | null; agentName: string; sourceName: string };
type DrillEntry = { id: string; carrierName: string; policyNumber: string; type: string; countedOn: string; cents: number; fileId: string; rowNumber: number | null };

export function ScoreDrill({ back, title, figure, policies, entries }: { back: string; title: string; figure: string; policies?: DrillPolicy[]; entries?: DrillEntry[] }) {
  const policyHeader = ["Client", "Carrier", "Policy number", "Status", "Issued", "Annualised premium", "Agent", "Lead source", "Why it counts"];
  const entryHeader = ["Counted on", "Carrier", "Policy number", "Type", "Amount"];
  const rows = policies
    ? policies.map((p) => [p.clientName, p.carrierName, p.policyNumber, statusLabel(p.status), p.issueDate, p.annualCents === null ? null : dollars(p.annualCents), p.agentName, p.sourceName, p.note])
    : (entries ?? []).map((e) => [e.countedOn, e.carrierName, e.policyNumber, e.type, dollars(e.cents)]);
  const total = (entries ?? []).reduce((sum, e) => sum + e.cents, 0);
  return (
    <TableCard
      title={title}
      description={figure}
      action={<Link href={back} className="text-sm font-semibold text-[var(--accent-ink)] hover:underline">Back to the scorecards</Link>}
      toolbar={<DataToolbar actions={<CsvButton name="scorecard-rows" header={policies ? policyHeader : entryHeader} rows={rows} />}><span className="text-sm text-muted-foreground">{count(rows.length)} {rows.length === 1 ? "row" : "rows"}{entries ? ` · ${centsText(total)} in all` : ""}</span></DataToolbar>}
    >
      {rows.length === 0 ? <EmptyState title="No rows behind this figure" hint="It may have changed since the page was opened; go back and open it again." /> : policies ? (
        <table className="portal-lead-table w-full min-w-[980px] text-left text-sm">
          <thead><tr><th>Client</th><th>Carrier · policy</th><th className="w-[120px]">Status</th><th className="w-[120px]">Issued</th><th className="w-[140px] text-right">Annualised premium</th><th>Why it counts</th></tr></thead>
          <tbody>
            {policies.map((p) => (
              <tr key={p.key}>
                <td className="font-semibold text-foreground">{p.clientName ?? <span className="font-normal text-muted-foreground">No client linked</span>}<span className="block text-xs font-normal text-muted-foreground">{p.agentName} · {p.sourceName}</span></td>
                <td><Link href={`/app/policies/carrier/${p.carrierId}/${encodeURIComponent(p.policyNumber)}`} className="hover:underline">{p.carrierName} · {p.policyNumber}</Link></td>
                <td>{statusLabel(p.status)}</td>
                <td className="tabular-nums">{p.issueDate ? readableDay(p.issueDate) : "—"}</td>
                <td className="text-right tabular-nums">{p.annualCents === null ? "—" : centsText(p.annualCents)}</td>
                <td>{p.tone === "plain" ? p.note : <StatusChip tone={p.tone === "good" ? "good" : "danger"}>{p.note}</StatusChip>}</td>
              </tr>
            ))}
          </tbody>
        </table>
      ) : (
        <table className="portal-lead-table w-full min-w-[720px] text-left text-sm">
          <thead><tr><th className="w-[140px]">Counted on</th><th>Carrier · policy</th><th>Type</th><th className="w-[140px] text-right">Amount</th><th className="w-[110px]">Source</th></tr></thead>
          <tbody>
            {(entries ?? []).map((e) => (
              <tr key={e.id}>
                <td className="tabular-nums">{readableDay(e.countedOn)}</td>
                <td>{e.carrierName} · {e.policyNumber}</td>
                <td>{e.type.replaceAll("_", " ")}</td>
                <td className="text-right tabular-nums">{centsText(e.cents)}</td>
                <td className="text-xs">{e.rowNumber ? <Link href={rowHref(e.fileId, e.rowNumber)} className="text-[var(--accent-ink)] hover:underline">Row {e.rowNumber}</Link> : <Link href={fileHref(e.fileId)} className="text-[var(--accent-ink)] hover:underline">The file</Link>}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </TableCard>
  );
}
