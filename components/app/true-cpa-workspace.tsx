"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { CalendarDays, ChevronDown, ExternalLink, Search, SlidersHorizontal } from "lucide-react";
import { Button } from "@/components/ui/button";
import { PageHeader } from "@/components/ui/page-header";
import { ErrorState, LoadingRows } from "@/components/ui/page-states";
import { StatTile } from "@/components/ui/stat";
import { StatusChip } from "@/components/ui/status-chip";
import { sectionForPath } from "@/lib/menu/definition";
import type { VendorScorecardLead, VendorScorecardReport, VendorScorecardRow, VendorScorecardVendorRow } from "@/lib/vendorScorecard/types";
import { CampaignComparisonWorkspace } from "./campaign-comparison-workspace";

const PAGE_SIZE = 25;
/** The persistency toggle's window. User decision: 60 days. Mirrors SCORECARD_PERSIST_DAYS on the server. */
const PERSIST_DAYS = 60;
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
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
/** "1 Sep – 22 Sep" for the range control. */
function shortRange(from: string, to: string) { const a = day(from); const b = day(to); return `${a.d} ${MONTHS[a.m - 1]}${a.y !== b.y ? ` ${a.y}` : ""} – ${b.d} ${MONTHS[b.m - 1]}${a.y !== b.y ? ` ${b.y}` : ""}`; }
/** "1–22 September" for the spend tile, the way the board phrases a period. */
function longRange(from: string, to: string) {
  const a = day(from); const b = day(to);
  if (a.y !== b.y) return `${a.d} ${MONTHS_LONG[a.m - 1]} ${a.y} – ${b.d} ${MONTHS_LONG[b.m - 1]} ${b.y}`;
  if (a.m !== b.m) return `${a.d} ${MONTHS_LONG[a.m - 1]} – ${b.d} ${MONTHS_LONG[b.m - 1]}`;
  return `${a.d}–${b.d} ${MONTHS_LONG[b.m - 1]}`;
}

const control = "box-border inline-flex h-10 items-center gap-2 rounded-lg border border-[var(--border-strong)] bg-card px-3.5 text-sm font-semibold leading-[1.43] tracking-[-0.01em] text-foreground";
const field = "h-9 w-full rounded-lg border border-[var(--border-strong)] bg-card px-2.5 text-sm text-foreground";
const panel = "absolute left-0 top-[calc(100%+6px)] z-20 grid w-[240px] gap-2 rounded-xl border border-border bg-card p-3.5 shadow-[0_12px_32px_rgba(0,0,0,.16)]";
const panelLabel = "text-xs font-semibold uppercase leading-[1.33] tracking-[0.02em] text-muted-foreground";
const th = "bg-[var(--surface-alt)] px-3 py-2 text-xs font-semibold uppercase leading-[1.33] tracking-[0.02em] text-muted-foreground";
const td = "border-t border-border px-3 py-2 text-sm leading-normal tracking-[-0.02em] text-[var(--body)]";
const segment = (on: boolean) => `h-8 rounded-md px-3 text-sm font-semibold leading-[1.43] tracking-[-0.01em] ${on ? "bg-card text-foreground shadow-[0_1px_2px_rgba(0,0,0,.08)]" : "text-muted-foreground hover:text-foreground"}`;

type Scope = { from: string; to: string; vendorId: string; campaignId: string; productCode: string; persist: boolean };
type Grain = "vendor" | "campaign";
type Sort = "cost" | "spend";
function queryFor(value: Scope) { const params = new URLSearchParams({ from: value.from, to: value.to }); if (value.vendorId) params.set("vendor_id", value.vendorId); if (value.campaignId) params.set("campaign_id", value.campaignId); if (value.productCode) params.set("product_code", value.productCode); if (value.persist) params.set("persist_days", String(PERSIST_DAYS)); return params.toString(); }

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
  return { key: row.campaign_id, label: `${row.vendor_name} · ${row.campaign_name}`, vendorId: row.vendor_id, vendorName: row.vendor_name, row, costPerRecord: row.cost_per_record_cents, records: row.records_purchased, leads: row.leads_received, dialable: row.dialable_leads, contact: row.contact_rate_percent, undialableRate: row.undialable_rate_percent, apps: row.applications, issued: row.issued_policies, netSpend: row.net_spend_cents, cpi: row.effective_cost_per_issued_policy_cents, claimAcceptance: row.claim_acceptance_rate_percent, warnings: row.attribution_warnings, isTest: row.is_test_batch, small: row.small_sample, rank: row.cost_rank };
}
function vendorLine(row: VendorScorecardVendorRow): Line {
  return { key: row.vendor_id, label: row.vendor_name, vendorId: row.vendor_id, vendorName: row.vendor_name, row: null, costPerRecord: row.cost_per_record_cents, records: row.records_purchased, leads: row.leads_received, dialable: row.dialable_leads, contact: row.contact_rate_percent, undialableRate: row.undialable_rate_percent, apps: row.applications, issued: row.issued_policies, netSpend: row.net_spend_cents, cpi: row.effective_cost_per_issued_policy_cents, claimAcceptance: row.claim_acceptance_rate_percent, warnings: row.attribution_warnings, isTest: row.is_test_batch, small: row.small_sample, rank: row.cost_rank };
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

/** The honest reading of the table, computed from it. Null when the figures cannot support one. */
function unitPriceInsight(lines: Line[]) {
  const judged = lines.filter((line) => line.rank != null && !line.small && line.cpi != null && line.costPerRecord != null && line.costPerRecord > 0);
  if (judged.length < 2) return null;
  const cheapestPolicy = [...judged].sort((a, b) => (a.cpi as number) - (b.cpi as number))[0];
  const cheapestRecord = [...judged].sort((a, b) => (a.costPerRecord as number) - (b.costPerRecord as number))[0];
  if (cheapestPolicy.key === cheapestRecord.key) {
    return { title: `${cheapestPolicy.label} is the cheapest per record and per policy.`, detail: `${dollars(cheapestPolicy.costPerRecord)} a record and ${dollars(cheapestPolicy.cpi)} a policy. Here unit price and the decision agree.` };
  }
  const times = (cheapestPolicy.costPerRecord as number) / (cheapestRecord.costPerRecord as number);
  return {
    title: `${cheapestPolicy.label} costs ${times >= 10 ? Math.round(times) : times.toFixed(1)}× more per record and makes the cheapest policies.`,
    detail: `${dollars(cheapestPolicy.costPerRecord)} against ${cheapestRecord.label}'s ${dollars(cheapestRecord.costPerRecord)}, and ${dollars(cheapestPolicy.cpi)} a policy against ${dollars(cheapestRecord.cpi)}. Unit price is not the decision.`,
  };
}

/** Why one line's figure should not be compared yet: a test batch first, else a small sample. */
function sampleInsight(lines: Line[], smallBelow: number) {
  const test = lines.find((line) => line.isTest && line.leads > 0);
  if (test) return { title: `${test.label} is ${plural(test.issued, "policy", "policies")} on ${plural(test.records, "record")}.`, detail: "Marked as a test batch and excluded from the ranking, so nobody compares a trial with a committed buy." };
  const small = lines.find((line) => line.small && line.netSpend != null);
  if (!small || small.netSpend == null) return null;
  const next = small.netSpend / (small.issued + 1);
  return { title: `${small.label} has ${plural(small.issued, "issued policy", "issued policies")}.`, detail: `Fewer than ${smallBelow} is a small sample: one more sale would move its cost per policy from ${dollars(small.cpi)} to ${dollars(next)}.` };
}

/** Close a popover on an outside click or Escape. */
function useDismiss(open: boolean, close: () => void) {
  const ref = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    if (!open) return;
    const onPointer = (event: MouseEvent) => { if (ref.current && !ref.current.contains(event.target as Node)) close(); };
    const onKey = (event: KeyboardEvent) => { if (event.key === "Escape") close(); };
    document.addEventListener("mousedown", onPointer);
    document.addEventListener("keydown", onKey);
    return () => { document.removeEventListener("mousedown", onPointer); document.removeEventListener("keydown", onKey); };
  }, [open, close]);
  return ref;
}

/**
 * True CPA (p-app-true-cpa): what each vendor and campaign costs through an issued policy.
 *
 * The board's strip — five figures, one control bar, one table — with the period and filters as a
 * draft the header's Apply commits, so a change of vendor does not fire three reloads. The
 * campaign comparison, the slot and attempt curves and the lead drill-down stay below it: people
 * use them and the board has nowhere else for them. Vendor returns is not embedded any more; it
 * has its own page (/app/vendor-returns), and drawing the same claim form twice gave two places
 * to submit one claim.
 *
 * The Scorecard concept (LA-2 §14, "which vendor should I buy from again") adds, inside that
 * layout: a By vendor / By campaign view over the report's vendor_rows, cheapest-policy-first
 * ranking with test batches left out, a best/worst tint, price per record and dialable counts, the
 * computed reading of the table, a persistency toggle, and speed-to-lead and consent cards read
 * from the same views /app/campaigns reads.
 */
export function TrueCpaWorkspace() {
  const [draft, setDraft] = useState<Scope>(() => ({ from: defaultFrom(), to: new Date().toISOString().slice(0, 10), vendorId: "", campaignId: "", productCode: "", persist: false }));
  const [applied, setApplied] = useState(draft);
  const [report, setReport] = useState<VendorScorecardReport | null>(null);
  const [selected, setSelected] = useState<VendorScorecardRow | null>(null);
  const [leads, setLeads] = useState<VendorScorecardLead[]>([]);
  const [detailLoading, setDetailLoading] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(0);
  const [grain, setGrain] = useState<Grain>("vendor");
  const [sort, setSort] = useState<Sort>("cost");
  const [rangeOpen, setRangeOpen] = useState(false);
  const [filtersOpen, setFiltersOpen] = useState(false);
  const rangeRef = useDismiss(rangeOpen, () => setRangeOpen(false));
  const filtersRef = useDismiss(filtersOpen, () => setFiltersOpen(false));

  const query = useMemo(() => queryFor(applied), [applied]);

  useEffect(() => {
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
        setReport(body); setSelected(null); setLeads([]); setPage(0);
      } catch (cause) {
        if (active) setError(cause instanceof Error ? cause.message : "Could not load the scorecard");
      } finally {
        if (active) setLoading(false);
      }
    })();
    return () => { active = false; };
  }, [query]);

  async function drill(row: VendorScorecardRow) {
    if (selected?.campaign_id === row.campaign_id) { setSelected(null); setLeads([]); return; }
    setSelected(row); setLeads([]); setDetailLoading(true);
    const params = new URLSearchParams({ from: applied.from, to: applied.to, vendor_id: row.vendor_id, campaign_id: row.campaign_id });
    try {
      const response = await fetch(`/api/app/true-cpa/leads?${params}`, { cache: "no-store" });
      const body = await response.json().catch(() => null);
      if (!response.ok) throw new Error(body?.error ?? "Could not load lead detail");
      setLeads(body?.rows ?? []);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not load lead detail");
    } finally {
      setDetailLoading(false);
    }
  }

  /** A vendor line opens that vendor's campaigns: the filter is applied, the view switches. */
  function openVendor(vendorId: string) {
    const next = { ...applied, vendorId, campaignId: "" };
    setDraft(next); setApplied(next); setGrain("campaign"); setSearch(""); setPage(0);
  }

  const apply = () => { setRangeOpen(false); setFiltersOpen(false); setApplied({ ...draft }); };
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
  const insights = useMemo(() => [unitPriceInsight(allLines), sampleInsight(allLines, report?.small_sample_below ?? 5)], [allLines, report]);
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
  const weakestConsent = [...consentRows].reverse().find((row) => row.consent_claimed_pct != null && row.consent_claimed_pct < 50) ?? null;
  const noun = effectiveGrain === "vendor" ? "vendor" : "campaign";

  return <div className="m-stagger flex w-full min-w-0 flex-col gap-6">
    <PageHeader
      eyebrow={sectionForPath("/app/true-cpa") ?? undefined}
      title="True CPA"
      description="What each vendor and campaign actually costs through an issued policy."
      actions={<>
        <Button asChild variant="outline" className="h-11 border-[var(--border-strong)] px-4"><a href={exportUrl}>Export CSV</a></Button>
        <Button className="h-11 px-4" onClick={apply} disabled={loading && !pending}>{pending ? "Apply" : loading ? "Loading…" : "Apply"}</Button>
      </>}
    />

    <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-5">
      <StatTile label="Net spend" value={loading ? "…" : dollars(totals?.net_spend_cents)} footnote={longRange(applied.from, applied.to)} />
      <StatTile label="Leads received" value={loading ? "…" : number(totals?.leads_received)} footnote={totals && totals.leads_received ? `${number(totals.dialable_leads)} dialable` : "after suppression"} />
      <StatTile label="Applications" value={loading ? "…" : number(totals?.applications)} footnote={share(totals?.applications, totals?.leads_received, "of leads")} reserveFootnote />
      <StatTile label="Issued policies" value={loading ? "…" : number(totals?.issued_policies)} valueTone={totals?.issued_policies ? "good" : undefined} footnote={persistOn ? `in force after ${report?.persist_days} days${totals?.policies_not_yet_measurable ? ` · ${number(totals.policies_not_yet_measurable)} too recent to judge` : ""}` : share(totals?.issued_policies, totals?.applications, "of applications")} reserveFootnote />
      <StatTile label="True CPA" value={loading ? "…" : dollars(totals?.effective_cost_per_issued_policy_cents)} valueTone={totals?.effective_cost_per_issued_policy_cents != null ? "primary" : undefined} footnote={persistOn ? "per persisting policy" : "per issued policy"} />
    </div>

    <div className="relative z-30 flex flex-wrap items-center gap-3 rounded-xl border border-border bg-card p-3">
      <div className="relative" ref={rangeRef}>
        <button type="button" className={control} aria-expanded={rangeOpen} onClick={() => setRangeOpen((open) => !open)}>
          <CalendarDays className="size-4" aria-hidden="true" />{shortRange(draft.from, draft.to)}<ChevronDown className="size-4" aria-hidden="true" />
        </button>
        {rangeOpen && <div className={panel} role="group" aria-label="Period">
          <label className={panelLabel} htmlFor="cpa-from">From</label>
          <input id="cpa-from" type="date" className={field} value={draft.from} max={draft.to} onChange={(event) => setDraft((current) => ({ ...current, from: event.target.value || current.from }))} />
          <label className={panelLabel} htmlFor="cpa-to">To</label>
          <input id="cpa-to" type="date" className={field} value={draft.to} min={draft.from} onChange={(event) => setDraft((current) => ({ ...current, to: event.target.value || current.to }))} />
          <Button type="button" className="mt-1 h-9" onClick={apply}>Apply</Button>
        </div>}
      </div>
      <span className="box-border flex h-10 w-full items-center gap-2 rounded-lg border border-[var(--border-strong)] bg-card px-3 text-muted-foreground sm:w-[248px]">
        <Search className="size-4 shrink-0" aria-hidden="true" />
        <input type="search" aria-label="Search vendor, campaign" placeholder="Search vendor, campaign" value={search} onChange={(event) => { setSearch(event.target.value); setPage(0); }} className="min-w-0 flex-grow border-0 bg-transparent text-sm tracking-[-0.02em] text-foreground outline-none" />
      </span>
      <div className="relative" ref={filtersRef}>
        <button type="button" className={control} aria-expanded={filtersOpen} onClick={() => setFiltersOpen((open) => !open)}>
          <SlidersHorizontal className="size-4" aria-hidden="true" />Filters
          {filterCount > 0 && <span className="inline-flex h-5 min-w-5 items-center justify-center rounded-full bg-[var(--surface-alt)] px-1.5 text-xs font-semibold tabular-nums text-foreground">{filterCount}</span>}
        </button>
        {filtersOpen && <div className={panel} role="group" aria-label="Filter the scorecard">
          <label className={panelLabel} htmlFor="scorecard-vendor">Vendor</label>
          <select id="scorecard-vendor" className={field} value={draft.vendorId} onChange={(event) => setDraft((current) => ({ ...current, vendorId: event.target.value, campaignId: "" }))}><option value="">All vendors</option>{vendors.map(([id, name]) => <option key={id} value={id}>{name}</option>)}</select>
          <label className={panelLabel} htmlFor="scorecard-campaign">Campaign</label>
          <select id="scorecard-campaign" className={field} value={draft.campaignId} onChange={(event) => setDraft((current) => ({ ...current, campaignId: event.target.value }))}><option value="">All campaigns</option>{(report?.rows ?? []).filter((row) => !draft.vendorId || row.vendor_id === draft.vendorId).map((row) => <option key={row.campaign_id} value={row.campaign_id}>{row.campaign_name}</option>)}</select>
          <label className={panelLabel} htmlFor="scorecard-product">Product</label>
          <select id="scorecard-product" className={field} value={draft.productCode} onChange={(event) => setDraft((current) => ({ ...current, productCode: event.target.value }))}><option value="">All products</option>{products.map((product) => <option key={product} value={product}>{product.replaceAll("_", " ")}</option>)}</select>
          <label className="mt-1 flex items-start gap-2 text-sm leading-normal text-foreground" htmlFor="scorecard-persist">
            <input id="scorecard-persist" type="checkbox" className="mt-1" checked={draft.persist} disabled={!upgraded} onChange={(event) => setDraft((current) => ({ ...current, persist: event.target.checked }))} />
            <span>Only policies still in force after {PERSIST_DAYS} days{!upgraded && <span className="block text-xs text-muted-foreground">Needs a database update that has not been applied yet.</span>}</span>
          </label>
          <div className="mt-1 flex gap-2">
            <Button type="button" variant="ghost" className="h-9 flex-1" onClick={() => setDraft((current) => ({ ...current, vendorId: "", campaignId: "", productCode: "", persist: false }))}>Clear</Button>
            <Button type="button" className="h-9 flex-1" onClick={apply}>Apply</Button>
          </div>
        </div>}
      </div>
      <span className="inline-flex h-10 items-center gap-0.5 rounded-lg bg-[var(--surface-alt)] p-1" role="group" aria-label="Rows">
        <button type="button" className={segment(effectiveGrain === "vendor")} aria-pressed={effectiveGrain === "vendor"} disabled={Boolean(report) && !upgraded} onClick={() => { setGrain("vendor"); setPage(0); }}>By vendor</button>
        <button type="button" className={segment(effectiveGrain === "campaign")} aria-pressed={effectiveGrain === "campaign"} onClick={() => { setGrain("campaign"); setPage(0); }}>By campaign</button>
      </span>
      <label className="sr-only" htmlFor="scorecard-sort">Sort</label>
      <select id="scorecard-sort" className={`${control} pr-2`} value={sort} onChange={(event) => { setSort(event.target.value as Sort); setPage(0); }}>
        <option value="cost">Cheapest policy first</option>
        <option value="spend">Highest spend first</option>
      </select>
      <span className="flex-grow" />
      {pending && <StatusChip tone="warning">Not applied yet</StatusChip>}
      {report && !pending && <span className="text-xs leading-normal text-muted-foreground">Live · computed {new Date(report.generated_at).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}</span>}
    </div>

    {report && !upgraded && <div className="rounded-xl border border-border border-l-[3px] border-l-[var(--warning)] bg-[var(--warning-surface)] px-4 py-3.5" role="note">
      <p className="text-sm font-semibold leading-normal tracking-[-0.02em] text-[var(--warning-ink)]">This scorecard needs a database update that has not been applied yet</p>
      <p className="mt-1.5 text-sm leading-normal tracking-[-0.02em] text-[var(--body)]">Until it is, net spend is each campaign&rsquo;s lifetime spend rather than the period&rsquo;s share of it, and the vendor view, test batches, the persistency filter and the speed and consent cards are not available.</p>
    </div>}
    {report && upgraded && (totals?.unallocated_spend_campaigns ?? 0) > 0 && <div className="rounded-xl border border-border border-l-[3px] border-l-[var(--warning)] bg-[var(--warning-surface)] px-4 py-3.5" role="note">
      <p className="text-sm font-semibold leading-normal tracking-[-0.02em] text-[var(--warning-ink)]">{plural(totals?.unallocated_spend_campaigns ?? 0, "campaign")} with spend but no records purchased</p>
      <p className="mt-1.5 text-sm leading-normal tracking-[-0.02em] text-[var(--body)]">Spend is split by the share of purchased records received in the period, so a campaign with no purchased count cannot be split and its spend is not in Net spend or True CPA. Enter its records purchased on the campaign.</p>
    </div>}

    <section className="overflow-hidden rounded-xl border border-border bg-card">
      {error && !report ? <ErrorState title="The scorecard did not load" detail={error} action={<Button variant="outline" onClick={() => setApplied({ ...applied })}>Try again</Button>} />
        : loading && !report ? <LoadingRows rows={4} columns={6} />
        : <>
          <div className="overflow-x-auto">
            <table className="w-full min-w-[1160px] table-fixed border-collapse text-left">
              <thead><tr>
                <th scope="col" className={th}>{effectiveGrain === "vendor" ? "Vendor" : <>Vendor &amp; campaign</>}</th>
                <th scope="col" className={`${th} w-[80px] text-right`}>Leads</th>
                <th scope="col" className={`${th} w-[80px] text-right`}>Dialable</th>
                <th scope="col" className={`${th} w-[80px] text-right`}>Contact</th>
                <th scope="col" className={`${th} w-[110px] text-right`}>Undialable rate<span className="block text-xs font-normal normal-case tracking-normal">Low is good</span></th>
                <th scope="col" className={`${th} w-[64px] text-right`}>Apps</th>
                <th scope="col" className={`${th} w-[70px] text-right`}>Issued</th>
                <th scope="col" className={`${th} w-[105px] text-right`}>Net spend</th>
                <th scope="col" className={`${th} w-[105px] text-right`}>True CPA</th>
                <th scope="col" className={`${th} w-[120px] text-right`}>Claim acceptance<span className="block text-xs font-normal normal-case tracking-normal">High is good</span></th>
                <th scope="col" className={`${th} w-[110px]`}>Lineage</th>
              </tr></thead>
              <tbody>
                {shown.map((line) => {
                  const open = Boolean(line.row) && selected?.campaign_id === line.row?.campaign_id;
                  const tone = open ? "bg-[var(--soft-orange-surface)]" : line.key === tint.best ? "bg-[var(--success-surface)]" : line.key === tint.worst ? "bg-[var(--error-surface)]" : "";
                  const activate = () => { if (line.row) void drill(line.row); else openVendor(line.vendorId); };
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
                    <td className={`${td} text-right tabular-nums`}>{number(line.leads)}</td>
                    <td className={`${td} text-right tabular-nums`}>{number(line.dialable)}</td>
                    <td className={`${td} text-right tabular-nums`}>{percent(line.contact)}</td>
                    <td className={`${td} text-right tabular-nums`}>{percent(line.undialableRate)}</td>
                    <td className={`${td} text-right tabular-nums`}>{number(line.apps)}</td>
                    <td className={`${td} text-right tabular-nums`}>{number(line.issued)}</td>
                    <td className={`${td} text-right tabular-nums`}>{dollars(line.netSpend)}</td>
                    <td className={`${td} text-right font-semibold tabular-nums ${line.key === tint.best ? "text-[var(--success-ink)]" : line.key === tint.worst ? "text-[var(--error-ink)]" : line.isTest ? "text-muted-foreground" : "text-foreground"}`}>{dollars(line.cpi)}</td>
                    <td className={`${td} text-right tabular-nums`}>{percent(line.claimAcceptance)}</td>
                    <td className={td}>{line.warnings ? <StatusChip tone="warning">{line.warnings} to review</StatusChip> : <StatusChip tone="good">Linked</StatusChip>}</td>
                  </tr>;
                })}
              </tbody>
            </table>
          </div>
          {lines.length === 0 && <p className="border-t border-border px-4 py-8 text-center text-sm text-muted-foreground">{search ? `No ${noun} matches that search.` : "No campaign has spend or leads in this period."}</p>}
          {insights.some(Boolean) && <div className="grid grid-cols-1 gap-3 border-t border-border px-4 py-3.5 lg:grid-cols-2">
            {insights[0] && <div className="rounded-lg bg-[var(--success-surface)] px-3.5 py-3">
              <p className="text-sm font-semibold leading-normal tracking-[-0.02em] text-[var(--success-ink)]">{insights[0].title}</p>
              <p className="mt-0.5 text-sm leading-normal tracking-[-0.02em] text-[var(--body)]">{insights[0].detail}</p>
            </div>}
            {insights[1] && <div className="rounded-lg bg-[var(--info-surface)] px-3.5 py-3">
              <p className="text-sm font-semibold leading-normal tracking-[-0.02em] text-[var(--info-ink)]">{insights[1].title}</p>
              <p className="mt-0.5 text-sm leading-normal tracking-[-0.02em] text-[var(--body)]">{insights[1].detail}</p>
            </div>}
          </div>}
          <div className="flex flex-wrap items-center justify-between gap-4 border-t border-border bg-[var(--canvas)] px-4 py-3 text-xs leading-normal text-muted-foreground">
            <span>{lines.length ? `Showing ${currentPage * PAGE_SIZE + 1}–${currentPage * PAGE_SIZE + shown.length} of ${plural(lines.length, noun)} · ${sort === "cost" ? "cheapest policy first, test batches last and unranked" : "highest spend first"}` : "Nothing to show"}</span>
            <span className="flex gap-2">
              <Button type="button" variant="outline" className="h-8 border-[var(--border-strong)] px-4" disabled={currentPage === 0} onClick={() => setPage(currentPage - 1)}>Previous</Button>
              <Button type="button" variant="outline" className="h-8 border-[var(--border-strong)] px-4" disabled={currentPage >= pageCount - 1} onClick={() => setPage(currentPage + 1)}>Next</Button>
            </span>
          </div>
        </>}
    </section>

    {selected && <section className="overflow-hidden rounded-xl border border-border bg-card" aria-labelledby="cpa-leads-heading">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border bg-[var(--surface-alt)] px-4 py-3">
        <h2 id="cpa-leads-heading" className="text-sm font-semibold leading-normal tracking-[-0.02em] text-foreground">Leads behind {selected.vendor_name} &middot; {selected.campaign_name}</h2>
        <span className="text-xs text-muted-foreground">Operational counts only — no phone, SSN, banking or policy number.</span>
      </div>
      {detailLoading ? <LoadingRows rows={3} columns={6} /> : leads.length === 0 ? <p className="px-4 py-6 text-sm text-muted-foreground">No leads matched this campaign in the selected period.</p> : <div className="overflow-x-auto"><table className="w-full min-w-[760px] border-collapse text-left">
        <thead><tr><th scope="col" className={th}>Lead</th><th scope="col" className={th}>Product</th><th scope="col" className={`${th} text-right`}>Attempts</th><th scope="col" className={`${th} text-right`}>Contacts</th><th scope="col" className={`${th} text-right`}>Applications</th><th scope="col" className={`${th} text-right`}>Issued</th><th scope="col" className={th}>Attribution</th><th scope="col" className={th}><span className="sr-only">Open</span></th></tr></thead>
        <tbody>{leads.map((lead) => <tr key={lead.lead_id} className="m-row">
          <td className={`${td} tabular-nums`}>{lead.lead_date}</td>
          <td className={td}>{lead.product_line.replaceAll("_", " ")}</td>
          <td className={`${td} text-right tabular-nums`}>{lead.attempts}</td>
          <td className={`${td} text-right tabular-nums`}>{lead.contacts}</td>
          <td className={`${td} text-right tabular-nums`}>{lead.applications}</td>
          <td className={`${td} text-right tabular-nums`}>{lead.issued_policies}</td>
          <td className={td}>{lead.attribution_status === "linked" ? <StatusChip tone="good">Linked</StatusChip> : <StatusChip tone="warning">Review</StatusChip>}</td>
          <td className={td}><a className="inline-flex items-center gap-1 text-sm font-semibold text-[var(--accent-ink)] hover:underline" href={`/app/leads/${lead.lead_id}`}><ExternalLink aria-hidden="true" className="size-3.5" />Open lead</a></td>
        </tr>)}</tbody>
      </table></div>}
    </section>}

    <div className="rounded-xl border border-border border-l-[3px] border-l-[var(--info)] bg-[var(--info-surface)] px-4 py-3.5">
      <p className="text-sm font-semibold leading-normal tracking-[-0.02em] text-[var(--info-ink)]">A missing True CPA is not a zero cost</p>
      <p className="mt-1.5 text-sm leading-normal tracking-[-0.02em] text-[var(--body)]">It means no issued-policy event is attributed to that vendor and campaign — one is recorded with Mark issued on the deal in Deal flow. It renders as &mdash;, never $0.00. Net spend is the period&rsquo;s share of each campaign&rsquo;s spend after credits, split by the purchased records received in the period, the same split the campaign comparison uses. Undialable rate and claim acceptance answer different questions and are never combined into one score. No phone, SSN, banking detail or policy number leaves this page in an export, and no talk-time metric is used anywhere in the calculation.</p>
    </div>

    {report && <div className="grid gap-6 xl:grid-cols-2">
      {[
        { title: "Contact rate by slot", lede: "Feeds dialing decisions without exposing talk time.", items: report.contact_rate_by_slot.map((item) => ({ key: item.slot, label: item.slot.replaceAll("_", " "), rate: item.rate_percent, contacts: item.contacts, attempts: item.attempts, share: null as number | null })) },
        { title: "Attempts-to-contact curve", lede: "Where the ceiling of seven attempts is paying off: each attempt's contact rate, and its share of all contacts.", items: report.attempts_to_contact.map((item) => ({ key: String(item.attempt_number), label: `Attempt ${item.attempt_number}`, rate: item.rate_percent, contacts: item.contacts, attempts: item.attempts, share: item.share_of_contacts_percent })) },
      ].map((card) => <section key={card.title} className="overflow-hidden rounded-xl border border-border bg-card">
        <div className="border-b border-border bg-[var(--surface-alt)] px-4 py-3">
          <h2 className="text-sm font-semibold leading-normal tracking-[-0.02em] text-foreground">{card.title}</h2>
          <p className="text-xs leading-normal text-muted-foreground">{card.lede}</p>
        </div>
        {card.items.length ? card.items.map((item, index) => <div key={item.key} className={`flex items-center gap-3 px-4 py-2.5 text-sm ${index ? "border-t border-border" : ""}`}>
          <span className="w-[120px] shrink-0 capitalize text-[var(--body)]">{item.label}</span>
          <span className="h-1.5 flex-grow overflow-hidden rounded-full bg-[var(--surface-alt)]"><span className="block h-full rounded-full bg-[var(--primary)]" style={{ width: `${Math.min(100, item.rate ?? 0)}%` }} /></span>
          <span className="w-[200px] shrink-0 text-right tabular-nums"><strong className="font-semibold text-foreground">{percent(item.rate)}</strong> <span className="text-xs text-muted-foreground">({item.contacts}/{item.attempts}){item.share != null ? ` · ${item.share}% of contacts` : ""}</span></span>
        </div>) : <p className="px-4 py-6 text-sm text-muted-foreground">No completed dispositions in this period.</p>}
      </section>)}

      <section className="overflow-hidden rounded-xl border border-border bg-card" aria-labelledby="cpa-speed-heading">
        <div className="border-b border-border bg-[var(--surface-alt)] px-4 py-3">
          <h2 id="cpa-speed-heading" className="text-sm font-semibold leading-normal tracking-[-0.02em] text-foreground">Speed to lead</h2>
          <p className="text-xs leading-normal text-muted-foreground">Real-time posted leads · arrival to first dial, median · all time, as on Campaigns</p>
        </div>
        {!upgraded ? <p className="px-4 py-6 text-sm text-muted-foreground">Needs a database update that has not been applied yet. Campaigns shows it per vendor meanwhile.</p>
          : speedRows.length ? <>
            {speedRows.map((row, index) => <div key={row.vendor_id} className={`px-4 py-2.5 ${index ? "border-t border-border" : ""}`}>
              <div className="flex items-baseline justify-between gap-3 text-sm">
                <span className="font-semibold text-foreground">{row.vendor_name}</span>
                <span className="tabular-nums"><strong className={`font-semibold ${row.speed_median_seconds != null && row.speed_median_seconds <= 60 ? "text-[var(--success-ink)]" : "text-foreground"}`}>{clock(row.speed_median_seconds)}</strong> <span className="text-xs text-muted-foreground">{percent(row.speed_within_60s_pct)} within a minute</span></span>
              </div>
              <span className="mt-1.5 block h-1.5 overflow-hidden rounded-full bg-[var(--surface-alt)]"><span className="block h-full rounded-full bg-[var(--primary)]" style={{ width: `${Math.min(100, (100 * (row.speed_median_seconds ?? 0)) / slowest)}%` }} /></span>
            </div>)}
            <p className="border-t border-border px-4 py-2.5 text-xs leading-normal text-muted-foreground">Target is under a minute, while they are still on the website. A slow first dial is fixed on the floor, not by changing vendor.</p>
          </> : <p className="px-4 py-6 text-sm text-muted-foreground">No real-time posted leads yet. Speed to lead is measured only for leads posted to you live; a list lead&rsquo;s arrival time means nothing.</p>}
      </section>

      <section className="overflow-hidden rounded-xl border border-border bg-card" aria-labelledby="cpa-consent-heading">
        <div className="border-b border-border bg-[var(--surface-alt)] px-4 py-3">
          <h2 id="cpa-consent-heading" className="text-sm font-semibold leading-normal tracking-[-0.02em] text-foreground">Consent certificates</h2>
          <p className="text-xs leading-normal text-muted-foreground">Leads with a stored TrustedForm or Jornaya certificate · all time, as on Campaigns</p>
        </div>
        {!upgraded ? <p className="px-4 py-6 text-sm text-muted-foreground">Needs a database update that has not been applied yet. Campaigns shows it per vendor meanwhile.</p>
          : consentRows.length ? <>
            {consentRows.map((row, index) => <div key={row.vendor_id} className={`flex items-center justify-between gap-3 px-4 py-2.5 text-sm ${index ? "border-t border-border" : ""}`}>
              <span className="font-semibold text-foreground">{row.vendor_name}</span>
              <span className="tabular-nums"><strong className={`font-semibold ${row.consent_claimed_pct != null && row.consent_claimed_pct < 50 ? "text-[var(--error-ink)]" : "text-foreground"}`}>{percent(row.consent_claimed_pct)}</strong> <span className="text-xs text-muted-foreground">of {number(row.consent_leads)} · {percent(row.consent_any_pct)} arrived with one</span></span>
            </div>)}
            {weakestConsent && weakestConsent.consent_claimed_pct != null && <div className="border-t border-border px-4 py-3">
              <div className="rounded-lg bg-[var(--error-surface)] px-3.5 py-3">
                <p className="text-sm font-semibold leading-normal tracking-[-0.02em] text-[var(--error-ink)]">{weakestConsent.vendor_name} cannot produce a stored certificate for {Math.round((100 - weakestConsent.consent_claimed_pct) * 10) / 10}% of its leads.</p>
                <p className="mt-0.5 text-sm leading-normal tracking-[-0.02em] text-[var(--body)]">That is what you are asked for when a complaint arrives.</p>
              </div>
            </div>}
          </> : <p className="px-4 py-6 text-sm text-muted-foreground">No vendor in scope has leads yet.</p>}
      </section>
    </div>}

    <CampaignComparisonWorkspace rows={report?.rows ?? []} defaultFrom={applied.from} defaultTo={applied.to} />
  </div>;
}
