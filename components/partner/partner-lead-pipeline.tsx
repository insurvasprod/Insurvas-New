"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { ArrowRight, ExternalLink, LayoutGrid, List, Lock, Search, SlidersHorizontal, X } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { PageHeader } from "@/components/ui/page-header";
import { StatTile } from "@/components/ui/stat";
import type { PartnerLeadDetail, PartnerLeadFacets, PartnerLeadRow, PartnerPipelineStage } from "@/lib/partnerLeads/types";
import type { PartnerRole } from "@/lib/partnerAuth/roles";
import { productLineLabel } from "@/lib/format/productLine";
import { PARTNER_LANES, type PartnerLaneCounts } from "@/lib/partnerLeads/lanes";

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
function stageTone(label: string) {
  const value = label.toLowerCase();
  if (value.includes("won") || value.includes("application") || value.includes("complete")) return "lead-stage-won";
  if (value.includes("lost") || value.includes("declined") || value.includes("not interested") || value.includes("closed")) return "lead-stage-lost";
  if (value.includes("progress") || value.includes("claimed") || value.includes("review")) return "lead-stage-open";
  return "lead-stage-neutral";
}

function LeadCard({ row, selected, onSelect }: { row: PartnerLeadRow; selected: boolean; onSelect: () => void }) {
  return <article className={`lead-pipeline-card ${selected ? "is-selected" : ""}`}>
    <button type="button" className="lead-card-main" onClick={onSelect}>
      <span className="lead-card-topline"><span className="lead-card-name">{row.customer}</span><ArrowRight className="size-4 text-muted-foreground" /></span>
      <span className="lead-card-meta">{productLineLabel(row.product)} · {ageShort(row.submittedAt)}</span>
    </button>
  </article>;
}

function Preview({ detail, loading, onClose }: { detail: PartnerLeadDetail | null; loading: boolean; onClose: () => void }) {
  const [tab, setTab] = useState<"submission" | "timeline">("submission");
  return <aside className="lead-preview-panel partner-lead-preview">
    <div className="lead-preview-header"><div><span className="eyebrow">LEAD PREVIEW · READ ONLY</span><h2>{detail?.customer ?? "Lead details"}</h2><p>{detail ? `${detail.product} · ${detail.submittedBy.name}` : "Partner submission"}</p></div><button type="button" className="lead-preview-close" aria-label="Close lead preview" onClick={onClose}><X className="size-5" /></button></div>
    <div className="lead-preview-tabs"><button type="button" className={tab === "submission" ? "is-active" : ""} onClick={() => setTab("submission")}>Submission</button><button type="button" className={tab === "timeline" ? "is-active" : ""} onClick={() => setTab("timeline")}>Timeline</button></div>
    {loading || !detail ? <div className="lead-preview-state" role="status" aria-live="polite">Loading lead details…</div> : tab === "submission" ? <div className="lead-preview-scroll"><div className="lead-preview-banner"><span className={`lead-stage-pill ${stageTone(stageLabel(detail))}`}>{stageLabel(detail)}</span><span>{detail.outcome ?? "Awaiting update"}</span></div><div className="lead-preview-section"><div className="lead-preview-lock"><Lock className="size-3.5" aria-hidden="true" />Form as submitted — cannot be edited in the partner portal</div><div className="lead-form-snapshot">{Object.entries(detail.values).map(([key, value]) => <div className="lead-snapshot-row" key={key}><span>{key.replaceAll("_", " ")}</span><strong>{typeof value === "object" ? JSON.stringify(value) : String(value ?? "—")}</strong></div>)}</div></div><div className="lead-preview-section"><div className="lead-section-heading"><h3>Submission details</h3></div><dl className="lead-detail-list"><div><dt>Submitted</dt><dd>{when(detail.submittedAt)}</dd></div><div><dt>Submitted by</dt><dd>{detail.submittedBy.name}</dd></div><div><dt>Last updated</dt><dd>{when(detail.updatedAt)}</dd></div><div><dt>Outcome</dt><dd>{detail.outcome ?? "Awaiting update"}</dd></div></dl></div></div> : <div className="lead-preview-scroll"><div className="lead-preview-section"><div className="lead-section-heading"><h3>Submission timeline</h3></div><div className="lead-timeline">{detail.timeline.length ? detail.timeline.map((event, index) => <div className="lead-timeline-item" key={`${event.at}-${event.type}-${index}`}><span className="lead-timeline-dot" /><div><strong>{event.label}</strong><p>{event.detail ?? "Partner-visible update"}</p><time>{when(event.at)}</time></div></div>) : <p className="text-sm text-muted-foreground">No timeline events yet.</p>}</div></div></div>}
    <div className="lead-preview-footer"><Link href="/partner/pipeline" className="lead-full-link">Back to partner pipeline <ExternalLink className="size-4" /></Link></div>
  </aside>;
}

export function PartnerLeadPipeline({ partnerStatus, role, partnerName }: { partnerStatus: "draft" | "active" | "paused" | "offboarded"; role: PartnerRole; partnerName?: string | null }) {
  const [data, setData] = useState<PipelineResponse | null>(null);
  const [filters, setFilters] = useState<Filters>(EMPTY_FILTERS);
  const [search, setSearch] = useState("");
  const [view, setView] = useState<"board" | "table">("board");
  const [moreFilters, setMoreFilters] = useState(false);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [detail, setDetail] = useState<PartnerLeadDetail | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState("");
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
    finally { setLoading(false); setLoadingMore(false); }
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

  return <div className={`m-stagger lead-workspace-page ${selectedId ? "has-preview" : ""}`}>
    <PageHeader
      className="mb-5"
      eyebrow="Partner workspace"
      title="Lead pipeline"
      description={role === "partner_admin" ? `Only leads submitted by ${partnerName || "your organization"} are shown. Updates refresh automatically.` : "Only leads you submitted are shown. Updates refresh automatically."}
      actions={<Button asChild variant="outline"><a href={exportHref}>Export CSV</a></Button>}
    />
    {partnerStatus !== "active" && <div className="mb-4 rounded-md border border-[var(--warning)]/40 bg-[var(--warning)]/10 p-3 text-sm" role="status"><strong>This partner account is {partnerStatus}.</strong><span className="ml-1">Lead history remains available to read.</span></div>}
    {error && <Card className="mb-4"><CardContent className="p-4 text-sm text-destructive" role="alert">{error}<Button className="ml-3" size="sm" variant="outline" onClick={() => void load()}>Try again</Button></CardContent></Card>}
    <div className="mb-4 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
      {PARTNER_LANES.map((lane) => <StatTile key={lane.key} label={lane.label} value={data?.laneCounts ? data.laneCounts[lane.key] : "—"} footnote={data && !data.laneCounts ? "not shown for a stage or outcome filter" : lane.footnote} />)}
    </div>
    <Card className="lead-filter-card"><CardContent className="p-3"><form onSubmit={(event) => event.preventDefault()} className="lead-filter-row"><select aria-label="Product" className="lead-filter-product" value={filters.product} onChange={(event) => setFilters((current) => ({ ...current, product: event.target.value }))}><option value="">All products</option>{data?.facets.products.map((item) => <option key={item} value={item}>{productLineLabel(item)}</option>)}</select><div className="lead-search-wrap"><Search className="size-4" /><Input type="search" aria-label="Search customer" value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search customer" /></div><Button type="button" variant="outline" onClick={() => setMoreFilters((value) => !value)}><SlidersHorizontal className="size-4" /> Filters{filterCount > 0 && <span className="lead-filter-count" aria-label={`${filterCount} active`}>{filterCount}</span>}</Button><div className="lead-view-toggle"><button type="button" aria-label="Board view" className={view === "board" ? "is-active" : ""} onClick={() => setView("board")}><LayoutGrid className="size-4" /> Board</button><button type="button" aria-label="Table view" className={view === "table" ? "is-active" : ""} onClick={() => setView("table")}><List className="size-4" /> Table</button></div></form>{moreFilters && <div className="lead-more-filters"><div><Label>Stage</Label><select value={filters.stage_id} onChange={(event) => setFilters((current) => ({ ...current, stage_id: event.target.value }))}><option value="">All stages</option>{activeStages.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select></div>{role === "partner_admin" && <div><Label>Submitted by</Label><select value={filters.closer_id} onChange={(event) => setFilters((current) => ({ ...current, closer_id: event.target.value }))}><option value="">Everyone</option>{data?.facets.closers.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select></div>}<div><Label>Outcome</Label><select value={filters.outcome} onChange={(event) => setFilters((current) => ({ ...current, outcome: event.target.value }))}><option value="">Any outcome</option>{data?.facets.outcomes.map((item) => <option key={item.key} value={item.key}>{item.label}</option>)}</select></div><div><Label>From</Label><Input type="date" value={filters.date_from} onChange={(event) => setFilters((current) => ({ ...current, date_from: event.target.value }))} /></div><div><Label>To</Label><Input type="date" value={filters.date_to} onChange={(event) => setFilters((current) => ({ ...current, date_to: event.target.value }))} /></div><Button type="button" variant="ghost" disabled={!hasFilters} onClick={() => setFilters(EMPTY_FILTERS)}>Reset</Button></div>}</CardContent></Card>
    {loading && !data ? <div className="lead-preview-state" role="status" aria-live="polite">Loading your lead workspace…</div> : <div className="lead-workspace-grid">{view === "board" ? <div className="lead-pipeline-board">{PARTNER_LANES.map((lane) => <section className="lead-pipeline-column partner-lane" data-lane={lane.key} key={lane.key}><header className="lead-column-header partner-lane-header"><h3>{lane.label}</h3><span>{laneRows.get(lane.key)?.length ?? 0}</span></header><div className="lead-column-list">{(laneRows.get(lane.key) ?? []).map((row) => <LeadCard key={row.id} row={row} selected={selectedId === row.id} onSelect={() => selectLead(row.id)} />)}{!(laneRows.get(lane.key) ?? []).length && <div className="lead-column-empty">Nothing here right now</div>}</div></section>)}</div> : <div className="lead-table-wrap"><table><thead><tr><th>Lead</th><th>Product</th><th>Stage</th>{role === "partner_admin" && <th>Submitted by</th>}<th>Submitted</th><th>Action</th></tr></thead><tbody>{visibleRows.map((row) => <tr key={row.id} className={selectedId === row.id ? "is-selected" : ""}><td><button type="button" onClick={() => selectLead(row.id)}><strong>{row.customer}</strong><small>{row.submittedBy.name}</small></button></td><td>{productLineLabel(row.product)}</td><td><span className={`lead-stage-pill ${stageTone(stageLabel(row))}`}>{stageLabel(row)}</span></td>{role === "partner_admin" && <td>{row.submittedBy.name}</td>}<td>{when(row.submittedAt)}</td><td><button type="button" className="lead-table-action" onClick={() => selectLead(row.id)}>{selectedId === row.id ? "Close" : "View"} <ArrowRight className="size-4" /></button></td></tr>)}</tbody></table>{!visibleRows.length && <div className="lead-column-empty">No leads match these filters.</div>}</div>}{selectedId && <Preview detail={detail} loading={detailLoading} onClose={() => setSelectedId(null)} />}</div>}
    {data && data.rows.length < data.total && <div className="flex flex-wrap items-center justify-center gap-3 py-3"><p className="text-sm text-muted-foreground">Showing {data.rows.length.toLocaleString()} of {data.total.toLocaleString()} leads</p><Button type="button" variant="outline" disabled={loadingMore || data.nextOffset == null} onClick={() => void load(data.nextOffset ?? data.rows.length, true)}>{loadingMore ? "Loading…" : "Load more"}</Button></div>}
  </div>;
}
