"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { Download } from "lucide-react";
import { Button } from "@/components/ui/button";
import { DataToolbar, FilterButton, RefreshButton, ToolbarSearch, toolbarControl } from "@/components/ui/data-toolbar";
import { PageHeader } from "@/components/ui/page-header";
import { PageLoading } from "@/components/ui/page-loading";
import { Pager } from "@/components/ui/pager";
import { ErrorState, NoMatches, SectionLoading } from "@/components/ui/page-states";
import { StatStrip, StatTile } from "@/components/ui/stat";
import { StatusChip } from "@/components/ui/status-chip";
import { TableCard } from "@/components/ui/table-card";
import type { ScorecardStage, VendorScorecardLeadResult, VendorScorecardReport, VendorScorecardRow, VendorScorecardVendorRow } from "@/lib/vendorScorecard/types";
import { CampaignComparisonWorkspace } from "./campaign-comparison-workspace";
import { CampaignSpeedToLead } from "@/components/app/campaign-speed-to-lead";

const PAGE_SIZE = 25;
/** The persistency toggle's window. User decision: 60 days. Mirrors SCORECARD_PERSIST_DAYS on the server. */
const PERSIST_DAYS = 60;
const MONTHS_LONG = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];

/** 90 days ending today, the default period (the SQL applies the same one when sent no dates). */
function defaultFrom() { const d = new Date(); d.setDate(d.getDate() - 89); return d.toISOString().slice(0, 10); }
function dollars(cents: number | null | undefined) { return cents == null ? "—" : new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 2, minimumFractionDigits: 2 }).format(cents / 100); }
function number(value: number | null | undefined) { return value == null ? "—" : value.toLocaleString(); }
function percent(value: number | null | undefined) { return value == null ? "—" : `${value}%`; }
/** "4:12" for a median in seconds. */
function clock(seconds: number | null | undefined) { if (seconds == null) return "—"; const s = Math.round(seconds); return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`; }
function plural(count: number, one: string, many = `${one}s`) { return `${count.toLocaleString()} ${count === 1 ? one : many}`; }
/** "6.3% of leads" — the artboard's footnote, computed rather than typed. */
function share(part: number | null | undefined, whole: number | null | undefined, suffix: string) {
  if (part == null || whole == null || whole === 0) return undefined;
  return `${((part / whole) * 100).toFixed(1)}% ${suffix}`;
}
const day = (iso: string) => { const [y, m, d] = iso.split("-").map(Number); return { y, m, d }; };
/** "1–22 September" for the spend tile, the way the board phrases a period. */
function longRange(from: string, to: string) {
  const a = day(from); const b = day(to);
  if (a.y !== b.y) return `${a.d} ${MONTHS_LONG[a.m - 1]} ${a.y} – ${b.d} ${MONTHS_LONG[b.m - 1]} ${b.y}`;
  if (a.m !== b.m) return `${a.d} ${MONTHS_LONG[a.m - 1]} – ${b.d} ${MONTHS_LONG[b.m - 1]}`;
  return `${a.d}–${b.d} ${MONTHS_LONG[b.m - 1]}`;
}

/** A one-line notice the reader must act on (standard §3). */
const notice = "rounded-lg border border-[var(--warning)]/30 bg-[var(--warning-surface)] px-4 py-2.5 text-sm leading-normal tracking-[-0.02em] text-[var(--warning-ink)]";
const th = "bg-[var(--surface-alt)] px-3 py-2 text-xs font-semibold uppercase leading-[1.33] tracking-[0.02em] text-muted-foreground";
const td = "border-t border-border px-3 py-2 text-sm leading-normal tracking-[-0.02em] text-[var(--body)]";

type Scope = { from: string; to: string; vendorId: string; campaignId: string; productCode: string; persist: boolean };
type Grain = "vendor" | "campaign";
type Sort = "cost" | "spend";
function queryFor(value: Scope) { const params = new URLSearchParams({ from: value.from, to: value.to }); if (value.vendorId) params.set("vendor_id", value.vendorId); if (value.campaignId) params.set("campaign_id", value.campaignId); if (value.productCode) params.set("product_code", value.productCode); if (value.persist) params.set("persist_days", String(PERSIST_DAYS)); return params.toString(); }

/**
 * What a click on a figure opens (LA-2.17-7): the leads behind it, in the report's own scope. The
 * key identifies the figure so a second click closes it.
 */
type DrillSpec = { key: string; title: string; params: Record<string, string> };
const DRILL_PAGE = 100;
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
 * the headline figures, then the scorecard table with its period and filters in the table's own
 * toolbar, then the secondary tables (funnel, the leads behind a figure, slot and attempt curves,
 * speed to lead, consent, campaign comparison). The period and filters are a draft that Apply
 * commits, so a change of vendor does not fire three reloads.
 *
 * The Scorecard concept (LA-2 §14, "which vendor should I buy from again"): a By vendor / By campaign
 * view over the report's vendor_rows, cheapest-policy-first ranking with test batches left out, a
 * best/worst tint, price per record and dialable counts, a persistency toggle, and speed-to-lead and
 * consent read from the same views /app/campaigns reads. Vendor returns has its own page.
 */
export function TrueCpaWorkspace({ initialReport = null }: { initialReport?: VendorScorecardReport | null } = {}) {
  // The page renders the default period's report on the server (LA-2.17-8), so the first paint has
  // the figures and no second round trip follows the shell. Its period is the one the server used.
  const [draft, setDraft] = useState<Scope>(() => ({ from: initialReport?.from ?? defaultFrom(), to: initialReport?.to ?? new Date().toISOString().slice(0, 10), vendorId: "", campaignId: "", productCode: "", persist: false }));
  const [applied, setApplied] = useState(draft);
  const [report, setReport] = useState<VendorScorecardReport | null>(initialReport);
  const [drillSpec, setDrillSpec] = useState<DrillSpec | null>(null);
  const [drillResult, setDrillResult] = useState<VendorScorecardLeadResult | null>(null);
  const [drillError, setDrillError] = useState<string | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [loading, setLoading] = useState(!initialReport);
  const [error, setError] = useState<string | null>(null);
  const served = useRef(initialReport ? queryFor(draft) : null);
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(0);
  const [grain, setGrain] = useState<Grain>("vendor");
  const [sort, setSort] = useState<Sort>("cost");
  const [filtersOpen, setFiltersOpen] = useState(false);
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
        setReport(body); setDrillSpec(null); setDrillResult(null); setPage(0);
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

  async function loadDrill(spec: DrillSpec, offset: number) {
    setDetailLoading(true); setDrillError(null);
    const params = new URLSearchParams({ ...scopeParams(), ...spec.params, offset: String(offset), limit: String(DRILL_PAGE) });
    try {
      const response = await fetch(`/api/app/true-cpa/leads?${params}`, { cache: "no-store" });
      const body = await response.json().catch(() => null);
      if (!response.ok) throw new Error(body?.error ?? "Could not load the leads behind this figure");
      setDrillResult(body as VendorScorecardLeadResult);
    } catch (cause) {
      setDrillResult(null);
      setDrillError(cause instanceof Error ? cause.message : "Could not load the leads behind this figure");
    } finally {
      setDetailLoading(false);
    }
  }

  /** Open the leads behind a figure; the same figure again closes them. */
  function openDrill(spec: DrillSpec) {
    if (drillSpec?.key === spec.key) { setDrillSpec(null); setDrillResult(null); setDrillError(null); return; }
    setDrillSpec(spec); setDrillResult(null);
    void loadDrill(spec, 0);
    requestAnimationFrame(() => document.getElementById("cpa-leads")?.scrollIntoView({ behavior: "smooth", block: "nearest" }));
  }

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

  function drill(row: VendorScorecardRow) {
    openDrill(lineDrill(campaignLine(row), "received"));
  }

  /** A vendor line opens that vendor's campaigns: the filter is applied, the view switches. */
  function openVendor(vendorId: string) {
    const next = { ...applied, vendorId, campaignId: "" };
    setDraft(next); setApplied(next); setGrain("campaign"); setSearch(""); setPage(0);
  }

  const apply = () => { setFiltersOpen(false); setApplied({ ...draft }); };
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
  const pageCount = Math.max(1, Math.ceil(lines.length / PAGE_SIZE));
  const currentPage = Math.min(page, pageCount - 1);
  const shown = lines.slice(currentPage * PAGE_SIZE, currentPage * PAGE_SIZE + PAGE_SIZE);
  const totals = report?.totals;
  const exportUrl = `/api/app/true-cpa?${query}&format=csv`;
  const persistOn = report?.persist_days != null;
  const vendorRows = report?.vendor_rows ?? [];
  const speedRows = vendorRows.filter((row) => (row.speed_posted_leads ?? 0) > 0).sort((a, b) => (a.speed_median_seconds ?? Infinity) - (b.speed_median_seconds ?? Infinity));
  const slowest = Math.max(1, ...speedRows.map((row) => row.speed_median_seconds ?? 0));
  const consentRows = vendorRows.filter((row) => (row.consent_leads ?? 0) > 0).sort((a, b) => (b.consent_claimed_pct ?? -1) - (a.consent_claimed_pct ?? -1));
  const noun = effectiveGrain === "vendor" ? "vendor" : "campaign";

  const clearFilters = () => setDraft((current) => ({ ...current, vendorId: "", campaignId: "", productCode: "", persist: false }));

  // First paint without a server-rendered report: the page's one loading look.
  if (loading && !report && !error) return <PageLoading />;

  const funnel = totals ? [
    { key: "bought", label: "Bought", value: totals.records_purchased as number | null, note: "records purchased, lifetime", cost: null as number | null, costLabel: "", stage: null as ScorecardStage | null },
    { key: "dialable", label: "Dialable", value: totals.dialable_leads as number | null, note: `of ${number(totals.leads_received)} received`, cost: totals.effective_cost_per_lead_cents, costLabel: "per lead", stage: "dialable" as ScorecardStage },
    { key: "dialed", label: "Dialled", value: totals.dialed_leads, note: "leads, not attempts", cost: null, costLabel: "", stage: "dialed" as ScorecardStage },
    { key: "contacted", label: "Contacted", value: totals.contacted_leads, note: share(totals.contacted_leads, totals.dialed_leads ?? undefined, "of dialled") ?? "leads reached", cost: totals.effective_cost_per_contact_cents, costLabel: "per contact", stage: "contacted" as ScorecardStage },
    { key: "quoted", label: "Quoted", value: totals.quoted_leads, note: "quote recorded or application", cost: null, costLabel: "", stage: "quoted" as ScorecardStage },
    { key: "applied", label: "Applied", value: totals.applied_leads ?? totals.applications, note: `${number(totals.applications)} application${totals.applications === 1 ? "" : "s"}`, cost: totals.effective_cost_per_application_cents, costLabel: "per application", stage: "applied" as ScorecardStage },
    { key: "issued", label: "Issued", value: totals.issued_policies, note: "policies", cost: totals.effective_cost_per_issued_policy_cents, costLabel: "per issued policy", stage: "issued" as ScorecardStage },
  ] : [];

  return <div className="m-stagger flex w-full min-w-0 flex-col gap-6">
    <PageHeader title="True CPA" description="What each vendor and campaign actually costs through an issued policy." />

    <StatStrip label="True CPA totals">
      <StatTile label="Net spend" value={loading ? "…" : dollars(totals?.net_spend_cents)} footnote={longRange(applied.from, applied.to)} action={<RowsLink label="the leads this spend bought" onClick={() => openDrill(totalDrill("received"))} />} />
      <StatTile label="Leads received" value={loading ? "…" : number(totals?.leads_received)} footnote={totals && totals.leads_received ? `${number(totals.dialable_leads)} dialable` : "after suppression"} action={<RowsLink label="the leads received" onClick={() => openDrill(totalDrill("received"))} />} />
      <StatTile label="Applications" value={loading ? "…" : number(totals?.applications)} footnote={share(totals?.applications, totals?.leads_received, "of leads")} reserveFootnote action={<RowsLink label="the leads with an application" onClick={() => openDrill(totalDrill("applied"))} />} />
      <StatTile label="Issued policies" value={loading ? "…" : number(totals?.issued_policies)} valueTone={totals?.issued_policies ? "good" : undefined} footnote={persistOn ? `in force after ${report?.persist_days} days${totals?.policies_not_yet_measurable ? ` · ${number(totals.policies_not_yet_measurable)} too recent` : ""}` : share(totals?.issued_policies, totals?.applications, "of applications")} reserveFootnote action={<RowsLink label="the leads with an issued policy" onClick={() => openDrill(totalDrill("issued"))} />} />
      <StatTile label="True CPA" value={loading ? "…" : dollars(totals?.effective_cost_per_issued_policy_cents)} valueTone={totals?.effective_cost_per_issued_policy_cents != null ? "primary" : undefined} footnote={persistOn ? "per persisting policy" : "per issued policy"} action={<RowsLink label="the policies behind it" onClick={() => openDrill(totalDrill("issued"))} />} />
    </StatStrip>

    {report && !upgraded && <p className={notice} role="status">A database update is pending: net spend is lifetime spend, and the vendor view, test batches, persistency filter, speed and consent are unavailable until it is applied.</p>}
    {report && upgraded && (totals?.unallocated_spend_campaigns ?? 0) > 0 && <p className={notice} role="status">{plural(totals?.unallocated_spend_campaigns ?? 0, "campaign")} with spend but no records purchased {totals?.unallocated_spend_campaigns === 1 ? "is" : "are"} left out of Net spend and True CPA. Enter the records purchased on the campaign.</p>}

    <TableCard
      toolbar={
        <DataToolbar
          actions={<>
            {pending && <Button type="button" onClick={apply}>Apply</Button>}
            <Button asChild variant="outline"><a href={exportUrl}><Download aria-hidden="true" />Export</a></Button>
            <RefreshButton onClick={refresh} refreshing={loading} />
          </>}
        >
          <ToolbarSearch value={search} onChange={(value) => { setSearch(value); setPage(0); }} placeholder="Search vendor, campaign" />
          <input type="date" aria-label="From" className={toolbarControl} value={draft.from} max={draft.to} onChange={(event) => setDraft((current) => ({ ...current, from: event.target.value || current.from }))} />
          <input type="date" aria-label="To" className={toolbarControl} value={draft.to} min={draft.from} onChange={(event) => setDraft((current) => ({ ...current, to: event.target.value || current.to }))} />
          <FilterButton open={filtersOpen} onClick={() => setFiltersOpen((open) => !open)} count={filterCount} />
          <select aria-label="Rows" className={toolbarControl} value={effectiveGrain} onChange={(event) => { setGrain(event.target.value as Grain); setPage(0); }}>
            <option value="vendor" disabled={Boolean(report) && !upgraded}>By vendor</option>
            <option value="campaign">By campaign</option>
          </select>
          <select aria-label="Sort" className={toolbarControl} value={sort} onChange={(event) => { setSort(event.target.value as Sort); setPage(0); }}>
            <option value="cost">Cheapest policy first</option>
            <option value="spend">Highest spend first</option>
          </select>
          {filtersOpen && <div className="flex w-full flex-wrap items-center gap-2" role="group" aria-label="Filter the scorecard">
            <select aria-label="Vendor" className={toolbarControl} value={draft.vendorId} onChange={(event) => setDraft((current) => ({ ...current, vendorId: event.target.value, campaignId: "" }))}><option value="">All vendors</option>{vendors.map(([id, name]) => <option key={id} value={id}>{name}</option>)}</select>
            <select aria-label="Campaign" className={toolbarControl} value={draft.campaignId} onChange={(event) => setDraft((current) => ({ ...current, campaignId: event.target.value }))}><option value="">All campaigns</option>{(report?.rows ?? []).filter((row) => !draft.vendorId || row.vendor_id === draft.vendorId).map((row) => <option key={row.campaign_id} value={row.campaign_id}>{row.campaign_name}</option>)}</select>
            <select aria-label="Product" className={toolbarControl} value={draft.productCode} onChange={(event) => setDraft((current) => ({ ...current, productCode: event.target.value }))}><option value="">All products</option>{products.map((product) => <option key={product} value={product}>{product.replaceAll("_", " ")}</option>)}</select>
            <label className="inline-flex h-9 items-center gap-2 text-sm text-foreground" htmlFor="scorecard-persist" title={upgraded ? undefined : "Needs a database update that has not been applied yet."}>
              <input id="scorecard-persist" type="checkbox" checked={draft.persist} disabled={!upgraded} onChange={(event) => setDraft((current) => ({ ...current, persist: event.target.checked }))} />
              <span>Only policies still in force after {PERSIST_DAYS} days</span>
            </label>
            <Button type="button" variant="ghost" onClick={clearFilters}>Clear</Button>
          </div>}
        </DataToolbar>
      }
      footer={<Pager
        page={currentPage + 1}
        total={lines.length}
        noun={`${noun}s`}
        pageSize={PAGE_SIZE}
        onPage={(next) => setPage(next - 1)}
        suffix={`${sort === "cost" ? "cheapest policy first, test batches last" : "highest spend first"}${report ? ` · computed ${new Date(report.generated_at).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}` : ""}`}
      />}
    >
      {error && !report ? <ErrorState title="The scorecard did not load" detail={error} action={<Button variant="outline" onClick={refresh}>Try again</Button>} />
        : loading ? <SectionLoading rows={6} columns={8} />
        : lines.length === 0 ? (search ? <NoMatches noun={`${noun}s`} onClear={() => { setSearch(""); setPage(0); }} /> : <p className="px-4 py-8 text-center text-sm text-muted-foreground">No campaign has spend or leads in this period.</p>)
        : <table className="w-full min-w-[1400px] table-fixed border-collapse text-left">
          <thead><tr>
            <th scope="col" className={th}>{effectiveGrain === "vendor" ? "Vendor" : <>Vendor &amp; campaign</>}</th>
            <th scope="col" className={`${th} w-[80px] text-right`}>Leads</th>
            <th scope="col" className={`${th} w-[80px] text-right`}>Dialable</th>
            <th scope="col" className={`${th} w-[80px] text-right`}>Dialled</th>
            <th scope="col" className={`${th} w-[80px] text-right`}>Contact</th>
            <th scope="col" className={`${th} w-[100px] text-right`}>Cost / contact</th>
            <th scope="col" className={`${th} w-[76px] text-right`}>Quoted</th>
            <th scope="col" className={`${th} w-[110px] text-right`} title={METRICS_APART}>Undialable rate<span className="block text-xs font-normal normal-case tracking-normal">Low is good</span></th>
            <th scope="col" className={`${th} w-[64px] text-right`}>Apps</th>
            <th scope="col" className={`${th} w-[70px] text-right`}>Issued</th>
            <th scope="col" className={`${th} w-[105px] text-right`}>Net spend</th>
            <th scope="col" className={`${th} w-[105px] text-right`} title="A dash means no issued policy is attributed yet. It is never $0.00.">True CPA</th>
            <th scope="col" className={`${th} w-[120px] text-right`} title={METRICS_APART}>Claim acceptance<span className="block text-xs font-normal normal-case tracking-normal">High is good</span></th>
            <th scope="col" className={`${th} w-[110px]`}>Lineage</th>
          </tr></thead>
          <tbody>
            {shown.map((line) => {
              const open = Boolean(drillSpec?.key.startsWith(`${line.row ? "campaign" : "vendor"}:${line.key}:`));
              const tone = open ? "bg-[var(--soft-orange-surface)]" : line.key === tint.best ? "bg-[var(--success-surface)]" : line.key === tint.worst ? "bg-[var(--error-surface)]" : "";
              const activate = () => { if (line.row) drill(line.row); else openVendor(line.vendorId); };
              // Every figure in the line opens its own rows. Before 20260925709800 only a
              // campaign's leads can be listed, so the other figures stay plain text.
              const figure = (value: number | null, stage: ScorecardStage, text = number(value)) => {
                const can = value != null && value > 0 && (report?.funnel || (stage === "received" && Boolean(line.row)));
                return can
                  ? <button type="button" className="tabular-nums hover:underline" aria-label={`${text} ${STAGE_NOUN[stage]} in ${line.label}: show the leads`} onClick={(event) => { event.stopPropagation(); openDrill(lineDrill(line, stage)); }}>{text}</button>
                  : text;
              };
              return <tr key={line.key} className={`m-row cursor-pointer ${tone}`} onClick={activate}>
                <td className={td}>
                  <button type="button" aria-expanded={line.row ? open : undefined} className="text-left text-sm tracking-[-0.02em] text-[var(--body)] hover:underline" onClick={(event) => { event.stopPropagation(); activate(); }}>{line.label}</button>
                  <span className="mt-0.5 flex flex-wrap items-center gap-1.5">
                    {line.isTest && <StatusChip tone="info">Test batch</StatusChip>}
                    {!line.isTest && line.small && <StatusChip tone="warning">Small sample</StatusChip>}
                    {line.key === tint.best && <StatusChip tone="good">Cheapest policy</StatusChip>}
                    {line.key === tint.worst && <StatusChip tone="danger">Dearest policy</StatusChip>}
                  </span>
                  <span className="block text-xs leading-normal text-muted-foreground tabular-nums">{line.costPerRecord != null ? `${dollars(line.costPerRecord)} / record · ` : ""}{plural(line.records, "record")} bought</span>
                </td>
                <td className={`${td} text-right tabular-nums`}>{figure(line.leads, "received")}</td>
                <td className={`${td} text-right tabular-nums`}>{figure(line.dialable, "dialable")}</td>
                <td className={`${td} text-right tabular-nums`}>{figure(line.dialed, "dialed")}</td>
                <td className={`${td} text-right tabular-nums`}>{figure(line.contacted, "contacted", percent(line.contact))}</td>
                <td className={`${td} text-right tabular-nums`}>{dollars(line.costPerContact)}</td>
                <td className={`${td} text-right tabular-nums`}>{figure(line.quoted, "quoted")}</td>
                <td className={`${td} text-right tabular-nums`}>{figure(line.undialableRate == null ? null : Math.max(0, line.leads - line.dialable), "undialable", percent(line.undialableRate))}</td>
                <td className={`${td} text-right tabular-nums`}>{figure(line.apps, "applied")}</td>
                <td className={`${td} text-right tabular-nums`}>{figure(line.issued, "issued")}</td>
                <td className={`${td} text-right tabular-nums`}>{figure(line.netSpend == null ? null : line.leads, "received", dollars(line.netSpend))}</td>
                <td className={`${td} text-right font-semibold tabular-nums ${line.key === tint.best ? "text-[var(--success-ink)]" : line.key === tint.worst ? "text-[var(--error-ink)]" : line.isTest ? "text-muted-foreground" : "text-foreground"}`}>{figure(line.cpi == null ? null : line.issued, "issued", dollars(line.cpi))}</td>
                <td className={`${td} text-right tabular-nums`}>{percent(line.claimAcceptance)}</td>
                <td className={td}>{line.warnings ? <StatusChip tone="warning">{line.warnings} to review</StatusChip> : <StatusChip tone="good">Linked</StatusChip>}</td>
              </tr>;
            })}
          </tbody>
        </table>}
    </TableCard>

    {/* The funnel (LA-2.17-2): bought, dialable, dialled, contacted, quoted, applied, issued, each
        with its cost where the spec asks for one (a dash with none, never $0), and each opening
        its rows. Dialled and quoted need 20260925709800; until then they say so. */}
    {totals && <TableCard title="Funnel" description="Leads received in the period, and what became of them in it.">
      <table className="w-full min-w-[860px] table-fixed border-collapse text-left">
        <thead><tr>{funnel.map((step) => <th key={step.key} scope="col" className={th}>{step.label}</th>)}</tr></thead>
        <tbody><tr>
          {funnel.map((step) => {
            const pendingStage = step.value == null;
            const canOpen = step.stage !== null && !pendingStage && (report?.funnel || step.stage === "received");
            return <td key={step.key} className={`${td} align-top`}>
              {canOpen
                ? <button type="button" className="text-left text-base font-semibold tabular-nums text-foreground hover:underline" aria-label={`${number(step.value)} ${step.label.toLowerCase()}: show the leads`} onClick={() => openDrill(totalDrill(step.stage as ScorecardStage))}>{number(step.value)}</button>
                : <span className="text-base font-semibold tabular-nums text-foreground">{number(step.value)}</span>}
              <span className="block text-xs text-muted-foreground">{pendingStage ? "needs a database update" : step.note}</span>
              {step.costLabel && <span className="block text-xs tabular-nums text-[var(--body)]">{dollars(step.cost)} {step.costLabel}</span>}
            </td>;
          })}
        </tr></tbody>
      </table>
    </TableCard>}

    {drillSpec && <div id="cpa-leads" className="scroll-mt-4">
      <TableCard
        title={`${drillSpec.title.charAt(0).toUpperCase()}${drillSpec.title.slice(1)}${drillResult?.total != null ? ` · ${plural(drillResult.total, "lead")}` : ""}`}
        // The whole selection's sums, so the rows reconcile with the figure that was clicked.
        description={drillResult?.sums ? `All ${plural(drillResult.sums.leads, "lead")} here: ${plural(drillResult.sums.attempts, "attempt")} in the period · ${number(drillResult.sums.dialed_leads)} dialled · ${number(drillResult.sums.contacted_leads)} contacted · ${number(drillResult.sums.quoted_leads)} quoted · ${plural(drillResult.sums.applications, "application")} · ${plural(drillResult.sums.issued_policies, "issued policy", "issued policies")}` : undefined}
        action={<Button type="button" variant="outline" onClick={() => { setDrillSpec(null); setDrillResult(null); setDrillError(null); }}>Close</Button>}
        // Server-side pages of the drill: the shared Pager, page n is offset (n-1) x limit.
        footer={drillResult && drillResult.drillReady && drillResult.total != null ? <Pager
          page={Math.floor(drillResult.offset / drillResult.limit) + 1}
          total={drillResult.total}
          noun="leads"
          pageSize={drillResult.limit}
          onPage={(next) => { if (!detailLoading) void loadDrill(drillSpec, (next - 1) * drillResult.limit); }}
        /> : undefined}
      >
        {drillResult && !drillResult.drillReady && <p className="border-t border-border bg-[var(--warning-surface)] px-4 py-2.5 text-xs leading-normal text-[var(--warning-ink)]">
          {drillResult.has_more ? "Only the newest 500 leads are listed. " : ""}Attempts and contacts are all time until a pending database update is applied.
        </p>}
        {detailLoading ? <SectionLoading rows={3} columns={6} />
          : drillError ? <p className="border-t border-border px-4 py-6 text-sm text-[var(--error-ink)]" role="alert">{drillError}</p>
          : !drillResult || drillResult.rows.length === 0 ? <p className="border-t border-border px-4 py-6 text-sm text-muted-foreground">No leads match this figure in the selected period.</p>
          : <table className="w-full min-w-[860px] border-collapse text-left">
            <thead><tr><th scope="col" className={th}>Lead</th><th scope="col" className={th}>Campaign</th><th scope="col" className={th}>Product</th><th scope="col" className={`${th} text-right`}>Attempts</th><th scope="col" className={`${th} text-right`}>Contacts</th>{drillResult.drillReady && <th scope="col" className={th}>Quoted</th>}<th scope="col" className={`${th} text-right`}>Applications</th><th scope="col" className={`${th} text-right`}>Issued</th><th scope="col" className={th}>Attribution</th><th scope="col" className={`${th} text-right`}><span className="sr-only">Open</span></th></tr></thead>
            <tbody>{drillResult.rows.map((lead) => <tr key={lead.lead_id} className="m-row">
              <td className={`${td} tabular-nums`}>{lead.lead_date}{drillResult.drillReady && lead.dialable === false && <span className="ml-1.5"><StatusChip tone="neutral" dot={false}>Undialable</StatusChip></span>}</td>
              <td className={td}>{lead.campaign_name}</td>
              <td className={td}>{lead.product_line.replaceAll("_", " ")}</td>
              <td className={`${td} text-right tabular-nums`}>{lead.attempts}</td>
              <td className={`${td} text-right tabular-nums`}>{lead.contacts}</td>
              {drillResult.drillReady && <td className={td}>{lead.quoted ? "Yes" : "—"}</td>}
              <td className={`${td} text-right tabular-nums`}>{lead.applications}</td>
              <td className={`${td} text-right tabular-nums`}>{lead.issued_policies}</td>
              <td className={td}>{lead.attribution_status === "linked" ? <StatusChip tone="good">Linked</StatusChip> : <StatusChip tone="warning">Review</StatusChip>}</td>
              <td className={`${td} text-right`}><Button asChild variant="outline" size="sm"><a href={`/app/leads/${lead.lead_id}`}>View</a></Button></td>
            </tr>)}</tbody>
          </table>}
      </TableCard>
    </div>}

    {report && <div className="grid gap-6 xl:grid-cols-2">
      {[
        { title: "Contact rate by slot", items: report.contact_rate_by_slot.map((item) => ({ key: item.slot, label: item.slot.replaceAll("_", " "), rate: item.rate_percent, contacts: item.contacts, attempts: item.attempts, share: null as number | null, spec: { key: `slot:${item.slot}`, title: `leads dialled in the ${item.slot.replaceAll("_", " ")} slot`, params: { stage: "received", slot: item.slot } } as DrillSpec })) },
        { title: "Attempts-to-contact curve", items: report.attempts_to_contact.map((item) => ({ key: String(item.attempt_number), label: `Attempt ${item.attempt_number}`, rate: item.rate_percent, contacts: item.contacts, attempts: item.attempts, share: item.share_of_contacts_percent, spec: { key: `attempt:${item.attempt_number}`, title: `leads with an attempt ${item.attempt_number} outcome`, params: { stage: "received", attempt_number: String(item.attempt_number) } } as DrillSpec })) },
      ].map((card) => <TableCard key={card.title} title={card.title}>
        {card.items.length ? card.items.map((item) => <div key={item.key} className="flex items-center gap-3 border-t border-border px-4 py-2.5 text-sm">
          {report.funnel && item.attempts > 0
            ? <button type="button" className="w-[120px] shrink-0 text-left capitalize text-[var(--body)] hover:underline" aria-label={`${item.label}: show the leads`} onClick={() => openDrill(item.spec)}>{item.label}</button>
            : <span className="w-[120px] shrink-0 capitalize text-[var(--body)]">{item.label}</span>}
          <span className="h-1.5 flex-grow overflow-hidden rounded-full bg-[var(--surface-alt)]"><span className="block h-full rounded-full bg-[var(--primary)]" style={{ width: `${Math.min(100, item.rate ?? 0)}%` }} /></span>
          <span className="w-[200px] shrink-0 text-right tabular-nums"><strong className="font-semibold text-foreground">{percent(item.rate)}</strong> <span className="text-xs text-muted-foreground">({item.contacts}/{item.attempts}){item.share != null ? ` · ${item.share}% of contacts` : ""}</span></span>
        </div>) : <p className="border-t border-border px-4 py-6 text-sm text-muted-foreground">No completed dispositions in this period.</p>}
      </TableCard>)}

      <TableCard title="Speed to lead" description="Arrival to first dial, median · real-time posted leads · all time">
        {!upgraded ? <p className="border-t border-border px-4 py-6 text-sm text-muted-foreground">Needs a database update that has not been applied yet.</p>
          : speedRows.length ? speedRows.map((row) => <div key={row.vendor_id} className="border-t border-border px-4 py-2.5">
            <div className="flex items-baseline justify-between gap-3 text-sm">
              <span className="font-semibold text-foreground">{row.vendor_name}</span>
              <span className="tabular-nums"><strong className={`font-semibold ${row.speed_median_seconds != null && row.speed_median_seconds <= 60 ? "text-[var(--success-ink)]" : "text-foreground"}`}>{clock(row.speed_median_seconds)}</strong> <span className="text-xs text-muted-foreground">{percent(row.speed_within_60s_pct)} within a minute</span></span>
            </div>
            <span className="mt-1.5 block h-1.5 overflow-hidden rounded-full bg-[var(--surface-alt)]"><span className="block h-full rounded-full bg-[var(--primary)]" style={{ width: `${Math.min(100, (100 * (row.speed_median_seconds ?? 0)) / slowest)}%` }} /></span>
            {/* LA-2.5-5: the vendor's campaigns, one line each, under its row (builder S's component). */}
            <CampaignSpeedToLead vendorId={row.vendor_id} />
          </div>) : <p className="border-t border-border px-4 py-6 text-sm text-muted-foreground">No real-time posted leads yet.</p>}
      </TableCard>

      <TableCard title="Consent certificates" description="Leads with a stored TrustedForm or Jornaya certificate · all time">
        {!upgraded ? <p className="border-t border-border px-4 py-6 text-sm text-muted-foreground">Needs a database update that has not been applied yet.</p>
          : consentRows.length ? consentRows.map((row) => <div key={row.vendor_id} className="flex items-center justify-between gap-3 border-t border-border px-4 py-2.5 text-sm">
            <span className="font-semibold text-foreground">{row.vendor_name}</span>
            <span className="tabular-nums"><strong className={`font-semibold ${row.consent_claimed_pct != null && row.consent_claimed_pct < 50 ? "text-[var(--error-ink)]" : "text-foreground"}`}>{percent(row.consent_claimed_pct)}</strong> <span className="text-xs text-muted-foreground">of {number(row.consent_leads)} · {percent(row.consent_any_pct)} arrived with one</span></span>
          </div>) : <p className="border-t border-border px-4 py-6 text-sm text-muted-foreground">No vendor in scope has leads yet.</p>}
      </TableCard>
    </div>}

    <CampaignComparisonWorkspace rows={report?.rows ?? []} defaultFrom={applied.from} defaultTo={applied.to} />
  </div>;
}

/** A headline figure's way into its rows (StatTile's action slot). */
function RowsLink({ label, onClick }: { label: string; onClick: () => void }) {
  return <button type="button" className="text-xs font-semibold text-foreground hover:underline" aria-label={`Show ${label}`} onClick={onClick}>Rows</button>;
}
