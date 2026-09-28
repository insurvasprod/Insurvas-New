"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { ArrowRight, Download, ExternalLink, LayoutGrid, List, Lock, X } from "lucide-react";

import { Button } from "@/components/ui/button";
import { DataToolbar, FilterButton, RefreshButton, ToolbarSearch, toolbarControl } from "@/components/ui/data-toolbar";
import { PageHeader } from "@/components/ui/page-header";
import { PageLoading } from "@/components/ui/page-loading";
import { EmptyState, ErrorState, NoMatches, SectionLoading } from "@/components/ui/page-states";
import { Pager, paginate } from "@/components/ui/pager";
import { StatStrip, StatTile } from "@/components/ui/stat";
import { StatusChip, type StatusTone } from "@/components/ui/status-chip";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { TableCard } from "@/components/ui/table-card";
import type { PartnerLeadDetail, PartnerLeadFacets, PartnerLeadRow, PartnerPipelineStage } from "@/lib/partnerLeads/types";
import type { PartnerRole } from "@/lib/partnerAuth/roles";
import { productLineLabel } from "@/lib/format/productLine";
import { PARTNER_LANES, type PartnerLaneCounts } from "@/lib/partnerLeads/lanes";
import { cn } from "@/lib/utils";

type PipelineResponse = {
  rows: PartnerLeadRow[];
  stages: PartnerPipelineStage[];
  facets: PartnerLeadFacets;
  counters: { submittedToday: number; claimed: number; converted: number; stillOpen: number };
  laneCounts?: PartnerLaneCounts | null;
  total: number;
  nextOffset: number | null;
};
type Filters = { date_from: string; date_to: string; closer_id: string; product: string; stage_id: string; outcome: string };
const EMPTY_FILTERS: Filters = { date_from: "", date_to: "", closer_id: "", product: "", stage_id: "", outcome: "" };
const PAGE_SIZE = 25;

/** Each lane's header ground and ink, as the board draws them. */
const LANE_TONE: Record<(typeof PARTNER_LANES)[number]["key"], string> = {
  new: "bg-[var(--surface-alt)] text-[var(--body)]",
  claimed: "bg-[var(--soft-orange-surface)] text-[var(--accent-ink)]",
  verification: "bg-[var(--info-surface)] text-[var(--info-ink)]",
  converted: "bg-[var(--success-surface)] text-[var(--success-ink)]",
};

function when(value: string) { return new Date(value).toLocaleString(); }
/** "12 min", "3 hr", "yesterday", "4 d" — how long ago, the way the board's cards say it. */
function ageShort(value: string) {
  const minutes = Math.max(0, Math.round((Date.now() - new Date(value).getTime()) / 60_000));
  if (minutes < 60) return `${Math.max(1, minutes)} min`;
  if (minutes < 24 * 60) return `${Math.round(minutes / 60)} hr`;
  if (minutes < 48 * 60) return "yesterday";
  return `${Math.round(minutes / (24 * 60))} d`;
}
function stageLabel(row: PartnerLeadRow | PartnerLeadDetail) { return row.stageName || row.outcome || "Submitted"; }
function stageTone(label: string): StatusTone {
  const value = label.toLowerCase();
  if (value.includes("won") || value.includes("application") || value.includes("complete")) return "good";
  if (value.includes("lost") || value.includes("declined") || value.includes("not interested") || value.includes("closed")) return "danger";
  if (value.includes("progress") || value.includes("claimed") || value.includes("review")) return "info";
  return "neutral";
}

function LeadCard({ row, selected, onSelect }: { row: PartnerLeadRow; selected: boolean; onSelect: () => void }) {
  return <button
    type="button"
    aria-pressed={selected}
    onClick={onSelect}
    className={cn(
      "block w-full rounded-md border bg-card p-3 text-left transition-colors hover:border-[var(--primary)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--ring-color)]",
      selected ? "border-[var(--primary)]" : "border-border"
    )}
  >
    <span className="flex items-center justify-between gap-2"><span className="truncate text-sm font-semibold text-foreground">{row.customer}</span><ArrowRight className="size-4 shrink-0 text-muted-foreground" aria-hidden="true" /></span>
    <span className="mt-0.5 block text-xs text-muted-foreground">{productLineLabel(row.product)} · {ageShort(row.submittedAt)}</span>
  </button>;
}

function Preview({ detail, loading, onClose }: { detail: PartnerLeadDetail | null; loading: boolean; onClose: () => void }) {
  const [tab, setTab] = useState<"submission" | "timeline">("submission");
  return <aside className="lead-preview-panel partner-lead-preview">
    <div className="lead-preview-header"><div><h2>{detail?.customer ?? "Lead details"}</h2><p>{detail ? `${detail.product} · ${detail.submittedBy.name}` : "Partner submission"}</p></div><button type="button" className="lead-preview-close" aria-label="Close lead preview" onClick={onClose}><X className="size-5" /></button></div>
    <div className="lead-preview-tabs"><button type="button" className={tab === "submission" ? "is-active" : ""} onClick={() => setTab("submission")}>Submission</button><button type="button" className={tab === "timeline" ? "is-active" : ""} onClick={() => setTab("timeline")}>Timeline</button></div>
    {loading || !detail ? <SectionLoading rows={6} columns={2} label="Loading lead details" /> : tab === "submission" ? <div className="lead-preview-scroll"><div className="lead-preview-banner"><StatusChip tone={stageTone(stageLabel(detail))}>{stageLabel(detail)}</StatusChip><span>{detail.outcome ?? "Awaiting update"}</span></div><div className="lead-preview-section"><div className="lead-preview-lock"><Lock className="size-3.5" aria-hidden="true" />Form as submitted — cannot be edited in the partner portal</div><div className="lead-form-snapshot">{Object.entries(detail.values).map(([key, value]) => <div className="lead-snapshot-row" key={key}><span>{key.replaceAll("_", " ")}</span><strong>{typeof value === "object" ? JSON.stringify(value) : String(value ?? "—")}</strong></div>)}</div></div><div className="lead-preview-section"><div className="lead-section-heading"><h3>Submission details</h3></div><dl className="lead-detail-list"><div><dt>Submitted</dt><dd>{when(detail.submittedAt)}</dd></div><div><dt>Submitted by</dt><dd>{detail.submittedBy.name}</dd></div><div><dt>Last updated</dt><dd>{when(detail.updatedAt)}</dd></div><div><dt>Outcome</dt><dd>{detail.outcome ?? "Awaiting update"}</dd></div></dl></div></div> : <div className="lead-preview-scroll"><div className="lead-preview-section"><div className="lead-section-heading"><h3>Submission timeline</h3></div><div className="lead-timeline">{detail.timeline.length ? detail.timeline.map((event, index) => <div className="lead-timeline-item" key={`${event.at}-${event.type}-${index}`}><span className="lead-timeline-dot" /><div><strong>{event.label}</strong><p>{event.detail ?? "Partner-visible update"}</p><time>{when(event.at)}</time></div></div>) : <p className="text-sm text-muted-foreground">No timeline events yet.</p>}</div></div></div>}
    <div className="lead-preview-footer"><Link href="/partner/pipeline" className="lead-full-link">Back to partner pipeline <ExternalLink className="size-4" /></Link></div>
  </aside>;
}

export function PartnerLeadPipeline({ role }: { partnerStatus: "draft" | "active" | "paused" | "offboarded"; role: PartnerRole; partnerName?: string | null }) {
  const [data, setData] = useState<PipelineResponse | null>(null);
  const [filters, setFilters] = useState<Filters>(EMPTY_FILTERS);
  const [search, setSearch] = useState("");
  const [view, setView] = useState<"board" | "table">("board");
  const [moreFilters, setMoreFilters] = useState(false);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [detail, setDetail] = useState<PartnerLeadDetail | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [loading, setLoading] = useState(true);
  // The first read draws the page skeleton; later reads (a filter change) keep the page and toolbar.
  const [firstLoad, setFirstLoad] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState("");
  const [page, setPage] = useState(1);
  const loadedLimitRef = useRef(250);

  const query = useMemo(() => new URLSearchParams(Object.entries(filters).filter(([, value]) => Boolean(value))).toString(), [filters]);
  const load = useCallback(async (offset = 0, append = false) => {
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
  }, [query]);
  // Polls only while the tab is visible, catches up on return, and never stacks a tick on a slow one.
  useEffect(() => { loadedLimitRef.current = 250; let polling = false; const poll = () => { if (document.visibilityState !== "visible" || polling) return; polling = true; void load(0).finally(() => { polling = false; }); }; const kickoff = window.setTimeout(() => { setData(null); setLoading(true); void load(); }, 0); const timer = window.setInterval(poll, 5000); document.addEventListener("visibilitychange", poll); return () => { window.clearTimeout(kickoff); window.clearInterval(timer); document.removeEventListener("visibilitychange", poll); }; }, [load]);
  useEffect(() => {
    if (!selectedId) return;
    let cancelled = false;
    const kickoff = window.setTimeout(() => {
      setDetail(null); setDetailLoading(true);
      void fetch(`/api/partner/leads/${selectedId}`, { cache: "no-store" }).then(async (response) => ({ response, body: await response.json().catch(() => null) })).then(({ response, body }) => { if (cancelled) return; if (!response.ok) throw new Error(body?.error ?? "Could not load lead detail"); setDetail(body); }).catch((cause) => { if (!cancelled) setError(cause instanceof Error ? cause.message : "Could not load lead detail"); }).finally(() => { if (!cancelled) setDetailLoading(false); });
    }, 0);
    return () => { cancelled = true; window.clearTimeout(kickoff); };
  }, [selectedId]);

  // Matches the customer's name, which is what the box says it searches. Product and submitter have
  // their own controls (the product select, and Filters › Submitted by).
  const visibleRows = useMemo(() => { const value = search.trim().toLowerCase(); return (data?.rows ?? []).filter((row) => !value || row.customer.toLowerCase().includes(value)); }, [data, search]);
  const activeStages = useMemo(() => (data?.stages ?? []).filter((stage) => !stage.isArchived).sort((a, b) => a.position - b.position), [data]);
  const laneRows = useMemo(() => { const groups = new Map<string, PartnerLeadRow[]>(); for (const row of visibleRows) if (row.lane && row.lane !== "closed") groups.set(row.lane, [...(groups.get(row.lane) ?? []), row]); return groups; }, [visibleRows]);
  // The Filters badge counts what is narrowing the list besides the product, which has its own control.
  const filterCount = [filters.stage_id, filters.closer_id, filters.outcome, filters.date_from || filters.date_to].filter(Boolean).length;
  const exportHref = `/api/partner/leads/export${query ? `?${query}` : ""}`;
  const hasFilters = Object.values(filters).some(Boolean);
  const selectLead = (id: string) => { setSelectedId((current) => current === id ? null : id); };
  const setFilter = (key: keyof Filters, value: string) => { setFilters((current) => ({ ...current, [key]: value })); setPage(1); };
  const clearAll = () => { setFilters(EMPTY_FILTERS); setSearch(""); setPage(1); };
  const tablePage = paginate(visibleRows, page, PAGE_SIZE);
  const canLoadMore = Boolean(data && data.rows.length < data.total);

  if (firstLoad) return <PageLoading />;

  const toolbar = <>
    <DataToolbar
      actions={<>
        <div role="group" aria-label="View" className="inline-flex h-9 items-center rounded-md border border-border bg-background p-0.5">
          {([["board", "Board", LayoutGrid], ["table", "Table", List]] as const).map(([key, label, Icon]) => <button
            key={key}
            type="button"
            aria-label={`${label} view`}
            aria-pressed={view === key}
            onClick={() => setView(key)}
            className={cn("inline-flex h-full items-center gap-1.5 rounded-[5px] px-2.5 text-sm font-semibold transition-colors", view === key ? "bg-[var(--surface-alt)] text-foreground" : "text-muted-foreground hover:text-foreground")}
          ><Icon className="size-4" aria-hidden="true" />{label}</button>)}
        </div>
        <Button asChild variant="outline"><a href={exportHref}><Download aria-hidden="true" />Export CSV</a></Button>
        <RefreshButton onClick={() => { setLoading(true); void load(); }} refreshing={loading} />
      </>}
    >
      <ToolbarSearch value={search} onChange={(value) => { setSearch(value); setPage(1); }} placeholder="Search customer" />
      <select aria-label="Product" className={toolbarControl} value={filters.product} onChange={(event) => setFilter("product", event.target.value)}><option value="">All products</option>{data?.facets.products.map((item) => <option key={item} value={item}>{productLineLabel(item)}</option>)}</select>
      <FilterButton open={moreFilters} onClick={() => setMoreFilters((value) => !value)} count={filterCount} />
    </DataToolbar>
    {moreFilters && <div className="flex w-full flex-wrap items-center gap-2">
      <select aria-label="Stage" className={toolbarControl} value={filters.stage_id} onChange={(event) => setFilter("stage_id", event.target.value)}><option value="">All stages</option>{activeStages.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select>
      {role === "partner_admin" && <select aria-label="Submitted by" className={toolbarControl} value={filters.closer_id} onChange={(event) => setFilter("closer_id", event.target.value)}><option value="">Submitted by anyone</option>{data?.facets.closers.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select>}
      <select aria-label="Outcome" className={toolbarControl} value={filters.outcome} onChange={(event) => setFilter("outcome", event.target.value)}><option value="">Any outcome</option>{data?.facets.outcomes.map((item) => <option key={item.key} value={item.key}>{item.label}</option>)}</select>
      <label className="flex items-center gap-1.5 text-sm text-muted-foreground">From<input type="date" className={toolbarControl} value={filters.date_from} onChange={(event) => setFilter("date_from", event.target.value)} /></label>
      <label className="flex items-center gap-1.5 text-sm text-muted-foreground">To<input type="date" className={toolbarControl} value={filters.date_to} onChange={(event) => setFilter("date_to", event.target.value)} /></label>
      <Button type="button" variant="ghost" disabled={!hasFilters} onClick={() => { setFilters(EMPTY_FILTERS); setPage(1); }}>Reset</Button>
    </div>}
  </>;

  const empty = search.trim() || hasFilters
    ? <NoMatches noun="leads" onClear={clearAll} />
    : <EmptyState title="No leads yet" hint="Leads you submit appear here as they move through the pipeline." action={<Button asChild variant="outline"><a href="/partner/submit-lead">Submit a lead</a></Button>} />;

  const body = !data
    ? (error ? <ErrorState detail={error} action={<Button type="button" variant="outline" onClick={() => void load()}>Try again</Button>} /> : <SectionLoading rows={8} columns={5} />)
    : view === "board"
      ? <div className="flex h-[max(420px,calc(100vh-380px))] gap-3 overflow-x-auto p-3">
        {PARTNER_LANES.map((lane) => {
          const rows = laneRows.get(lane.key) ?? [];
          return <section key={lane.key} data-lane={lane.key} aria-label={lane.label} className="flex min-h-0 min-w-[220px] flex-1 flex-col overflow-hidden rounded-md border border-border bg-[var(--canvas)]">
            <header className={cn("flex items-center justify-between gap-2 border-b border-border px-3 py-2 text-sm font-semibold", LANE_TONE[lane.key])}><h3>{lane.label}</h3><span className="tabular-nums">{rows.length}</span></header>
            <div className="grid min-h-0 flex-1 content-start gap-2 overflow-y-auto p-2">
              {rows.map((row) => <LeadCard key={row.id} row={row} selected={selectedId === row.id} onSelect={() => selectLead(row.id)} />)}
              {!rows.length && <p className="px-2 py-6 text-center text-xs text-muted-foreground">Nothing here right now</p>}
            </div>
          </section>;
        })}
      </div>
      : !visibleRows.length ? empty : <Table>
        <TableHeader><TableRow><TableHead>Lead</TableHead><TableHead>Product</TableHead><TableHead>Stage</TableHead>{role === "partner_admin" && <TableHead>Submitted by</TableHead>}<TableHead>Submitted</TableHead><TableHead className="text-right"><span className="sr-only">Action</span></TableHead></TableRow></TableHeader>
        <TableBody>
          {tablePage.rows.map((row) => <TableRow key={row.id} data-state={selectedId === row.id ? "selected" : undefined}>
            <TableCell className="font-medium">{row.customer}</TableCell>
            <TableCell className="text-muted-foreground">{productLineLabel(row.product)}</TableCell>
            <TableCell><StatusChip tone={stageTone(stageLabel(row))}>{stageLabel(row)}</StatusChip></TableCell>
            {role === "partner_admin" && <TableCell className="text-muted-foreground">{row.submittedBy.name}</TableCell>}
            <TableCell className="tabular-nums text-muted-foreground">{when(row.submittedAt)}</TableCell>
            <TableCell className="text-right"><Button type="button" variant="outline" size="sm" aria-expanded={selectedId === row.id} onClick={() => selectLead(row.id)}>{selectedId === row.id ? "Close" : "View"}</Button></TableCell>
          </TableRow>)}
        </TableBody>
      </Table>;

  const loadMore = canLoadMore && data
    ? <Button type="button" variant="outline" size="sm" disabled={loadingMore || data.nextOffset == null} aria-busy={loadingMore} onClick={() => void load(data.nextOffset ?? data.rows.length, true)}>Load more</Button>
    : null;
  const footer = !data ? undefined : view === "table"
    ? <><Pager page={tablePage.current} total={visibleRows.length} noun="leads" pageSize={PAGE_SIZE} onPage={setPage} suffix={canLoadMore ? `${data.rows.length.toLocaleString()} of ${data.total.toLocaleString()} loaded` : undefined} />{loadMore}</>
    : canLoadMore ? <><span>Showing {data.rows.length.toLocaleString()} of {data.total.toLocaleString()} leads</span>{loadMore}</> : undefined;

  return <div className="m-stagger space-y-6">
    <PageHeader title="Lead pipeline" description={role === "partner_admin" ? undefined : "Only the leads you submitted."} />
    {error && data && <p role="alert" className="flex flex-wrap items-center justify-between gap-3 rounded-md border border-[var(--error)] bg-[var(--error-surface)] px-4 py-2 text-sm text-[var(--error-ink)]">{error}<Button type="button" variant="outline" onClick={() => void load()}>Try again</Button></p>}
    <StatStrip label="Leads by lane">
      {PARTNER_LANES.map((lane) => <StatTile key={lane.key} label={lane.label} value={data?.laneCounts ? data.laneCounts[lane.key] : "—"} footnote={data && !data.laneCounts ? "not shown for a stage or outcome filter" : lane.footnote} />)}
    </StatStrip>
    <div className={cn("grid items-start gap-4", selectedId && "lg:grid-cols-[minmax(0,1fr)_minmax(300px,34%)]")}>
      <TableCard className="min-w-0" toolbar={toolbar} footer={footer}>{body}</TableCard>
      {selectedId && <Preview detail={detail} loading={detailLoading} onClose={() => setSelectedId(null)} />}
    </div>
  </div>;
}
