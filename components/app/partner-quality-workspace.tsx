"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { Download } from "lucide-react";
import { Button } from "@/components/ui/button";
import { DataToolbar, FilterButton, RefreshButton, ToolbarSearch, toolbarControl } from "@/components/ui/data-toolbar";
import { PageHeader } from "@/components/ui/page-header";
import { PageLoading } from "@/components/ui/page-loading";
import { EmptyState, ErrorState, NoMatches } from "@/components/ui/page-states";
import { StatStrip, StatTile } from "@/components/ui/stat";
import { TableCard } from "@/components/ui/table-card";
import { PARTNER_TYPES, PARTNER_TYPE_LABELS } from "@/lib/partners/constants";
import { defaultPartnerQualityPeriod, percentChange, percentOf, pointChange, screeningFlags, screeningPassRate } from "@/lib/partnerQuality/metrics";
import type { PartnerQualityMetric, PartnerQualityReport, PartnerQualityRow } from "@/lib/partnerQuality/types";
import { cn } from "@/lib/utils";
import { count, downloadCsv, MetricCell, metricLabel, paginate, Pager, partnerTypeLabel, percent, NO_COST_HINT, PeriodInputs, periodQuery, Prior, SortButton, useDrilldown, type Period } from "./partner-quality-parts";

type SortKey = "partner_name" | "sent" | "claimed" | "worked" | "submitted" | "screening_pass" | "duplicates" | "conversion_rate" | "disqualification_rate";

const SORT_VALUE: Record<SortKey, (row: PartnerQualityRow) => string | number> = {
  partner_name: (row) => row.partner_name,
  sent: (row) => row.sent,
  claimed: (row) => row.claimed,
  worked: (row) => row.worked,
  submitted: (row) => row.submitted,
  screening_pass: (row) => screeningPassRate(row) ?? -1,
  duplicates: (row) => row.duplicates,
  conversion_rate: (row) => row.conversion_rate ?? -1,
  disqualification_rate: (row) => row.disqualification_rate ?? -1,
};

const SORT_LABEL: Record<SortKey, string> = { partner_name: "partner name", sent: "most leads sent", claimed: "claimed", worked: "worked", submitted: "submitted", screening_pass: "screening pass", duplicates: "duplicates", conversion_rate: "conversion", disqualification_rate: "DQ %" };

/** Rate shown only when the partner sent something; "—" otherwise. */
function rate(value: number | null, sent: number) { return sent ? percent(value) : "—"; }

export function PartnerQualityWorkspace({ initialPeriod }: { initialPeriod?: Period | null }) {
  const [period, setPeriod] = useState<Period>(() => initialPeriod ?? defaultPartnerQualityPeriod());
  const [data, setData] = useState<PartnerQualityReport | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [sort, setSort] = useState<{ key: SortKey; direction: "asc" | "desc" }>({ key: "sent", direction: "desc" });
  const [search, setSearch] = useState("");
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [typeFilter, setTypeFilter] = useState("all");
  // LA-1.18: a partner with no leads in the period shows a zero row by default. Idle is a finding.
  const [hideEmpty, setHideEmpty] = useState(false);
  const [page, setPage] = useState(1);
  const drilldown = useDrilldown();

  const load = useCallback(async (next: Period) => {
    setLoading(true); setError("");
    try {
      const response = await fetch(`/api/app/partner-quality?${periodQuery(next)}`, { cache: "no-store" });
      const body = await response.json().catch(() => null);
      if (!response.ok) setError(body?.error ?? "Could not load partner quality"); else setData(body);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Could not load partner quality");
    } finally {
      setLoading(false);
    }
  }, []);
  // The report is tenant-scoped on the server; this effect only hydrates the client view.
  useEffect(() => { void load(period); }, [period, load]);

  function changePeriod(next: Period) {
    setPeriod(next); setPage(1);
    // Keep the period in the address so a partner's page, and the way back from it, use the same one.
    try { window.history.replaceState(null, "", `?${periodQuery(next)}`); } catch { /* not fatal */ }
  }

  const rows = useMemo(() => {
    if (!data) return [];
    const value = SORT_VALUE[sort.key];
    return [...data.rows].sort((a, b) => {
      const left = value(a); const right = value(b);
      const comparison = typeof left === "string" && typeof right === "string" ? left.localeCompare(right) : Number(left) - Number(right);
      return (sort.direction === "asc" ? comparison : -comparison) || a.partner_name.localeCompare(b.partner_name);
    });
  }, [data, sort]);

  function toggleSort(key: SortKey) {
    setSort((current) => current.key === key ? { key, direction: current.direction === "asc" ? "desc" : "asc" } : { key, direction: key === "partner_name" ? "asc" : "desc" });
  }

  if (loading && !data) return <PageLoading />;
  if (!data) return <div className="space-y-6"><PageHeader title="Partner quality" /><ErrorState detail={error || "Could not load partner quality"} action={<Button variant="outline" onClick={() => void load(period)}>Try again</Button>} /></div>;

  const active: Period = { from: data.from, to: data.to };
  const total = data.summary;
  const previous = data.previous_summary;
  const pass = screeningPassRate(total);
  const previousPass = screeningPassRate(previous);
  const conversion = percentOf(total.submitted, total.sent);
  const duplicateRate = percentOf(total.duplicates, total.sent);
  const dqRate = percentOf(total.disqualified, total.sent);
  const withLeads = data.rows.filter((row) => row.sent > 0).length;
  const previousWithLeads = data.rows.filter((row) => row.previous.sent > 0).length;
  const sentChange = percentChange(total.sent, previous.sent);
  const ptsDelta = (current: number | null, prior: number | null, goodWhen: "up" | "down") => { const value = pointChange(current, prior); return value == null ? undefined : { value, unit: " pts", goodWhen }; };

  const needle = search.trim().toLowerCase();
  const shown = rows.filter((row) => (!hideEmpty || row.sent > 0) && (typeFilter === "all" || row.partner_type === typeFilter) && (!needle || row.partner_name.toLowerCase().includes(needle)));
  const { current, rows: pageRows } = paginate(shown, page);
  const activeFilters = (hideEmpty ? 1 : 0) + (typeFilter !== "all" ? 1 : 0);
  const clearFilters = () => { setSearch(""); setTypeFilter("all"); setHideEmpty(false); setPage(1); };
  const detailHref = (row: PartnerQualityRow) => `/app/partner-quality/${row.partner_id}?${periodQuery(active)}`;
  const open = (row: PartnerQualityRow, metric: PartnerQualityMetric) => drilldown.open({ label: `${row.partner_name} · ${metricLabel(metric)}`, partnerId: row.partner_id, metric, period: active });

  function exportCsv() {
    downloadCsv(`partner-quality-${active.from}-to-${active.to}.csv`,
      ["Partner", "Type", "Sent", "Claimed", "Worked", "Submitted", "Screening pass %", "Duplicates", "Duplicate %", "Conversion %", "DQ %", "Prev sent", "Prev submitted", "Prev conversion %"],
      shown.map((row) => [row.partner_name, partnerTypeLabel(row.partner_type), row.sent, row.claimed, row.worked, row.submitted, screeningPassRate(row), row.duplicates, row.duplicate_rate, row.conversion_rate, row.disqualification_rate, row.previous.sent, row.previous.submitted, row.previous.conversion_rate]));
  }

  const th = (key: SortKey, label: string, width: string, hint?: string) => <th className={cn(width, "text-right")} title={hint}><SortButton label={label} active={sort.key === key} onClick={() => toggleSort(key)} /></th>;

  return <div className="m-stagger portal-partner-quality-page flex flex-col gap-6">
    <PageHeader title="Partner quality" description="Lead quality and conversion by partner, against the prior period." />

    <StatStrip label="Partner quality totals">
      <StatTile label="Leads sent" value={count(total.sent)} delta={sentChange == null ? undefined : { value: sentChange }} footnote={`prev ${count(previous.sent)}`} />
      <StatTile label="Screening pass" value={total.sent ? percent(pass) : "—"} valueTone={pass != null && pass < 90 ? "warning" : undefined} delta={total.sent ? ptsDelta(pass, previousPass, "up") : undefined} footnote={`${count(screeningFlags(total.screening))} flagged`} />
      <StatTile label="Conversion" value={total.sent ? percent(conversion) : "—"} delta={total.sent ? ptsDelta(conversion, percentOf(previous.submitted, previous.sent), "up") : undefined} footnote={`${count(total.submitted)} submitted`} />
      <StatTile label="Duplicate rate" value={total.sent ? percent(duplicateRate) : "—"} delta={total.sent ? ptsDelta(duplicateRate, percentOf(previous.duplicates, previous.sent), "down") : undefined} footnote={`${count(total.duplicates)} leads`} />
      <StatTile label="DQ rate" value={total.sent ? percent(dqRate) : "—"} delta={total.sent ? ptsDelta(dqRate, percentOf(previous.disqualified, previous.sent), "down") : undefined} footnote={`${count(total.disqualified)} leads`} />
      <StatTile label="Partners with leads" value={count(withLeads)} delta={{ value: withLeads - previousWithLeads, unit: "" }} footnote={`of ${data.rows.length}`} />
    </StatStrip>

    <TableCard
      toolbar={<>
        <DataToolbar actions={<>
          <Button type="button" variant="outline" onClick={exportCsv} disabled={shown.length === 0}><Download aria-hidden="true" />Export</Button>
          <RefreshButton onClick={() => void load(period)} refreshing={loading} />
        </>}>
          <ToolbarSearch value={search} onChange={(value) => { setSearch(value); setPage(1); }} placeholder="Search partners" />
          <PeriodInputs value={active} onChange={changePeriod} />
          <FilterButton open={filtersOpen} onClick={() => setFiltersOpen((value) => !value)} count={activeFilters} />
        </DataToolbar>
        {filtersOpen && <div className="flex w-full flex-wrap items-center gap-4">
          <select aria-label="Partner type" className={toolbarControl} value={typeFilter} onChange={(event) => { setTypeFilter(event.target.value); setPage(1); }}>
            <option value="all">All types</option>
            {PARTNER_TYPES.map((type) => <option key={type} value={type}>{PARTNER_TYPE_LABELS[type]}</option>)}
          </select>
          <label className="inline-flex items-center gap-2 text-sm"><input type="checkbox" checked={hideEmpty} onChange={(event) => { setHideEmpty(event.target.checked); setPage(1); }} className="size-4 accent-[var(--primary)]" />Only partners with leads</label>
          {activeFilters > 0 && <Button type="button" variant="ghost" onClick={clearFilters}>Clear filters</Button>}
        </div>}
        {error && <p role="alert" className="w-full text-sm text-destructive">{error}</p>}
      </>}
      footer={<Pager page={current} total={shown.length} noun="partners" onPage={setPage} suffix={`${SORT_LABEL[sort.key]} first`} />}
    >
      {data.rows.length === 0
        ? <EmptyState title="No partners yet" hint="Partners appear here once they are added under Partners." />
        : shown.length === 0
          ? <NoMatches noun="partners" onClear={clearFilters} />
          : <table className="portal-lead-table w-full min-w-[1160px] text-left text-sm">
              <thead>
                <tr>
                  <th><SortButton label="Partner" active={sort.key === "partner_name"} onClick={() => toggleSort("partner_name")} /></th>
                  {th("sent", "Sent", "w-[96px]")}
                  {th("claimed", "Claimed", "w-[100px]")}
                  {th("worked", "Worked", "w-[96px]")}
                  {th("submitted", "Submitted", "w-[110px]")}
                  {th("screening_pass", "Screening pass", "w-[130px]")}
                  {th("duplicates", "Duplicates", "w-[110px]")}
                  {th("conversion_rate", "Conversion", "w-[116px]", NO_COST_HINT)}
                  {th("disqualification_rate", "DQ %", "w-[90px]")}
                  <th className="w-[84px] text-right"><span className="sr-only">View</span></th>
                </tr>
              </thead>
              <tbody className="m-seq">
                {pageRows.map((row, index) => {
                  const prior = row.previous;
                  const rowPass = screeningPassRate(row);
                  return (
                    <tr key={row.partner_id} className={cn("m-row", index === 0 && current === 1 && sort.key === "sent" && sort.direction === "desc" && row.sent > 0 && "bg-[var(--soft-orange-surface)]")}>
                      <td>
                        <Link href={detailHref(row)} className="block font-semibold text-foreground underline-offset-4 hover:underline">{row.partner_name}</Link>
                        <span className="block text-xs text-muted-foreground">{partnerTypeLabel(row.partner_type)}</span>
                      </td>
                      <td className="text-right"><MetricCell label={`${row.partner_name}: sent ${row.sent}; open leads`} onClick={() => open(row, "sent")}>{count(row.sent)}</MetricCell><Prior label="Sent" value={count(prior.sent)} /></td>
                      <td className="text-right"><MetricCell label={`${row.partner_name}: claimed ${row.claimed}; open leads`} onClick={() => open(row, "claimed")}>{count(row.claimed)}</MetricCell><Prior label="Claimed" value={count(prior.claimed)} /></td>
                      <td className="text-right"><MetricCell label={`${row.partner_name}: worked ${row.worked}; open leads`} onClick={() => open(row, "worked")}>{count(row.worked)}</MetricCell><Prior label="Worked" value={count(prior.worked)} /></td>
                      <td className="text-right"><MetricCell label={`${row.partner_name}: submitted ${row.submitted}; open leads`} onClick={() => open(row, "submitted")}>{count(row.submitted)}</MetricCell><Prior label="Submitted" value={count(prior.submitted)} /></td>
                      <td className="text-right tabular-nums" title={`${count(screeningFlags(row.screening))} of ${count(row.sent)} flagged`}>{rate(rowPass, row.sent)}<Prior label="Screening pass" value={rate(screeningPassRate(prior), prior.sent)} /></td>
                      <td className="text-right"><MetricCell label={`${row.partner_name}: duplicates ${row.duplicates}; open leads`} onClick={() => open(row, "duplicate")}>{count(row.duplicates)}</MetricCell><Prior label="Duplicates" value={count(Math.round(((prior.duplicate_rate ?? 0) * prior.sent) / 100))} /></td>
                      <td className="text-right"><MetricCell label={`${row.partner_name}: conversion ${rate(row.conversion_rate, row.sent)}, ${row.submitted} of ${row.sent}; open submitted leads`} onClick={() => open(row, "submitted")}>{rate(row.conversion_rate, row.sent)}</MetricCell><Prior label="Conversion" value={rate(prior.conversion_rate, prior.sent)} /></td>
                      <td className="text-right"><MetricCell label={`${row.partner_name}: DQ rate ${rate(row.disqualification_rate, row.sent)}, ${row.disqualified} of ${row.sent}; open disqualified leads`} onClick={() => open(row, "disqualified")}>{rate(row.disqualification_rate, row.sent)}</MetricCell><Prior label="DQ %" value={rate(prior.disqualification_rate, prior.sent)} /></td>
                      <td className="text-right"><Button asChild variant="outline" size="sm"><Link href={detailHref(row)} aria-label={`View ${row.partner_name}`}>View</Link></Button></td>
                    </tr>
                  );
                })}
              </tbody>
            </table>}
    </TableCard>
    {drilldown.drawer}
  </div>;
}
