"use client";

import { useMemo, useRef, useState, type ReactNode } from "react";
import { Download } from "lucide-react";

import { Button } from "@/components/ui/button";
import { DataToolbar, FilterButton, RefreshButton, toolbarControl } from "@/components/ui/data-toolbar";
import { PageHeader } from "@/components/ui/page-header";
import { EmptyState, SectionLoading } from "@/components/ui/page-states";
import { StatStrip, StatTile } from "@/components/ui/stat";
import { StatusChip } from "@/components/ui/status-chip";
import { TableCard } from "@/components/ui/table-card";
import { downloadCsv } from "@/components/app/partner-quality-parts";
import { REQUIREMENT_KIND_LABEL } from "@/lib/applications/constants";
import { dayMonth } from "@/lib/applications/listRules";
import { buildSalesReport, crossCell, dayIn, MIN_CASES, pct, type Median, type Ratio, type ReportFilters, type SalesReport } from "@/lib/applications/reportRules";
import { sampleReportInput } from "@/lib/applications/reportFixtures";
import { cn } from "@/lib/utils";
import { useSampleRefresh } from "./applications-list";
import { money, SampleDataNotice } from "./parts";

const TABS = [
  { key: "funnel", label: "Funnel and rates" },
  { key: "timing", label: "Timing" },
  { key: "declines", label: "Decline reasons" },
  { key: "counteroffers", label: "Counteroffers" },
  { key: "premium", label: "Premium and commission" },
] as const;
type Tab = (typeof TABS)[number]["key"];

const RANGES = [
  { key: "30", label: "Last 30 days", days: 30 },
  { key: "90", label: "Last 90 days", days: 90 },
  { key: "180", label: "Last 6 months", days: 180 },
  { key: "365", label: "Last 12 months", days: 365 },
  { key: "custom", label: "Custom dates", days: null },
] as const;
type RangeKey = (typeof RANGES)[number]["key"];

const tabClass = (active: boolean) => `-mb-px inline-flex h-10 items-center border-b-2 px-1 text-sm font-semibold leading-[1.43] tracking-[-0.01em] outline-none focus-visible:ring-2 focus-visible:ring-ring ${active ? "border-[var(--primary)] text-foreground" : "border-transparent text-muted-foreground hover:text-foreground"}`;
const count = (n: number) => n.toLocaleString("en-US");

/** "63.5% (198/312)" — the rate and the two numbers it comes from, every time; under MIN_CASES, the count greyed. */
function RateCell({ r, digits = 0 }: { r: Ratio; digits?: number }) {
  if (r.d <= 0) return <span className="text-muted-foreground">—</span>;
  if (r.n < MIN_CASES) return <span className="tabular-nums text-muted-foreground" title={`${r.n} of ${r.d} — fewer than ${MIN_CASES} cases, too few for a rate`}>n={r.n}</span>;
  return <span className="tabular-nums">{pct(r, digits)}% <span className="text-muted-foreground">({count(r.n)}/{count(r.d)})</span></span>;
}

function Cross({ n, d }: { n: number; d: number }) {
  const cell = crossCell(n, d);
  if (cell.kind === "count") return <span className="tabular-nums text-muted-foreground" title={`${n} of ${d} — fewer than ${MIN_CASES} cases, too few for a rate`}>{cell.text}</span>;
  return <span className="tabular-nums">{cell.text} <span className="text-muted-foreground">{cell.detail}</span></span>;
}

function MedianCell({ m, unit }: { m: Median; unit: string }) {
  if (m.value === null || m.n === 0) return <span className="text-muted-foreground">—</span>;
  const small = m.n < MIN_CASES;
  return <span className={cn("tabular-nums", small && "text-muted-foreground")} title={small ? `Only ${m.n} cases — too few to rely on` : undefined}>{small ? `n=${m.n}` : <>{m.value} {unit} <span className="text-muted-foreground">(n={m.n})</span></>}</span>;
}

function tileRate(r: Ratio, noun: string) {
  return r.d > 0 ? `${pct(r, 1)}% of ${noun} · ${count(r.n)}/${count(r.d)}` : `of ${noun}`;
}

function windowFor(range: RangeKey, now: number, timeZone: string, custom: { from: string; to: string }) {
  const def = RANGES.find((r) => r.key === range);
  if (!def || def.days === null) return custom;
  return { from: dayIn(new Date(now - (def.days - 1) * 86_400_000).toISOString(), timeZone), to: dayIn(new Date(now).toISOString(), timeZone) };
}

type Filters = { carrierId: string; productCode: string; source: string; producerId: string };
const NO_FILTERS: Filters = { carrierId: "", productCode: "", source: "", producerId: "" };

export function SalesPerformance({ report: initialReport, sample = false, timeZone = "UTC", initialTab = "declines" }: { report: SalesReport; sample?: boolean; timeZone?: string; initialTab?: Tab }) {
  const [tab, setTab] = useState<Tab>(initialTab);
  const [report, setReport] = useState(initialReport);
  const [range, setRange] = useState<RangeKey>("90");
  const [custom, setCustom] = useState({ from: initialReport.from, to: initialReport.to });
  const [filters, setFilters] = useState<Filters>(NO_FILTERS);
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [now] = useState(() => Date.now());
  const sampleRefresh = useSampleRefresh();
  const sampleInput = useMemo(() => (sample ? sampleReportInput(now) : null), [sample, now]);
  const seq = useRef(0);

  const win = windowFor(range, now, timeZone, custom);
  const queryFor = (r: RangeKey, c: { from: string; to: string }, fl: Filters): ReportFilters => {
    const w = windowFor(r, now, timeZone, c);
    return { from: w.from, to: w.to, carrierId: fl.carrierId || null, productCode: fl.productCode || null, source: fl.source || null, producerId: fl.producerId || null };
  };

  /** Recount for a new window or filter: in the browser for the sample, from the route otherwise. */
  async function load(q: ReportFilters) {
    if (sampleInput) { setReport(buildSalesReport(sampleInput, q)); return; }
    const mine = ++seq.current;
    setLoading(true);
    const params = new URLSearchParams({ from: q.from, to: q.to });
    if (q.carrierId) params.set("carrier", q.carrierId);
    if (q.productCode) params.set("product", q.productCode);
    if (q.source) params.set("source", q.source);
    if (q.producerId) params.set("producer", q.producerId);
    try {
      const r = await fetch(`/api/app/reports/sales?${params}`, { cache: "no-store" });
      const body = (await r.json().catch(() => null)) as { report?: SalesReport; error?: string } | null;
      if (mine !== seq.current) return;
      if (!r.ok || !body?.report) { setError(body?.error ?? "Could not load the report — the figures shown are from the last load."); return; }
      setReport(body.report); setError(null);
    } catch {
      if (mine === seq.current) setError("Could not load the report — check your connection. The figures shown are from the last load.");
    } finally {
      if (mine === seq.current) setLoading(false);
    }
  }
  const change = (next: { range?: RangeKey; custom?: { from: string; to: string }; filters?: Filters }) => {
    const r = next.range ?? range; const c = next.custom ?? custom; const fl = next.filters ?? filters;
    if (next.range) setRange(next.range);
    if (next.custom) setCustom(next.custom);
    if (next.filters) setFilters(next.filters);
    void load(queryFor(r, c, fl));
  };
  const refresh = () => { if (sample) sampleRefresh.refresh(); void load(queryFor(range, custom, filters)); };
  const panelCount = Object.values(filters).filter(Boolean).length;
  const setFilter = (k: keyof Filters, v: string) => change({ filters: { ...filters, [k]: v } });
  const period = `${report.from}-to-${report.to}`;
  const windowLabel = `${dayMonth(report.from)} – ${dayMonth(report.to)}`;
  const t = report.totals;

  // ── per-tab table and export ─────────────────────────────────────────────
  const d = report.declines;
  const declineCarriers = d.carriers;
  const exporters: Record<Tab, () => void> = {
    funnel: () => downloadCsv(`sales-funnel-${period}.csv`, ["Stage", "Insureds", "Of previous stage", "Previous stage", "Of quoted", "Quoted", "Note"], [
      ["Quoted", report.funnel.quoted, null, null, null, null, ""],
      ["Applied", report.funnel.applied.n, pct(report.funnel.applied), report.funnel.applied.d, pct(report.funnel.applied), report.funnel.quoted, ""],
      ["Submitted", report.funnel.submitted.n, pct(report.funnel.submitted), report.funnel.submitted.d, pct({ n: report.funnel.submitted.n, d: report.funnel.quoted }), report.funnel.quoted, ""],
      ["Issued", report.funnel.issued.n, pct(report.funnel.issued), report.funnel.issued.d, pct({ n: report.funnel.issued.n, d: report.funnel.quoted }), report.funnel.quoted, ""],
      ["Placed", null, null, null, null, null, "Partial — not recorded yet"],
    ]),
    timing: () => downloadCsv(`timing-${period}.csv`, ["Carrier", "Median hours first quote to submit", "n", "Median days submit to issue", "n"],
      [...report.timing.rows.map((r) => [r.name, r.quoteToSubmitHours.value, r.quoteToSubmitHours.n, r.submitToIssueDays.value, r.submitToIssueDays.n]), ["All carriers", report.timing.all.quoteToSubmitHours.value, report.timing.all.quoteToSubmitHours.n, report.timing.all.submitToIssueDays.value, report.timing.all.submitToIssueDays.n]]),
    declines: () => downloadCsv(`decline-reasons-${period}.csv`, ["Reason", ...declineCarriers.flatMap((c) => [`${c.name} cases`, `${c.name} declines`]), "All cases", "All declines"],
      [...d.rows.map((r) => [r.label, ...declineCarriers.flatMap((c) => [r.byCarrier[c.id] ?? 0, c.total]), r.total, d.total]), ["All declines", ...declineCarriers.flatMap((c) => [c.total, c.total]), d.total, d.total]]),
    counteroffers: () => downloadCsv(`counteroffers-${period}.csv`, ["Carrier", "Submitted", "Counteroffered", "Accepted", "Refused by client", "Expired", "Still waiting", "Top reason"],
      [...report.counteroffers.rows.map((r) => [r.name, r.submitted, r.counteroffered, r.accepted, r.refused, r.expired, r.pending, r.topReason]), ["All carriers", report.counteroffers.total.submitted, report.counteroffers.total.counteroffered, report.counteroffers.total.accepted, report.counteroffers.total.refused, report.counteroffers.total.expired, report.counteroffers.total.pending, null]]),
    premium: () => downloadCsv(`premium-${period}.csv`, ["Carrier", "Submitted annualised (USD)", "Issued annualised (USD)", "Issued applications", "Estimated first-year commission (USD)", "Issued with a commission rate"],
      [...report.premium.rows.map((r) => [r.name, (r.submittedAnnualCents / 100).toFixed(2), (r.issuedAnnualCents / 100).toFixed(2), r.issuedCount, (r.estimatedFycCents / 100).toFixed(2), r.ratedCount]), ["All carriers", (report.premium.total.submittedAnnualCents / 100).toFixed(2), (report.premium.total.issuedAnnualCents / 100).toFixed(2), report.premium.total.issuedCount, (report.premium.total.estimatedFycCents / 100).toFixed(2), report.premium.total.ratedCount]]),
  };
  const exportRequirements = () => downloadCsv(`requirement-days-${period}.csv`, ["Requirement", ...report.timing.rows.flatMap((c) => [`${c.name} median days`, `${c.name} n`]), "All median days", "All n"],
    report.timing.requirements.map((r) => [REQUIREMENT_KIND_LABEL[r.kind], ...report.timing.rows.flatMap((c) => [r.byCarrier[c.carrierId]?.value ?? null, r.byCarrier[c.carrierId]?.n ?? 0]), r.all.value, r.all.n]));

  const toolbar = (
    <>
      <DataToolbar actions={<>
        <Button type="button" variant="outline" onClick={exporters[tab]} aria-label={`Export ${TABS.find((x) => x.key === tab)?.label.toLowerCase()} as CSV`}><Download aria-hidden="true" />Export</Button>
        <RefreshButton onClick={refresh} refreshing={loading || sampleRefresh.refreshing} />
      </>}>
        <select aria-label="Date range" className={toolbarControl} value={range} onChange={(event) => { const next = event.target.value as RangeKey; change(next === "custom" ? { range: next, custom: win } : { range: next }); }}>
          {RANGES.map((r) => <option key={r.key} value={r.key}>{r.label}</option>)}
        </select>
        {range === "custom" && (
          <span className="inline-flex items-center gap-1.5 text-sm text-muted-foreground">
            <input type="date" aria-label="From" className={toolbarControl} value={custom.from} max={custom.to} onChange={(event) => { if (event.target.value) change({ custom: { ...custom, from: event.target.value } }); }} />
            <span aria-hidden="true">–</span>
            <input type="date" aria-label="To" className={toolbarControl} value={custom.to} min={custom.from} onChange={(event) => { if (event.target.value) change({ custom: { ...custom, to: event.target.value } }); }} />
          </span>
        )}
        <FilterButton open={filtersOpen} onClick={() => setFiltersOpen((v) => !v)} count={panelCount} aria-controls="report-filters" />
      </DataToolbar>
      {filtersOpen && (
        <div id="report-filters" className="flex w-full flex-wrap items-center gap-2">
          <select aria-label="Carrier" className={toolbarControl} value={filters.carrierId} onChange={(event) => setFilter("carrierId", event.target.value)}>
            <option value="">All carriers</option>
            {report.options.carriers.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
          </select>
          <select aria-label="Product" className={toolbarControl} value={filters.productCode} onChange={(event) => setFilter("productCode", event.target.value)}>
            <option value="">All products</option>
            {report.options.products.map((p) => <option key={p.code} value={p.code}>{p.label}</option>)}
          </select>
          <select aria-label="Lead source" className={toolbarControl} value={filters.source} onChange={(event) => setFilter("source", event.target.value)}>
            <option value="">All lead sources</option>
            {report.options.sources.map((s) => <option key={s.value} value={s.value}>{s.label}</option>)}
          </select>
          <select aria-label="Producer" className={toolbarControl} value={filters.producerId} onChange={(event) => setFilter("producerId", event.target.value)}>
            <option value="">All producers</option>
            {report.options.producers.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
          </select>
          {panelCount > 0 && <Button type="button" variant="ghost" onClick={() => change({ filters: NO_FILTERS })}>Clear filters</Button>}
        </div>
      )}
      {error && <p role="alert" className="w-full text-sm text-destructive">{error}</p>}
    </>
  );

  let body: ReactNode;
  let footer: ReactNode = null;
  let secondary: ReactNode = null;
  if (loading) body = <SectionLoading rows={6} columns={5} label="Loading the report" />;
  else if (tab === "funnel") {
    const f = report.funnel;
    footer = <span>{windowLabel} · each insured counted once, from their first quote</span>;
    body = f.quoted === 0
      ? <EmptyState title="No quotes in this window" hint="The funnel starts at an insured's first saved quote. Widen the dates or clear a filter." />
      : <table className="portal-lead-table w-full min-w-[760px] text-left text-sm">
          <thead><tr><th>Stage</th><th className="w-[140px]">Insureds</th><th className="w-[220px]">Of previous stage</th><th className="w-[220px]">Of quoted</th></tr></thead>
          <tbody className="m-seq">
            <tr className="m-row"><td className="font-semibold">Quoted</td><td className="tabular-nums">{count(f.quoted)}</td><td className="text-muted-foreground">—</td><td className="text-muted-foreground">—</td></tr>
            <tr className="m-row"><td className="font-semibold">Applied</td><td className="tabular-nums">{count(f.applied.n)}</td><td><RateCell r={f.applied} /></td><td><RateCell r={{ n: f.applied.n, d: f.quoted }} /></td></tr>
            <tr className="m-row"><td className="font-semibold">Submitted</td><td className="tabular-nums">{count(f.submitted.n)}</td><td><RateCell r={f.submitted} /></td><td><RateCell r={{ n: f.submitted.n, d: f.quoted }} /></td></tr>
            <tr className="m-row"><td className="font-semibold">Issued</td><td className="tabular-nums">{count(f.issued.n)}</td><td><RateCell r={f.issued} /></td><td><RateCell r={{ n: f.issued.n, d: f.quoted }} /></td></tr>
            <tr className="m-row">
              <td><span className="inline-flex items-center gap-2 font-semibold">Placed <StatusChip tone="warning" title="The first premium draft result is not recorded anywhere yet. Placed is never inferred from issued.">Partial</StatusChip></span></td>
              <td className="text-muted-foreground" title="Not recorded yet">—</td><td className="text-muted-foreground">—</td><td className="text-muted-foreground">—</td>
            </tr>
          </tbody>
        </table>;
  } else if (tab === "timing") {
    const tm = report.timing;
    footer = <span>{windowLabel} · medians · under {MIN_CASES} cases shows the count in grey</span>;
    body = tm.rows.length === 0
      ? <EmptyState title="Nothing submitted in this window" hint="Timing is measured from each insured's first quote to submission, and from submission to issue." />
      : <table className="portal-lead-table w-full min-w-[640px] text-left text-sm">
          <thead><tr><th>Carrier</th><th className="w-[240px]">First quote → submit</th><th className="w-[240px]">Submit → issue</th></tr></thead>
          <tbody className="m-seq">
            {tm.rows.map((r) => <tr key={r.carrierId} className="m-row"><td>{r.name}</td><td><MedianCell m={r.quoteToSubmitHours} unit="h" /></td><td><MedianCell m={r.submitToIssueDays} unit="days" /></td></tr>)}
          </tbody>
          <tfoot><tr className="bg-[var(--surface-alt)] font-semibold text-foreground"><td className="border-t border-[var(--border-strong)] px-3 py-2.5">All carriers</td><td className="border-t border-[var(--border-strong)] px-3 py-2.5"><MedianCell m={tm.all.quoteToSubmitHours} unit="h" /></td><td className="border-t border-[var(--border-strong)] px-3 py-2.5"><MedianCell m={tm.all.submitToIssueDays} unit="days" /></td></tr></tfoot>
        </table>;
    secondary = (
      <TableCard title="Days a requirement sits open" action={<Button type="button" variant="outline" onClick={exportRequirements} disabled={tm.requirements.length === 0} title={tm.requirements.length === 0 ? "Nothing to export" : undefined}><Download aria-hidden="true" />Export</Button>}>
        {tm.requirements.length === 0
          ? <EmptyState title="No requirements on these applications" hint="A requirement counts here once it is met, from the day the carrier raised it." />
          : <table className="portal-lead-table w-full min-w-[640px] text-left text-sm">
              <thead><tr><th>Requirement</th>{tm.rows.map((c) => <th key={c.carrierId} className="w-[150px]">{c.name}</th>)}<th className="w-[128px]">All</th></tr></thead>
              <tbody className="m-seq">
                {tm.requirements.map((r) => <tr key={r.kind} className="m-row"><td>{REQUIREMENT_KIND_LABEL[r.kind]}</td>{tm.rows.map((c) => <td key={c.carrierId}><MedianCell m={r.byCarrier[c.carrierId] ?? { value: null, n: 0 }} unit="days" /></td>)}<td><MedianCell m={r.all} unit="days" /></td></tr>)}
              </tbody>
            </table>}
      </TableCard>
    );
  } else if (tab === "declines") {
    footer = <span>{windowLabel} · each figure is that reason’s share of the carrier’s declines</span>;
    body = d.total === 0
      ? <EmptyState title="No declines in this window" hint="An application that closes without a policy shows here under the reason recorded for it." />
      : <table className="portal-lead-table w-full min-w-[860px] text-left text-sm">
          <thead><tr><th>Reason</th>{declineCarriers.map((c) => <th key={c.id} className="w-[150px]">{c.name}</th>)}<th className="w-[128px]">All</th></tr></thead>
          <tbody className="m-seq">
            {d.rows.map((r) => (
              <tr key={r.key} className="m-row">
                <td>{r.label}</td>
                {declineCarriers.map((c) => <td key={c.id}><Cross n={r.byCarrier[c.id] ?? 0} d={c.total} /></td>)}
                <td><Cross n={r.total} d={d.total} /></td>
              </tr>
            ))}
          </tbody>
          <tfoot>
            <tr className="bg-[var(--surface-alt)] font-semibold text-foreground">
              <td className="border-t border-[var(--border-strong)] px-3 py-2.5">All declines</td>
              {declineCarriers.map((c) => <td key={c.id} className="border-t border-[var(--border-strong)] px-3 py-2.5 tabular-nums">{count(c.total)}</td>)}
              <td className="border-t border-[var(--border-strong)] px-3 py-2.5 tabular-nums">{count(d.total)}</td>
            </tr>
          </tfoot>
        </table>;
  } else if (tab === "counteroffers") {
    const co = report.counteroffers;
    footer = <span>{windowLabel} · applications submitted in the window</span>;
    body = co.total.submitted === 0
      ? <EmptyState title="Nothing submitted in this window" hint="A counteroffer is counted against the application it was made on." />
      : <table className="portal-lead-table w-full min-w-[980px] text-left text-sm">
          <thead><tr><th>Carrier</th><th className="w-[110px]">Submitted</th><th className="w-[170px]">Counteroffered</th><th className="w-[100px]">Accepted</th><th className="w-[100px]">Refused</th><th className="w-[100px]">Expired</th><th className="w-[110px]">Still waiting</th><th>Top reason</th></tr></thead>
          <tbody className="m-seq">
            {co.rows.map((r) => (
              <tr key={r.carrierId} className="m-row">
                <td>{r.name}</td><td className="tabular-nums">{count(r.submitted)}</td><td><RateCell r={{ n: r.counteroffered, d: r.submitted }} /></td>
                <td className="tabular-nums">{count(r.accepted)}</td><td className="tabular-nums">{count(r.refused)}</td><td className="tabular-nums">{count(r.expired)}</td><td className="tabular-nums">{count(r.pending)}</td>
                <td>{r.topReason ?? <span className="text-muted-foreground">—</span>}</td>
              </tr>
            ))}
          </tbody>
          <tfoot>
            <tr className="bg-[var(--surface-alt)] font-semibold text-foreground">
              {["All carriers", count(co.total.submitted)].map((v, i) => <td key={i} className="border-t border-[var(--border-strong)] px-3 py-2.5 tabular-nums">{v}</td>)}
              <td className="border-t border-[var(--border-strong)] px-3 py-2.5"><RateCell r={{ n: co.total.counteroffered, d: co.total.submitted }} /></td>
              {[co.total.accepted, co.total.refused, co.total.expired, co.total.pending].map((v, i) => <td key={i} className="border-t border-[var(--border-strong)] px-3 py-2.5 tabular-nums">{count(v)}</td>)}
              <td className="border-t border-[var(--border-strong)] px-3 py-2.5" />
            </tr>
          </tfoot>
        </table>;
  } else {
    const p = report.premium;
    footer = <span>{windowLabel} · annualised · commission estimated from your contract level{p.total.issuedCount > p.total.ratedCount ? ` · ${p.total.issuedCount - p.total.ratedCount} of ${p.total.issuedCount} issued have no rate on file` : ""}</span>;
    body = p.rows.length === 0
      ? <EmptyState title="Nothing submitted in this window" hint="Premium is the selected quote's monthly premium, annualised, for each application submitted." />
      : <table className="portal-lead-table w-full min-w-[860px] text-left text-sm">
          <thead><tr><th>Carrier</th><th className="w-[170px]">Submitted</th><th className="w-[170px]">Issued</th><th className="w-[150px]">Issued share</th><th className="w-[220px]"><span className="block">First-year commission</span><span className="block text-xs font-normal normal-case tracking-normal">Estimated</span></th></tr></thead>
          <tbody className="m-seq">
            {p.rows.map((r) => (
              <tr key={r.carrierId} className="m-row">
                <td>{r.name}</td><td className="tabular-nums">{money(r.submittedAnnualCents)}</td><td className="tabular-nums">{money(r.issuedAnnualCents)}</td>
                <td className="tabular-nums">{r.submittedAnnualCents > 0 ? `${pct({ n: r.issuedAnnualCents, d: r.submittedAnnualCents }, 1)}%` : "—"}</td>
                <td className="tabular-nums" title={`${r.ratedCount} of ${r.issuedCount} issued have a commission rate on file`}>{money(r.estimatedFycCents)}</td>
              </tr>
            ))}
          </tbody>
          <tfoot>
            <tr className="bg-[var(--surface-alt)] font-semibold text-foreground">
              <td className="border-t border-[var(--border-strong)] px-3 py-2.5">All carriers</td>
              <td className="border-t border-[var(--border-strong)] px-3 py-2.5 tabular-nums">{money(p.total.submittedAnnualCents)}</td>
              <td className="border-t border-[var(--border-strong)] px-3 py-2.5 tabular-nums">{money(p.total.issuedAnnualCents)}</td>
              <td className="border-t border-[var(--border-strong)] px-3 py-2.5 tabular-nums">{p.total.submittedAnnualCents > 0 ? `${pct({ n: p.total.issuedAnnualCents, d: p.total.submittedAnnualCents }, 1)}%` : "—"}</td>
              <td className="border-t border-[var(--border-strong)] px-3 py-2.5 tabular-nums">{money(p.total.estimatedFycCents)}</td>
            </tr>
          </tfoot>
        </table>;
  }

  return (
    <div className="m-stagger flex flex-col gap-6">
      <PageHeader
        title="Sales performance"
        description="Where applications stop, and which reason belongs to which carrier."
        actions={<Button type="button" variant="outline" onClick={() => setTab("funnel")} disabled={tab === "funnel"} title={tab === "funnel" ? "The funnel is open" : undefined}>Open the funnel</Button>}
      />
      {sample && <SampleDataNotice />}

      <div role="tablist" aria-label="Sales performance views" className="flex flex-wrap gap-6 border-b border-border">
        {TABS.map((item) => (
          <button key={item.key} id={`sales-tab-${item.key}`} type="button" role="tab" aria-selected={tab === item.key} aria-controls="sales-panel" onClick={() => setTab(item.key)} className={tabClass(tab === item.key)}>{item.label}</button>
        ))}
      </div>

      <StatStrip label="Sales totals">
        <StatTile label="Submitted" value={count(t.submitted)} footnote={windowLabel} />
        <StatTile label="Issued" value={count(t.issued.n)} valueTone={t.issued.n > 0 ? "good" : undefined} footnote={tileRate(t.issued, "submitted")} />
        <StatTile label="Declined" value={count(t.declined.n)} valueTone={t.declined.n > 0 ? "danger" : undefined} footnote={tileRate(t.declined, "submitted")} />
        <StatTile label="Counteroffered" value={count(t.counteroffered.n)} valueTone={t.counteroffered.n > 0 ? "warning" : undefined} footnote={tileRate(t.counteroffered, "submitted")} />
      </StatStrip>

      <div id="sales-panel" role="tabpanel" aria-labelledby={`sales-tab-${tab}`} className="flex flex-col gap-6">
        <TableCard toolbar={toolbar} footer={footer}>{body}</TableCard>
        {!loading && secondary}
      </div>
    </div>
  );
}
