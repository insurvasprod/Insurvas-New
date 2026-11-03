"use client";

import { Fragment, useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { ArrowRight, ArrowUpRight, CheckCircle2, ChevronDown, CircleAlert, Clock3, Hand, Inbox, Languages, Send } from "lucide-react";

import { Button } from "@/components/ui/button";
import { ActiveFilters, DataToolbar, FilterButton, FilterPanel, RefreshButton, ToolbarSearch, toolbarControl, type ActiveFilter } from "@/components/ui/data-toolbar";
import { Field } from "@/components/ui/field";
import { SelectMenu } from "@/components/ui/select-menu";
import { IconViewSwitch } from "@/components/ui/view-tabs";
import { LiveStamp, useClockSeconds } from "@/components/ui/live-stamp";
import { PageHeader } from "@/components/ui/page-header";
import { PageLoading } from "@/components/ui/page-loading";
import { EmptyState, ErrorState, NoMatches, SectionLoading } from "@/components/ui/page-states";
import { Pager, paginate } from "@/components/ui/pager";
import { KpiRow, KpiTile } from "@/components/ui/kpi-tile";
import { StatusChip } from "@/components/ui/status-chip";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { TableCard } from "@/components/ui/table-card";
import { useFittingPageSize } from "@/components/ui/use-fitting-page-size";
import type { PartnerLeadRow, PartnerPipelinePayload } from "@/lib/partnerLeads/types";
import type { PartnerRole } from "@/lib/partnerAuth/roles";
import { stageLabel, stageTone, when } from "@/components/partner/lead-format";
import { productLineLabel } from "@/lib/format/productLine";
import { oldestOpenLabel } from "@/lib/format/age";
import { isHeld, isSold } from "@/lib/partnerLeads/insights";
import { localDay, shiftDay, trendSeries } from "@/lib/partnerLeads/trend";
import { expectedEarningsFact, termLabel } from "@/lib/partners/payout";
import { countersFromLanes } from "@/lib/partnerLeads/counters";
import { AGE_TONE_TEXT, ageShort, ageTone, boardColumns, laneOf, nobodyClaimedRow, oldestOpenIsStuck, type AgeThresholds, type AgeTone } from "@/lib/partnerLeads/view";
import { NOBODY_CLAIMED_LABEL, type PartnerLane } from "@/lib/partnerLeads/lanes";
import { cn } from "@/lib/utils";

type PipelineResponse = PartnerPipelinePayload;

/**
 * Sample data in place of the API, for `/design/pipeline` (development only). With it set the page
 * neither fetches nor polls, so every state — busy, quiet, empty, erroring, SLA-flagged — can be
 * drawn and checked. The dev database holds one lead; without this seam "verified" would only ever
 * mean "the happy path with a single card".
 */
export type PipelinePreview = { data: PartnerPipelinePayload | null; error?: string };
type Filters = { date_from: string; date_to: string; closer_id: string; product: string; stage_id: string; outcome: string; pipeline_id: string };
const EMPTY_FILTERS: Filters = { date_from: "", date_to: "", closer_id: "", product: "", stage_id: "", outcome: "", pipeline_id: "" };
/** How many cards a lane shows before it offers the rest: a busy agency can put hundreds in one. */
const LANE_PAGE = 20;

/** A board column's header ground and ink, by what being in that column means. */
const COLUMN_TONE: Record<string, string> = {
  open: "border-t-2 border-t-[var(--border-strong)] text-[var(--ink)]",
  won: "border-t-2 border-t-[var(--success)] text-[var(--success-ink)]",
  closed: "border-t-2 border-t-[var(--muted)] text-muted-foreground",
};

/** An age worth remarking on is a badge, on the ground its ink is paired with (UI-CONSISTENCY §12). */
const AGE_TONE_BADGE: Record<AgeTone, string | null> = {
  neutral: null,
  warning: "bg-[var(--warning-surface)] text-[var(--warning-ink)]",
  danger: "bg-[var(--error-surface)] text-[var(--error-ink)]",
};

/** The age, with the words that go with its colour: never colour alone (UI-CONSISTENCY §12). */
function Age({ row, now, thresholds, className }: { row: PartnerLeadRow; now: number | null; thresholds?: AgeThresholds; className?: string }) {
  if (now === null) return <span className={cn("text-muted-foreground", className)}>—</span>;
  const tone = ageTone(row, now, thresholds);
  const badge = AGE_TONE_BADGE[tone];
  const words = AGE_TONE_TEXT[tone];
  const text = ageShort(row.submittedAt, now);
  if (!badge) return <span className={cn("tabular-nums text-muted-foreground", className)}>{text}</span>;
  return <span className={cn("inline-flex items-center gap-1 rounded-badge px-1.5 py-0.5 text-xs font-medium tabular-nums", badge, className)}>
    {tone === "danger" ? <CircleAlert className="size-3 shrink-0" aria-hidden="true" /> : <Clock3 className="size-3 shrink-0" aria-hidden="true" />}
    {text}
    <span className="sr-only"> — {words}</span>
  </span>;
}

function LeadCard({ row, href, now, thresholds, showSubmitter }: { row: PartnerLeadRow; href: string; now: number | null; thresholds?: AgeThresholds; showSubmitter?: boolean }) {
  const flagged = nobodyClaimedRow(row);
  return <Link
    href={href}
    className="group block w-full rounded-md border border-border bg-card p-3 text-left no-underline transition-colors hover:border-[var(--primary)] hover:bg-[var(--surface-alt)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--ring-color)]"
  >
    <span className="flex items-start justify-between gap-2">
      <span className="min-w-0">
        <span className="block truncate text-sm font-semibold text-foreground">{row.customer}</span>
        {/* Who sent it, for an admin reading the whole organisation's board. */}
        {showSubmitter && <span className="mt-0.5 block truncate text-[0.6875rem] text-muted-foreground">{row.submittedBy.name}</span>}
      </span>
      <ArrowRight className="mt-0.5 size-4 shrink-0 text-muted-foreground transition-transform group-hover:translate-x-0.5" aria-hidden="true" />
    </span>
    {/* Product and customer language are quiet descriptors; the SLA age keeps its semantic tone. */}
    <span className="mt-2 flex flex-wrap items-center gap-1.5">
      <StatusChip tone="neutral" className="border border-border">{productLineLabel(row.product)}</StatusChip>
      {row.language && <StatusChip tone="neutral" className="border border-border"><span className="inline-flex items-center gap-1.5" aria-label={`Customer language: ${row.language}`}><Languages aria-hidden="true" className="size-3.5" />{row.language}</span></StatusChip>}
    </span>
    {/* The agency's stage and the waiting time stay together, with an explicit SLA label when raised. */}
    <span className="mt-2 flex min-w-0 items-center justify-between gap-2 border-t border-border pt-1.5">
      {flagged ? <StatusChip tone="warning">{NOBODY_CLAIMED_LABEL}</StatusChip> : <span className="min-w-0 truncate text-xs text-muted-foreground">{row.stageName}</span>}
      <Age row={row} now={now} thresholds={thresholds} className="shrink-0" />
    </span>
  </Link>;
}

/**
 * The filters a link opened the page with (LA-4.20: the partner home's figures open the rows behind
 * them), e.g. /partner/pipeline?stage_id=…&view=table or ?lane=new. A ?lead=<id> is handled by
 * the route, which redirects to that lead's own page. The page renders PageLoading
 * until its first read, so the server's empty state and this one draw the same markup.
 */
function linkedState() {
  const params = typeof window === "undefined" ? new URLSearchParams() : new URLSearchParams(window.location.search);
  const filters = { ...EMPTY_FILTERS };
  for (const key of Object.keys(EMPTY_FILTERS) as Array<keyof Filters>) filters[key] = params.get(key)?.slice(0, 64) ?? "";
  const view: "board" | "table" = params.get("view") === "table" ? "table" : "board";
  const lane = params.get("lane");
  const LANES = ["new", "claimed", "verification", "converted", "closed"];
  return {
    filters,
    view,
    lane: (lane && LANES.includes(lane) ? lane : "") as PartnerLane | "",
  };
}

export function PartnerLeadPipeline({ role, partnerStatus, preview }: { partnerStatus: "draft" | "active" | "paused" | "offboarded"; role: PartnerRole; partnerName?: string | null; preview?: PipelinePreview }) {
  const [linked] = useState(linkedState);
  const [data, setData] = useState<PipelineResponse | null>(preview?.data ?? null);
  const [filters, setFilters] = useState<Filters>(linked.filters);
  const [search, setSearch] = useState("");
  // A lane folds to a slim strip with its name and count; its leads stay loaded and searchable.
  const [foldedLanes, setFoldedLanes] = useState<ReadonlySet<string>>(() => new Set());
  const toggleLane = (key: string) => setFoldedLanes((current) => { const next = new Set(current); if (next.has(key)) next.delete(key); else next.add(key); return next; });
  const [view, setView] = useState<"board" | "table">(linked.view);
  const [moreFilters, setMoreFilters] = useState(() => Boolean(linked.filters.stage_id || linked.filters.closer_id || linked.filters.outcome || linked.filters.date_from || linked.filters.date_to));
  /** Narrowing the page does client-side: the server's filters speak stages, not lanes. */
  const [lane, setLane] = useState<PartnerLane | "">(linked.lane);
  const [onlyFlagged, setOnlyFlagged] = useState(false);
  /** Age and Submitted are the same instant read two ways, so one direction serves both columns. */
  const [sort, setSort] = useState<{ key: "age" | "submitted"; dir: "asc" | "desc" }>({ key: "submitted", dir: "desc" });
  /** Each pipeline lane pages independently so one busy stage doesn't affect the others. */
  const [lanePages, setLanePages] = useState<Partial<Record<PartnerLane, number>>>({});
  const [loading, setLoading] = useState(!preview);
  // The first read draws the page skeleton; later reads (a filter change) keep the page and toolbar.
  const [firstLoad, setFirstLoad] = useState(!preview);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState(preview?.error ?? "");
  const [page, setPage] = useState(1);
  const pageSize = useFittingPageSize(480, 45);
  const loadedLimitRef = useRef(250);

  const query = useMemo(() => new URLSearchParams(Object.entries(filters).filter(([, value]) => Boolean(value))).toString(), [filters]);
  const load = useCallback(async (offset = 0, append = false) => {
    if (preview) { setLoading(false); return; }
    if (append) setLoadingMore(true);
    try {
      const params = new URLSearchParams(query); params.set("limit", String(loadedLimitRef.current)); params.set("offset", String(offset));
      const response = await fetch(`/api/partner/leads/pipeline?${params}`, { cache: "no-store" });
      const body = await response.json().catch(() => null);
      if (!response.ok) throw new Error(body?.error ?? "Could not load your lead pipeline");
      setData((current) => {
        if (!append || !current) {
          loadedLimitRef.current = Math.max(250, body.rows.length);
          return body;
        }
        const rows = [...current.rows, ...body.rows].filter((row: PartnerLeadRow, index: number, all: PartnerLeadRow[]) => all.findIndex((candidate) => candidate.id === row.id) === index);
        loadedLimitRef.current = Math.max(250, rows.length);
        return { ...body, rows, nextOffset: rows.length < body.total ? rows.length : null };
      });
      setError("");
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Could not load your lead pipeline"); }
    finally { setLoading(false); setLoadingMore(false); setFirstLoad(false); }
  }, [query, preview]);
  // Polls only while the tab is visible, catches up on return, and never stacks a tick on a slow one.
  useEffect(() => { if (preview) return; loadedLimitRef.current = 250; let polling = false; const poll = () => { if (document.visibilityState !== "visible" || polling) return; polling = true; void load(0).finally(() => { polling = false; }); }; const kickoff = window.setTimeout(() => { setData(null); setLoading(true); void load(); }, 0); const timer = window.setInterval(poll, 5000); document.addEventListener("visibilitychange", poll); return () => { window.clearTimeout(kickoff); window.clearInterval(timer); document.removeEventListener("visibilitychange", poll); }; }, [load, preview]);
  const allRows = useMemo(() => data?.rows ?? [], [data]);
  // Search matches the customer's name, which is what the box says it searches. Product and
  // submitter have their own controls in the filter panel.
  const pipelineByStage = useMemo(() => new Map((data?.stages ?? []).map((stage) => [stage.id, stage.pipelineId])), [data?.stages]);
  const pipelineRows = useMemo(() => filters.pipeline_id
    ? allRows.filter((row) => pipelineByStage.get(row.stageId) === filters.pipeline_id)
    : allRows, [allRows, filters.pipeline_id, pipelineByStage]);
  const visibleRows = useMemo(() => {
    const value = search.trim().toLowerCase();
    return pipelineRows.filter((row) =>
      (!value || row.customer.toLowerCase().includes(value))
      && (!lane || laneOf(row) === lane)
      && (!onlyFlagged || nobodyClaimedRow(row)));
  }, [pipelineRows, search, lane, onlyFlagged]);

  const sortedRows = useMemo(() => [...visibleRows].sort((a, b) => {
    const newestFirst = Date.parse(b.submittedAt) - Date.parse(a.submittedAt);
    // Oldest-first and newest-last are the same order read from opposite ends.
    const byAge = sort.key === "submitted" ? newestFirst : -newestFirst;
    return sort.dir === "desc" ? byAge : -byAge;
  }), [visibleRows, sort]);

  // The board's columns are the shared lanes, in the order the counters above them read, so the
  // two cannot contradict each other. The agency's own stage name rides on each card.
  const laneRows = useMemo(() => {
    const groups = new Map<PartnerLane, PartnerLeadRow[]>();
    for (const row of visibleRows) { const key = laneOf(row); groups.set(key, [...(groups.get(key) ?? []), row]); }
    return groups;
  }, [visibleRows]);
  const columns = boardColumns((laneRows.get("closed")?.length ?? 0) > 0);
  /** Anything narrowing the page client-side: the column then counts what it matched. */
  const narrowed = Boolean(search.trim() || lane || onlyFlagged || filters.pipeline_id);
  const laneTotal = (key: PartnerLane) => {
    const loaded = laneRows.get(key)?.length ?? 0;
    if (narrowed || key === "closed" || !data?.laneCounts) return loaded;
    return data.laneCounts[key];
  };

  // A relative age needs a "now" the server does not have: null until the clock is read, so the
  // markup hydrates against itself and a relative time never causes a mismatch.
  const clockSeconds = useClockSeconds();
  const now = clockSeconds === null ? null : clockSeconds * 1000;
  const previewCounters = preview && filters.pipeline_id
    ? (() => {
        const counts = { new: 0, claimed: 0, verification: 0, converted: 0 };
        for (const row of pipelineRows) { const key = laneOf(row); if (key !== "closed") counts[key] += 1; }
        const midnight = new Date(); midnight.setHours(0, 0, 0, 0);
        return countersFromLanes(counts, pipelineRows.filter((row) => Date.parse(row.submittedAt) >= midnight.getTime()).length);
      })()
    : null;
  const counters = previewCounters ?? data?.counters;
  /** Never a 0 for a figure that was not read: an unread number is a dash. */
  const figure = (value: number | undefined) => (data && value !== undefined ? value : "—");
  const scopeLabel = role === "partner_admin" ? "Your team and your leads" : "Your leads";
  const earningsFact = expectedEarningsFact(counters?.converted ?? 0, data?.terms ?? null);
  const rate = termLabel(data?.terms ?? null);
  const earningsHelp = rate
    ? `Your rate is ${rate}. The figure here is that rate on the conversions above; your agency's published statement is what is actually paid.`
    : "Conversions in the last 30 days. Your agency's published statement is what is actually paid.";
  // The small line in each tile: the last 14 days of the leads loaded, one point a day.
  const tileSeries = useMemo(() => {
    if (now === null) return null;
    const to = localDay(new Date(now))!;
    const window = { from: shiftDay(to, -13), to, now };
    const perDay = (match: (row: PartnerLeadRow) => boolean) => trendSeries(allRows.filter(match).map((row) => row.submittedAt), window).buckets.map((bucket) => bucket.count);
    return { submitted: perDay(() => true), claimed: perDay(isHeld), converted: perDay(isSold), open: perDay((row) => laneOf(row) !== "closed" && laneOf(row) !== "converted") };
  }, [allRows, now]);
  const stuck = now !== null && oldestOpenIsStuck(data?.oldestOpenAt, now, data?.ageThresholds);

  /** Where a lead's record lives, carrying the view so Back returns to the list as it was. */
  const recordHref = (id: string) => {
    const params = new URLSearchParams();
    if (view === "table") params.set("view", "table");
    if (filters.pipeline_id) params.set("pipeline_id", filters.pipeline_id);
    return `/partner/pipeline/${id}${params.size ? `?${params}` : ""}`;
  };
  const stageById = new Map((data?.stages ?? []).map((stage) => [stage.id, stage]));
  const manyPipelines = new Set((data?.stages ?? []).map((stage) => stage.pipelineId)).size > 1;
  const filterCount = [filters.pipeline_id, filters.stage_id, filters.closer_id, filters.outcome, filters.product, lane, onlyFlagged || null, filters.date_from || filters.date_to].filter(Boolean).length;
  const hasFilters = Object.values(filters).some(Boolean) || Boolean(lane) || onlyFlagged;
  const setFilter = (key: keyof Filters, value: string) => { setFilters((current) => ({ ...current, [key]: value })); setPage(1); setLanePages({}); };
  const setPipeline = (pipelineId: string) => { setFilters((current) => ({ ...current, pipeline_id: pipelineId, stage_id: "" })); setPage(1); setLanePages({}); };
  const narrowTo = (next: PartnerLane | "") => { setLane(next); setOnlyFlagged(false); setPage(1); setLanePages({}); };
  const clearAll = () => { setFilters(EMPTY_FILTERS); setSearch(""); setLane(""); setOnlyFlagged(false); setPage(1); setLanePages({}); };
  const tablePage = paginate(sortedRows, page, pageSize);
  const canLoadMore = Boolean(data && data.rows.length < data.total);
  // The search runs over the leads loaded in the browser, so a typed search reads in the rest, batch by batch.
  useEffect(() => {
    if (preview || !search.trim() || !data || loading || loadingMore || data.nextOffset == null || data.rows.length >= data.total) return;
    const nextOffset = data.nextOffset;
    const timer = window.setTimeout(() => { void load(nextOffset, true); }, 0);
    return () => window.clearTimeout(timer);
  }, [preview, search, data, loading, loadingMore, load]);
  const turnLanePage = (key: PartnerLane, nextPage: number) => {
    setLanePages((current) => ({ ...current, [key]: nextPage }));
    if (data && data.rows.length < nextPage * LANE_PAGE && data.nextOffset != null && !loadingMore) {
      void load(data.nextOffset, true);
    }
  };

  /** Every narrowing in force, as removable chips under the panel (UI-CONSISTENCY §6a). */
  const chips: ActiveFilter[] = [
    filters.pipeline_id && { key: "pipeline", label: "Pipeline", value: data?.pipelines.find((item) => item.id === filters.pipeline_id)?.name ?? "Pipeline", onRemove: () => setPipeline("") },
    filters.product && { key: "product", label: "Product", value: productLineLabel(filters.product), onRemove: () => setFilter("product", "") },
    filters.stage_id && { key: "stage", label: "Stage", value: stageById.get(filters.stage_id)?.name ?? "Stage", onRemove: () => setFilter("stage_id", "") },
    filters.closer_id && { key: "closer", label: "Submitted by", value: data?.facets.closers.find((item) => item.id === filters.closer_id)?.name ?? "Someone", onRemove: () => setFilter("closer_id", "") },
    filters.outcome && { key: "outcome", label: "Outcome", value: data?.facets.outcomes.find((item) => item.key === filters.outcome)?.label ?? "Outcome", onRemove: () => setFilter("outcome", "") },
    lane && { key: "lane", label: "Where it is", value: columns.find((column) => column.key === lane)?.label ?? lane, onRemove: () => { setLane(""); setLanePages({}); } },
    onlyFlagged && { key: "flagged", label: "Needs you", value: NOBODY_CLAIMED_LABEL, onRemove: () => { setOnlyFlagged(false); setLanePages({}); } },
    (filters.date_from || filters.date_to) && { key: "dates", label: "Submitted", value: `${filters.date_from || "any"} to ${filters.date_to || "today"}`, onRemove: () => { setFilters((current) => ({ ...current, date_from: "", date_to: "" })); setPage(1); setLanePages({}); } },
  ].filter(Boolean) as ActiveFilter[];

  if (firstLoad) return <PageLoading />;

  // The context selector leads the search; the view, inline filter and refresh controls match the
  // ordering in the manager's reference image.
  const toolbar = <DataToolbar
    actions={<>
      <IconViewSwitch label="Pipeline view" options={[{ key: "board", label: "Board view", icon: "grid" }, { key: "table", label: "Table view", icon: "list" }]} value={view} onChange={setView} />
      <FilterButton iconOnly open={moreFilters} controls="partner-lead-filters" onClick={() => setMoreFilters((value) => !value)} count={filterCount} />
      {/* The label is for the room it has: on a phone the icon carries it, with the name still on
          the control for anyone listening rather than looking. */}
      <RefreshButton onClick={() => { setLoading(true); void load(); }} refreshing={loading} labelClassName="sr-only" className="px-2.5" />
    </>}
  >
    <SelectMenu
      label="Pipeline"
      value={filters.pipeline_id}
      defaultValue=""
      onChange={setPipeline}
      searchPlaceholder="Search pipelines"
      className="w-full sm:w-48"
      matchTriggerWidth
      panelAlign="start"
      options={[{ value: "", label: "All pipelines" }, ...(data?.pipelines ?? []).map((item) => ({ value: item.id, label: item.name }))]}
    />
    <ToolbarSearch value={search} onChange={(value) => { setSearch(value); setPage(1); setLanePages({}); }} placeholder="Search customer" />
  </DataToolbar>;

  // §6a: the panel opens inside the card, under the toolbar, as a grid of labelled fields.
  // §6a: the panel opens inside the card, under the toolbar, as a grid of labelled fields. Each
  // choice is the kit's searchable SelectMenu (owner, 2026-10-29: the native dropdowns were "so
  // plain", and a long list needs a search at the top) — never a native <select>, whose menu the
  // operating system draws in its own colours.
  const filterPanel = <>
    <FilterPanel id="partner-lead-filters" open={moreFilters}>
      <Field label="Where it is" htmlFor="partner-lead-lane">
        <SelectMenu
          id="partner-lead-lane"
          label="Where it is"
          value={lane}
          defaultValue=""
          onChange={(next) => narrowTo(next)}
          searchPlaceholder="Search stages"
          className="w-full"
          matchTriggerWidth
          panelAlign="start"
          options={[
            { value: "" as PartnerLane | "", label: "Anywhere" },
            // No description: the lane footnotes are sentences, and SelectMenu's description is for
            // short context (a state name beside its code) — in a 288px panel they collide with the
            // label. The count is what the reader needs here; the board's column header carries the
            // sentence in its title.
            ...columns.map((column) => ({ value: column.key as PartnerLane | "", label: column.label, count: laneTotal(column.key) })),
          ]}
        />
      </Field>
      <Field label="Product" htmlFor="partner-lead-product">
        <SelectMenu
          id="partner-lead-product"
          label="Product"
          value={filters.product}
          defaultValue=""
          onChange={(next) => setFilter("product", next)}
          searchPlaceholder="Search products"
          className="w-full"
          matchTriggerWidth
          panelAlign="start"
          options={[
            { value: "", label: "All products" },
            ...(data?.facets.products ?? []).map((item) => ({ value: item, label: productLineLabel(item) })),
          ]}
        />
      </Field>
      <Field label="Agency stage" htmlFor="partner-lead-stage">
        <SelectMenu
          id="partner-lead-stage"
          label="Agency stage"
          value={filters.stage_id}
          defaultValue=""
          onChange={(next) => setFilter("stage_id", next)}
          searchPlaceholder="Search stages"
          className="w-full"
          matchTriggerWidth
          panelAlign="start"
          options={[
            { value: "", label: "All stages" },
            // Grouped by pipeline only when the partner's leads sit in more than one, so the usual
            // case is a plain list rather than a list under one heading.
            ...(data?.stages ?? []).map((item) => ({ value: item.id, label: item.name, group: manyPipelines ? item.pipelineName : undefined, count: item.leadCount })),
          ]}
        />
      </Field>
      {role === "partner_admin" && <Field label="Submitted by" htmlFor="partner-lead-closer">
        <SelectMenu
          id="partner-lead-closer"
          label="Submitted by"
          value={filters.closer_id}
          defaultValue=""
          onChange={(next) => setFilter("closer_id", next)}
          searchPlaceholder="Search your team"
          className="w-full"
          matchTriggerWidth
          panelAlign="start"
          options={[
            { value: "", label: "Anyone on your team" },
            ...(data?.facets.closers ?? []).map((item) => ({ value: item.id, label: item.name })),
          ]}
        />
      </Field>}
      <Field label="Outcome" htmlFor="partner-lead-outcome">
        <SelectMenu
          id="partner-lead-outcome"
          label="Outcome"
          value={filters.outcome}
          defaultValue=""
          onChange={(next) => setFilter("outcome", next)}
          searchPlaceholder="Search outcomes"
          className="w-full"
          matchTriggerWidth
          panelAlign="start"
          options={[
            { value: "", label: "Any outcome" },
            ...(data?.facets.outcomes ?? []).map((item) => ({ value: item.key, label: item.label })),
          ]}
        />
      </Field>
      <Field label="Submitted from" htmlFor="partner-lead-from">
        <input id="partner-lead-from" type="date" aria-label="Submitted from" className={cn(toolbarControl, "w-full")} value={filters.date_from} onChange={(event) => setFilter("date_from", event.target.value)} />
      </Field>
      <Field label="Submitted to" htmlFor="partner-lead-to">
        <input id="partner-lead-to" type="date" aria-label="Submitted to" className={cn(toolbarControl, "w-full")} value={filters.date_to} onChange={(event) => setFilter("date_to", event.target.value)} />
      </Field>
    </FilterPanel>
    <ActiveFilters filters={chips} onClear={clearAll} />
  </>;

  const empty = <div className="flex min-h-[24rem] flex-1 items-center justify-center">
    {search.trim() || hasFilters
      ? <NoMatches noun="leads" onClear={clearAll} />
      : <EmptyState title="No leads yet" hint="Leads you submit appear here as they move through the pipeline." action={<Button asChild variant="outline" size="sm"><a href="/partner/submit-lead">Submit New Lead</a></Button>} />}
  </div>;

  const loadMore = canLoadMore && data
    ? <Button type="button" variant="outline" size="sm" disabled={loadingMore || data.nextOffset == null} aria-busy={loadingMore} onClick={() => void load(data.nextOffset ?? data.rows.length, true)}>Load more</Button>
    : null;

  const sortBy = (key: "age" | "submitted") => setSort((current) => ({ key, dir: current.key === key && current.dir === "desc" ? "asc" : "desc" }));
  const sortState = (key: "age" | "submitted") => (sort.key === key ? (sort.dir === "desc" ? "descending" : "ascending") : "none");

  // Both views answer an empty result the same way: nothing submitted yet offers the action that
  // fills the page, a filter that matched nothing offers to clear itself (§8). The board used to
  // show four empty columns instead, which offered neither.
  // The page owns vertical scrolling. A stage shows up to 20 naturally sized cards, then its own
  // pager advances to the next set. Never constrain a lane's card list to a scrollable viewport:
  // that made a handful of leads scroll inside a column while also showing pagination.
  // Below md the lanes stack into one vertical read; on wider screens they sit side by side.
  const board = !visibleRows.length ? empty : <div className="flex min-h-[24rem] flex-1 flex-col gap-3 overflow-x-auto p-3 md:flex-row">
    {columns.map((column) => {
      const rows = laneRows.get(column.key) ?? [];
      const total = laneTotal(column.key);
      const lanePage = paginate(rows, lanePages[column.key] ?? 1, LANE_PAGE);
      const needsMoreRows = (lanePage.current - 1) * LANE_PAGE >= rows.length && total > rows.length && loadingMore;
      const isFolded = foldedLanes.has(column.key);
      return <section key={column.key} data-stage={column.key} aria-label={column.label} className={cn("flex min-w-0 flex-col rounded-md border border-border bg-[var(--canvas)]", isFolded ? "md:w-12 md:min-w-12 md:flex-none" : "md:w-0 md:min-w-[220px] md:max-w-[420px] md:flex-1")}>
        <header className={cn("sticky top-0 z-10 border-b border-border bg-card text-sm font-semibold md:static", COLUMN_TONE[column.tone])} title={column.footnote}>
          <button
            type="button"
            aria-expanded={!isFolded}
            aria-label={`${column.label}, ${total.toLocaleString()} ${total === 1 ? "lead" : "leads"}. ${isFolded ? "Open" : "Fold"} this stage`}
            onClick={() => toggleLane(column.key)}
            className={cn("flex w-full items-center gap-2 border-0 bg-transparent px-3 py-2 text-left font-[inherit] text-inherit outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring", isFolded && "md:flex-col md:px-0 md:py-3")}
          >
            <ChevronDown aria-hidden="true" className={cn("size-4 shrink-0 text-muted-foreground transition-transform", isFolded && "-rotate-90")} />
            <h3 className={cn("min-w-0 flex-1 truncate", isFolded && "md:flex-none md:[writing-mode:vertical-rl]")}>{column.label}</h3>
            <span className="inline-flex min-w-6 items-center justify-center rounded-full bg-[var(--surface-alt)] px-2 py-0.5 text-xs tabular-nums text-[var(--body)]">{total.toLocaleString()}</span>
          </button>
        </header>
        <div className={cn("grid content-start gap-2 p-2", isFolded && "hidden")}>
          {lanePage.rows.map((row) => <LeadCard key={row.id} row={row} href={recordHref(row.id)} now={now} thresholds={data?.ageThresholds} showSubmitter={role === "partner_admin"} />)}
          {/* An empty lane is one quiet line on a phone, not 420px of nothing. */}
          {!rows.length && <p className="px-2 py-2 text-center text-xs text-muted-foreground md:py-6">Nothing here right now</p>}
          {needsMoreRows && <p className="px-2 py-3 text-center text-xs text-muted-foreground" role="status">Loading leads…</p>}
        </div>
        {!isFolded && total > LANE_PAGE && <div className="border-t border-border bg-[var(--surface-alt)]/60 px-3 py-2">
          <Pager page={lanePage.current} total={total} noun={`${column.label.toLowerCase()} leads`} pageSize={LANE_PAGE} onPage={(nextPage) => turnLanePage(column.key, nextPage)} disabled={loadingMore} layout="stepper" />
        </div>}
      </section>;
    })}
  </div>;

  const table = !sortedRows.length ? empty : <Table>
    <TableHeader><TableRow>
      <TableHead>Lead</TableHead>
      <TableHead>Product</TableHead>
      <TableHead>Stage</TableHead>
      {role === "partner_admin" && <TableHead>Submitted by</TableHead>}
      <TableHead aria-sort={sortState("age")}>
        <button type="button" onClick={() => sortBy("age")} className="font-medium text-inherit hover:text-foreground">Waiting{sort.key === "age" ? (sort.dir === "desc" ? " ↓" : " ↑") : ""}</button>
      </TableHead>
      <TableHead aria-sort={sortState("submitted")}>
        <button type="button" onClick={() => sortBy("submitted")} className="font-medium text-inherit hover:text-foreground">Submitted{sort.key === "submitted" ? (sort.dir === "desc" ? " ↓" : " ↑") : ""}</button>
      </TableHead>
      <TableHead className="text-right"><span className="sr-only">Action</span></TableHead>
    </TableRow></TableHeader>
    <TableBody>
      {tablePage.rows.map((row) => <TableRow key={row.id}>
        <TableCell className="font-medium">{row.customer}</TableCell>
        <TableCell className="text-muted-foreground">{productLineLabel(row.product)}</TableCell>
        <TableCell><StatusChip tone={stageTone(row)}>{stageLabel(row)}</StatusChip></TableCell>
        {role === "partner_admin" && <TableCell className="text-muted-foreground">{row.submittedBy.name}</TableCell>}
        <TableCell><Age row={row} now={now} thresholds={data?.ageThresholds} /></TableCell>
        <TableCell className="tabular-nums text-muted-foreground">{when(row.submittedAt)}</TableCell>
        <TableCell className="text-right"><Button asChild variant="ghost" size="icon" className="text-muted-foreground hover:text-foreground"><Link href={recordHref(row.id)} title="Open the lead" aria-label={`Open the lead for ${row.customer}`}><ArrowUpRight aria-hidden="true" /></Link></Button></TableCell>
      </TableRow>)}
    </TableBody>
  </Table>;

  const body = !data
    ? (error ? <ErrorState detail={error} action={<Button type="button" variant="outline" onClick={() => void load()}>Try again</Button>} /> : <SectionLoading rows={8} columns={5} />)
    : view === "board" ? board : table;

  // The table pages through what is loaded and fetches the next batch as the last loaded page opens,
  // so it never needs a Load more button (owner 2026-10-30: every table pages like Source campaigns).
  const turnTablePage = (next: number) => {
    setPage(next);
    if (data && canLoadMore && !loadingMore && data.nextOffset != null && next >= Math.ceil(sortedRows.length / pageSize)) void load(data.nextOffset, true);
  };
  const footer = !data ? undefined : view === "table"
    ? <Pager page={tablePage.current} total={sortedRows.length} noun="leads" pageSize={pageSize} onPage={turnTablePage} disabled={loadingMore} suffix={canLoadMore ? `${data.rows.length.toLocaleString()} of ${data.total.toLocaleString()} loaded` : undefined} />
    : canLoadMore ? <><span>Showing {data.rows.length.toLocaleString()} of {data.total.toLocaleString()} leads</span>{loadMore}</> : undefined;

  return <div className="m-stagger flex min-h-[calc(100dvh_-_7rem)] w-full min-w-0 flex-col gap-6">
    <PageHeader
      title="Lead Pipeline"
      description={role === "partner_admin" ? "Track leads submitted by you and your team." : "Track the leads you submitted."}
      hideTitle
      breadcrumbs={[{ label: "Leads" }, { label: "Lead Pipeline" }]}
      actions={<>
        {data && <LiveStamp updatedAt={data.generatedAt} staleAfterSeconds={45} />}
        {partnerStatus === "active" && <Button asChild size="sm"><a href="/partner/submit-lead"><Send aria-hidden="true" />Submit New Lead</a></Button>}
      </>}
    />
    {error && data && <p role="alert" className="flex flex-wrap items-center justify-between gap-3 rounded-md border border-[var(--error)] bg-[var(--error-surface)] px-4 py-2 text-sm text-[var(--error-ink)]">{error}<Button type="button" variant="outline" onClick={() => void load()}>Try again</Button></p>}
    {/* The counters in the board's own lanes (lib/partnerLeads/counters.ts), as the dashboard tiles the other
        partner pages use: a round icon, the figure, the last two weeks as a line, one plain sentence. */}
    <KpiRow label={scopeLabel}>
      <KpiTile
        icon={Send}
        label="Submitted today"
        value={figure(counters?.submittedToday)}
        series={tileSeries?.submitted}
        note="Since midnight, your time"
      />
      <KpiTile
        icon={Hand}
        label="With a closer"
        value={figure(counters?.claimed)}
        series={tileSeries?.claimed}
        note="Claimed, or on a call now"
      />
      <KpiTile
        icon={CheckCircle2}
        label="Converted · 30 days"
        info={earningsHelp}
        value={figure(counters?.converted)}
        series={tileSeries?.converted}
        note={earningsFact ? <>{earningsFact.label}{earningsFact.value !== undefined && <> · <span className="font-semibold text-foreground">{earningsFact.value}</span></>}</> : "Became business"}
      />
      <KpiTile
        icon={Inbox}
        label="Still open"
        value={figure(counters?.stillOpen)}
        tone={stuck ? "warn" : "default"}
        series={tileSeries?.open}
        note={now === null ? "Not yet finished" : oldestOpenLabel(counters?.stillOpen ?? 0, data?.oldestOpenAt, now)}
      />
    </KpiRow>
    <TableCard className="flex min-h-[28rem] min-w-0 flex-1 flex-col" bodyClassName="flex min-h-0 flex-1 flex-col" toolbar={toolbar} filters={filterPanel} footer={footer}>{body}</TableCard>
  </div>;
}
