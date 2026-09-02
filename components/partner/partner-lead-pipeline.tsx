"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import type { PartnerLeadDetail, PartnerLeadRow, PartnerPipelineStage } from "@/lib/partnerLeads/types";

type PipelineResponse = { rows: PartnerLeadRow[]; stages: PartnerPipelineStage[]; counters: { submittedToday: number; claimed: number; converted: number; stillOpen: number }; realtimeTopic: string; generatedAt: string };
type Filters = { date_from: string; date_to: string; closer_id: string; product: string; stage_id: string; outcome: string };
const EMPTY_FILTERS: Filters = { date_from: "", date_to: "", closer_id: "", product: "", stage_id: "", outcome: "" };

function when(value: string) { return new Date(value).toLocaleString(); }

export function PartnerLeadPipeline({ partnerStatus }: { partnerStatus: "draft" | "active" | "paused" | "offboarded" }) {
  const [data, setData] = useState<PipelineResponse | null>(null);
  const [filters, setFilters] = useState<Filters>(EMPTY_FILTERS);
  const [view, setView] = useState<"board" | "table">("board");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [detail, setDetail] = useState<PartnerLeadDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const query = useMemo(() => new URLSearchParams(Object.entries(filters).filter(([, value]) => Boolean(value))).toString(), [filters]);
  const load = useCallback(async () => {
    const response = await fetch(`/api/partner/leads/pipeline${query ? `?${query}` : ""}`, { cache: "no-store" });
    const body = await response.json().catch(() => null);
    if (!response.ok) { setError(body?.error ?? "Could not load your lead pipeline"); setLoading(false); return; }
    setData(body); setError(null); setLoading(false);
  }, [query]);

  useEffect(() => { const kickoff = window.setTimeout(() => void load(), 0); const timer = window.setInterval(() => void load(), 5000); return () => { window.clearTimeout(kickoff); window.clearInterval(timer); }; }, [load]);
  useEffect(() => {
    if (!selectedId) return;
    let cancelled = false;
    void fetch(`/api/partner/leads/${selectedId}`, { cache: "no-store" }).then(async (response) => ({ response, body: await response.json().catch(() => null) })).then(({ response, body }) => { if (cancelled) return; if (!response.ok) setError(body?.error ?? "Could not load lead detail"); else setDetail(body); });
    return () => { cancelled = true; };
  }, [selectedId]);

  function openDetail(id: string) { setSelectedId(id); setDetail(null); setError(null); }

  const groups = useMemo(() => {
    const map = new Map<string, PartnerLeadRow[]>();
    for (const row of data?.rows ?? []) map.set(row.stageId, [...(map.get(row.stageId) ?? []), row]);
    return map;
  }, [data]);
  const closers = useMemo(() => [...new Map((data?.rows ?? []).filter((row) => row.submittedBy.id).map((row) => [row.submittedBy.id, row.submittedBy.name])).entries()], [data]);
  const products = useMemo(() => [...new Set((data?.rows ?? []).map((row) => row.product))].sort(), [data]);
  const outcomes = useMemo(() => [...new Map((data?.rows ?? []).filter((row) => row.disposition).map((row) => [row.disposition, row.outcome ?? row.disposition!])).entries()], [data]);
  const exportHref = `/api/partner/leads/export${query ? `?${query}` : ""}`;

  function changeFilter(key: keyof Filters, value: string) { setFilters((current) => ({ ...current, [key]: value })); setSelectedId(null); }

  return <Card>
    <CardHeader><div className="flex flex-wrap items-start justify-between gap-3"><div><CardTitle>Your lead pipeline</CardTitle><CardDescription>Only leads submitted by this partner are shown. Updates refresh automatically.</CardDescription></div><div className="flex flex-wrap gap-2"><Button size="sm" variant={view === "board" ? "default" : "outline"} onClick={() => setView("board")}>Board</Button><Button size="sm" variant={view === "table" ? "default" : "outline"} onClick={() => setView("table")}>Table</Button><Button size="sm" variant="outline" asChild><a href={exportHref}>Export CSV</a></Button></div></div></CardHeader>
    <CardContent className="space-y-5">
      {partnerStatus === "paused" && <div className="rounded-md border border-amber-500/40 bg-amber-500/10 p-3 text-sm" role="status"><p className="font-medium">This partner account is paused</p><p className="mt-1">Your lead history remains available to read. New submissions are disabled until the account is active.</p></div>}
      {error && <p className="rounded-md border border-[var(--color-danger)]/40 p-3 text-sm text-[var(--color-danger)]" role="alert">{error}</p>}
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">{[["Submitted today", data?.counters.submittedToday ?? 0], ["Claimed", data?.counters.claimed ?? 0], ["Converted", data?.counters.converted ?? 0], ["Still open", data?.counters.stillOpen ?? 0]].map(([label, value]) => <div className="rounded-lg border bg-muted/20 p-4" key={String(label)}><p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">{label}</p><p className="mt-1 text-2xl font-semibold tabular-nums">{value}</p></div>)}</div>
      <div className="grid gap-3 rounded-lg border bg-muted/20 p-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-6">
        <div className="space-y-1.5"><Label htmlFor="partner-date-from">From</Label><Input id="partner-date-from" type="date" value={filters.date_from} onChange={(event) => changeFilter("date_from", event.target.value)} /></div>
        <div className="space-y-1.5"><Label htmlFor="partner-date-to">To</Label><Input id="partner-date-to" type="date" value={filters.date_to} onChange={(event) => changeFilter("date_to", event.target.value)} /></div>
        <div className="space-y-1.5"><Label htmlFor="partner-closer">Closer</Label><select id="partner-closer" className="flex h-9 w-full rounded-md border bg-background px-3 text-sm" value={filters.closer_id} onChange={(event) => changeFilter("closer_id", event.target.value)}><option value="">All closers</option>{closers.map(([id, name]) => <option key={id ?? name} value={id ?? ""}>{name}</option>)}</select></div>
        <div className="space-y-1.5"><Label htmlFor="partner-product">Product</Label><select id="partner-product" className="flex h-9 w-full rounded-md border bg-background px-3 text-sm" value={filters.product} onChange={(event) => changeFilter("product", event.target.value)}><option value="">All products</option>{products.map((product) => <option key={product} value={product}>{product}</option>)}</select></div>
        <div className="space-y-1.5"><Label htmlFor="partner-stage">Stage</Label><select id="partner-stage" className="flex h-9 w-full rounded-md border bg-background px-3 text-sm" value={filters.stage_id} onChange={(event) => changeFilter("stage_id", event.target.value)}><option value="">All stages</option>{data?.stages.map((stage) => <option key={stage.id} value={stage.id}>{stage.name}</option>)}</select></div>
        <div className="space-y-1.5"><Label htmlFor="partner-outcome">Outcome</Label><select id="partner-outcome" className="flex h-9 w-full rounded-md border bg-background px-3 text-sm" value={filters.outcome} onChange={(event) => changeFilter("outcome", event.target.value)}><option value="">All outcomes</option>{outcomes.map(([key, label]) => <option key={key ?? label} value={key ?? ""}>{label}</option>)}</select></div>
      </div>
      {loading && !data ? <p className="text-sm text-muted-foreground">Loading your pipeline…</p> : view === "board" ? <div className="flex gap-3 overflow-x-auto pb-2">{(data?.stages ?? []).map((stage) => <section className="min-w-[260px] flex-1 rounded-lg border bg-muted/10" key={stage.id}><div className="border-b p-3" style={{ borderTopColor: stage.color, borderTopWidth: 3 }}><div className="flex items-center justify-between gap-2"><h3 className="font-semibold">{stage.name}</h3><span className="rounded-full bg-muted px-2 py-0.5 text-xs tabular-nums">{groups.get(stage.id)?.length ?? 0}</span></div>{stage.isArchived && <p className="mt-1 text-xs text-muted-foreground">Archived stage</p>}</div><div className="space-y-2 p-2">{(groups.get(stage.id) ?? []).map((row) => <button className="w-full rounded-md border bg-card p-3 text-left shadow-sm transition hover:border-[var(--color-blue)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring" key={row.id} onClick={() => openDetail(row.id)}><p className="font-medium">{row.customer}</p><p className="mt-1 text-xs text-muted-foreground">{row.product} · {row.submittedBy.name}</p><p className="mt-1 text-xs text-muted-foreground">{row.outcome ?? "No outcome yet"}</p></button>)}</div></section>)}{(data?.stages ?? []).length === 0 && <p className="text-sm text-muted-foreground">No pipeline stages are available.</p>}</div> : <div className="overflow-x-auto rounded-lg border"><table className="w-full min-w-[760px] text-sm"><thead className="bg-muted/30"><tr className="border-b text-left"><th className="px-3 py-2 font-medium">Customer</th><th className="px-3 py-2 font-medium">Submitted</th><th className="px-3 py-2 font-medium">Closer</th><th className="px-3 py-2 font-medium">Product</th><th className="px-3 py-2 font-medium">Stage</th><th className="px-3 py-2 font-medium">Outcome</th></tr></thead><tbody>{(data?.rows ?? []).map((row) => <tr className="border-b last:border-0 hover:bg-muted/20" key={row.id}><td className="px-3 py-3"><button className="font-medium text-left underline-offset-4 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring" onClick={() => openDetail(row.id)}>{row.customer}</button></td><td className="px-3 py-3 text-muted-foreground">{when(row.submittedAt)}</td><td className="px-3 py-3">{row.submittedBy.name}</td><td className="px-3 py-3">{row.product}</td><td className="px-3 py-3">{row.stageName}</td><td className="px-3 py-3">{row.outcome ?? "—"}</td></tr>)}</tbody></table>{data?.rows.length === 0 && <p className="p-4 text-sm text-muted-foreground">No leads match these filters.</p>}</div>}
      {selectedId && detail && <div className="rounded-lg border bg-muted/10 p-4"><div className="flex flex-wrap items-start justify-between gap-3"><div><h3 className="text-lg font-semibold">{detail.customer}</h3><p className="text-sm text-muted-foreground">{detail.product} · {detail.stageName} · submitted {when(detail.submittedAt)}</p></div><Button variant="outline" size="sm" onClick={() => setSelectedId(null)}>Close detail</Button></div><div className="mt-4 grid gap-5 lg:grid-cols-2"><div><h4 className="font-medium">Form as submitted</h4><dl className="mt-2 divide-y rounded-md border">{Object.entries(detail.values).map(([key, value]) => <div className="grid grid-cols-[minmax(120px,0.7fr)_minmax(0,1fr)] gap-3 px-3 py-2 text-sm" key={key}><dt className="font-medium text-muted-foreground">{key}</dt><dd className="break-words">{typeof value === "object" ? JSON.stringify(value) : String(value ?? "—")}</dd></div>)}</dl></div><div><h4 className="font-medium">Timeline</h4><ol className="mt-2 space-y-3 border-l pl-4">{detail.timeline.map((event, index) => <li key={`${event.at}-${event.type}-${index}`}><p className="text-sm font-medium">{event.label}</p><time className="text-xs text-muted-foreground" dateTime={event.at}>{when(event.at)}</time>{event.detail && <p className="mt-1 text-sm text-muted-foreground">{event.detail}</p>}</li>)}</ol></div></div></div>}
    </CardContent>
  </Card>;
}
