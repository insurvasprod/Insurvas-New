"use client";

import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { Download } from "lucide-react";

import { Button } from "@/components/ui/button";
import { ActiveFilters, DataToolbar, FilterButton, FilterField, FilterPanel, RefreshButton, toolbarControl, type ActiveFilter } from "@/components/ui/data-toolbar";
import { PageHeader } from "@/components/ui/page-header";
import { InfoTip } from "@/components/ui/info-tip";
import { PagedBody, PagedTableCard } from "@/components/ui/paged";
import { EmptyState, SectionLoading } from "@/components/ui/page-states";
import { StatStrip, StatTile } from "@/components/ui/stat";
import { StatusChip } from "@/components/ui/status-chip";
import { ViewTabs } from "@/components/app/book-of-business-views";
import { Callout } from "@/components/app/settings/primitives";
import { PeriodPicker, type Period } from "@/components/app/reports/period-picker";
import { InReportsSlot, useUrlTab } from "@/components/app/reports/reports-slot";
import { keepSharedPeriod } from "@/lib/reports/views";
import { downloadCsv } from "@/components/app/partner-quality-parts";
import { REQUIREMENT_KIND_LABEL } from "@/lib/applications/constants";
import { reportPeriod } from "@/lib/reports/periodText";
import { buildSalesReport, crossCell, MIN_CASES, pct, type Median, type Ratio, type ReportFilters, type SalesReport } from "@/lib/applications/reportRules";
import { sampleReportInput } from "@/lib/applications/reportFixtures";
import { cn } from "@/lib/utils";
import { useSampleRefresh } from "./applications-list";
import { money } from "./parts";

const TABS = [
  { key: "funnel", label: "Funnel and rates" },
  { key: "timing", label: "Timing" },
  // Its own tab (foundation pass 2026-11-03): it was a second table stacked under Timing.
  { key: "requirements", label: "Requirements" },
  { key: "declines", label: "Decline reasons" },
  { key: "counteroffers", label: "Counteroffers" },
  { key: "premium", label: "Premium and commission" },
] as const;
type Tab = (typeof TABS)[number]["key"];

const count = (n: number) => n.toLocaleString("en-US");

/** "63.5% (198/312)" — the rate and the two numbers it comes from, every time; under MIN_CASES, "4 of 26" greyed. */
function RateCell({ r, digits = 0 }: { r: Ratio; digits?: number }) {
  if (r.d <= 0 || r.n === 0 && r.d < MIN_CASES) return <span className="text-muted-foreground">—</span>;
  if (r.n < MIN_CASES) return <span className="tabular-nums text-muted-foreground" title={`Fewer than ${MIN_CASES} cases, too few for a rate`}>{count(r.n)} of {count(r.d)}</span>;
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
  return <span className={cn("tabular-nums", small && "text-muted-foreground")} title={small ? `Fewer than ${MIN_CASES} cases, too few to rely on` : undefined}>{small ? `${m.n} ${m.n === 1 ? "case" : "cases"}` : <>{m.value} {unit} <span className="text-muted-foreground">({m.n} cases)</span></>}</span>;
}

function tileRate(r: Ratio, noun: string) {
  return r.d > 0 ? `${pct(r, 1)}% of ${noun} · ${count(r.n)}/${count(r.d)}` : `of ${noun}`;
}

type Filters = { carrierId: string; productCode: string; source: string; producerId: string };
const NO_FILTERS: Filters = { carrierId: "", productCode: "", source: "", producerId: "" };
const TAB_KEYS = TABS.map((t) => t.key);

/**
 * `framed`: inside the Reports page (components/app/reports/reports-page.tsx), which draws the title;
 * the tabs go to its top row. `periodFromAddress`: the report was read for the Reports views' shared
 * period (`?from&to`), so it opens on those dates; any change of window is kept in the address.
 *
 * Foundation pass (2026-11-03, docs/reports/FOUNDATION-PASS.md): the tab is in the address (`?tab=`) and
 * each figure tile opens its tab; the period is the Reports period control; carrier, product, lead source
 * and producer sit in the Filters panel (UI-CONSISTENCY §6a); a failed reload goes to the bell.
 */
export function SalesPerformance({ report: initialReport, sample = false, initialTab = "declines", framed = false }: { report: SalesReport; sample?: boolean; timeZone?: string; initialTab?: Tab; framed?: boolean; periodFromAddress?: boolean }) {
  const { tab, setTab, href: tabHref } = useUrlTab(TAB_KEYS, initialTab);
  const [report, setReport] = useState(initialReport);
  const [period, setPeriod] = useState<Period>({ from: initialReport.from, to: initialReport.to });
  const [filters, setFilters] = useState<Filters>(NO_FILTERS);
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [now] = useState(() => Date.now());
  const sampleRefresh = useSampleRefresh();
  const sampleInput = useMemo(() => (sample ? sampleReportInput(now) : null), [sample, now]);
  const seq = useRef(0);
  // The first window is the server's; a later period or filter recounts (an effect, so a filter chip's
  // remove handler only sets state).
  const served = useRef(true);

  const queryFor = (w: Period, fl: Filters): ReportFilters => ({ from: w.from, to: w.to, carrierId: fl.carrierId || null, productCode: fl.productCode || null, source: fl.source || null, producerId: fl.producerId || null });

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
      if (!r.ok || !body?.report) { setError(body?.error ?? "The report did not load — try again. Showing the last figures."); return; }
      setReport(body.report); setError(null);
    } catch {
      if (mine === seq.current) setError("The report did not load — check your connection. Showing the last figures.");
    } finally {
      if (mine === seq.current) setLoading(false);
    }
  }
  const change = (next: { period?: Period; filters?: Filters }) => {
    const w = next.period ?? period; const fl = next.filters ?? filters;
    if (next.period) setPeriod(next.period);
    if (next.filters) setFilters(next.filters);
    if (framed && next.period) keepSharedPeriod(queryFor(w, fl));
  };
  useEffect(() => {
    if (served.current) { served.current = false; return; }
    void load(queryFor(period, filters));
  }, [period, filters]); // eslint-disable-line react-hooks/exhaustive-deps
  const refresh = () => { if (sample) sampleRefresh.refresh(); void load(queryFor(period, filters)); };
  const panelCount = Object.values(filters).filter(Boolean).length;
  const setFilter = (k: keyof Filters, v: string) => change({ filters: { ...filters, [k]: v } });
  const span = `${report.from}-to-${report.to}`;
  const windowLabel = reportPeriod(report.from, report.to);
  const t = report.totals;
  // An empty window says how to widen it: clear the filters when one is on (2026-10-09 copy pass).
  const emptyAction = panelCount > 0 ? <Button type="button" variant="outline" onClick={() => change({ filters: NO_FILTERS })}>Clear filters</Button> : undefined;
  const optionLabel = (k: keyof Filters, v: string) => k === "carrierId" ? report.options.carriers.find((c) => c.id === v)?.name : k === "productCode" ? report.options.products.find((p) => p.code === v)?.label : k === "source" ? report.options.sources.find((o) => o.value === v)?.label : report.options.producers.find((p) => p.id === v)?.name;
  const FILTER_LABEL: Record<keyof Filters, string> = { carrierId: "Carrier", productCode: "Product", source: "Lead source", producerId: "Producer" };
  const chips: ActiveFilter[] = (Object.keys(filters) as Array<keyof Filters>).filter((k) => filters[k]).map((k) => ({ key: k, label: FILTER_LABEL[k], value: optionLabel(k, filters[k]) ?? filters[k], onRemove: () => setFilter(k, "") }));
  const emptyHint = panelCount > 0 ? "Clear a filter or widen the dates." : "Try a wider date range.";

  // ── per-tab table and export ─────────────────────────────────────────────
  const d = report.declines;
  const declineCarriers = d.carriers;
  const exporters: Record<Tab, () => void> = {
    funnel: () => downloadCsv(`sales-funnel-${span}.csv`, ["Stage", "Insureds", "Of previous stage", "Previous stage", "Of quoted", "Quoted", "Note"], [
      ["Quoted", report.funnel.quoted, null, null, null, null, ""],
      ["Applied", report.funnel.applied.n, pct(report.funnel.applied), report.funnel.applied.d, pct(report.funnel.applied), report.funnel.quoted, ""],
      ["Submitted", report.funnel.submitted.n, pct(report.funnel.submitted), report.funnel.submitted.d, pct({ n: report.funnel.submitted.n, d: report.funnel.quoted }), report.funnel.quoted, ""],
      ["Issued", report.funnel.issued.n, pct(report.funnel.issued), report.funnel.issued.d, pct({ n: report.funnel.issued.n, d: report.funnel.quoted }), report.funnel.quoted, ""],
      ["Placed", null, null, null, null, null, "Partial — not recorded yet"],
    ]),
    timing: () => downloadCsv(`timing-${span}.csv`, ["Carrier", "Median hours first quote to submit", "n", "Median days submit to issue", "n"],
      [...report.timing.rows.map((r) => [r.name, r.quoteToSubmitHours.value, r.quoteToSubmitHours.n, r.submitToIssueDays.value, r.submitToIssueDays.n]), ["All carriers", report.timing.all.quoteToSubmitHours.value, report.timing.all.quoteToSubmitHours.n, report.timing.all.submitToIssueDays.value, report.timing.all.submitToIssueDays.n]]),
    requirements: () => exportRequirements(),
    declines: () => downloadCsv(`decline-reasons-${span}.csv`, ["Reason", ...declineCarriers.flatMap((c) => [`${c.name} cases`, `${c.name} declines`]), "All cases", "All declines"],
      [...d.rows.map((r) => [r.label, ...declineCarriers.flatMap((c) => [r.byCarrier[c.id] ?? 0, c.total]), r.total, d.total]), ["All declines", ...declineCarriers.flatMap((c) => [c.total, c.total]), d.total, d.total]]),
    counteroffers: () => downloadCsv(`counteroffers-${span}.csv`, ["Carrier", "Submitted", "Counteroffered", "Accepted", "Refused by client", "Expired", "Still waiting", "Top reason"],
      [...report.counteroffers.rows.map((r) => [r.name, r.submitted, r.counteroffered, r.accepted, r.refused, r.expired, r.pending, r.topReason]), ["All carriers", report.counteroffers.total.submitted, report.counteroffers.total.counteroffered, report.counteroffers.total.accepted, report.counteroffers.total.refused, report.counteroffers.total.expired, report.counteroffers.total.pending, null]]),
    premium: () => downloadCsv(`premium-${span}.csv`, ["Carrier", "Submitted annualised (USD)", "Issued annualised (USD)", "Issued applications", "Estimated first-year commission (USD)", "Issued with a commission rate"],
      [...report.premium.rows.map((r) => [r.name, (r.submittedAnnualCents / 100).toFixed(2), (r.issuedAnnualCents / 100).toFixed(2), r.issuedCount, (r.estimatedFycCents / 100).toFixed(2), r.ratedCount]), ["All carriers", (report.premium.total.submittedAnnualCents / 100).toFixed(2), (report.premium.total.issuedAnnualCents / 100).toFixed(2), report.premium.total.issuedCount, (report.premium.total.estimatedFycCents / 100).toFixed(2), report.premium.total.ratedCount]]),
  };
  function exportRequirements() { downloadCsv( `requirement-days-${span}.csv`, ["Requirement", ...report.timing.rows.flatMap((c) => [`${c.name} median days`, `${c.name} n`]), "All median days", "All n"],
    report.timing.requirements.map((r) => [REQUIREMENT_KIND_LABEL[r.kind], ...report.timing.rows.flatMap((c) => [r.byCarrier[c.carrierId]?.value ?? null, r.byCarrier[c.carrierId]?.n ?? 0]), r.all.value, r.all.n])); }

  // The period first, then the one Filters button (UI-CONSISTENCY §6a: carrier, product, lead source and
  // producer open in the panel under the toolbar); Export and Refresh last.
  const toolbar = (
    <DataToolbar actions={<>
        <Button type="button" variant="outline" onClick={exporters[tab]} aria-label={`Export ${TABS.find((x) => x.key === tab)?.label.toLowerCase()} as CSV`} disabled={tab === "requirements" && report.timing.requirements.length === 0}><Download aria-hidden="true" />Export</Button>
        <RefreshButton onClick={refresh} refreshing={loading || sampleRefresh.refreshing} />
      </>}>
        <PeriodPicker value={period} onChange={(next) => change({ period: next })} />
        <FilterButton open={filtersOpen} count={panelCount} controls="sales-filters" onClick={() => setFiltersOpen(!filtersOpen)} />
    </DataToolbar>
  );
  const filterPanel = (
    <>
      <FilterPanel id="sales-filters" open={filtersOpen}>
          <FilterField label="Carrier" htmlFor="sales-carrierId"><select id="sales-carrierId" className={toolbarControl} value={filters.carrierId} onChange={(event) => setFilter("carrierId", event.target.value)}>
            <option value="">All carriers</option>
            {report.options.carriers.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
          </select></FilterField>
          <FilterField label="Product" htmlFor="sales-productCode"><select id="sales-productCode" className={toolbarControl} value={filters.productCode} onChange={(event) => setFilter("productCode", event.target.value)}>
            <option value="">All products</option>
            {report.options.products.map((p) => <option key={p.code} value={p.code}>{p.label}</option>)}
          </select></FilterField>
          <FilterField label="Lead source" htmlFor="sales-source"><select id="sales-source" className={toolbarControl} value={filters.source} onChange={(event) => setFilter("source", event.target.value)}>
            <option value="">All lead sources</option>
            {report.options.sources.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
          </select></FilterField>
          <FilterField label="Producer" htmlFor="sales-producerId"><select id="sales-producerId" className={toolbarControl} value={filters.producerId} onChange={(event) => setFilter("producerId", event.target.value)}>
            <option value="">All producers</option>
            {report.options.producers.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
          </select></FilterField>
      </FilterPanel>
      <ActiveFilters filters={chips} onClear={() => change({ filters: NO_FILTERS })} />
    </>
  );

  let body: ReactNode;
  let footer: ReactNode = null;
  let suffix: ReactNode = null;
  let total = 0;
  let noun = "carriers";
  if (loading) body = <SectionLoading rows={6} columns={5} label="Loading the report" />;
  else if (tab === "funnel") {
    const f = report.funnel;
    footer = <span>{windowLabel} · each insured counted once, from their first quote</span>;
    body = f.quoted === 0
      ? <EmptyState title="No quotes in this window" hint={emptyHint} action={emptyAction} />
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
    suffix = <>{windowLabel} · medians · under {MIN_CASES} cases shows the count in grey</>;
    footer = <span>{suffix}</span>;
    total = tm.rows.length;
    body = tm.rows.length === 0
      ? <EmptyState title="Nothing submitted in this window" hint={emptyHint} action={emptyAction} />
      : <table className="portal-lead-table w-full min-w-[640px] text-left text-sm">
          <thead><tr><th>Carrier</th><th className="w-[240px]">First quote → submit</th><th className="w-[240px]">Submit → issue</th></tr></thead>
          <PagedBody className="m-seq">
            {tm.rows.map((r) => <tr key={r.carrierId} className="m-row"><td>{r.name}</td><td><MedianCell m={r.quoteToSubmitHours} unit="h" /></td><td><MedianCell m={r.submitToIssueDays} unit="days" /></td></tr>)}
          </PagedBody>
          <tfoot><tr className="bg-[var(--surface-alt)] font-semibold text-foreground"><td className="border-t border-[var(--border-strong)] px-3 py-2.5">All carriers</td><td className="border-t border-[var(--border-strong)] px-3 py-2.5"><MedianCell m={tm.all.quoteToSubmitHours} unit="h" /></td><td className="border-t border-[var(--border-strong)] px-3 py-2.5"><MedianCell m={tm.all.submitToIssueDays} unit="days" /></td></tr></tfoot>
        </table>;
  } else if (tab === "requirements") {
    const tm = report.timing;
    // Only the carriers with a met requirement in the window: an empty column per carrier pushed the grid past the card.
    const reqCarriers = tm.rows.filter((c) => tm.requirements.some((r) => (r.byCarrier[c.carrierId]?.n ?? 0) > 0));
    footer = <span>{windowLabel} · median days from raised to met, counted once met · under {MIN_CASES} cases shows the count in grey</span>;
    total = tm.requirements.length;
    noun = "requirements";
    body = tm.requirements.length === 0
      ? <EmptyState title="No met requirements in this window" hint={emptyHint} action={emptyAction} />
      : <table className="portal-lead-table w-full min-w-[640px] text-left text-sm">
          <thead><tr><th>Requirement</th>{reqCarriers.map((c) => <th key={c.carrierId}>{c.name}</th>)}<th>All</th></tr></thead>
          <PagedBody className="m-seq">
            {tm.requirements.map((r) => <tr key={r.kind} className="m-row"><td>{REQUIREMENT_KIND_LABEL[r.kind]}</td>{reqCarriers.map((c) => <td key={c.carrierId}><MedianCell m={r.byCarrier[c.carrierId] ?? { value: null, n: 0 }} unit="days" /></td>)}<td><MedianCell m={r.all} unit="days" /></td></tr>)}
          </PagedBody>
        </table>;
  } else if (tab === "declines") {
    suffix = <>{windowLabel} · each figure is that reason’s share of the carrier’s declines</>;
    footer = <span>{suffix}</span>;
    total = d.rows.length;
    noun = "reasons";
    body = d.total === 0
      ? <EmptyState title="No declines in this window" hint={emptyHint} action={emptyAction} />
      : <table className="portal-lead-table w-full min-w-[860px] text-left text-sm">
          <thead><tr><th>Reason</th>{declineCarriers.map((c) => <th key={c.id} className="w-[150px]">{c.name}</th>)}<th className="w-[128px]">All</th></tr></thead>
          <PagedBody className="m-seq">
            {d.rows.map((r) => (
              <tr key={r.key} className="m-row">
                <td>{r.label}</td>
                {declineCarriers.map((c) => <td key={c.id}><Cross n={r.byCarrier[c.id] ?? 0} d={c.total} /></td>)}
                <td><Cross n={r.total} d={d.total} /></td>
              </tr>
            ))}
          </PagedBody>
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
    suffix = <>{windowLabel} · applications submitted in the window</>;
    footer = <span>{suffix}</span>;
    total = co.rows.length;
    body = co.total.submitted === 0
      ? <EmptyState title="Nothing submitted in this window" hint={emptyHint} action={emptyAction} />
      : <table className="portal-lead-table w-full min-w-[980px] text-left text-sm">
          <thead><tr><th>Carrier</th><th className="w-[110px]">Submitted</th><th className="w-[170px]">Counteroffered</th><th className="w-[100px]">Accepted</th><th className="w-[100px]">Refused</th><th className="w-[100px]">Expired</th><th className="w-[110px]">Still waiting</th><th>Top reason</th></tr></thead>
          <PagedBody className="m-seq">
            {co.rows.map((r) => (
              <tr key={r.carrierId} className="m-row">
                <td>{r.name}</td><td className="tabular-nums">{count(r.submitted)}</td><td><RateCell r={{ n: r.counteroffered, d: r.submitted }} /></td>
                <td className="tabular-nums">{count(r.accepted)}</td><td className="tabular-nums">{count(r.refused)}</td><td className="tabular-nums">{count(r.expired)}</td><td className="tabular-nums">{count(r.pending)}</td>
                <td>{r.topReason ?? <span className="text-muted-foreground">—</span>}</td>
              </tr>
            ))}
          </PagedBody>
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
    suffix = <>{windowLabel} · annualised · commission estimated from your contract level{p.total.issuedCount > p.total.ratedCount ? ` · ${p.total.issuedCount - p.total.ratedCount} of ${p.total.issuedCount} issued have no rate on file` : ""}</>;
    footer = <span>{suffix}</span>;
    total = p.rows.length;
    body = p.rows.length === 0
      ? <EmptyState title="Nothing submitted in this window" hint={emptyHint} action={emptyAction} />
      : <table className="portal-lead-table w-full min-w-[860px] text-left text-sm">
          <thead><tr><th>Carrier</th><th className="w-[170px]"><span className="inline-flex items-center gap-1">Submitted<InfoTip label="About premium">The selected quote’s monthly premium, annualised, for each application.</InfoTip></span></th><th className="w-[170px]">Issued</th><th className="w-[150px]">Issued share</th><th className="w-[220px]"><span className="block">First-year commission</span><span className="block text-xs font-normal normal-case tracking-normal">Estimated</span></th></tr></thead>
          <PagedBody className="m-seq">
            {p.rows.map((r) => (
              <tr key={r.carrierId} className="m-row">
                <td>{r.name}</td><td className="tabular-nums">{money(r.submittedAnnualCents)}</td><td className="tabular-nums">{money(r.issuedAnnualCents)}</td>
                <td className="tabular-nums">{r.submittedAnnualCents > 0 ? `${pct({ n: r.issuedAnnualCents, d: r.submittedAnnualCents }, 1)}%` : "—"}</td>
                <td className="tabular-nums" title={`${r.ratedCount} of ${r.issuedCount} issued have a commission rate on file`}>{money(r.estimatedFycCents)}</td>
              </tr>
            ))}
          </PagedBody>
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
      {!framed && (
        <PageHeader
          title="Sales performance"
          description="Where applications stop, by carrier and reason."
        />
      )}

      {/* The views on the title line (UI-CONSISTENCY §8a). ("Open the funnel" is gone, 2026-10-30: the Funnel tab opens it.) */}
      <InReportsSlot framed={framed} slot="lead">
        <ViewTabs label="Sales performance views" tabs={TABS.map((item) => ({ key: item.key, label: item.label }))} active={tab} onChange={setTab} controls="sales-panel" />
      </InReportsSlot>
      {sample && <Callout tone="info" title="Sample data">This screen is a design preview and nothing on it is saved.</Callout>}
      {error && <Callout tone="error" title="The report did not reload">{error}</Callout>}

      {/* Each tile opens the tab its figure is read from (owner 2026-11-02: the tiles are the links). */}
      <StatStrip label="Sales totals">
        <StatTile label="Submitted" value={count(t.submitted)} footnote={windowLabel} href={tabHref("funnel")} />
        <StatTile label="Issued" value={count(t.issued.n)} valueTone={t.issued.n > 0 ? "good" : undefined} footnote={tileRate(t.issued, "submitted")} href={tabHref("premium")} />
        <StatTile label="Declined" value={count(t.declined.n)} valueTone={t.declined.n > 0 ? "danger" : undefined} footnote={tileRate(t.declined, "submitted")} href={tabHref("declines")} />
        <StatTile label="Counteroffered" value={count(t.counteroffered.n)} valueTone={t.counteroffered.n > 0 ? "warning" : undefined} footnote={tileRate(t.counteroffered, "submitted")} href={tabHref("counteroffers")} />
      </StatStrip>

      <div id="sales-panel" role="tabpanel" aria-labelledby={`sales-panel-tab-${tab}`} className="flex flex-col gap-6">
        <PagedTableCard key={tab} total={total} noun={noun} suffix={suffix} toolbar={toolbar} filters={filterPanel} footer={footer}>{body}</PagedTableCard>
      </div>
    </div>
  );
}
