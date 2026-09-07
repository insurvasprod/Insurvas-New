"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import type { PartnerQualityDispositionBreakdown, PartnerQualityLeadResult, PartnerQualityMetric, PartnerQualityReport, PartnerQualityRow } from "@/lib/partnerQuality/types";

type Filters = { from: string; to: string };
type SortKey = "partner_name" | "sent" | "claimed" | "worked" | "submitted" | "conversion_rate" | "disqualification_rate" | "duplicate_rate";

function isoDate(date: Date) { return new Intl.DateTimeFormat("en-CA").format(date); }
function initialFilters(): Filters { const to = new Date(); const from = new Date(to); from.setDate(from.getDate() - 29); return { from: isoDate(from), to: isoDate(to) }; }
function query(filters: Filters) { const params = new URLSearchParams({ from: filters.from, to: filters.to }); return params.toString(); }
function percent(value: number | null) { return value == null ? "0.0%" : `${value.toFixed(1)}%`; }
function delta(value: number, previous: number) { const difference = value - previous; return `${difference > 0 ? "+" : ""}${difference}`; }
function dateText(value: string) { return new Intl.DateTimeFormat(undefined, { dateStyle: "medium" }).format(new Date(`${value}T00:00:00Z`)); }
function metricLabel(metric: PartnerQualityMetric) { return ({ sent: "Sent", claimed: "Claimed", worked: "Worked", submitted: "Submitted", disqualified: "Disqualified", tcpa: "TCPA blocked", dnc: "DNC flagged", invalid: "Invalid phone", duplicate: "Duplicate", disposition: "Disposition" })[metric]; }

function MetricButton({ row, metric, value, onClick }: { row: PartnerQualityRow; metric: PartnerQualityMetric; value: number; onClick: (metric: PartnerQualityMetric) => void }) {
  return <button type="button" className="rounded px-2 py-1 font-semibold tabular-nums underline-offset-4 hover:bg-muted hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary" aria-label={`${row.partner_name}: ${metricLabel(metric)} ${value}; open leads`} onClick={() => onClick(metric)}>{value}</button>;
}

function SortButton({ label, active, onClick }: { label: string; active: boolean; onClick: () => void }) { return <button type="button" className="font-semibold underline-offset-4 hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary" onClick={onClick}>{label}{active ? " ↕" : ""}</button>; }

export function PartnerQualityWorkspace() {
  const [filters, setFilters] = useState<Filters>(initialFilters);
  const [activeFilters, setActiveFilters] = useState<Filters>(initialFilters);
  const [data, setData] = useState<PartnerQualityReport | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [sort, setSort] = useState<{ key: SortKey; direction: "asc" | "desc" }>({ key: "sent", direction: "desc" });
  const [drilldown, setDrilldown] = useState<PartnerQualityLeadResult | null>(null);
  const [drilldownLabel, setDrilldownLabel] = useState("");
  const [drilldownLoading, setDrilldownLoading] = useState(false);
  const [drilldownError, setDrilldownError] = useState("");

  const load = useCallback(async (next: Filters) => {
    setLoading(true); setError("");
    const response = await fetch(`/api/app/partner-quality?${query(next)}`, { cache: "no-store" });
    const body = await response.json().catch(() => null);
    if (!response.ok) setError(body?.error ?? "Could not load partner quality"); else setData(body);
    setLoading(false);
  }, []);
  // The report is tenant-scoped on the server; this effect only hydrates the client view.
  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(() => { void load(activeFilters); }, [activeFilters, load]);

  const rows = useMemo(() => {
    if (!data) return [];
    return [...data.rows].sort((a, b) => {
      const left = a[sort.key]; const right = b[sort.key];
      const comparison = typeof left === "string" && typeof right === "string" ? left.localeCompare(right) : Number(left ?? 0) - Number(right ?? 0);
      return (sort.direction === "asc" ? comparison : -comparison) || a.partner_name.localeCompare(b.partner_name);
    });
  }, [data, sort]);

  function apply(event: React.FormEvent) { event.preventDefault(); setActiveFilters(filters); }
  function toggleSort(key: SortKey) { setSort((current) => current.key === key ? { key, direction: current.direction === "asc" ? "desc" : "asc" } : { key, direction: key === "partner_name" ? "asc" : "desc" }); }

  async function openDrilldown(row: PartnerQualityRow, metric: PartnerQualityMetric, disposition?: string) {
    setDrilldown(null); setDrilldownError(""); setDrilldownLoading(true); setDrilldownLabel(`${row.partner_name} · ${metricLabel(metric)}${disposition ? ` · ${disposition}` : ""}`);
    const params = new URLSearchParams({ ...activeFilters, partner_id: row.partner_id, metric }); if (disposition) params.set("disposition", disposition);
    const response = await fetch(`/api/app/partner-quality/leads?${params.toString()}`, { cache: "no-store" });
    const body = await response.json().catch(() => null);
    if (!response.ok) setDrilldownError(body?.error ?? "Could not load these leads"); else setDrilldown(body);
    setDrilldownLoading(false);
  }

  if (loading && !data) return <p className="text-sm text-muted-foreground">Loading partner quality…</p>;
  if (error && !data) return <Card><CardContent className="space-y-3 p-6"><p role="alert" className="text-sm text-destructive">{error}</p><Button variant="outline" onClick={() => void load(activeFilters)}>Try again</Button></CardContent></Card>;
  if (!data) return null;
  const dispositionMap = new Map(data.dispositions.map((entry) => [entry.partner_id, entry]));
  const total = data.summary;
  return <div className="mx-auto max-w-[1500px] space-y-6">
    <div><h1 className="text-2xl font-extrabold tracking-tight">Partner quality</h1><p className="mt-1 text-sm text-muted-foreground">Which partners send leads worth taking? Every number opens the exact leads behind it.</p></div>
    <Card><CardContent className="p-4"><form onSubmit={apply} className="grid gap-3 sm:grid-cols-[minmax(0,180px)_minmax(0,180px)_auto] sm:items-end"><div className="space-y-1"><Label htmlFor="quality-from">From date</Label><Input id="quality-from" type="date" value={filters.from} onChange={(event) => setFilters({ ...filters, from: event.target.value })} /></div><div className="space-y-1"><Label htmlFor="quality-to">To date</Label><Input id="quality-to" type="date" value={filters.to} onChange={(event) => setFilters({ ...filters, to: event.target.value })} /></div><Button type="submit">Apply dates</Button></form><p className="mt-3 text-xs text-muted-foreground">Lead received period: {dateText(data.from)}–{dateText(data.to)}. The comparison is {dateText(data.previous_from)}–{dateText(data.previous_to)}.</p></CardContent></Card>
    {error && <p role="alert" className="rounded-md border border-destructive/40 bg-destructive/10 p-3 text-sm text-destructive">{error}</p>}
    <div className="rounded-lg border border-primary/20 bg-primary/5 p-3 text-sm"><strong>Cost data is not included yet.</strong> Partner spend, CPA, and true CPA belong to the accounting work; this view measures lead quality only.</div>
    <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4"><Card><CardContent className="p-4"><p className="text-xs font-semibold uppercase text-muted-foreground">Leads sent</p><p className="mt-1 text-2xl font-bold tabular-nums">{total.sent}</p><p className="text-xs text-muted-foreground">{delta(total.sent, data.previous_summary.sent)} vs prior period</p></CardContent></Card><Card><CardContent className="p-4"><p className="text-xs font-semibold uppercase text-muted-foreground">Leads worked</p><p className="mt-1 text-2xl font-bold tabular-nums">{total.worked}</p><p className="text-xs text-muted-foreground">{delta(total.worked, data.previous_summary.worked)} vs prior period</p></CardContent></Card><Card><CardContent className="p-4"><p className="text-xs font-semibold uppercase text-muted-foreground">Applications submitted</p><p className="mt-1 text-2xl font-bold tabular-nums">{total.submitted}</p><p className="text-xs text-muted-foreground">{delta(total.submitted, data.previous_summary.submitted)} vs prior period</p></CardContent></Card><Card><CardContent className="p-4"><p className="text-xs font-semibold uppercase text-muted-foreground">Screening flags</p><p className="mt-1 text-2xl font-bold tabular-nums">{total.screening.tcpa + total.screening.dnc + total.screening.invalid}</p><p className="text-xs text-muted-foreground">TCPA, DNC, and invalid phone</p></CardContent></Card></div>
    <Card><CardHeader><CardTitle className="text-base">Partner comparison</CardTitle><p className="text-sm text-muted-foreground">Click any count or rate to inspect the exact lead records counted.</p></CardHeader><CardContent><div className="overflow-x-auto"><table className="w-full min-w-[1050px] text-sm"><thead><tr className="border-b text-left text-xs uppercase text-muted-foreground"><th className="p-2"><SortButton label="Partner" active={sort.key === "partner_name"} onClick={() => toggleSort("partner_name")} /></th><th className="p-2"><SortButton label="Sent" active={sort.key === "sent"} onClick={() => toggleSort("sent")} /></th><th className="p-2"><SortButton label="Claimed" active={sort.key === "claimed"} onClick={() => toggleSort("claimed")} /></th><th className="p-2"><SortButton label="Worked" active={sort.key === "worked"} onClick={() => toggleSort("worked")} /></th><th className="p-2"><SortButton label="Submitted" active={sort.key === "submitted"} onClick={() => toggleSort("submitted")} /></th><th className="p-2"><SortButton label="Conv %" active={sort.key === "conversion_rate"} onClick={() => toggleSort("conversion_rate")} /></th><th className="p-2"><SortButton label="DQ %" active={sort.key === "disqualification_rate"} onClick={() => toggleSort("disqualification_rate")} /></th><th className="p-2"><SortButton label="Duplicate %" active={sort.key === "duplicate_rate"} onClick={() => toggleSort("duplicate_rate")} /></th><th className="p-2">Trend vs prior</th></tr></thead><tbody>{rows.map((row) => <tr key={row.partner_id} className="border-b align-middle"><td className="p-2 font-semibold">{row.partner_name}</td><td className="p-2"><MetricButton row={row} metric="sent" value={row.sent} onClick={(metric) => void openDrilldown(row, metric)} /></td><td className="p-2"><MetricButton row={row} metric="claimed" value={row.claimed} onClick={(metric) => void openDrilldown(row, metric)} /></td><td className="p-2"><MetricButton row={row} metric="worked" value={row.worked} onClick={(metric) => void openDrilldown(row, metric)} /></td><td className="p-2"><MetricButton row={row} metric="submitted" value={row.submitted} onClick={(metric) => void openDrilldown(row, metric)} /></td><td className="p-2"><button type="button" className="rounded px-2 py-1 font-semibold tabular-nums underline-offset-4 hover:bg-muted hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary" aria-label={`${row.partner_name}: conversion rate ${percent(row.conversion_rate)}; open submitted leads`} onClick={() => void openDrilldown(row, "submitted")}>{percent(row.conversion_rate)}</button></td><td className="p-2"><MetricButton row={row} metric="disqualified" value={row.disqualified} onClick={(metric) => void openDrilldown(row, metric)} /><span className="ml-1 text-xs text-muted-foreground">({percent(row.disqualification_rate)})</span></td><td className="p-2"><MetricButton row={row} metric="duplicate" value={row.duplicates} onClick={(metric) => void openDrilldown(row, metric)} /><span className="ml-1 text-xs text-muted-foreground">({percent(row.duplicate_rate)})</span></td><td className="p-2 text-xs text-muted-foreground">Sent {delta(row.sent, row.previous.sent)} · Conv {row.conversion_rate == null && row.previous.conversion_rate == null ? "0.0" : delta(row.conversion_rate ?? 0, row.previous.conversion_rate ?? 0)} pts</td></tr>)}</tbody></table></div>{rows.length === 0 && <p className="p-4 text-sm text-muted-foreground">No partners are configured yet.</p>}</CardContent></Card>
    <div className="grid gap-6 lg:grid-cols-2"><Card><CardHeader><CardTitle className="text-base">Screening quality</CardTitle><p className="text-sm text-muted-foreground">Counts are linked to the same lead period.</p></CardHeader><CardContent><div className="overflow-x-auto"><table className="w-full text-sm"><thead><tr className="border-b text-left text-xs uppercase text-muted-foreground"><th className="p-2">Partner</th><th className="p-2">TCPA</th><th className="p-2">DNC</th><th className="p-2">Invalid</th></tr></thead><tbody>{rows.map((row) => <tr key={row.partner_id} className="border-b"><td className="p-2 font-medium">{row.partner_name}</td><td className="p-2"><MetricButton row={row} metric="tcpa" value={row.screening.tcpa} onClick={(metric) => void openDrilldown(row, metric)} /></td><td className="p-2"><MetricButton row={row} metric="dnc" value={row.screening.dnc} onClick={(metric) => void openDrilldown(row, metric)} /></td><td className="p-2"><MetricButton row={row} metric="invalid" value={row.screening.invalid} onClick={(metric) => void openDrilldown(row, metric)} /></td></tr>)}</tbody></table></div></CardContent></Card><DispositionCard rows={rows} breakdown={dispositionMap} onOpen={openDrilldown} /></div>
    {(drilldownLoading || drilldown || drilldownError) && <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/45 p-4" role="presentation"><Card role="dialog" aria-modal="true" aria-labelledby="quality-drilldown-title" className="max-h-[85vh] w-full max-w-3xl overflow-hidden"><CardHeader><div className="flex items-start justify-between gap-4"><div><CardTitle id="quality-drilldown-title" className="text-base">{drilldownLabel}</CardTitle><p className="text-sm text-muted-foreground">{drilldown ? `${drilldown.total} exact lead${drilldown.total === 1 ? "" : "s"} in this cell` : "Loading exact leads…"}</p></div><Button variant="outline" onClick={() => { setDrilldown(null); setDrilldownError(""); }} autoFocus>Close</Button></div></CardHeader><CardContent className="max-h-[65vh] overflow-y-auto">{drilldownError && <p role="alert" className="text-sm text-destructive">{drilldownError}</p>}{drilldown && <div className="overflow-x-auto"><table className="w-full min-w-[620px] text-sm"><thead><tr className="border-b text-left text-xs uppercase text-muted-foreground"><th className="p-2">Date</th><th className="p-2">Lead</th><th className="p-2">Phone</th><th className="p-2">Disposition</th><th className="p-2">Screening</th></tr></thead><tbody>{drilldown.rows.map((lead) => <tr key={lead.lead_id} className="border-b"><td className="p-2">{lead.date}</td><td className="p-2">{lead.full_name}</td><td className="p-2">{lead.phone ?? "—"}</td><td className="p-2">{lead.disposition ?? "—"}</td><td className="p-2">{lead.screening_outcome ?? "—"}</td></tr>)}</tbody></table></div>}</CardContent></Card></div>}
  </div>;
}

function DispositionCard({ rows, breakdown, onOpen }: { rows: PartnerQualityRow[]; breakdown: Map<string, PartnerQualityDispositionBreakdown>; onOpen: (row: PartnerQualityRow, metric: PartnerQualityMetric, disposition?: string) => void }) {
  return <Card><CardHeader><CardTitle className="text-base">Breakdown by disposition</CardTitle><p className="text-sm text-muted-foreground">A disposition count drills into the matching leads.</p></CardHeader><CardContent className="space-y-3">{rows.map((row) => { const items = breakdown.get(row.partner_id)?.dispositions ?? []; return <div key={row.partner_id} className="flex flex-wrap items-center justify-between gap-2 border-b pb-3 last:border-0"><span className="font-medium">{row.partner_name}</span><div className="flex flex-wrap gap-2">{items.length ? items.map((item) => <button key={item.key} type="button" className="rounded-full border px-2.5 py-1 text-xs font-medium hover:bg-muted focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary" onClick={() => onOpen(row, "disposition", item.key)}>{item.key.replaceAll("_", " ")} · {item.count}</button>) : <span className="text-sm text-muted-foreground">No dispositions yet</span>}</div></div>; })}{rows.length === 0 && <p className="text-sm text-muted-foreground">No partners are configured yet.</p>}</CardContent></Card>;
}
