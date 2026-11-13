"use client";

import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { usePathname, useSearchParams } from "next/navigation";
import { Download } from "lucide-react";

import { Button } from "@/components/ui/button";
import { BarList, ChartHeading, LineSeries, type BarListRow } from "@/components/ui/chart";
import { ActiveFilters, DataToolbar, FilterButton, FilterField, FilterPanel, RefreshButton, toolbarControl, type ActiveFilter } from "@/components/ui/data-toolbar";
import { PageHeader } from "@/components/ui/page-header";
import { InfoTip } from "@/components/ui/info-tip";
import { PagedBody, PagedTableCard } from "@/components/ui/paged";
import { EmptyState, SectionLoading } from "@/components/ui/page-states";
import { StatStrip, StatTile } from "@/components/ui/stat";
import { StatusChip } from "@/components/ui/status-chip";
import { TableCard } from "@/components/ui/table-card";
import { useShow } from "@/components/ui/view-switch";
import { ViewTabs } from "@/components/app/book-of-business-views";
import { Callout } from "@/components/app/settings/primitives";
import { PeriodPicker, type Period } from "@/components/app/reports/period-picker";
import { InReportsSlot, useUrlTab } from "@/components/app/reports/reports-slot";
import { keepSharedPeriod } from "@/lib/reports/views";
import { showHref } from "@/lib/reports/show";
import { downloadCsv } from "@/components/app/partner-quality-parts";
import { REQUIREMENT_KIND_LABEL } from "@/lib/applications/constants";
import { reportPeriod } from "@/lib/reports/periodText";
import { buildSalesReport, MIN_CASES, pct, type Median, type Ratio, type ReportFilters, type SalesReport } from "@/lib/applications/reportRules";
import { sampleReportInput } from "@/lib/applications/reportFixtures";
import { useSampleRefresh } from "./applications-list";
import { money } from "./parts";
import { load as loadResource, readResource } from "@/lib/client/resource-cache";

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
const plural = (n: number, one: string, many: string) => `${count(n)} ${n === 1 ? one : many}`;
const hours = (v: number) => `${v} h`;
const days = (v: number) => (v === 1 ? "1 day" : `${v} days`);

/** The report's read for a window and its filters, as the app's cache keys it (lib/client/resource-cache.ts). */
type SalesReportBody = { report?: SalesReport; error?: string } | null;
function salesReportKey(q: ReportFilters) {
  const params = new URLSearchParams({ from: q.from, to: q.to });
  if (q.carrierId) params.set("carrier", q.carrierId);
  if (q.productCode) params.set("product", q.productCode);
  if (q.source) params.set("source", q.source);
  if (q.producerId) params.set("producer", q.producerId);
  return `/api/app/reports/sales?${params}`;
}

/** A rate as one plain figure (round 7, one line a row): its two counts are the tooltip; under MIN_CASES it waits ("—"). */
function rateOf(r: Ratio, digits = 0): string | null {
  if (r.d < MIN_CASES) return null;
  return `${pct(r, digits)}%`;
}
function RateCell({ r, digits = 0 }: { r: Ratio; digits?: number }) {
  const text = rateOf(r, digits);
  return <td className="tabular-nums" title={r.d > 0 ? `${count(r.n)} of ${count(r.d)}` : undefined}>{text ?? <span className="text-muted-foreground">—</span>}</td>;
}
/** A median as one plain figure; under MIN_CASES it waits ("—") and the row's chip says why. */
function MedianCell({ m, unit }: { m: Median; unit: (v: number) => string }) {
  const shown = m.value !== null && m.n >= MIN_CASES;
  return <td className="tabular-nums" title={m.n > 0 ? plural(m.n, "case", "cases") : undefined}>{shown ? unit(m.value as number) : <span className="text-muted-foreground">—</span>}</td>;
}
const small = <StatusChip>Under {MIN_CASES} cases</StatusChip>;
const dash = <span className="text-muted-foreground">—</span>;

function tileRate(r: Ratio, noun: string) {
  return r.d > 0 ? `${pct(r, 1)}% of ${noun}` : `of ${noun}`;
}

type Filters = { carrierId: string; productCode: string; source: string; producerId: string };
const NO_FILTERS: Filters = { carrierId: "", productCode: "", source: "", producerId: "" };
const TAB_KEYS = TABS.map((t) => t.key);
const FILTER_PARAM: Record<keyof Filters, string> = { carrierId: "carrier", productCode: "product", source: "source", producerId: "producer" };

/** Keep or drop parameters in the address in place (no server round trip), so the next link or switch carries them. */
function keepParams(values: Record<string, string>) {
  try {
    const url = new URL(window.location.href);
    for (const [key, value] of Object.entries(values)) { if (value) url.searchParams.set(key, value); else url.searchParams.delete(key); }
    window.history.replaceState(window.history.state, "", `${url.pathname}${url.search}${url.hash}`);
  } catch { /* the view still shows the change */ }
}

/**
 * `framed`: inside the Reports page (components/app/reports/reports-page.tsx), which draws the title;
 * the tabs go to its top row. `periodFromAddress`: the report was read for the Reports views' shared
 * period (`?from&to`), so it opens on those dates; any change of window is kept in the address.
 *
 * Foundation pass (2026-11-03, docs/reports/FOUNDATION-PASS.md): the tab is in the address (`?tab=`) and
 * each figure tile opens its tab; the period is the Reports period control; carrier, product, lead source
 * and producer sit in the Filters panel (UI-CONSISTENCY §6a).
 *
 * Round 7 (owner picks 1·B and 1·A as bars, 2026-11-11, docs/la4/mockups-r7/reports.html §1): the Table · Chart
 * switch (`?show=`, opening on the chart). The chart view draws submitted and issued by week on every tab, then the
 * tab's own bars; every bar, point and key row opens the table view filtered to its rows (`?carrier`, `?reason`,
 * `?requirement`, a week's `?from&to`). The tables are one line a row, one figure a cell, colour only in the chip.
 * The cards stay, each with its figure's line by week.
 */
export function SalesPerformance({ report: initialReport, sample = false, initialTab = "declines", framed = false, initialFilters = NO_FILTERS }: { report: SalesReport; sample?: boolean; timeZone?: string; initialTab?: Tab; framed?: boolean; periodFromAddress?: boolean; initialFilters?: Filters }) {
  const { tab, setTab, href: tabHref } = useUrlTab(TAB_KEYS, initialTab);
  const show = useShow("chart");
  const query = useSearchParams();
  const pathname = usePathname();
  const [report, setReport] = useState(initialReport);
  const [period, setPeriod] = useState<Period>({ from: initialReport.from, to: initialReport.to });
  const [filters, setFilters] = useState<Filters>(initialFilters);
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [allCarriers, setAllCarriers] = useState(false);
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
  async function load(q: ReportFilters, fresh = false) {
    if (sampleInput) { setReport(buildSalesReport(sampleInput, q)); return; }
    const mine = ++seq.current;
    setLoading(true);
    const key = salesReportKey(q);
    try {
      // Through the app's cache (lib/client/resource-cache.ts): a window read a moment ago is not asked again.
      const body = await (fresh ? loadResource<SalesReportBody>(key) : readResource<SalesReportBody>(key));
      if (mine !== seq.current) return;
      if (!body?.report) { setError(body?.error ?? "The report did not load — try again. Showing the last figures."); return; }
      setReport(body.report); setError(null);
    } catch (cause) {
      // An answer from the route (it has a status) keeps its own words; no answer at all is the connection.
      const answered = cause && typeof cause === "object" && "status" in cause;
      if (mine === seq.current) setError(answered ? ((cause as { body?: SalesReportBody | null }).body?.error ?? "The report did not load — try again. Showing the last figures.") : "The report did not load — check your connection. Showing the last figures.");
    } finally {
      if (mine === seq.current) setLoading(false);
    }
  }
  const change = (next: { period?: Period; filters?: Filters }) => {
    const w = next.period ?? period; const fl = next.filters ?? filters;
    if (next.period) setPeriod(next.period);
    if (next.filters) {
      setFilters(next.filters);
      keepParams(Object.fromEntries((Object.keys(FILTER_PARAM) as Array<keyof Filters>).map((k) => [FILTER_PARAM[k], next.filters?.[k] ?? ""])));
    }
    if (framed && next.period) keepSharedPeriod(queryFor(w, fl));
  };
  useEffect(() => {
    if (served.current) { served.current = false; return; }
    void load(queryFor(period, filters));
  }, [period, filters]); // eslint-disable-line react-hooks/exhaustive-deps
  const refresh = () => { if (sample) sampleRefresh.refresh(); void load(queryFor(period, filters), true); };
  const setFilter = (k: keyof Filters, v: string) => change({ filters: { ...filters, [k]: v } });

  // A reason or a requirement narrows its own tab's table (a bar of "Why cases were declined" opens it so).
  const reasonKey = query.get("reason") ?? "";
  const requirementKey = query.get("requirement") ?? "";
  const panelCount = Object.values(filters).filter(Boolean).length;
  const span = `${report.from}-to-${report.to}`;
  const windowLabel = reportPeriod(report.from, report.to);
  const t = report.totals;
  const d = report.declines;
  const co = report.counteroffers;
  const tm = report.timing;
  const p = report.premium;
  const buckets = report.trend.buckets;
  const grain = report.trend.grain;

  /** The table view, filtered: every bar, point and key row opens one of these. */
  const base = `${pathname}?${query.toString()}`;
  const tableHref = (extra: Record<string, string | null>) => showHref(base, "table", { tab, ...extra });
  const carrierHref = (id: string, onTab: Tab = tab) => (id === "none" ? showHref(base, "table", { tab: onTab }) : showHref(base, "table", { tab: onTab, carrier: id }));

  // An empty window says how to widen it: clear the filters when one is on (2026-10-09 copy pass).
  const clearAll = () => { change({ filters: NO_FILTERS }); keepParams({ reason: "", requirement: "" }); };
  const emptyAction = panelCount > 0 ? <Button type="button" variant="outline" onClick={clearAll}>Clear filters</Button> : undefined;
  const optionLabel = (k: keyof Filters, v: string) => k === "carrierId" ? report.options.carriers.find((c) => c.id === v)?.name : k === "productCode" ? report.options.products.find((o) => o.code === v)?.label : k === "source" ? report.options.sources.find((o) => o.value === v)?.label : report.options.producers.find((o) => o.id === v)?.name;
  const FILTER_LABEL: Record<keyof Filters, string> = { carrierId: "Carrier", productCode: "Product", source: "Lead source", producerId: "Producer" };
  const chips: ActiveFilter[] = (Object.keys(filters) as Array<keyof Filters>).filter((k) => filters[k]).map((k) => ({ key: k, label: FILTER_LABEL[k], value: optionLabel(k, filters[k]) ?? filters[k], onRemove: () => setFilter(k, "") }));
  if (reasonKey && tab === "declines") chips.push({ key: "reason", label: "Reason", value: d.rows.find((r) => r.key === reasonKey)?.label ?? reasonKey, onRemove: () => keepParams({ reason: "" }) });
  if (requirementKey && tab === "requirements") chips.push({ key: "requirement", label: "Requirement", value: REQUIREMENT_KIND_LABEL[requirementKey as keyof typeof REQUIREMENT_KIND_LABEL] ?? requirementKey, onRemove: () => keepParams({ requirement: "" }) });
  const emptyHint = panelCount > 0 ? "Clear a filter or widen the dates." : "Try a wider date range.";

  // ── per-tab export ───────────────────────────────────────────────────────
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
      [...tm.rows.map((r) => [r.name, r.quoteToSubmitHours.value, r.quoteToSubmitHours.n, r.submitToIssueDays.value, r.submitToIssueDays.n]), ["All carriers", tm.all.quoteToSubmitHours.value, tm.all.quoteToSubmitHours.n, tm.all.submitToIssueDays.value, tm.all.submitToIssueDays.n]]),
    requirements: () => exportRequirements(),
    declines: () => downloadCsv(`decline-reasons-${span}.csv`, ["Reason", ...declineCarriers.flatMap((c) => [`${c.name} cases`, `${c.name} declines`]), "All cases", "All declines"],
      [...d.rows.map((r) => [r.label, ...declineCarriers.flatMap((c) => [r.byCarrier[c.id] ?? 0, c.total]), r.total, d.total]), ["All declines", ...declineCarriers.flatMap((c) => [c.total, c.total]), d.total, d.total]]),
    counteroffers: () => downloadCsv(`counteroffers-${span}.csv`, ["Carrier", "Submitted", "Counteroffered", "Accepted", "Refused by client", "Expired", "Still waiting", "Top reason"],
      [...co.rows.map((r) => [r.name, r.submitted, r.counteroffered, r.accepted, r.refused, r.expired, r.pending, r.topReason]), ["All carriers", co.total.submitted, co.total.counteroffered, co.total.accepted, co.total.refused, co.total.expired, co.total.pending, null]]),
    premium: () => downloadCsv(`premium-${span}.csv`, ["Carrier", "Submitted annualised (USD)", "Issued annualised (USD)", "Issued applications", "Estimated first-year commission (USD)", "Issued with a commission rate"],
      [...p.rows.map((r) => [r.name, (r.submittedAnnualCents / 100).toFixed(2), (r.issuedAnnualCents / 100).toFixed(2), r.issuedCount, (r.estimatedFycCents / 100).toFixed(2), r.ratedCount]), ["All carriers", (p.total.submittedAnnualCents / 100).toFixed(2), (p.total.issuedAnnualCents / 100).toFixed(2), p.total.issuedCount, (p.total.estimatedFycCents / 100).toFixed(2), p.total.ratedCount]]),
  };
  function exportRequirements() { downloadCsv( `requirement-days-${span}.csv`, ["Requirement", ...tm.rows.flatMap((c) => [`${c.name} median days`, `${c.name} n`]), "All median days", "All n"],
    tm.requirements.map((r) => [REQUIREMENT_KIND_LABEL[r.kind], ...tm.rows.flatMap((c) => [r.byCarrier[c.carrierId]?.value ?? null, r.byCarrier[c.carrierId]?.n ?? 0]), r.all.value, r.all.n])); }

  // The period first, then the one Filters button (UI-CONSISTENCY §6a: carrier, product, lead source and
  // producer open in the panel under the toolbar); Export and Refresh last. The same in both views.
  const toolbar = (
    <DataToolbar actions={<>
        <Button type="button" variant="outline" onClick={exporters[tab]} aria-label={`Export ${TABS.find((x) => x.key === tab)?.label.toLowerCase()} as CSV`} disabled={tab === "requirements" && tm.requirements.length === 0}><Download aria-hidden="true" />Export</Button>
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
            {report.options.products.map((o) => <option key={o.code} value={o.code}>{o.label}</option>)}
          </select></FilterField>
          <FilterField label="Lead source" htmlFor="sales-source"><select id="sales-source" className={toolbarControl} value={filters.source} onChange={(event) => setFilter("source", event.target.value)}>
            <option value="">All lead sources</option>
            {report.options.sources.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
          </select></FilterField>
          <FilterField label="Producer" htmlFor="sales-producerId"><select id="sales-producerId" className={toolbarControl} value={filters.producerId} onChange={(event) => setFilter("producerId", event.target.value)}>
            <option value="">All producers</option>
            {report.options.producers.map((o) => <option key={o.id} value={o.id}>{o.name}</option>)}
          </select></FilterField>
      </FilterPanel>
      <ActiveFilters filters={chips} onClear={clearAll} />
    </>
  );

  // ── shared per-tab facts ─────────────────────────────────────────────────
  const submittedBy = new Map(co.rows.map((r) => [r.carrierId, r.submitted]));
  const carrierName = new Map(tm.rows.map((r) => [r.carrierId, r.name]));
  const reqCarriers = (kind: string) => {
    const r = tm.requirements.find((x) => x.kind === kind);
    return r ? tm.rows.filter((c) => (r.byCarrier[c.carrierId]?.n ?? 0) > 0).map((c) => c.name) : [];
  };
  const declineCarrierNames = (row: (typeof d.rows)[number]) => Object.keys(row.byCarrier).filter((id) => (row.byCarrier[id] ?? 0) > 0).map((id) => (id === "none" ? "No carrier" : declineCarriers.find((c) => c.id === id)?.name ?? carrierName.get(id) ?? "Unknown carrier")).sort();
  const offersEnded = co.total.accepted + co.total.refused + co.total.expired + co.total.pending;
  const shareOf = (n: number, of: number) => (of > 0 ? `${pct({ n, d: of })}%` : "");
  const f = report.funnel;

  // ── the empty states, the same in both views ─────────────────────────────
  const empty: Record<Tab, ReactNode> = {
    funnel: f.quoted === 0 ? <EmptyState title="No quotes in this window" hint={emptyHint} action={emptyAction} /> : null,
    timing: tm.rows.length === 0 ? <EmptyState title="Nothing submitted in this window" hint={emptyHint} action={emptyAction} /> : null,
    requirements: tm.requirements.length === 0 ? <EmptyState title="No requirements in this window" hint={emptyHint} action={emptyAction} /> : null,
    declines: d.total === 0 ? <EmptyState title="No declines in this window" hint={emptyHint} action={emptyAction} /> : null,
    counteroffers: co.total.submitted === 0 ? <EmptyState title="Nothing submitted in this window" hint={emptyHint} action={emptyAction} /> : null,
    premium: p.rows.length === 0 ? <EmptyState title="Nothing submitted in this window" hint={emptyHint} action={emptyAction} /> : null,
  };

  // ── the chart view ───────────────────────────────────────────────────────
  const grainWord = grain === "day" ? "day" : grain === "month" ? "month" : "week";
  const bucketByKey = new Map(buckets.map((b) => [b.key, b]));
  const trendChart = (
    <section aria-label={`Submitted and issued, by ${grainWord}`} className="flex flex-col gap-3">
      <ChartHeading title={`Submitted and issued, by ${grainWord}`} period={`${windowLabel} · each application in the ${grainWord} it was submitted`} />
      {buckets.length >= 2 ? (
        <LineSeries
          points={buckets.map((b) => ({ key: b.key, label: b.label, value: b.submitted }))}
          summary={`Applications submitted and issued, by ${grainWord}, ${windowLabel}.`}
          unit="applications"
          legend={{ label: "Submitted", figure: count(t.submitted), href: tableHref({ tab: "funnel" }) }}
          lines={[{ key: "issued", label: "Issued", tone: "cat2", points: buckets.map((b) => ({ key: b.key, label: b.label, value: b.issued })), figure: count(t.issued.n), href: tableHref({ tab: "premium" }) }]}
          hrefFor={(point) => { const b = bucketByKey.get(point.key); return b ? tableHref({ from: b.from, to: b.to }) : null; }}
        />
      ) : (
        <p className="m-0 text-sm text-muted-foreground">One {grainWord} in this window: {plural(t.submitted, "application", "applications")} submitted, {count(t.issued.n)} issued.</p>
      )}
    </section>
  );

  const chartBlock = (title: string, periodText: string, chart: ReactNode, note?: ReactNode) => (
    <section aria-label={title} className="flex min-w-0 flex-col gap-3">
      <ChartHeading title={title} period={periodText} />
      {chart}
      {note ? <p className="m-0 text-xs text-muted-foreground">{note}</p> : null}
    </section>
  );

  function tabChart(): ReactNode {
    if (tab === "funnel") {
      const rows: BarListRow[] = [
        { key: "quoted", label: "Quoted", value: f.quoted, caption: "insureds" },
        { key: "applied", label: "Applied", value: f.applied.n, caption: rateOf(f.applied) ? `${rateOf(f.applied)} of quoted` : undefined },
        { key: "submitted", label: "Submitted", value: f.submitted.n, caption: rateOf(f.submitted) ? `${rateOf(f.submitted)} of applied` : undefined },
        { key: "issued", label: "Issued", value: f.issued.n, caption: rateOf(f.issued) ? `${rateOf(f.issued)} of submitted` : undefined },
        { key: "placed", label: "Placed", value: 0, figure: "—", chip: <StatusChip>Not recorded yet</StatusChip> },
      ].map((row) => ({ ...row, href: tableHref({ tab: "funnel" }) }));
      return chartBlock("Where applications stop", "Insureds · each counted once, from their first quote", <BarList rows={rows} summary="Insureds at each stage, quoted to issued." unit="insureds" />);
    }
    if (tab === "timing") {
      const issueRows = tm.rows.filter((r) => r.submitToIssueDays.value !== null && r.submitToIssueDays.n >= MIN_CASES).sort((a, b) => (b.submitToIssueDays.value ?? 0) - (a.submitToIssueDays.value ?? 0));
      const quoteRows = tm.rows.filter((r) => r.quoteToSubmitHours.value !== null && r.quoteToSubmitHours.n >= MIN_CASES).sort((a, b) => (b.quoteToSubmitHours.value ?? 0) - (a.quoteToSubmitHours.value ?? 0));
      const left = tm.rows.length - new Set([...issueRows, ...quoteRows].map((r) => r.carrierId)).size;
      const allIssue = tm.all.submitToIssueDays; const allQuote = tm.all.quoteToSubmitHours;
      return (
        <div className="grid min-w-0 gap-6 lg:grid-cols-2">
          {chartBlock("Submit to issue, median days", `Carriers with ${MIN_CASES} issued or more`, issueRows.length
            ? <BarList rows={issueRows.map((r) => ({ key: r.carrierId, label: r.name, value: r.submitToIssueDays.value ?? 0, figure: days(r.submitToIssueDays.value ?? 0), caption: count(r.submitToIssueDays.n), href: carrierHref(r.carrierId) }))} summary="Median days from submit to issue, by carrier." unit="days"
                total={{ label: "All carriers", figure: allIssue.value !== null ? days(allIssue.value) : "—", caption: plural(allIssue.n, "case", "cases") }} />
            : <p className="m-0 text-sm text-muted-foreground">No carrier has {MIN_CASES} issued yet.</p>)}
          {chartBlock("First quote to submit, median hours", `Carriers with ${MIN_CASES} cases or more`, quoteRows.length
            ? <BarList rows={quoteRows.map((r) => ({ key: r.carrierId, label: r.name, value: r.quoteToSubmitHours.value ?? 0, figure: hours(r.quoteToSubmitHours.value ?? 0), caption: count(r.quoteToSubmitHours.n), href: carrierHref(r.carrierId) }))} summary="Median hours from first quote to submit, by carrier." unit="hours"
                total={{ label: "All carriers", figure: allQuote.value !== null ? hours(allQuote.value) : "—", caption: plural(allQuote.n, "case", "cases") }} />
            : <p className="m-0 text-sm text-muted-foreground">No carrier has {MIN_CASES} cases yet.</p>,
            left > 0 ? `${plural(left, "carrier", "carriers")} under ${MIN_CASES} cases ${left === 1 ? "is" : "are"} left off the chart; the table lists ${left === 1 ? "it" : "them"}.` : undefined)}
        </div>
      );
    }
    if (tab === "requirements") {
      const rows: BarListRow[] = [...tm.requirements].sort((a, b) => b.all.n - a.all.n).map((r) => ({
        key: r.kind, label: REQUIREMENT_KIND_LABEL[r.kind], value: r.all.n, figure: plural(r.all.n, "case", "cases"),
        caption: r.all.value !== null && r.all.n >= MIN_CASES ? days(r.all.value) : undefined,
        href: tableHref({ requirement: r.kind }),
      }));
      return chartBlock("Requirements met, by kind", `A median to meet shows from ${MIN_CASES} cases`, <BarList rows={rows} summary="Requirements met in the window, by kind." unit="cases" />);
    }
    if (tab === "declines") {
      const byCarrier = [...declineCarriers].map((c) => ({ key: c.id, label: c.name, value: c.total, caption: submittedBy.has(c.id) ? `of ${count(submittedBy.get(c.id) ?? 0)}` : undefined, href: carrierHref(c.id) }));
      return (
        <div className="grid min-w-0 gap-6 lg:grid-cols-2">
          {chartBlock("Why cases were declined", `${plural(d.total, "decline", "declines")} of ${count(t.submitted)} submitted`,
            <BarList rows={d.rows.map((r) => ({ key: r.key, label: r.label, value: r.total, caption: d.total >= MIN_CASES ? shareOf(r.total, d.total) : undefined, href: tableHref({ reason: r.key }) }))} summary="Declines by reason." unit="declines" />)}
          {chartBlock("Declines by carrier", "Declines, of the carrier’s submitted", <BarList rows={byCarrier} summary="Declines by carrier." unit="declines" />)}
        </div>
      );
    }
    if (tab === "counteroffers") {
      const ended: BarListRow[] = [
        { key: "accepted", label: "Accepted", value: co.total.accepted },
        { key: "refused", label: "Refused", value: co.total.refused },
        { key: "expired", label: "Expired", value: co.total.expired },
        { key: "pending", label: "Still waiting", value: co.total.pending },
      ].map((row) => ({ ...row, caption: shareOf(row.value, offersEnded) || undefined, href: tableHref({ tab: "counteroffers" }) }));
      const byCarrier: BarListRow[] = co.rows.filter((r) => r.counteroffered > 0).map((r) => ({ key: r.carrierId, label: r.name, value: r.counteroffered, caption: `of ${count(r.submitted)}${r.accepted ? ` · ${count(r.accepted)} accepted` : ""}`, href: carrierHref(r.carrierId) }));
      return (
        <div className="grid min-w-0 gap-6 lg:grid-cols-2">
          {chartBlock(`How the ${plural(offersEnded, "counteroffer", "counteroffers")} ended`, `${count(co.total.counteroffered)} of ${count(co.total.submitted)} submitted${co.total.submitted ? ` (${pct({ n: co.total.counteroffered, d: co.total.submitted })}%)` : ""}`,
            offersEnded ? <BarList rows={ended} summary="How the counteroffers ended." unit="counteroffers" /> : <p className="m-0 text-sm text-muted-foreground">No counteroffers in this window.</p>)}
          {chartBlock("Counteroffers by carrier", "Counteroffered, of the carrier’s submitted",
            byCarrier.length ? <BarList rows={byCarrier} summary="Counteroffers by carrier." unit="counteroffers" /> : <p className="m-0 text-sm text-muted-foreground">No carrier counteroffered in this window.</p>)}
        </div>
      );
    }
    const issuedShare = p.total.submittedAnnualCents > 0 ? `${pct({ n: p.total.issuedAnnualCents, d: p.total.submittedAnnualCents }, 1)}% issued` : "";
    return chartBlock("Premium submitted and issued, by carrier", `${money(p.total.issuedAnnualCents)} issued annualised · solid is issued, pale is the rest submitted`,
      <BarList
        rows={p.rows.map((r) => ({ key: r.carrierId, label: r.name, value: r.submittedAnnualCents, inner: r.issuedAnnualCents, figure: money(r.issuedAnnualCents), caption: `of ${money(r.submittedAnnualCents)}`, href: carrierHref(r.carrierId) }))}
        summary="Annualised premium submitted and issued, by carrier." format={(v) => money(v)}
        total={{ label: `All carriers${issuedShare ? ` · ${issuedShare}` : ""}`, figure: money(p.total.issuedAnnualCents), caption: `of ${money(p.total.submittedAnnualCents)}` }}
      />,
      p.total.issuedCount > p.total.ratedCount ? `First-year commission is in the table; it is estimated for ${count(p.total.ratedCount)} of ${count(p.total.issuedCount)} issued, so it is not drawn.` : undefined);
  }

  // ── the table view: one line a row ───────────────────────────────────────
  let table: ReactNode;
  let footer: ReactNode = null;
  let total = 0;
  let noun = "carriers";
  const th = (label: string, extra = "") => <th className={extra}>{label}</th>;
  if (tab === "funnel") {
    footer = <span>{windowLabel} · each insured counted once, from their first quote · a rate’s two counts are its tooltip</span>;
    total = 5; noun = "stages";
    const stage = (label: string, n: number, before: Ratio | null, ofQuoted: Ratio | null) => (
      <tr key={label} className="m-row">
        <td className="font-semibold">{label}</td>
        <td className="tabular-nums">{count(n)}</td>
        {before ? <RateCell r={before} /> : <td>{dash}</td>}
        {ofQuoted ? <RateCell r={ofQuoted} /> : <td>{dash}</td>}
        <td>{before && before.d > 0 && before.d < MIN_CASES ? small : dash}</td>
      </tr>
    );
    table = (
      <table className="portal-lead-table w-full text-left text-sm">
        <thead><tr>{th("Stage")}{th("Insureds")}{th("Of the stage before")}{th("Of quoted")}{th("Status")}</tr></thead>
        <tbody className="m-seq">
          {stage("Quoted", f.quoted, null, null)}
          {stage("Applied", f.applied.n, f.applied, { n: f.applied.n, d: f.quoted })}
          {stage("Submitted", f.submitted.n, f.submitted, { n: f.submitted.n, d: f.quoted })}
          {stage("Issued", f.issued.n, f.issued, { n: f.issued.n, d: f.quoted })}
          <tr className="m-row">
            <td className="font-semibold">Placed</td><td>{dash}</td><td>{dash}</td><td>{dash}</td>
            <td><StatusChip title="The first premium draft result is not recorded anywhere yet. Placed is never inferred from issued.">Not recorded yet</StatusChip></td>
          </tr>
        </tbody>
      </table>
    );
  } else if (tab === "timing") {
    const a = tm.all;
    footer = <span>{windowLabel} · medians{a.quoteToSubmitHours.value !== null && a.submitToIssueDays.value !== null ? ` · ${hours(a.quoteToSubmitHours.value)} and ${days(a.submitToIssueDays.value)} across all carriers` : ""}</span>;
    total = tm.rows.length;
    table = (
      <table className="portal-lead-table w-full text-left text-sm">
        <thead><tr>{th("Carrier")}{th("Cases")}{th("Quote to submit")}{th("Submit to issue")}{th("Status")}</tr></thead>
        <PagedBody className="m-seq">
          {tm.rows.map((r) => (
            <tr key={r.carrierId} className="m-row">
              <td className="font-semibold">{r.name}</td>
              <td className="tabular-nums">{count(submittedBy.get(r.carrierId) ?? r.quoteToSubmitHours.n)}</td>
              <MedianCell m={r.quoteToSubmitHours} unit={hours} />
              <MedianCell m={r.submitToIssueDays} unit={days} />
              <td>{r.quoteToSubmitHours.n < MIN_CASES ? small : r.submitToIssueDays.n < MIN_CASES ? <StatusChip>Under {MIN_CASES} issued</StatusChip> : dash}</td>
            </tr>
          ))}
        </PagedBody>
      </table>
    );
  } else if (tab === "requirements") {
    const list = [...tm.requirements].sort((a, b) => b.all.n - a.all.n).filter((r) => !requirementKey || r.kind === requirementKey);
    footer = <span>{windowLabel} · median days from raised to met, counted once met · the carrier is a filter and the chart</span>;
    total = list.length; noun = "requirements";
    table = (
      <table className="portal-lead-table w-full text-left text-sm">
        <thead><tr>{th("Requirement")}{th("Cases met")}{th("Median to meet")}{th("Carriers")}{th("Status")}</tr></thead>
        <PagedBody className="m-seq">
          {list.map((r) => {
            const names = reqCarriers(r.kind);
            return (
              <tr key={r.kind} className="m-row">
                <td className="font-semibold">{REQUIREMENT_KIND_LABEL[r.kind]}</td>
                <td className="tabular-nums">{count(r.all.n)}</td>
                <MedianCell m={r.all} unit={days} />
                <td className="max-w-[24rem] truncate" title={names.join(" · ")}>{names.length ? names.join(" · ") : dash}</td>
                <td>{r.all.n === 0 ? <StatusChip>None met</StatusChip> : r.all.n < MIN_CASES ? small : dash}</td>
              </tr>
            );
          })}
        </PagedBody>
      </table>
    );
  } else if (tab === "declines") {
    const list = d.rows.filter((r) => !reasonKey || r.key === reasonKey);
    footer = <span>{plural(d.total, "decline", "declines")} of {count(t.submitted)} submitted · {windowLabel} · the carrier is a filter and the chart</span>;
    total = list.length; noun = "reasons";
    table = (
      <table className="portal-lead-table w-full text-left text-sm">
        <thead><tr>{th("Reason")}{th("Declines")}{th("Share")}{th("Carriers")}{th("Status")}</tr></thead>
        <PagedBody className="m-seq">
          {list.map((r) => {
            const names = declineCarrierNames(r);
            return (
              <tr key={r.key} className="m-row">
                <td className="font-semibold">{r.label}</td>
                <td className="tabular-nums">{count(r.total)}</td>
                <RateCell r={{ n: r.total, d: d.total }} />
                <td className="max-w-[24rem] truncate" title={names.join(" · ")}>{names.join(" · ")}</td>
                <td>{d.total < MIN_CASES ? small : dash}</td>
              </tr>
            );
          })}
        </PagedBody>
      </table>
    );
  } else if (tab === "counteroffers") {
    const withOffers = co.rows.filter((r) => r.counteroffered > 0);
    const list = allCarriers ? co.rows : withOffers;
    const hidden = co.rows.length - withOffers.length;
    footer = (
      <>
        <span>{count(co.total.counteroffered)} of {count(co.total.submitted)} counteroffered{co.total.submitted ? ` (${pct({ n: co.total.counteroffered, d: co.total.submitted })}%)` : ""} · {co.total.pending ? `${count(co.total.pending)} still waiting` : "none still waiting"} · {windowLabel}</span>
        {hidden > 0 && <Button type="button" variant="ghost" size="sm" onClick={() => setAllCarriers(!allCarriers)}>{allCarriers ? "Only carriers with counteroffers" : `Show all ${count(co.rows.length)}`}</Button>}
      </>
    );
    total = list.length;
    table = list.length === 0 ? <EmptyState title="No counteroffers in this window" hint="Every application submitted in the window went straight to a decision." action={hidden > 0 ? <Button type="button" variant="outline" onClick={() => setAllCarriers(true)}>Show all {count(co.rows.length)} carriers</Button> : undefined} /> : (
      <table className="portal-lead-table w-full text-left text-sm">
        <thead><tr>{th("Carrier")}{th("Submitted")}{th("Counteroffered")}{th("Accepted")}{th("Refused or expired")}{th("Status")}</tr></thead>
        <PagedBody className="m-seq">
          {list.map((r) => (
            <tr key={r.carrierId} className="m-row">
              <td className="font-semibold">{r.name}</td>
              <td className="tabular-nums">{count(r.submitted)}</td>
              <td className="tabular-nums" title={r.topReason ? `Top reason: ${r.topReason}` : undefined}>{count(r.counteroffered)}</td>
              <td className="tabular-nums">{count(r.accepted)}</td>
              <td className="tabular-nums" title={`${count(r.refused)} refused · ${count(r.expired)} expired`}>{count(r.refused + r.expired)}</td>
              <td>{r.pending > 0 ? <StatusChip tone="warning">{count(r.pending)} waiting</StatusChip> : r.counteroffered > 0 ? <StatusChip>Settled</StatusChip> : dash}</td>
            </tr>
          ))}
        </PagedBody>
      </table>
    );
  } else {
    footer = <span>Annualised · commission estimated from your contract level{p.total.issuedCount > p.total.ratedCount ? ` · ${count(p.total.issuedCount - p.total.ratedCount)} of ${count(p.total.issuedCount)} issued have no rate on file` : ""} · {money(p.total.submittedAnnualCents)} submitted, {money(p.total.issuedAnnualCents)} issued, {money(p.total.estimatedFycCents)} first-year commission</span>;
    total = p.rows.length;
    table = (
      <table className="portal-lead-table w-full text-left text-sm">
        <thead><tr>
          <th><span className="inline-flex items-center gap-1">Carrier<InfoTip label="About premium">The selected quote’s monthly premium, annualised, for each application. First-year commission is estimated.</InfoTip></span></th>
          {th("Submitted")}{th("Issued")}{th("Issued share")}{th("First-year commission")}{th("Status")}
        </tr></thead>
        <PagedBody className="m-seq">
          {p.rows.map((r) => (
            <tr key={r.carrierId} className="m-row">
              <td className="font-semibold">{r.name}</td>
              <td className="tabular-nums">{money(r.submittedAnnualCents)}</td>
              <td className="tabular-nums">{money(r.issuedAnnualCents)}</td>
              <td className="tabular-nums">{r.submittedAnnualCents > 0 ? `${pct({ n: r.issuedAnnualCents, d: r.submittedAnnualCents }, 1)}%` : dash}</td>
              <td className="tabular-nums" title={`${r.ratedCount} of ${r.issuedCount} issued have a commission rate on file`}>{money(r.estimatedFycCents)}</td>
              <td>{r.issuedCount > 0 && r.ratedCount === 0 ? <StatusChip tone="warning">No rate on file</StatusChip> : r.issuedCount > r.ratedCount ? <StatusChip tone="warning">{count(r.issuedCount - r.ratedCount)} without a rate</StatusChip> : dash}</td>
            </tr>
          ))}
        </PagedBody>
      </table>
    );
  }

  const tabEmpty = empty[tab];
  const view = show === "table"
    ? <PagedTableCard key={`table-${tab}`} total={total} noun={noun} toolbar={toolbar} filters={filterPanel} footer={tabEmpty || loading ? null : footer}>
        {loading ? <SectionLoading rows={6} columns={5} label="Loading the report" /> : tabEmpty ?? table}
      </PagedTableCard>
    : <TableCard key={`chart-${tab}`} toolbar={toolbar} filters={filterPanel}>
        {loading ? <SectionLoading rows={6} columns={4} label="Loading the report" /> : (
          <div className="flex min-w-0 flex-col gap-8 p-4">
            {trendChart}
            {tabEmpty ?? tabChart()}
          </div>
        )}
      </TableCard>;

  const trendOf = (pick: (b: (typeof buckets)[number]) => number) => (buckets.length >= 2 ? { points: buckets.map(pick), tone: "primary" as const, placement: "under" as const } : undefined);

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
        <ViewTabs label="Sales performance views" tabs={TABS.map((item) => ({ key: item.key, label: item.label, count: item.key === "declines" ? d.total || null : item.key === "counteroffers" ? co.total.counteroffered || null : null }))} active={tab} onChange={setTab} controls="sales-panel" />
      </InReportsSlot>
      {error && <Callout tone="error" title="The report did not reload">{error}</Callout>}

      {/* Each tile opens the tab its figure is read from (owner 2026-11-02: the tiles are the links); round 7 (0·C):
          each carries its figure by week, plain, and a problem says so in one chip. */}
      <StatStrip label="Sales totals">
        <StatTile label="Submitted" value={count(t.submitted)} footnote={windowLabel} href={tabHref("funnel")} trend={trendOf((b) => b.submitted)} />
        <StatTile label="Issued" value={count(t.issued.n)} footnote={tileRate(t.issued, "submitted")} href={tabHref("premium")} trend={trendOf((b) => b.issued)} />
        <StatTile label="Declined" value={count(t.declined.n)} footnote={tileRate(t.declined, "submitted")} href={tabHref("declines")} trend={trendOf((b) => b.declined)} />
        <StatTile label="Counteroffered" value={count(t.counteroffered.n)} footnote={co.total.pending > 0 ? <StatusChip tone="warning">{count(co.total.pending)} still waiting</StatusChip> : tileRate(t.counteroffered, "submitted")} href={tabHref("counteroffers")} trend={trendOf((b) => b.counteroffered)} />
      </StatStrip>

      <div id="sales-panel" role="tabpanel" aria-labelledby={`sales-panel-tab-${tab}`} className="flex flex-col gap-6">
        {view}
      </div>
    </div>
  );
}
