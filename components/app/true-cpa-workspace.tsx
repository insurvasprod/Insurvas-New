"use client";

import { Fragment, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import Link from "next/link";
import { Download } from "lucide-react";
import { Button } from "@/components/ui/button";
import { ActiveFilters, DataToolbar, FilterButton, FilterField, FilterPanel, RefreshButton, ToolbarSearch, toolbarControl, type ActiveFilter } from "@/components/ui/data-toolbar";
import { checkboxControl } from "@/components/ui/field";
import { ViewTabs } from "@/components/ui/view-tabs";
import { InfoTip } from "@/components/ui/info-tip";
import { PageHeader } from "@/components/ui/page-header";
import { PageLoading } from "@/components/ui/page-loading";
import { FramedLoading } from "@/components/app/reports/reports-slot";
import { Pager } from "@/components/ui/pager";
import { EmptyState, ErrorState, NoMatches, SectionLoading } from "@/components/ui/page-states";
import { StatStrip, StatTile } from "@/components/ui/stat";
import { StatusChip } from "@/components/ui/status-chip";
import { TableCard } from "@/components/ui/table-card";
import { ToggleChip } from "@/components/ui/toggle-chip";
import type { ScorecardStage, VendorScorecardReport, VendorScorecardRow, VendorScorecardVendorRow } from "@/lib/vendorScorecard/types";
import { CampaignComparisonWorkspace } from "./campaign-comparison-workspace";
import { CampaignSpeedToLead } from "@/components/app/campaign-speed-to-lead";
import { cn } from "@/lib/utils";
import { Callout } from "@/components/app/settings/primitives";
import { PeriodPicker } from "@/components/app/reports/period-picker";
import { InReportsSlot, ReportsSlot, useUrlTab } from "@/components/app/reports/reports-slot";
import { trueCpaLeadsHref, type DrillSpec } from "@/lib/reports/trueCpaLeads";
import { reportPeriod } from "@/lib/reports/periodText";
import { keepSharedPeriod } from "@/lib/reports/views";

/**
 * One view at a time (2026-10-26; foundation pass 2026-11-03: "Where leads drop off" held four lists on one
 * tab, so each is its own tab now). `?tab=` opens one; the old `dropoff` opens the funnel.
 */
const VIEWS = ["scorecard", "funnel", "contact", "speed", "consent", "compare"] as const;
type View = (typeof VIEWS)[number];
/** Vendor cards a page. */
const PAGE_SIZE_CARDS = 8;
/** The persistency toggle's window. User decision: 60 days. Mirrors SCORECARD_PERSIST_DAYS on the server. */
const PERSIST_DAYS = 60;

/** 90 days ending today, the default period (the SQL applies the same one when sent no dates). */
function defaultFrom() { const d = new Date(); d.setDate(d.getDate() - 89); return d.toISOString().slice(0, 10); }
function dollars(cents: number | null | undefined) { return cents == null ? "—" : new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 2, minimumFractionDigits: 2 }).format(cents / 100); }
function number(value: number | null | undefined) { return value == null ? "—" : value.toLocaleString(); }
/** One decimal everywhere (QA 2026-11-03): the RPC's raw values mixed "68.75%", "20%" and "4.78%" on one card. */
function percent(value: number | null | undefined) { return value == null ? "—" : `${Number(value).toFixed(1)}%`; }
/** "4:12" for a median in seconds. */
function clock(seconds: number | null | undefined) { if (seconds == null) return "—"; const s = Math.round(seconds); return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`; }
function plural(count: number, one: string, many = `${one}s`) { return `${count.toLocaleString()} ${count === 1 ? one : many}`; }
/** "6.3% of leads" — the artboard's footnote, computed rather than typed. */
function share(part: number | null | undefined, whole: number | null | undefined, suffix: string) {
  if (part == null || whole == null || whole === 0) return undefined;
  return `${((part / whole) * 100).toFixed(1)}% ${suffix}`;
}


type Scope = { from: string; to: string; vendorId: string; campaignId: string; productCode: string; persist: boolean };
type Grain = "vendor" | "campaign";
type Sort = "cost" | "spend";
function queryFor(value: Scope) { const params = new URLSearchParams({ from: value.from, to: value.to }); if (value.vendorId) params.set("vendor_id", value.vendorId); if (value.campaignId) params.set("campaign_id", value.campaignId); if (value.productCode) params.set("product_code", value.productCode); if (value.persist) params.set("persist_days", String(PERSIST_DAYS)); return params.toString(); }

const STAGE_NOUN: Record<ScorecardStage, string> = {
  received: "leads received", dialable: "dialable leads", undialable: "undialable leads", dialed: "leads dialled",
  contacted: "leads contacted", quoted: "leads quoted", applied: "leads with an application", issued: "leads with an issued policy",
};

/** One table line, whether it is a campaign or a vendor roll-up. */
type Line = {
  key: string;
  label: string;
  vendorId: string;
  vendorName: string;
  row: VendorScorecardRow | null;
  costPerRecord: number | null;
  records: number;
  leads: number;
  dialable: number;
  dialed: number | null;
  quoted: number | null;
  costPerContact: number | null;
  contacted: number;
  contact: number | null;
  undialableRate: number | null;
  apps: number;
  issued: number;
  netSpend: number | null;
  cpi: number | null;
  claimAcceptance: number | null;
  warnings: number;
  isTest: boolean;
  small: boolean;
  rank: number | null;
};

function campaignLine(row: VendorScorecardRow): Line {
  return { key: row.campaign_id, label: `${row.vendor_name} · ${row.campaign_name}`, vendorId: row.vendor_id, vendorName: row.vendor_name, row, costPerRecord: row.cost_per_record_cents, records: row.records_purchased, leads: row.leads_received, dialable: row.dialable_leads, dialed: row.dialed_leads, quoted: row.quoted_leads, costPerContact: row.effective_cost_per_contact_cents, contacted: row.contacted_leads, contact: row.contact_rate_percent, undialableRate: row.undialable_rate_percent, apps: row.applications, issued: row.issued_policies, netSpend: row.net_spend_cents, cpi: row.effective_cost_per_issued_policy_cents, claimAcceptance: row.claim_acceptance_rate_percent, warnings: row.attribution_warnings, isTest: row.is_test_batch, small: row.small_sample, rank: row.cost_rank };
}
function vendorLine(row: VendorScorecardVendorRow): Line {
  return { key: row.vendor_id, label: row.vendor_name, vendorId: row.vendor_id, vendorName: row.vendor_name, row: null, costPerRecord: row.cost_per_record_cents, records: row.records_purchased, leads: row.leads_received, dialable: row.dialable_leads, dialed: row.dialed_leads, quoted: row.quoted_leads, costPerContact: row.effective_cost_per_contact_cents, contacted: row.contacted_leads, contact: row.contact_rate_percent, undialableRate: row.undialable_rate_percent, apps: row.applications, issued: row.issued_policies, netSpend: row.net_spend_cents, cpi: row.effective_cost_per_issued_policy_cents, claimAcceptance: row.claim_acceptance_rate_percent, warnings: row.attribution_warnings, isTest: row.is_test_batch, small: row.small_sample, rank: row.cost_rank };
}

/**
 * Cheapest policy first: ranked lines by rank, then lines with no policy yet (highest spend first),
 * then test batches, which are never ranked. "Highest spend" is the old order, kept as an option.
 */
function sortLines(lines: Line[], sort: Sort) {
  const spend = (a: Line, b: Line) => (b.netSpend ?? -1) - (a.netSpend ?? -1);
  if (sort === "spend") return [...lines].sort(spend);
  const group = (line: Line) => (line.isTest ? 2 : line.rank == null ? 1 : 0);
  return [...lines].sort((a, b) => group(a) - group(b) || (a.rank ?? 0) - (b.rank ?? 0) || spend(a, b) || a.label.localeCompare(b.label));
}

/**
 * The tint: the cheapest and the dearest cost per issued policy among lines that are ranked and are
 * not small samples — a two-policy line is not "the best vendor". Needs two such lines to mean anything.
 */
function extremes(lines: Line[]) {
  const judged = lines.filter((line) => line.rank != null && !line.small && line.cpi != null);
  if (judged.length < 2) return { best: null as string | null, worst: null as string | null };
  const sorted = [...judged].sort((a, b) => (a.cpi as number) - (b.cpi as number));
  const best = sorted[0]; const worst = sorted[sorted.length - 1];
  return best.cpi === worst.cpi ? { best: null, worst: null } : { best: best.key, worst: worst.key };
}

/** Said on the two quality columns (LA-2.19 decision 11), as their tooltip. */
const METRICS_APART = "Undialable rate and claim acceptance answer different questions and are never combined into one score.";

/**
 * True CPA (p-app-true-cpa): what each vendor and campaign costs through an issued policy.
 *
 * Laid out to the UI consistency standard (docs/design/UI-CONSISTENCY.md): the header, one strip of
 * the headline figures, then one row of views (scorecard, funnel, slot and attempt curves, speed to
 * lead and consent, campaign comparison) with the report's period and filters on its right, which
 * every view reads; the leads behind a figure open their own page (/app/true-cpa/leads, 2026-11-03). The period and filters are a
 * draft that Apply commits, so a change of vendor does not fire three reloads.
 *
 * The Scorecard concept (LA-2 §14, "which vendor should I buy from again"): a By vendor / By campaign
 * view over the report's vendor_rows, cheapest-policy-first ranking with test batches left out, a
 * best/worst tint, price per record and dialable counts, a persistency toggle, and speed-to-lead and
 * consent read from the same views /app/campaigns reads. Vendor returns has its own page.
 */
/**
 * `framed`: inside the Reports page (components/app/reports/reports-page.tsx), which draws the title;
 * the views and the scope go to its top row, Export to its corner, and an applied period is kept in
 * the address for the other Reports views.
 */
export function TrueCpaWorkspace({ initialReport = null, framed = false }: { initialReport?: VendorScorecardReport | null; framed?: boolean } = {}) {
  // The page renders the default period's report on the server (LA-2.17-8), so the first paint has
  // the figures and no second round trip follows the shell. Its period is the one the server used.
  const [draft, setDraft] = useState<Scope>(() => ({ from: initialReport?.from ?? defaultFrom(), to: initialReport?.to ?? new Date().toISOString().slice(0, 10), vendorId: "", campaignId: "", productCode: "", persist: false }));
  const [applied, setApplied] = useState(draft);
  const [report, setReport] = useState<VendorScorecardReport | null>(initialReport);
  const [loading, setLoading] = useState(!initialReport);
  const [error, setError] = useState<string | null>(null);
  const served = useRef(initialReport ? queryFor(draft) : null);
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(0);
  const [grain, setGrain] = useState<Grain>("vendor");
  const [sort, setSort] = useState<Sort>("cost");
  const [filtersOpen, setFiltersOpen] = useState(false);
  const { tab: view, setTab: setView } = useUrlTab(VIEWS, "scorecard", "tab", { dropoff: "funnel" });
  const [curve, setCurve] = useState<"slot" | "attempt">("slot");
  // Refresh re-reads the applied scope; the query string alone would not change.
  const [reloadKey, setReloadKey] = useState(0);

  const query = useMemo(() => queryFor(applied), [applied]);

  useEffect(() => {
    // The server already rendered this exact scope: no second fetch for it.
    // (Not cleared on the skip, so a development double-mount skips twice rather than refetching.)
    if (served.current === query) return;
    served.current = null;
    let active = true;
    void (async () => {
      await Promise.resolve();
      if (!active) return;
      setLoading(true); setError(null);
      try {
        const response = await fetch(`/api/app/true-cpa?${query}`, { cache: "no-store" });
        const body = await response.json().catch(() => null);
        if (!active) return;
        if (!response.ok) throw new Error(body?.error ?? "Could not load the scorecard");
        setReport(body); setPage(0);
      } catch (cause) {
        if (active) setError(cause instanceof Error ? cause.message : "Could not load the scorecard");
      } finally {
        if (active) setLoading(false);
      }
    })();
    return () => { active = false; };
  }, [query, reloadKey]);

  function refresh() { served.current = null; setReloadKey((key) => key + 1); }

  /** The report's own scope as drill parameters: the applied period and filters. */
  function scopeParams(): Record<string, string> {
    const params: Record<string, string> = { from: applied.from, to: applied.to };
    if (applied.vendorId) params.vendor_id = applied.vendorId;
    if (applied.campaignId) params.campaign_id = applied.campaignId;
    if (applied.productCode) params.product_code = applied.productCode;
    if (applied.persist) params.persist_days = String(PERSIST_DAYS);
    return params;
  }

  /** The page of leads behind a figure, in this report's period and filters (LA-2.17-7). */
  const drillHref = (spec: DrillSpec) => trueCpaLeadsHref(spec, scopeParams());

  /** A line's figure: its campaign (or vendor) and a stage. */
  function lineDrill(line: Line, stage: ScorecardStage): DrillSpec {
    const params: Record<string, string> = { stage, vendor_id: line.vendorId };
    if (line.row) params.campaign_id = line.row.campaign_id;
    return { key: `${line.row ? "campaign" : "vendor"}:${line.key}:${stage}`, title: `${STAGE_NOUN[stage]} · ${line.label}`, params };
  }

  /** A headline figure, over everything the report is scoped to. */
  function totalDrill(stage: ScorecardStage): DrillSpec {
    return { key: `total:${stage}`, title: `${STAGE_NOUN[stage]} · everything in this report`, params: { stage } };
  }

  /** A vendor line opens that vendor's campaigns: the filter is applied, the view switches. */
  function openVendor(vendorId: string) {
    const next = { ...applied, vendorId, campaignId: "" };
    setDraft(next); setApplied(next); setGrain("campaign"); setSearch(""); setPage(0);
  }

  const apply = () => { setFiltersOpen(false); setApplied({ ...draft }); if (framed) keepSharedPeriod(draft); };
  /** A change that takes effect at once (the period, removing one filter chip): draft and applied together. */
  const applyNow = (next: Scope) => { setDraft(next); setApplied(next); setPage(0); if (framed && (next.from !== applied.from || next.to !== applied.to)) keepSharedPeriod(next); };
  const pending = JSON.stringify(draft) !== JSON.stringify(applied);
  const filterCount = [applied.vendorId, applied.campaignId, applied.productCode].filter(Boolean).length;
  const vendors = [...new Map((report?.rows ?? []).map((row) => [row.vendor_id, row.vendor_name])).entries()];
  const products = [...new Set((report?.rows ?? []).map((row) => row.product_code).filter((value): value is string => Boolean(value)))];
  const upgraded = report?.upgraded !== false;
  // Before the report migration there is no vendor roll-up to show; the campaign view still works.
  const effectiveGrain: Grain = report && !upgraded ? "campaign" : grain;

  const allLines = useMemo(() => effectiveGrain === "vendor" ? (report?.vendor_rows ?? []).map(vendorLine) : (report?.rows ?? []).map(campaignLine), [report, effectiveGrain]);
  const lines = useMemo(() => {
    const needle = search.trim().toLowerCase();
    return sortLines(allLines.filter((line) => !needle || line.label.toLowerCase().includes(needle)), sort);
  }, [allLines, search, sort]);
  const tint = useMemo(() => extremes(allLines), [allLines]);
  const pageCount = Math.max(1, Math.ceil(lines.length / PAGE_SIZE_CARDS));
  const currentPage = Math.min(page, pageCount - 1);
  const shown = lines.slice(currentPage * PAGE_SIZE_CARDS, currentPage * PAGE_SIZE_CARDS + PAGE_SIZE_CARDS);
  const totals = report?.totals;
  const exportUrl = `/api/app/true-cpa?${query}&format=csv`;
  const persistOn = report?.persist_days != null;
  const vendorRows = report?.vendor_rows ?? [];
  const speedRows = vendorRows.filter((row) => (row.speed_posted_leads ?? 0) > 0).sort((a, b) => (a.speed_median_seconds ?? Infinity) - (b.speed_median_seconds ?? Infinity));
  const slowest = Math.max(1, ...speedRows.map((row) => row.speed_median_seconds ?? 0));
  const consentRows = vendorRows.filter((row) => (row.consent_leads ?? 0) > 0).sort((a, b) => (b.consent_claimed_pct ?? -1) - (a.consent_claimed_pct ?? -1));
  const noun = effectiveGrain === "vendor" ? "vendor" : "campaign";

  const clearFilters = () => setDraft((current) => ({ ...current, vendorId: "", campaignId: "", productCode: "", persist: false }));
  /** Clear turns the filters off and applies at once: the table shows everything again. */
  const clearAndApply = () => { const next = { ...draft, vendorId: "", campaignId: "", productCode: "", persist: false }; setFiltersOpen(false); setDraft(next); setApplied(next); setSearch(""); setPage(0); };

  // First paint without a server-rendered report: the page's one loading look.
  if (loading && !report && !error) return framed ? <FramedLoading /> : <PageLoading />;

  const funnel = totals ? [
    { key: "bought", label: "Bought", value: totals.records_purchased as number | null, note: "records purchased, lifetime", cost: null as number | null, costLabel: "", stage: null as ScorecardStage | null },
    { key: "dialable", label: "Dialable", value: totals.dialable_leads as number | null, note: `of ${number(totals.leads_received)} received`, cost: totals.effective_cost_per_lead_cents, costLabel: "per lead", stage: "dialable" as ScorecardStage },
    { key: "dialed", label: "Dialled", value: totals.dialed_leads, note: "leads, not attempts", cost: null, costLabel: "", stage: "dialed" as ScorecardStage },
    { key: "contacted", label: "Contacted", value: totals.contacted_leads, note: share(totals.contacted_leads, totals.dialed_leads ?? undefined, "of dialled") ?? "leads reached", cost: totals.effective_cost_per_contact_cents, costLabel: "per contact", stage: "contacted" as ScorecardStage },
    { key: "quoted", label: "Quoted", value: totals.quoted_leads, note: "quote recorded or application", cost: null, costLabel: "", stage: "quoted" as ScorecardStage },
    { key: "applied", label: "Applied", value: totals.applied_leads ?? totals.applications, note: `${number(totals.applications)} application${totals.applications === 1 ? "" : "s"}`, cost: totals.effective_cost_per_application_cents, costLabel: "per application", stage: "applied" as ScorecardStage },
    { key: "issued", label: "Issued", value: totals.issued_policies, note: "policies", cost: totals.effective_cost_per_issued_policy_cents, costLabel: "per issued policy", stage: "issued" as ScorecardStage },
  ] : [];
  const tabs: { key: View; label: string }[] = [
    { key: "scorecard", label: "Vendors" },
    { key: "funnel", label: "Funnel" },
    { key: "contact", label: "Contact rate" },
    { key: "speed", label: "Speed to lead" },
    { key: "consent", label: "Consent certificates" },
    { key: "compare", label: "Compare" },
  ];
  const appliedFilters = filterCount + (applied.persist ? 1 : 0);
  const unallocated = report && upgraded ? totals?.unallocated_spend_campaigns ?? 0 : 0;
  const chips: ActiveFilter[] = [
    applied.vendorId ? { key: "vendor", label: "Vendor", value: vendors.find(([id]) => id === applied.vendorId)?.[1] ?? "One vendor", onRemove: () => applyNow({ ...applied, vendorId: "", campaignId: "" }) } : null,
    applied.campaignId ? { key: "campaign", label: "Campaign", value: (report?.rows ?? []).find((row) => row.campaign_id === applied.campaignId)?.campaign_name ?? "One campaign", onRemove: () => applyNow({ ...applied, campaignId: "" }) } : null,
    applied.productCode ? { key: "product", label: "Product", value: applied.productCode.replaceAll("_", " "), onRemove: () => applyNow({ ...applied, productCode: "" }) } : null,
    applied.persist ? { key: "persist", label: "Policies", value: `in force after ${PERSIST_DAYS} days`, onRemove: () => applyNow({ ...applied, persist: false }) } : null,
  ].filter((chip): chip is ActiveFilter => Boolean(chip));

  // The report's scope, in every list's toolbar (the period first, then Filters), and the panel under it
  // (UI-CONSISTENCY §6a). The period applies at once; the panel's choices wait for Apply.
  const scope = <>
    <PeriodPicker value={{ from: applied.from, to: applied.to }} onChange={(next) => applyNow({ ...applied, ...next })} />
    <FilterButton open={filtersOpen} controls="true-cpa-filters" onClick={() => setFiltersOpen((open) => !open)} count={appliedFilters} />
  </>;
  const scopeFilters = <>
    <FilterPanel id="true-cpa-filters" open={filtersOpen}>
      <FilterField label="Vendor" htmlFor="true-cpa-vendor"><select id="true-cpa-vendor" className={toolbarControl} value={draft.vendorId} onChange={(event) => setDraft((current) => ({ ...current, vendorId: event.target.value, campaignId: "" }))}><option value="">All vendors</option>{vendors.map(([id, name]) => <option key={id} value={id}>{name}</option>)}</select></FilterField>
      <FilterField label="Campaign" htmlFor="true-cpa-campaign"><select id="true-cpa-campaign" className={toolbarControl} value={draft.campaignId} onChange={(event) => setDraft((current) => ({ ...current, campaignId: event.target.value }))}><option value="">All campaigns</option>{(report?.rows ?? []).filter((row) => !draft.vendorId || row.vendor_id === draft.vendorId).map((row) => <option key={row.campaign_id} value={row.campaign_id}>{row.campaign_name}</option>)}</select></FilterField>
      <FilterField label="Product" htmlFor="true-cpa-product"><select id="true-cpa-product" className={toolbarControl} value={draft.productCode} onChange={(event) => setDraft((current) => ({ ...current, productCode: event.target.value }))}><option value="">All products</option>{products.map((product) => <option key={product} value={product}>{product.replaceAll("_", " ")}</option>)}</select></FilterField>
      <label className="inline-flex items-center gap-2 self-end pb-2 text-sm text-foreground" htmlFor="scorecard-persist" title={upgraded ? undefined : "Needs a database update that has not been applied yet."}>
        <input id="scorecard-persist" type="checkbox" className={checkboxControl} checked={draft.persist} disabled={!upgraded} onChange={(event) => setDraft((current) => ({ ...current, persist: event.target.checked }))} />
        <span>Only policies still in force after {PERSIST_DAYS} days</span>
      </label>
      <div className="flex items-end justify-end gap-2">
        <Button type="button" variant="ghost" onClick={clearFilters}>Clear</Button>
        <Button type="button" onClick={apply} disabled={!pending}>Apply</Button>
      </div>
    </FilterPanel>
    <ActiveFilters filters={chips} onClear={clearAndApply} />
  </>;
  const toolbar = (extra?: ReactNode, children?: ReactNode) => <DataToolbar actions={<>{extra}<RefreshButton onClick={refresh} refreshing={loading} /></>}>{scope}{children}</DataToolbar>;
  const notLoaded = <ErrorState title="The scorecard did not load" detail={error ?? "No figures for this period."} action={<Button variant="outline" onClick={refresh}>Try again</Button>} />;
  const pendingUpdate = <EmptyState title="Not available yet" hint="This needs a database update that has not been applied yet." />;

  return <div className="m-stagger flex w-full min-w-0 flex-col gap-6">
    {framed
      ? <ReportsSlot slot="corner"><Button asChild variant="outline"><a href={exportUrl}><Download aria-hidden="true" />Export</a></Button></ReportsSlot>
      : <PageHeader title="True CPA" description="What an issued policy really cost, by vendor and campaign." actions={<Button asChild variant="outline"><a href={exportUrl}><Download aria-hidden="true" />Export</a></Button>} />}

    {/* Spend that can't be counted yet goes to the bell (UI-CONSISTENCY §3), with the way to fix it. */}
    {unallocated > 0 && <Callout tone="warning" title={`${plural(unallocated, "campaign has", "campaigns have")} no records purchased entered`}>{unallocated === 1 ? "Its" : "Their"} spend is left out of Net spend and True CPA. <Link href="/app/lead-sources?tab=campaigns" className="font-semibold underline">Enter records purchased</Link></Callout>}
    {report && !upgraded && <Callout tone="warning" title="Some views wait on a database update">Until it is applied, net spend is lifetime spend, and the vendor view, test batches, persistency filter, speed and consent are unavailable.</Callout>}
    {error && report && <Callout tone="error" title="The scorecard did not reload">{error}</Callout>}

    {/* Five figures, each the link to the leads behind it (owner 2026-11-02: the tiles are the links). */}
    <StatStrip label="True CPA totals">
      <StatTile label="Net spend" value={loading ? "…" : dollars(totals?.net_spend_cents)} footnote={reportPeriod(applied.from, applied.to)} href={drillHref(totalDrill("received"))} />
      <StatTile label="Leads received" value={loading ? "…" : number(totals?.leads_received)} footnote={totals && totals.leads_received ? `${number(totals.dialable_leads)} dialable` : "after suppression"} href={drillHref(totalDrill("received"))} />
      <StatTile label="Applications" value={loading ? "…" : number(totals?.applications)} footnote={share(totals?.applied_leads ?? totals?.applications, totals?.contacted_leads, "of contacted leads") ?? "applications in the period"} href={report?.funnel ? drillHref(totalDrill("applied")) : undefined} />
      <StatTile label="Issued policies" value={loading ? "…" : number(totals?.issued_policies)} valueTone={totals?.issued_policies ? "good" : undefined} footnote={persistOn ? `in force after ${report?.persist_days} days${totals?.policies_not_yet_measurable ? ` · ${number(totals.policies_not_yet_measurable)} too recent` : ""}` : share(totals?.issued_policies, totals?.applications, "of applications")} reserveFootnote href={drillHref(totalDrill("issued"))} />
      <StatTile label="True CPA" value={loading ? "…" : dollars(totals?.effective_cost_per_issued_policy_cents)} valueTone={totals?.effective_cost_per_issued_policy_cents != null ? "primary" : undefined} footnote={persistOn ? "per persisting policy" : "per issued policy"} href={drillHref(totalDrill("issued"))} />
    </StatStrip>

    {/* The views, on the title line (UI-CONSISTENCY §8a): one list at a time. */}
    <InReportsSlot framed={framed} slot="lead">
      <ViewTabs label="True CPA views" tabs={tabs} value={view} onChange={setView} idPrefix="true-cpa-tab" controls="true-cpa-view" />
    </InReportsSlot>

    <div key={view} role="tabpanel" id="true-cpa-view" aria-labelledby={`true-cpa-tab-${view}`} className="flex min-w-0 flex-col gap-6">
    {/* Vendors (redesign 2026-10-26, owner pick B): one card per vendor — or per campaign — with its cost
        per issued policy large, its flags, and its own funnel from bought to issued. Every count opens
        the leads behind it. */}
    {view === "scorecard" && <TableCard
      toolbar={toolbar(undefined, <>
        <ToolbarSearch value={search} onChange={(value) => { setSearch(value); setPage(0); }} placeholder="Search vendor, campaign" />
        <div role="radiogroup" aria-label="Rows" className="flex flex-wrap items-center gap-2">
          {([["vendor", "By vendor"], ["campaign", "By campaign"]] as const).map(([key, text]) => (
            <ToggleChip key={key} role="radio" selected={effectiveGrain === key} disabled={key === "vendor" && Boolean(report) && !upgraded} onClick={() => { setGrain(key); setPage(0); }}>{text}</ToggleChip>
          ))}
        </div>
        <select aria-label="Sort" className={toolbarControl} value={sort} onChange={(event) => { setSort(event.target.value as Sort); setPage(0); }}>
          <option value="cost">Cheapest policy first</option>
          <option value="spend">Highest spend first</option>
        </select>
      </>)}
      filters={scopeFilters}
      footer={<Pager
        page={currentPage + 1}
        total={lines.length}
        noun={`${noun}s`}
        pageSize={PAGE_SIZE_CARDS}
        onPage={(next) => setPage(next - 1)}
        suffix={`${sort === "cost" ? "cheapest policy first, test batches last" : "highest spend first"} · a dash for True CPA means no issued policy yet, not zero cost${report ? ` · computed ${new Date(report.generated_at).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}` : ""}`}
      />}
    >
      {error && !report ? notLoaded
        : loading ? <SectionLoading rows={6} columns={4} />
        : lines.length === 0 ? (search || appliedFilters > 0 ? <NoMatches noun={`${noun}s`} onClear={clearAndApply} /> : <EmptyState title="No spend or leads in this period" hint="Widen the dates, or add a campaign with its spend." action={<Button asChild variant="outline"><Link href="/app/lead-sources?tab=campaigns">Open campaigns</Link></Button>} />)
        : <ul className="m-0 grid list-none gap-3.5 border-t border-border p-4 lg:grid-cols-2">
            {shown.map((line) => {
              const best = line.key === tint.best;
              const worst = line.key === tint.worst;
              // Every count opens its own rows. Before 20260925709800 only a campaign's leads can be
              // listed, so the other figures stay plain text.
              const figure = (value: number | null, stage: ScorecardStage, text = number(value)) => {
                const can = value != null && value > 0 && (report?.funnel || (stage === "received" && Boolean(line.row)));
                return can
                  ? <Link href={drillHref(lineDrill(line, stage))} className="tabular-nums hover:underline" aria-label={`${text} ${STAGE_NOUN[stage]} in ${line.label}: show the leads`}>{text}</Link>
                  : text;
              };
              const steps: Array<{ label: string; value: number | null; stage: ScorecardStage | null }> = [
                { label: "Bought", value: line.records, stage: null },
                { label: "Dialable", value: line.dialable, stage: "dialable" },
                { label: "Dialled", value: line.dialed, stage: "dialed" },
                { label: "Contacted", value: line.contacted, stage: "contacted" },
                { label: "Quoted", value: line.quoted, stage: "quoted" },
                { label: "Applied", value: line.apps, stage: "applied" },
                { label: "Issued", value: line.issued, stage: "issued" },
              ];
              const top = Math.max(1, ...steps.map((step) => step.value ?? 0));
              return <li key={line.key} className={cn("m-glass flex min-w-0 flex-col gap-3 rounded-xl border p-4", best ? "border-[var(--success)]/50" : worst ? "border-[var(--error)]/50" : "border-border")}>
                <div className="flex items-start justify-between gap-3">
                  <span className="min-w-0">
                    <strong className="block truncate text-sm font-semibold text-foreground" title={line.label}>{line.label}</strong>
                    <span className="block text-xs text-muted-foreground">{dollars(line.netSpend)} net spend{line.costPerRecord != null ? ` · ${dollars(line.costPerRecord)} a record` : ""}</span>
                  </span>
                  <span className="shrink-0 text-right">
                    <strong className={cn("block text-2xl font-semibold leading-tight tracking-[-0.02em] tabular-nums", best ? "text-[var(--success-ink)]" : worst ? "text-[var(--error-ink)]" : line.isTest ? "text-muted-foreground" : "text-foreground")}>{figure(line.cpi == null ? null : line.issued, "issued", dollars(line.cpi))}</strong>
                    <span className="inline-flex items-center gap-1 text-xs text-muted-foreground">per issued policy<InfoTip label="About True CPA" side="bottom">Net spend divided by issued policies. A dash means no issued policy is attributed yet. It is never $0.00.</InfoTip></span>
                  </span>
                </div>
                {(line.isTest || line.small || best || worst) && <span className="flex flex-wrap items-center gap-1.5">
                  {line.isTest && <StatusChip tone="info">Test batch</StatusChip>}
                  {!line.isTest && line.small && <StatusChip tone="warning">Small sample</StatusChip>}
                  {best && <StatusChip tone="good">Cheapest policy</StatusChip>}
                  {worst && <StatusChip tone="danger">Dearest policy</StatusChip>}
                </span>}
                <div className="flex flex-col gap-1.5" aria-label={`${line.label}: from bought to issued`}>
                  {steps.map((step) => <div key={step.label} className="grid grid-cols-[80px_minmax(0,1fr)_64px] items-center gap-2.5 text-xs">
                    <span className="text-[var(--body)]">{step.label}</span>
                    <span className="h-1.5 overflow-hidden rounded-full bg-[var(--surface-alt)]"><span className="m-bar-x block h-full rounded-full bg-[var(--primary)]" style={{ width: `${step.value ? Math.max(2, (100 * step.value) / top) : 0}%` }} /></span>
                    <span className="text-right tabular-nums text-foreground">{step.stage ? figure(step.value, step.stage) : <span title={`${plural(line.records, "record")} bought`}>{number(step.value)}</span>}</span>
                  </div>)}
                </div>
                <div className="grid grid-cols-2 gap-x-4 gap-y-1.5 border-t border-border pt-3 text-xs sm:grid-cols-4">
                  <span><span className="block text-muted-foreground">Contact</span><span className="tabular-nums text-foreground">{percent(line.contact)} · {dollars(line.costPerContact)}</span></span>
                  <span title={METRICS_APART}><span className="block text-muted-foreground">Undialable rate<span className="block text-[var(--muted)]">Low is good</span></span><span className="tabular-nums text-foreground">{figure(line.undialableRate == null ? null : Math.max(0, line.leads - line.dialable), "undialable", percent(line.undialableRate))}</span></span>
                  <span title={METRICS_APART}><span className="block text-muted-foreground">Claim acceptance<span className="block text-[var(--muted)]">High is good</span></span><span className="tabular-nums text-foreground">{percent(line.claimAcceptance)}</span></span>
                  <span><span className="block text-muted-foreground">Lineage</span>{line.warnings ? <span className="text-[var(--warning-ink)]">{line.warnings} to review</span> : <span className="text-[var(--success-ink)]">Linked</span>}</span>
                </div>
                <div className="flex items-center justify-between gap-2">
                  <span className="text-xs text-muted-foreground">{figure(line.leads, "received")} leads received</span>
                  {line.row
                    ? <Button asChild size="sm" variant="outline"><Link href={drillHref(lineDrill(line, "received"))}>Leads</Link></Button>
                    : <Button type="button" size="sm" variant="outline" onClick={() => openVendor(line.vendorId)}>See campaigns</Button>}
                </div>
              </li>;
            })}
          </ul>}
    </TableCard>}

    {/* The funnel (LA-2.17-2): bought, dialable, dialled, contacted, quoted, applied, issued, each with its
        cost where the spec asks for one (a dash with none, never $0), and each opening its rows. Dialled
        and quoted need 20260925709800; until then they say so. */}
    {view === "funnel" && <TableCard toolbar={toolbar()} filters={scopeFilters} footer={<span>What became of this period&rsquo;s leads, and what each step cost</span>}>
      {!report ? (loading ? <SectionLoading rows={2} columns={7} /> : notLoaded) : !totals ? pendingUpdate : (
        <table className="portal-lead-table w-full min-w-[760px] text-left text-sm">
          <thead><tr>{funnel.map((step) => <th key={step.key} scope="col">{step.label}</th>)}</tr></thead>
          <tbody><tr>
            {funnel.map((step) => {
              const pendingStage = step.value == null;
              const canOpen = step.stage !== null && !pendingStage && (report?.funnel || step.stage === "received");
              return <td key={step.key} className="whitespace-normal! align-top">
                {canOpen
                  ? <Link href={drillHref(totalDrill(step.stage as ScorecardStage))} className="text-base font-semibold tabular-nums text-foreground hover:underline" aria-label={`${number(step.value)} ${step.label.toLowerCase()}: show the leads`}>{number(step.value)}</Link>
                  : <span className="text-base font-semibold tabular-nums text-foreground">{number(step.value)}</span>}
                <span className="block text-xs text-muted-foreground">{pendingStage ? "needs a database update" : step.note}</span>
                {step.costLabel && <span className="block text-xs tabular-nums text-[var(--body)]">{dollars(step.cost)} {step.costLabel}</span>}
              </td>;
            })}
          </tr></tbody>
        </table>
      )}
    </TableCard>}

    {/* Contact rate: by slot or by attempt (the attempts-to-contact curve), one at a time. */}
    {view === "contact" && (() => {
      const items = !report ? [] : curve === "slot"
        ? report.contact_rate_by_slot.map((item) => ({ key: item.slot, label: item.slot.replaceAll("_", " "), rate: item.rate_percent, contacts: item.contacts, attempts: item.attempts, share: null as number | null, spec: { key: `slot:${item.slot}`, title: `leads dialled in the ${item.slot.replaceAll("_", " ")} slot`, params: { stage: "received", slot: item.slot } } as DrillSpec }))
        : report.attempts_to_contact.map((item) => ({ key: String(item.attempt_number), label: `Attempt ${item.attempt_number}`, rate: item.rate_percent, contacts: item.contacts, attempts: item.attempts, share: item.share_of_contacts_percent, spec: { key: `attempt:${item.attempt_number}`, title: `leads with an attempt ${item.attempt_number} outcome`, params: { stage: "received", attempt_number: String(item.attempt_number) } } as DrillSpec }));
      return <TableCard
        toolbar={toolbar(undefined, <div role="radiogroup" aria-label="Contact rate by" className="flex flex-wrap items-center gap-2">
          <ToggleChip role="radio" selected={curve === "slot"} onClick={() => setCurve("slot")}>By slot</ToggleChip>
          <ToggleChip role="radio" selected={curve === "attempt"} onClick={() => setCurve("attempt")}>By attempt</ToggleChip>
        </div>)}
        filters={scopeFilters}
      >
        {!report ? (loading ? <SectionLoading rows={4} columns={3} /> : notLoaded) : items.length === 0 ? <EmptyState title="No dispositions in this period" hint="Rates appear once calls are dispositioned." /> : (
          <table className="portal-lead-table w-full min-w-[640px] text-left text-sm">
            <thead><tr><th>{curve === "slot" ? "Slot" : "Attempt"}</th><th className="w-[40%]"><span className="sr-only">Rate</span></th><th className="text-right">Contact rate</th><th className="text-right">Contacts / attempts</th>{curve === "attempt" && <th className="text-right">% of contacts</th>}</tr></thead>
            <tbody>
              {items.map((item) => <tr key={item.key}>
                <td className="capitalize">{report.funnel && item.attempts > 0 ? <Link href={drillHref(item.spec)} className="hover:underline" aria-label={`${item.label}: show the leads`}>{item.label}</Link> : item.label}</td>
                <td><span aria-hidden className="block h-1.5 overflow-hidden rounded-full bg-[var(--surface-alt)]"><span className="m-bar-x block h-full rounded-full bg-[var(--primary)]" style={{ width: `${Math.min(100, item.rate ?? 0)}%` }} /></span></td>
                <td className="text-right font-semibold tabular-nums">{percent(item.rate)}</td>
                <td className="text-right tabular-nums text-muted-foreground">{item.contacts}/{item.attempts}</td>
                {curve === "attempt" && <td className="text-right tabular-nums">{item.share != null ? `${item.share}%` : "—"}</td>}
              </tr>)}
            </tbody>
          </table>
        )}
      </TableCard>;
    })()}

    {view === "speed" && <TableCard toolbar={toolbar()} filters={scopeFilters} footer={<span>Median arrival to first dial · real-time leads · all time</span>}>
      {!report ? (loading ? <SectionLoading rows={4} columns={3} /> : notLoaded) : !upgraded ? pendingUpdate : speedRows.length === 0 ? <EmptyState title="No real-time leads yet" hint="Leads posted by a vendor in real time show here." /> : (
        <table className="portal-lead-table w-full min-w-[640px] text-left text-sm">
          <thead><tr><th>Vendor</th><th className="w-[36%]"><span className="sr-only">Median</span></th><th className="text-right">Median to first dial</th><th className="text-right">Within a minute</th></tr></thead>
          <tbody>
            {speedRows.map((row) => <Fragment key={row.vendor_id}>
              <tr>
                <td className="font-semibold text-foreground">{row.vendor_name}</td>
                <td><span aria-hidden className="block h-1.5 overflow-hidden rounded-full bg-[var(--surface-alt)]"><span className="m-bar-x block h-full rounded-full bg-[var(--primary)]" style={{ width: `${Math.min(100, (100 * (row.speed_median_seconds ?? 0)) / slowest)}%` }} /></span></td>
                <td className={cn("text-right font-semibold tabular-nums", row.speed_median_seconds != null && row.speed_median_seconds <= 60 && "text-[var(--success-ink)]")}>{clock(row.speed_median_seconds)}</td>
                <td className="text-right tabular-nums">{percent(row.speed_within_60s_pct)}</td>
              </tr>
              {/* LA-2.5-5: the vendor's campaigns, one line each, under its row. */}
              <tr><td colSpan={4} className="py-0"><CampaignSpeedToLead vendorId={row.vendor_id} /></td></tr>
            </Fragment>)}
          </tbody>
        </table>
      )}
    </TableCard>}

    {view === "consent" && <TableCard toolbar={toolbar()} filters={scopeFilters} footer={<span>Leads with a stored TrustedForm or Jornaya certificate · all time</span>}>
      {!report ? (loading ? <SectionLoading rows={4} columns={3} /> : notLoaded) : !upgraded ? pendingUpdate : consentRows.length === 0 ? <EmptyState title="No vendor leads yet" hint="Coverage shows once a vendor has sent leads." /> : (
        <table className="portal-lead-table w-full min-w-[640px] text-left text-sm">
          <thead><tr><th>Vendor</th><th className="text-right">Certificate stored</th><th className="text-right">Arrived with one</th><th className="text-right">Leads</th></tr></thead>
          <tbody>
            {consentRows.map((row) => <tr key={row.vendor_id}>
              <td className="font-semibold text-foreground">{row.vendor_name}</td>
              <td className={cn("text-right font-semibold tabular-nums", row.consent_claimed_pct != null && row.consent_claimed_pct < 50 && "text-[var(--error-ink)]")}>{percent(row.consent_claimed_pct)}</td>
              <td className="text-right tabular-nums">{percent(row.consent_any_pct)}</td>
              <td className="text-right tabular-nums">{number(row.consent_leads)}</td>
            </tr>)}
          </tbody>
        </table>
      )}
    </TableCard>}

    {view === "compare" && <CampaignComparisonWorkspace rows={report?.rows ?? []} defaultFrom={applied.from} defaultTo={applied.to} />}
    </div>
  </div>;
}
