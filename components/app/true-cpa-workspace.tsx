"use client";

import { Fragment, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import Link from "next/link";
import { usePathname, useSearchParams } from "next/navigation";
import { Download } from "lucide-react";
import { Button } from "@/components/ui/button";
import { ActiveFilters, DataToolbar, FilterButton, FilterField, FilterPanel, RefreshButton, ToolbarSearch, toolbarControl, type ActiveFilter } from "@/components/ui/data-toolbar";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { checkboxControl } from "@/components/ui/field";
import { ViewTabs } from "@/components/ui/view-tabs";
import { PageHeader } from "@/components/ui/page-header";
import { PageLoading } from "@/components/ui/page-loading";
import { FramedLoading } from "@/components/app/reports/reports-slot";
import { Pager } from "@/components/ui/pager";
import { EmptyState, ErrorState, NoMatches, SectionLoading } from "@/components/ui/page-states";
import { StatStrip, StatTile } from "@/components/ui/stat";
import { StatusChip } from "@/components/ui/status-chip";
import { TableCard } from "@/components/ui/table-card";
import { ToggleChip } from "@/components/ui/toggle-chip";
import { BarList, BarSeries, ChartHeading, ChartLegend, LineSeries, type BarListRow } from "@/components/ui/chart";
import { useShow } from "@/components/ui/view-switch";
import { setParamsInPlace } from "@/components/ui/nav-pending";
import { useFittingPageSize } from "@/components/ui/use-fitting-page-size";
import type { ScorecardStage, VendorScorecardReport, VendorScorecardRow, VendorScorecardVendorRow } from "@/lib/vendorScorecard/types";
import { CampaignComparisonWorkspace } from "./campaign-comparison-workspace";
import { PeriodPicker } from "@/components/app/reports/period-picker";
import { InReportsSlot, useUrlTab } from "@/components/app/reports/reports-slot";
import { trueCpaLeadsHref, type DrillSpec } from "@/lib/reports/trueCpaLeads";
import { reportPeriod } from "@/lib/reports/periodText";
import { keepSharedPeriod } from "@/lib/reports/views";
import { showHref } from "@/lib/reports/show";
import { bySlotOrder, cumulativeCpa, grainFromParams, reportScopeQuery, scopeFromParams, scopeParams, scopeQuery, slotLabel, slotShort, STAGE_TITLE, TRUE_CPA_PERSIST_DAYS, type TrueCpaGrain, type TrueCpaScope, type TrueCpaSeries } from "@/lib/reports/trueCpaView";
import { load as loadResource, readResource } from "@/lib/client/resource-cache";
import { notify } from "@/lib/notify";

/** The report's read, as the app's cache keys it (lib/client/resource-cache.ts). */
const trueCpaKey = (query: string) => `/api/app/true-cpa?${query}`;
/** The cards' small charts: the same report a week at a time (lib/vendorScorecard/series.ts). */
const seriesKey = (query: string) => `/api/app/true-cpa/series?${query}`;
const SPEED_KEY = "/api/app/campaigns/speed-to-lead";

/**
 * One view at a time (2026-10-26; foundation pass 2026-11-03). `?tab=` opens one; the old `dropoff` opens the funnel.
 */
const VIEWS = ["scorecard", "funnel", "contact", "speed", "consent", "compare"] as const;
type View = (typeof VIEWS)[number];
const PERSIST_DAYS = TRUE_CPA_PERSIST_DAYS;

/** 90 days ending today, the default period (the SQL applies the same one when sent no dates). */
function defaultFrom() { const d = new Date(); d.setDate(d.getDate() - 89); return d.toISOString().slice(0, 10); }
function today() { return new Date().toISOString().slice(0, 10); }
function dollars(cents: number | null | undefined) { return cents == null ? "—" : new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 2, minimumFractionDigits: 2 }).format(cents / 100); }
const usd = (value: number) => new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 2, minimumFractionDigits: 2 }).format(value);
function number(value: number | null | undefined) { return value == null ? "—" : value.toLocaleString(); }
/** One decimal everywhere (QA 2026-11-03): the RPC's raw values mixed "68.75%", "20%" and "4.78%" on one card. */
function percent(value: number | null | undefined) { return value == null ? "—" : `${Number(value).toFixed(1)}%`; }
/** "4:12" for a median in seconds. */
function clock(seconds: number | null | undefined) { if (seconds == null) return "—"; const s = Math.round(seconds); return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`; }
function plural(count: number, one: string, many = `${one}s`) { return `${count.toLocaleString()} ${count === 1 ? one : many}`; }
/** "6.3% of leads", computed rather than typed. */
function share(part: number | null | undefined, whole: number | null | undefined, suffix: string) {
  if (part == null || whole == null || whole === 0) return undefined;
  return `${((part / whole) * 100).toFixed(1)}% ${suffix}`;
}

/** One table line, whether it is a campaign or a vendor roll-up. */
type Line = {
  key: string;
  label: string;
  vendorId: string;
  campaignId: string | null;
  leads: number;
  dialable: number;
  contacted: number;
  contact: number | null;
  costPerContact: number | null;
  undialableRate: number | null;
  claimAcceptance: number | null;
  apps: number;
  issued: number;
  netSpend: number | null;
  costPerApp: number | null;
  cpi: number | null;
  isTest: boolean;
  small: boolean;
  rank: number | null;
};

function line(row: VendorScorecardRow | VendorScorecardVendorRow, campaign: VendorScorecardRow | null): Line {
  return {
    key: campaign ? campaign.campaign_id : row.vendor_id,
    label: campaign ? `${campaign.vendor_name} · ${campaign.campaign_name}` : row.vendor_name,
    vendorId: row.vendor_id,
    campaignId: campaign?.campaign_id ?? null,
    leads: row.leads_received, dialable: row.dialable_leads, contacted: row.contacted_leads, contact: row.contact_rate_percent,
    costPerContact: row.effective_cost_per_contact_cents, undialableRate: row.undialable_rate_percent, claimAcceptance: row.claim_acceptance_rate_percent,
    apps: row.applications, issued: row.issued_policies, netSpend: row.net_spend_cents, costPerApp: row.effective_cost_per_application_cents,
    cpi: row.effective_cost_per_issued_policy_cents, isTest: row.is_test_batch, small: row.small_sample, rank: row.cost_rank,
  };
}

/** Cheapest policy first: ranked lines by rank, then lines with no policy yet (highest spend first), then test batches. */
function sortLines(lines: Line[]) {
  const spend = (a: Line, b: Line) => (b.netSpend ?? -1) - (a.netSpend ?? -1);
  const group = (item: Line) => (item.isTest ? 2 : item.rank == null ? 1 : 0);
  return [...lines].sort((a, b) => group(a) - group(b) || (a.rank ?? 0) - (b.rank ?? 0) || spend(a, b) || a.label.localeCompare(b.label));
}

/** Said on the two quality columns (LA-2.19 decision 11), as their tooltip. */
const METRICS_APART = "Undialable rate and claim acceptance answer different questions and are never combined into one score.";

type CampaignSpeed = { campaignId: string; campaignName: string; vendorId: string; postedLeads: number; dialledLeads: number; medianSeconds: number | null; dialledWithin60s: number; dialledWithin60sPct: number | null };

/**
 * True CPA (Reports round 7, owner pick 7·A on every tab, 2026-11-11): what each vendor and campaign costs
 * through an issued policy.
 *
 * The title line carries the six tabs, the Table · Chart switch (ReportsPage `show`, opening on the chart), the
 * period and Export. Five cards over the view, each with a small chart of its own figure by week. Every tab has
 * a chart view drawn from the kit (components/ui/chart.tsx) and a table view, one line a row. The scope (period
 * and filters) is in the address, so a bar opens the table filtered to its rows and a reload keeps it; the
 * filters are a dialog that Apply commits, so a change of vendor does not fire three reloads. The leads behind
 * a figure open their own page (/app/true-cpa/leads).
 */
export function TrueCpaWorkspace({ initialReport = null, framed = false }: { initialReport?: VendorScorecardReport | null; framed?: boolean } = {}) {
  const searchParams = useSearchParams();
  const pathname = usePathname();
  const show = useShow("chart");
  const fallback = { from: initialReport?.from ?? defaultFrom(), to: initialReport?.to ?? today() };
  const urlScope = scopeFromParams(searchParams, fallback);
  const urlKey = scopeQuery(urlScope);
  const urlGrain = grainFromParams(searchParams);

  const [applied, setApplied] = useState<TrueCpaScope>(urlScope);
  const [draft, setDraft] = useState<TrueCpaScope>(urlScope);
  const [grain, setGrainState] = useState<TrueCpaGrain>(urlGrain);
  // A bar, a row or a bookmark changes the address: follow it.
  useEffect(() => { if (urlKey !== scopeQuery(applied)) { setApplied(urlScope); setDraft(urlScope); } }, [urlKey]); // eslint-disable-line react-hooks/exhaustive-deps, react-hooks/set-state-in-effect
  useEffect(() => { setGrainState(urlGrain); }, [urlGrain]); // eslint-disable-line react-hooks/set-state-in-effect

  const [report, setReport] = useState<VendorScorecardReport | null>(initialReport);
  const [loading, setLoading] = useState(!initialReport);
  const [error, setError] = useState<string | null>(null);
  const [series, setSeries] = useState<{ query: string; data: TrueCpaSeries } | null>(null);
  const [speed, setSpeed] = useState<CampaignSpeed[] | null>(null);
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(1);
  const [filtersOpen, setFiltersOpen] = useState(false);
  const { tab: view, setTab: setView } = useUrlTab(VIEWS, "scorecard", "tab", { dropoff: "funnel" });
  const [curve, setCurve] = useState<"slot" | "attempt" | "vendor">("slot");
  const [reloadKey, setReloadKey] = useState(0);
  const refreshing = useRef(false);
  const pageSize = useFittingPageSize(330, 45);

  const query = useMemo(() => scopeQuery(applied), [applied]);

  useEffect(() => {
    let active = true;
    void (async () => {
      await Promise.resolve();
      if (!active) return;
      // The server already rendered this exact scope: no second read for it.
      if (!refreshing.current && initialReport && reportScopeQuery(initialReport) === query) {
        setReport(initialReport); setError(null); setLoading(false);
        return;
      }
      setLoading(true); setError(null);
      try {
        // Through the app's cache: a scope read a moment ago is not asked again; Refresh always asks.
        const fresh = refreshing.current; refreshing.current = false;
        const body = await (fresh ? loadResource<VendorScorecardReport>(trueCpaKey(query)) : readResource<VendorScorecardReport>(trueCpaKey(query)));
        if (!active) return;
        setReport(body); setPage(1);
      } catch (cause) {
        if (active) setError(cause instanceof Error ? cause.message : "Could not load the scorecard");
      } finally {
        if (active) setLoading(false);
      }
    })();
    return () => { active = false; };
  }, [query, reloadKey, initialReport]);

  // The cards' small charts: a week at a time, after the figures.
  useEffect(() => {
    let active = true;
    void readResource<TrueCpaSeries>(seriesKey(query)).then((data) => { if (active) setSeries({ query, data }); }, () => { /* the cards keep their figures without a chart */ });
    return () => { active = false; };
  }, [query, reloadKey]);

  // Speed to lead's campaigns, one line each under their vendor (LA-2.5-5), for the table.
  useEffect(() => {
    if (view !== "speed" || show !== "table" || speed) return;
    let active = true;
    void readResource<{ campaigns: CampaignSpeed[] }>(SPEED_KEY).then((data) => { if (active) setSpeed(data.campaigns ?? []); }, () => { if (active) setSpeed([]); });
    return () => { active = false; };
  }, [view, show, speed]);

  // A reload that failed while figures are on screen: say so in a toast, keep the figures (board 7·8).
  useEffect(() => {
    if (!error || !report) return;
    notify.fail("The scorecard did not reload.", { detail: `The figures shown are from ${new Date(report.generated_at).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}.` });
  }, [error]); // eslint-disable-line react-hooks/exhaustive-deps

  function refresh() { refreshing.current = true; setReloadKey((key) => key + 1); }

  /** Commit a scope: the view reads it and the address keeps it (and the period for the other Reports views). */
  function commit(next: TrueCpaScope) {
    setApplied(next); setDraft(next); setPage(1);
    setParamsInPlace(scopeParams(next));
    if (framed) keepSharedPeriod(next);
  }
  function setGrain(next: TrueCpaGrain) { setGrainState(next); setPage(1); setParamsInPlace({ by: next === "campaign" ? "campaign" : null }); }

  /** The report's own scope as drill parameters: the applied period and filters. */
  function drillScope(): Record<string, string> {
    const params: Record<string, string> = { from: applied.from, to: applied.to };
    if (applied.vendorId) params.vendor_id = applied.vendorId;
    if (applied.campaignId) params.campaign_id = applied.campaignId;
    if (applied.productCode) params.product_code = applied.productCode;
    if (applied.persist) params.persist_days = String(PERSIST_DAYS);
    return params;
  }
  /** The page of leads behind a figure, in this report's period and filters (LA-2.17-7). */
  const drillHref = (spec: DrillSpec) => trueCpaLeadsHref(spec, drillScope());
  /** A headline figure, over everything the report is scoped to. */
  function totalDrill(stage: ScorecardStage): DrillSpec { return { key: `total:${stage}`, title: STAGE_TITLE[stage], params: { stage } }; }
  /** A line's figure: its campaign (or vendor) and a stage. */
  function lineDrill(item: Line, stage: ScorecardStage): DrillSpec {
    const params: Record<string, string> = { stage, vendor_id: item.vendorId };
    if (item.campaignId) params.campaign_id = item.campaignId;
    return { key: `${item.campaignId ? "campaign" : "vendor"}:${item.key}:${stage}`, title: `${STAGE_TITLE[stage]} · ${item.label}`, params };
  }
  /** This page's table view, in this scope and tab, with `extra` on top: where a bar or a legend row opens. */
  const tableHref = (extra: Record<string, string | null> = {}) => showHref(`${pathname}?${searchParams.toString()}`, "table", { ...scopeParams(applied), tab: view, by: grain === "campaign" ? "campaign" : null, ...extra });
  /** The rows of one line: a vendor opens its campaigns; a campaign opens itself. */
  const lineTableHref = (item: Line, tab: View = view) => item.campaignId
    ? tableHref({ tab, vendor_id: item.vendorId, campaign_id: item.campaignId, by: "campaign" })
    : tableHref({ tab, vendor_id: item.vendorId, by: "campaign" });

  const filterCount = [applied.vendorId, applied.campaignId, applied.productCode].filter(Boolean).length;
  const vendors = [...new Map((report?.rows ?? []).map((row) => [row.vendor_id, row.vendor_name])).entries()];
  const products = [...new Set((report?.rows ?? []).map((row) => row.product_code).filter((value): value is string => Boolean(value)))];
  const upgraded = report?.upgraded !== false;
  // Before the report migration there is no vendor roll-up to show; the campaign view still works.
  const effectiveGrain: TrueCpaGrain = report && !upgraded ? "campaign" : grain;

  const allLines = useMemo(() => effectiveGrain === "vendor" ? (report?.vendor_rows ?? []).map((row) => line(row, null)) : (report?.rows ?? []).map((row) => line(row, row)), [report, effectiveGrain]);
  const lines = useMemo(() => {
    const needle = search.trim().toLowerCase();
    return sortLines(allLines.filter((item) => !needle || item.label.toLowerCase().includes(needle)));
  }, [allLines, search]);
  const pageCount = Math.max(1, Math.ceil(lines.length / pageSize));
  const currentPage = Math.min(page, pageCount);
  const shown = lines.slice((currentPage - 1) * pageSize, currentPage * pageSize);
  const totals = report?.totals;
  const exportUrl = `/api/app/true-cpa?${query}&format=csv`;
  const persistOn = report?.persist_days != null;
  const vendorRows = report?.vendor_rows ?? [];
  const speedRows = vendorRows.filter((row) => (row.speed_posted_leads ?? 0) > 0).sort((a, b) => (a.speed_median_seconds ?? Infinity) - (b.speed_median_seconds ?? Infinity));
  const consentRows = vendorRows.filter((row) => (row.consent_leads ?? 0) > 0).sort((a, b) => (b.consent_any_pct ?? -1) - (a.consent_any_pct ?? -1));
  const noun = effectiveGrain === "vendor" ? "vendor" : "campaign";
  const period = reportPeriod(applied.from, applied.to);
  const points = series && series.query === query ? series.data.points : null;
  const cpaTrend = points ? cumulativeCpa(points) : [];

  // First paint without a server-rendered report: the page's one loading look.
  if (loading && !report && !error) return framed ? <FramedLoading /> : <PageLoading />;

  const tabs: { key: View; label: string }[] = [
    { key: "scorecard", label: "Vendors" },
    { key: "funnel", label: "Funnel" },
    { key: "contact", label: "Contact rate" },
    { key: "speed", label: "Speed to lead" },
    { key: "consent", label: "Consent" },
    { key: "compare", label: "Compare" },
  ];
  const appliedFilters = filterCount + (applied.persist ? 1 : 0);
  const unallocated = report && upgraded ? totals?.unallocated_spend_campaigns ?? 0 : 0;
  const chips: ActiveFilter[] = [
    applied.vendorId ? { key: "vendor", label: "Vendor", value: vendors.find(([id]) => id === applied.vendorId)?.[1] ?? "One vendor", onRemove: () => commit({ ...applied, vendorId: "", campaignId: "" }) } : null,
    applied.campaignId ? { key: "campaign", label: "Campaign", value: (report?.rows ?? []).find((row) => row.campaign_id === applied.campaignId)?.campaign_name ?? "One campaign", onRemove: () => commit({ ...applied, campaignId: "" }) } : null,
    applied.productCode ? { key: "product", label: "Product", value: applied.productCode.replaceAll("_", " "), onRemove: () => commit({ ...applied, productCode: "" }) } : null,
    applied.persist ? { key: "persist", label: "Policies", value: `in force after ${PERSIST_DAYS} days`, onRemove: () => commit({ ...applied, persist: false }) } : null,
  ].filter((chip): chip is ActiveFilter => Boolean(chip));
  const clearAndApply = () => { setFiltersOpen(false); setSearch(""); commit({ ...applied, vendorId: "", campaignId: "", productCode: "", persist: false }); };

  // The three notices became one chip on the toolbar line (board 7·8): spend left out of the figures, or views
  // that wait on a database update. A failed reload is a toast; the figures stay.
  const notice = unallocated > 0
    ? <Link href="/app/lead-sources?tab=campaigns" className="rounded-full outline-none focus-visible:ring-2 focus-visible:ring-ring" title="Their spend is left out of Net spend and True CPA until records purchased is entered."><StatusChip tone="warning">{plural(unallocated, "campaign")} left out ›</StatusChip></Link>
    : report && !upgraded ? <StatusChip tone="warning" title="Until a database update is applied, net spend is lifetime spend, and the vendor view, test batches, persistency filter, speed and consent are unavailable.">Some views wait on an update</StatusChip>
    : null;
  const summary = totals ? <span className="whitespace-nowrap text-sm text-muted-foreground">{period} · {dollars(totals.net_spend_cents)} net spend · {plural(totals.issued_policies, "issued policy", "issued policies")}</span> : null;

  // The filters (board 7·8): the shared ConfirmDialog holding its fields ("pop-ups only confirm"), opened from the
  // toolbar's Filters button. The fields lay out in the shared FilterPanel; Apply commits them together, Clear empties them.
  const filtersDialog = <>
    <FilterButton open={filtersOpen} controls="true-cpa-filters" count={appliedFilters} onClick={() => { setDraft(applied); setFiltersOpen(true); }} />
    <ConfirmDialog
      open={filtersOpen}
      onOpenChange={setFiltersOpen}
      onConfirm={() => { setFiltersOpen(false); commit(draft); }}
      title="Filters"
      confirmLabel="Apply"
      destructive={false}
      fields={<>
          <FilterPanel id="true-cpa-filters" open={filtersOpen} className="grid-cols-1 border-b-0 px-0 py-0">
            <FilterField label="Vendor" htmlFor="true-cpa-vendor"><select id="true-cpa-vendor" className={toolbarControl} value={draft.vendorId} onChange={(event) => setDraft((current) => ({ ...current, vendorId: event.target.value, campaignId: "" }))}><option value="">All vendors</option>{vendors.map(([id, name]) => <option key={id} value={id}>{name}</option>)}</select></FilterField>
            <FilterField label="Campaign" htmlFor="true-cpa-campaign"><select id="true-cpa-campaign" className={toolbarControl} value={draft.campaignId} onChange={(event) => setDraft((current) => ({ ...current, campaignId: event.target.value }))}><option value="">All campaigns</option>{(report?.rows ?? []).filter((row) => !draft.vendorId || row.vendor_id === draft.vendorId).map((row) => <option key={row.campaign_id} value={row.campaign_id}>{row.campaign_name}</option>)}</select></FilterField>
            <FilterField label="Product" htmlFor="true-cpa-product"><select id="true-cpa-product" className={toolbarControl} value={draft.productCode} onChange={(event) => setDraft((current) => ({ ...current, productCode: event.target.value }))}><option value="">All products</option>{products.map((product) => <option key={product} value={product}>{product.replaceAll("_", " ")}</option>)}</select></FilterField>
            <label className="inline-flex items-center gap-2 text-sm text-foreground" htmlFor="scorecard-persist" title={upgraded ? undefined : "Needs a database update that has not been applied yet."}>
              <input id="scorecard-persist" type="checkbox" className={checkboxControl} checked={draft.persist} disabled={!upgraded} onChange={(event) => setDraft((current) => ({ ...current, persist: event.target.checked }))} />
              <span>Only policies still in force after {PERSIST_DAYS} days</span>
            </label>
          </FilterPanel>
        <Button type="button" variant="ghost" className="self-start" onClick={() => setDraft((current) => ({ ...current, vendorId: "", campaignId: "", productCode: "", persist: false }))}>Clear</Button>
      </>}
    />
  </>;

  /** Every tab's toolbar: its own controls, then Filters, the applied chips, the period's sums and the one notice chip; Refresh last. */
  const toolbar = (children?: ReactNode) => <DataToolbar actions={<RefreshButton onClick={refresh} refreshing={loading} />}>
    {children}{filtersDialog}<ActiveFilters inline filters={chips} onClear={clearAndApply} />{summary}{notice}
  </DataToolbar>;
  const notLoaded = <ErrorState title="The scorecard did not load" detail={error ?? "No figures for this period."} action={<Button variant="outline" onClick={refresh}>Try again</Button>} />;
  const pendingUpdate = <EmptyState title="Not available yet" hint="This needs a database update that has not been applied yet." />;
  const openRows = (href: string, text = "Open the rows") => <Link href={href} className="whitespace-nowrap text-sm font-medium text-foreground hover:underline">{text} ›</Link>;
  const chartGrid = "grid gap-8 p-4 lg:grid-cols-2";
  const chartColumn = "flex min-w-0 flex-col gap-4";

  const funnel = totals ? ([
    { stage: "received", value: totals.leads_received, before: null, cost: null, costLabel: "" },
    { stage: "dialable", value: totals.dialable_leads, before: totals.leads_received, cost: totals.effective_cost_per_lead_cents, costLabel: "a lead" },
    { stage: "dialed", value: totals.dialed_leads, before: totals.dialable_leads, cost: null, costLabel: "" },
    { stage: "contacted", value: totals.contacted_leads, before: totals.dialed_leads, cost: totals.effective_cost_per_contact_cents, costLabel: "a contact" },
    { stage: "quoted", value: totals.quoted_leads, before: totals.contacted_leads, cost: null, costLabel: "" },
    { stage: "applied", value: totals.applied_leads ?? totals.applications, before: totals.quoted_leads, cost: totals.effective_cost_per_application_cents, costLabel: "an application" },
    { stage: "issued", value: totals.issued_policies, before: totals.applied_leads ?? totals.applications, cost: totals.effective_cost_per_issued_policy_cents, costLabel: "a policy" },
  ] as Array<{ stage: ScorecardStage; value: number | null; before: number | null; cost: number | null; costLabel: string }>) : [];
  const STEP_BEFORE: Partial<Record<ScorecardStage, string>> = { dialable: "of received", dialed: "of dialable", contacted: "of dialled", quoted: "of contacted", applied: "of quoted", issued: "of applied" };
  const canDrill = (stage: ScorecardStage) => Boolean(report?.funnel) || stage === "received";
  const slots = bySlotOrder(report?.contact_rate_by_slot ?? []);
  const attempts = report?.attempts_to_contact ?? [];
  const slotContacts = slots.reduce((sum, item) => sum + item.contacts, 0);
  const slotAttempts = slots.reduce((sum, item) => sum + item.attempts, 0);
  const slotDrill = (slot: string): DrillSpec => ({ key: `slot:${slot}`, title: `${slotLabel(slot)} slot`, params: { stage: "received", slot } });
  const attemptDrill = (attempt: number): DrillSpec => ({ key: `attempt:${attempt}`, title: `Attempt ${attempt}`, params: { stage: "received", attempt_number: String(attempt) } });
  const vendorOf = (vendorId: string) => allLines.find((item) => item.vendorId === vendorId && !item.campaignId) ?? null;

  return <div className="m-stagger flex w-full min-w-0 flex-col gap-6">
    {/* The period and Export on the title line, after the Table · Chart switch (board 7·1). */}
    {framed
      ? <InReportsSlot framed slot="corner">
          <PeriodPicker value={{ from: applied.from, to: applied.to }} onChange={(next) => commit({ ...applied, ...next })} />
          <Button asChild variant="outline"><a href={exportUrl} onClick={() => notify.done(`Exported ${plural(report?.rows.length ?? 0, "campaign")}.`, { detail: `True CPA · ${period}.csv` })}><Download aria-hidden="true" />Export</a></Button>
        </InReportsSlot>
      : <PageHeader title="True CPA" description="What an issued policy really cost, by vendor and campaign." actions={<><PeriodPicker value={{ from: applied.from, to: applied.to }} onChange={(next) => commit({ ...applied, ...next })} /><Button asChild variant="outline"><a href={exportUrl}><Download aria-hidden="true" />Export</a></Button></>} />}

    {/* Five figures, each the link to the leads behind it and each with its own figure by week (owner 0·C). */}
    <StatStrip label="True CPA totals">
      <StatTile label="Net spend" value={loading ? "…" : dollars(totals?.net_spend_cents)} footnote={period} href={drillHref(totalDrill("received"))} trend={points && points.length > 1 ? { points: points.map((point) => point.net_spend_cents / 100), tone: "primary", placement: "under" } : undefined} />
      <StatTile label="Leads received" value={loading ? "…" : number(totals?.leads_received)} footnote={totals && totals.leads_received ? `${number(totals.dialable_leads)} dialable` : "after suppression"} href={drillHref(totalDrill("received"))} trend={points && points.length > 1 ? { points: points.map((point) => point.leads_received), tone: "primary", placement: "under" } : undefined} />
      <StatTile label="Applications" value={loading ? "…" : number(totals?.applications)} footnote={share(totals?.applied_leads ?? totals?.applications, totals?.contacted_leads, "of contacted leads") ?? "applications in the period"} href={report?.funnel ? drillHref(totalDrill("applied")) : undefined} trend={points && points.length > 1 ? { points: points.map((point) => point.applications), tone: "primary", placement: "under" } : undefined} />
      <StatTile label="Issued policies" value={loading ? "…" : number(totals?.issued_policies)} footnote={persistOn ? `in force after ${report?.persist_days} days${totals?.policies_not_yet_measurable ? ` · ${number(totals.policies_not_yet_measurable)} too recent` : ""}` : share(totals?.issued_policies, totals?.applications, "of applications")} reserveFootnote href={drillHref(totalDrill("issued"))} trend={points && points.length > 1 ? { points: points.map((point) => point.issued_policies), tone: "primary", placement: "under" } : undefined} />
      <StatTile label="True CPA" value={loading ? "…" : totals?.effective_cost_per_issued_policy_cents == null ? "No policy yet" : dollars(totals.effective_cost_per_issued_policy_cents)} footnote={totals && totals.issued_policies > 0 && report && totals.issued_policies < report.small_sample_below ? <StatusChip tone="warning" title={`Fewer than ${report.small_sample_below} issued policies`}>Small sample</StatusChip> : persistOn ? "per persisting policy" : "per issued policy"} href={drillHref(totalDrill("issued"))} trend={cpaTrend.length > 1 ? { points: cpaTrend, tone: "primary", placement: "under" } : undefined} />
    </StatStrip>

    {/* The views, on the title line (UI-CONSISTENCY §8a): one at a time. */}
    <InReportsSlot framed={framed} slot="lead">
      <ViewTabs label="True CPA views" tabs={tabs} value={view} onChange={setView} idPrefix="true-cpa-tab" controls="true-cpa-view" />
    </InReportsSlot>

    <div key={`${view}:${show}`} role="tabpanel" id="true-cpa-view" aria-labelledby={`true-cpa-tab-${view}`} className="flex min-w-0 flex-col gap-6">

    {/* Vendors. Chart (7·2, A): where the money went, and what it bought — two BarLists side by side. Table (7·1):
        one line a vendor (or campaign), six columns; the True CPA cell is the row's one chip. */}
    {view === "scorecard" && <TableCard
      toolbar={toolbar(<>
        <ToolbarSearch value={search} onChange={(value) => { setSearch(value); setPage(1); }} placeholder="Vendor, campaign" />
        <div role="radiogroup" aria-label="Rows" className="flex flex-wrap items-center gap-2">
          {([["vendor", "By vendor"], ["campaign", "By campaign"]] as const).map(([key, text]) => (
            <ToggleChip key={key} role="radio" selected={effectiveGrain === key} disabled={key === "vendor" && Boolean(report) && !upgraded} onClick={() => setGrain(key)}>{text}</ToggleChip>
          ))}
        </div>
      </>)}
      footer={show === "table" ? <Pager page={currentPage} total={lines.length} noun={`${noun}s`} pageSize={pageSize} onPage={setPage} suffix="Cheapest policy first · test batches last · “No policy yet” means no issued policy, never $0.00" /> : undefined}
    >
      {error && !report ? notLoaded
        : loading && !report ? <SectionLoading rows={6} columns={6} />
        : lines.length === 0 ? (search || appliedFilters > 0 ? <NoMatches noun={`${noun}s`} onClear={clearAndApply} /> : <EmptyState title="No spend or leads in this period" hint="Widen the dates, or add a campaign with its spend." action={<Button asChild variant="outline"><Link href="/app/lead-sources?tab=campaigns">Open campaigns</Link></Button>} />)
        : show === "chart" ? (() => {
            const spendRows: BarListRow[] = [...lines].filter((item) => (item.netSpend ?? 0) > 0).sort((a, b) => (b.netSpend ?? 0) - (a.netSpend ?? 0)).map((item) => ({
              key: item.key, label: item.label, value: (item.netSpend ?? 0) / 100, figure: dollars(item.netSpend),
              caption: item.issued > 0 ? plural(item.issued, "policy", "policies") : "no policy yet", href: lineTableHref(item),
            }));
            const appRows: BarListRow[] = [...lines].filter((item) => item.apps > 0).sort((a, b) => b.apps - a.apps || b.issued - a.issued).map((item) => ({
              key: item.key, label: item.label, value: item.apps, inner: item.issued, figure: number(item.apps),
              caption: item.issued > 0 ? `${number(item.issued)} issued` : item.costPerApp != null ? `${dollars(item.costPerApp)} each` : undefined, href: lineTableHref(item),
            }));
            return <div className={chartGrid}>
              <div className={chartColumn}>
                <ChartHeading title={`Net spend by ${noun}`} period={`${period} · ${dollars(totals?.net_spend_cents)} · ${plural(totals?.issued_policies ?? 0, "issued policy", "issued policies")} · True CPA ${totals?.effective_cost_per_issued_policy_cents == null ? "no policy yet" : dollars(totals.effective_cost_per_issued_policy_cents)}`} action={openRows(tableHref())} />
                {spendRows.length ? <BarList rows={spendRows} summary={`Net spend by ${noun}, ${period}`} format={usd} unit="net spend" /> : <EmptyState title="No net spend in this period" hint="Spend shows once a campaign has records purchased entered." />}
              </div>
              <div className={chartColumn}>
                <ChartHeading title={`Applications by ${noun}`} period={`${plural(totals?.applications ?? 0, "application")} · ${number(totals?.issued_policies)} issued`} action={report?.funnel ? openRows(drillHref(totalDrill("applied")), `Open the ${number(totals?.applied_leads ?? totals?.applications)} leads`) : undefined} />
                {appRows.length ? <><BarList rows={appRows} summary={`Applications by ${noun}, with issued policies inside`} unit="applications" /><ChartLegend items={[{ key: "apps", label: "Applications", tone: "faint" }, { key: "issued", label: "Issued", tone: "strong", href: drillHref(totalDrill("issued")) }]} /></> : <EmptyState title="No applications in this period" hint="Applications show once a lead from a vendor applies." />}
              </div>
            </div>;
          })()
        : <table className="portal-lead-table w-full text-left text-sm">
            <thead><tr><th>{effectiveGrain === "vendor" ? "Vendor" : "Campaign"}</th><th className="text-right">Net spend</th><th className="text-right">Leads received</th><th className="text-right">Applications</th><th className="text-right">Issued</th><th>True CPA</th></tr></thead>
            <tbody className="m-seq">
              {shown.map((item) => {
                // Every count opens its own rows. Before 20260925709800 only a campaign's leads can be listed.
                const figure = (value: number, stage: ScorecardStage) => value > 0 && (report?.funnel || (stage === "received" && item.campaignId))
                  ? <Link href={drillHref(lineDrill(item, stage))} className="hover:underline" aria-label={`${number(value)} ${STAGE_TITLE[stage].toLowerCase()} in ${item.label}: show the leads`}>{number(value)}</Link>
                  : number(value);
                return <tr key={item.key} className="m-row">
                  <td className="max-w-[320px] truncate whitespace-nowrap font-medium text-foreground" title={item.label}>
                    {item.campaignId
                      ? <Link href={drillHref(lineDrill(item, "received"))} className="hover:underline">{item.label}</Link>
                      : <Link href={lineTableHref(item)} className="hover:underline" title={`${item.label}: its campaigns`}>{item.label}</Link>}
                  </td>
                  <td className="whitespace-nowrap text-right tabular-nums">{dollars(item.netSpend)}</td>
                  <td className="whitespace-nowrap text-right tabular-nums">{figure(item.leads, "received")}</td>
                  <td className="whitespace-nowrap text-right tabular-nums">{figure(item.apps, "applied")}</td>
                  <td className="whitespace-nowrap text-right tabular-nums">{figure(item.issued, "issued")}</td>
                  <td className="whitespace-nowrap tabular-nums">
                    {item.isTest ? <StatusChip tone="info" title="Test batch: never ranked">Test batch{item.cpi != null ? ` · ${dollars(item.cpi)}` : ""}</StatusChip>
                      : item.cpi == null ? <StatusChip tone="neutral">No policy yet</StatusChip>
                      : item.small ? <StatusChip tone="warning" title="Small sample: fewer issued policies than the report needs to rank fairly">{dollars(item.cpi)} · small sample</StatusChip>
                      : dollars(item.cpi)}
                  </td>
                </tr>;
              })}
            </tbody>
          </table>}
    </TableCard>}

    {/* Funnel (7·4, A): stepped bars, one a step, each step's cost as its caption. The table turns it on its side:
        one step a row. Records bought (lifetime) are in the (i), not a step. */}
    {view === "funnel" && <TableCard toolbar={toolbar()} footer={show === "table" && totals ? <span>Bought {plural(totals.records_purchased, "record")}, lifetime: not a step · a dash means no cost at that step</span> : undefined}>
      {!report ? (loading ? <SectionLoading rows={7} columns={4} /> : notLoaded) : !totals ? pendingUpdate
        : show === "chart" ? <div className="flex min-w-0 flex-col gap-4 p-4">
            <ChartHeading title="What became of this period’s leads" period={`${period} · ${applied.vendorId ? vendors.find(([id]) => id === applied.vendorId)?.[1] ?? "one vendor" : "all vendors"}`} action={openRows(drillHref(totalDrill("received")), "Open the leads")} />
            <BarList
              summary={`The funnel from ${number(totals.leads_received)} leads received to ${plural(totals.issued_policies, "issued policy", "issued policies")}`}
              unit="leads"
              rows={funnel.map((step) => ({
                key: step.stage, label: STAGE_TITLE[step.stage], value: step.value ?? 0, figure: step.value == null ? "—" : number(step.value),
                caption: step.value == null ? "needs a database update" : step.cost != null ? `${dollars(step.cost)} ${step.costLabel}` : share(step.value, step.before, STEP_BEFORE[step.stage] ?? ""),
                href: step.value != null && canDrill(step.stage) ? drillHref(totalDrill(step.stage)) : undefined,
              }))}
            />
          </div>
        : <table className="portal-lead-table w-full text-left text-sm">
            <thead><tr><th>Step</th><th className="text-right">Leads</th><th className="text-right">Of the step before</th><th className="text-right">Cost each</th></tr></thead>
            <tbody className="m-seq">
              {funnel.map((step) => <tr key={step.stage} className="m-row">
                <td className="whitespace-nowrap font-medium text-foreground">{step.value != null && step.value > 0 && canDrill(step.stage) ? <Link href={drillHref(totalDrill(step.stage))} className="hover:underline">{STAGE_TITLE[step.stage]}</Link> : STAGE_TITLE[step.stage]}</td>
                <td className="whitespace-nowrap text-right tabular-nums">{step.value == null ? <StatusChip tone="neutral" title="Needs a database update that has not been applied yet">Waiting on an update</StatusChip> : number(step.value)}</td>
                <td className="whitespace-nowrap text-right tabular-nums">{step.before == null || step.value == null || !step.before ? <span className="text-muted-foreground">—</span> : percent((step.value / step.before) * 100)}</td>
                <td className="whitespace-nowrap text-right tabular-nums">{step.cost == null ? <span className="text-muted-foreground">—</span> : dollars(step.cost)}</td>
              </tr>)}
            </tbody>
          </table>}
    </TableCard>}

    {/* Contact rate (7·5, A): bars by time slot (categories) and a line by attempt (an order whose shape matters).
        The table carries the figures, By slot · By attempt · By vendor; the vendor lines keep the undialable rate
        and claim acceptance, each with its direction. */}
    {view === "contact" && <TableCard
      toolbar={toolbar(show === "table" ? <div role="radiogroup" aria-label="Contact rate by" className="flex flex-wrap items-center gap-2">
        <ToggleChip role="radio" selected={curve === "slot"} onClick={() => setCurve("slot")}>By slot</ToggleChip>
        <ToggleChip role="radio" selected={curve === "attempt"} onClick={() => setCurve("attempt")}>By attempt</ToggleChip>
        <ToggleChip role="radio" selected={curve === "vendor"} onClick={() => setCurve("vendor")}>By vendor</ToggleChip>
      </div> : undefined)}
    >
      {!report ? (loading ? <SectionLoading rows={6} columns={4} /> : notLoaded)
        : show === "chart" ? (slots.length === 0 && attempts.length === 0 ? <EmptyState title="No dispositions in this period" hint="Rates appear once calls are dispositioned." /> : <div className={chartGrid}>
            <div className={chartColumn}>
              <ChartHeading title="Contact rate by time of day" period={`${period} · ${number(slotContacts)} contacts of ${number(slotAttempts)} attempts`} action={openRows(tableHref({ tab: "contact" }), "Open the rows")} />
              {slots.length ? <BarSeries
                bars={slots.map((item) => ({ key: item.slot, label: slotShort(item.slot), value: item.rate_percent ?? 0 }))}
                summary="Contact rate by time-of-day slot"
                format={(value) => `${value.toFixed(1)}%`}
                unit="contact rate"
                labels="all"
                names={{ value: "Contact rate" }}
                hrefFor={(bar) => (report.funnel ? drillHref(slotDrill(bar.key)) : null)}
              /> : <EmptyState title="No slots yet" hint="Slots appear once calls are dispositioned." />}
            </div>
            <div className={chartColumn}>
              <ChartHeading title="Contact rate by attempt" period={attempts.length ? `attempt 1 to ${attempts[attempts.length - 1].attempt_number}` : "no attempts yet"} action={openRows(tableHref({ tab: "contact" }), "Open the rows")} />
              {attempts.length > 1 ? <LineSeries
                points={attempts.map((item) => ({ key: String(item.attempt_number), label: String(item.attempt_number), value: item.rate_percent ?? 0 }))}
                summary="Contact rate by attempt number"
                format={(value) => `${value.toFixed(1)}%`}
                unit="contact rate"
                labels="all"
                legend={{ label: "Contact rate", figure: percent(report.totals.contact_rate_percent) }}
                hrefFor={(point) => (report.funnel ? drillHref(attemptDrill(Number(point.key))) : null)}
              /> : <EmptyState title="Not enough attempts yet" hint="The curve needs a second attempt." />}
            </div>
          </div>)
        : curve === "vendor" ? (allLines.length === 0 ? <EmptyState title="No vendor lines in this period" hint="Lines appear once a vendor has sent leads." /> : (
          <table className="portal-lead-table w-full text-left text-sm">
            <thead><tr><th>{effectiveGrain === "vendor" ? "Vendor" : "Campaign"}</th><th className="text-right">Contact rate</th><th className="text-right">Cost a contact</th><th className="text-right" title={METRICS_APART}>Undialable rate<span className="ml-1 font-normal text-muted-foreground">Low is good</span></th><th className="text-right" title={METRICS_APART}>Claim acceptance<span className="ml-1 font-normal text-muted-foreground">High is good</span></th><th className="text-right">Leads received</th></tr></thead>
            <tbody className="m-seq">
              {sortLines(allLines).map((item) => <tr key={item.key} className="m-row">
                <td className="max-w-[320px] truncate whitespace-nowrap font-medium text-foreground" title={item.label}>{item.label}</td>
                <td className="whitespace-nowrap text-right tabular-nums">{report.funnel && item.contacted > 0 ? <Link href={drillHref(lineDrill(item, "contacted"))} className="hover:underline">{percent(item.contact)}</Link> : percent(item.contact)}</td>
                <td className="whitespace-nowrap text-right tabular-nums">{dollars(item.costPerContact)}</td>
                <td className="whitespace-nowrap text-right tabular-nums">{report.funnel && item.leads - item.dialable > 0 ? <Link href={drillHref(lineDrill(item, "undialable"))} className="hover:underline">{percent(item.undialableRate)}</Link> : percent(item.undialableRate)}</td>
                <td className="whitespace-nowrap text-right tabular-nums">{percent(item.claimAcceptance)}</td>
                <td className="whitespace-nowrap text-right tabular-nums">{number(item.leads)}</td>
              </tr>)}
            </tbody>
          </table>))
        : (() => {
            const items = curve === "slot"
              ? slots.map((item) => ({ key: item.slot, label: slotLabel(item.slot), rate: item.rate_percent, contacts: item.contacts, attempts: item.attempts, share: null as number | null, spec: slotDrill(item.slot) }))
              : attempts.map((item) => ({ key: String(item.attempt_number), label: `Attempt ${item.attempt_number}`, rate: item.rate_percent, contacts: item.contacts, attempts: item.attempts, share: item.share_of_contacts_percent, spec: attemptDrill(item.attempt_number) }));
            return items.length === 0 ? <EmptyState title="No dispositions in this period" hint="Rates appear once calls are dispositioned." /> : (
              <table className="portal-lead-table w-full text-left text-sm">
                <thead><tr><th>{curve === "slot" ? "Slot" : "Attempt"}</th><th className="text-right">Contact rate</th><th className="text-right">Contacts</th><th className="text-right">Attempts</th>{curve === "attempt" && <th className="text-right">% of contacts</th>}</tr></thead>
                <tbody className="m-seq">
                  {items.map((item) => <tr key={item.key} className="m-row">
                    <td className="whitespace-nowrap font-medium text-foreground">{report.funnel && item.attempts > 0 ? <Link href={drillHref(item.spec)} className="hover:underline" aria-label={`${item.label}: show the leads`}>{item.label}</Link> : item.label}</td>
                    <td className="whitespace-nowrap text-right tabular-nums">{percent(item.rate)}</td>
                    <td className="whitespace-nowrap text-right tabular-nums">{number(item.contacts)}</td>
                    <td className="whitespace-nowrap text-right tabular-nums">{number(item.attempts)}</td>
                    {curve === "attempt" && <td className="whitespace-nowrap text-right tabular-nums">{percent(item.share)}</td>}
                  </tr>)}
                </tbody>
              </table>
            );
          })()}
    </TableCard>}

    {/* Speed to lead (7·6, A): a bar a vendor, the median to first dial; the share within a minute in its caption.
        The table keeps each vendor's campaigns under its row, one line each. */}
    {view === "speed" && <TableCard toolbar={toolbar()} footer={show === "table" ? <span>Median arrival to first dial · real-time leads · all time</span> : undefined}>
      {!report ? (loading ? <SectionLoading rows={4} columns={4} /> : notLoaded) : !upgraded ? pendingUpdate : speedRows.length === 0 ? <EmptyState title="No real-time leads yet" hint="Leads posted by a vendor in real time show here." />
        : show === "chart" ? <div className="flex min-w-0 flex-col gap-4 p-4">
            <ChartHeading title="Median time to first dial" period="real-time leads · all time" action={openRows(tableHref({ tab: "speed" }))} />
            <BarList
              rows={speedRows.map((row) => ({ key: row.vendor_id, label: row.vendor_name, value: row.speed_median_seconds ?? 0, figure: clock(row.speed_median_seconds), caption: row.speed_within_60s_pct == null ? undefined : `${percent(row.speed_within_60s_pct)} within a minute`, href: tableHref({ tab: "speed", vendor_id: row.vendor_id, by: "campaign" }) }))}
              summary="Median seconds from a real-time lead's arrival to its first dial, by vendor"
              format={(value) => clock(value)}
              unit="median to first dial"
            />
          </div>
        : <table className="portal-lead-table w-full text-left text-sm">
            <thead><tr><th>Vendor</th><th className="text-right">Median to first dial</th><th className="text-right">Within a minute</th><th className="text-right">Leads</th></tr></thead>
            <tbody className="m-seq">
              {speedRows.map((row) => <Fragment key={row.vendor_id}>
                <tr className="m-row">
                  <td className="whitespace-nowrap font-medium text-foreground">{row.vendor_name}</td>
                  <td className="whitespace-nowrap text-right tabular-nums">{clock(row.speed_median_seconds)}</td>
                  <td className="whitespace-nowrap text-right tabular-nums">{percent(row.speed_within_60s_pct)}</td>
                  <td className="whitespace-nowrap text-right tabular-nums">{number(row.speed_posted_leads)}</td>
                </tr>
                {/* LA-2.5-5: the vendor's campaigns, one line each, under its row. */}
                {(speed ?? []).filter((campaign) => campaign.vendorId === row.vendor_id).map((campaign) => <tr key={campaign.campaignId} className="m-row">
                  <td className="max-w-[320px] truncate whitespace-nowrap pl-8" title={campaign.campaignName}>{campaign.campaignName}</td>
                  <td className="whitespace-nowrap text-right tabular-nums">{clock(campaign.medianSeconds)}</td>
                  <td className="whitespace-nowrap text-right tabular-nums">{percent(campaign.dialledWithin60sPct)}</td>
                  <td className="whitespace-nowrap text-right tabular-nums">{number(campaign.postedLeads)}</td>
                </tr>)}
              </Fragment>)}
            </tbody>
          </table>}
    </TableCard>}

    {/* Consent certificates (7·6, A): a bar a vendor, the share that arrived with one; the share we stored inside
        it. Under 50% stored is the row's one amber chip. */}
    {view === "consent" && <TableCard toolbar={toolbar()} footer={show === "table" ? <span>Consent certificates from TrustedForm or Jornaya · all time</span> : undefined}>
      {!report ? (loading ? <SectionLoading rows={4} columns={4} /> : notLoaded) : !upgraded ? pendingUpdate : consentRows.length === 0 ? <EmptyState title="No vendor leads yet" hint="Coverage shows once a vendor has sent leads." />
        : show === "chart" ? <div className="flex min-w-0 flex-col gap-4 p-4">
            <ChartHeading title="Leads that arrived with a consent certificate" period="all time · TrustedForm or Jornaya" action={openRows(tableHref({ tab: "consent" }))} />
            <BarList
              rows={consentRows.map((row) => ({ key: row.vendor_id, label: row.vendor_name, value: row.consent_any_pct ?? 0, inner: Math.min(row.consent_claimed_pct ?? 0, row.consent_any_pct ?? 0), figure: percent(row.consent_any_pct), caption: `${percent(row.consent_claimed_pct)} stored`, href: tableHref({ tab: "consent", vendor_id: row.vendor_id }) }))}
              summary="Share of each vendor's leads that arrived with a consent certificate, and the share stored by us inside it"
              format={(value) => `${value.toFixed(1)}%`}
              max={100}
              unit="arrived with a certificate"
            />
            <ChartLegend items={[{ key: "any", label: "Arrived with one", tone: "faint" }, { key: "stored", label: "Stored by us", tone: "strong" }]} />
          </div>
        : <table className="portal-lead-table w-full text-left text-sm">
            <thead><tr><th>Vendor</th><th>Stored</th><th className="text-right">Arrived with one</th><th className="text-right">Leads</th></tr></thead>
            <tbody className="m-seq">
              {consentRows.map((row) => <tr key={row.vendor_id} className="m-row">
                <td className="whitespace-nowrap font-medium text-foreground">{vendorOf(row.vendor_id) ? <Link href={lineTableHref(vendorOf(row.vendor_id) as Line, "scorecard")} className="hover:underline">{row.vendor_name}</Link> : row.vendor_name}</td>
                <td className="whitespace-nowrap tabular-nums">{row.consent_claimed_pct != null && row.consent_claimed_pct < 50 ? <StatusChip tone="warning" title="Under half of this vendor's leads have a certificate stored">{percent(row.consent_claimed_pct)} stored</StatusChip> : `${percent(row.consent_claimed_pct)} stored`}</td>
                <td className="whitespace-nowrap text-right tabular-nums">{percent(row.consent_any_pct)}</td>
                <td className="whitespace-nowrap text-right tabular-nums">{number(row.consent_leads)}</td>
              </tr>)}
            </tbody>
          </table>}
    </TableCard>}

    {view === "compare" && <CampaignComparisonWorkspace rows={report?.rows ?? []} defaultFrom={applied.from} defaultTo={applied.to} show={show} />}
    </div>
  </div>;
}
