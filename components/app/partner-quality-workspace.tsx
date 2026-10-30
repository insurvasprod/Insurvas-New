"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { Download } from "lucide-react";
import { Button } from "@/components/ui/button";
import { ClearFiltersButton, DataToolbar, RefreshButton, ToolbarSearch, toolbarControl } from "@/components/ui/data-toolbar";
import { PageHeader } from "@/components/ui/page-header";
import { PageLoading } from "@/components/ui/page-loading";
import { EmptyState, ErrorState, NoMatches } from "@/components/ui/page-states";
import { StatTile } from "@/components/ui/stat";
import { TableCard } from "@/components/ui/table-card";
import { ToggleChip } from "@/components/ui/toggle-chip";
import { PARTNER_TYPES, PARTNER_TYPE_LABELS } from "@/lib/partners/constants";
import { defaultPartnerQualityPeriod, percentChange, percentOf, pointChange, screeningFlags, screeningPassRate } from "@/lib/partnerQuality/metrics";
import type { PartnerQualityMetric, PartnerQualityReport, PartnerQualityRow } from "@/lib/partnerQuality/types";
import { cn } from "@/lib/utils";
import { count, downloadCsv, MetricCell, metricLabel, paginate, Pager, partnerTypeLabel, percent, NO_COST_HINT, PeriodInputs, periodQuery, Prior, SortButton, useDrilldown, type Period } from "./partner-quality-parts";
import { FILL_CARD, useFittingRows } from "./use-fitting-rows";

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

/** Partners A4: this period (green) over the prior one (grey), against the best rate on screen. */
function ConversionBars({ now, prior, max }: { now: number | null; prior: number | null; max: number }) {
  const width = (value: number | null) => `${value == null || max <= 0 ? 0 : Math.max(3, (value / max) * 100)}%`;
  return (
    <span aria-hidden className="flex w-20 flex-col gap-1">
      <span className="h-1.5 overflow-hidden rounded-full bg-[var(--surface-alt)]"><span className="block h-full rounded-full bg-[var(--primary)]" style={{ width: width(now) }} /></span>
      <span className="h-1.5 overflow-hidden rounded-full bg-[var(--surface-alt)]"><span className="block h-full rounded-full bg-[var(--border-strong)]" style={{ width: width(prior) }} /></span>
    </span>
  );
}

/**
 * `recordLinks`: the reader can open partner records (owner or bookkeeper with Partners on the plan),
 * so a row opens the partner's own record on its Quality tab (2026-10-25). Anyone else — a producer —
 * keeps the stand-alone quality page.
 */
export function PartnerQualityWorkspace({ initialPeriod, recordLinks = false }: { initialPeriod?: Period | null; recordLinks?: boolean }) {
  const [period, setPeriod] = useState<Period>(() => initialPeriod ?? defaultPartnerQualityPeriod());
  const [data, setData] = useState<PartnerQualityReport | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [sort, setSort] = useState<{ key: SortKey; direction: "asc" | "desc" }>({ key: "sent", direction: "desc" });
  const [search, setSearch] = useState("");
  const [typeFilter, setTypeFilter] = useState("all");
  // LA-1.18: a partner with no leads in the period shows a zero row by default. Idle is a finding.
  const [hideEmpty, setHideEmpty] = useState(false);
  const [page, setPage] = useState(1);
  // Header, strip, toolbar, column heads and pager above and below the rows; a row carries its "prev".
  const pageSize = useFittingRows(410, 57);
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
  if (!data) return <div className="space-y-6"><PageHeader title="Partner Quality" /><ErrorState detail={error || "Could not load partner quality"} action={<Button variant="outline" onClick={() => void load(period)}>Try again</Button>} /></div>;

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
  const conversionMax = Math.max(0, ...shown.flatMap((row) => [row.sent ? row.conversion_rate ?? 0 : 0, row.previous.sent ? row.previous.conversion_rate ?? 0 : 0]));
  const { current, rows: pageRows } = paginate(shown, page, pageSize);
  const filtered = hideEmpty || typeFilter !== "all" || needle !== "";
  const clearFilters = () => { setSearch(""); setTypeFilter("all"); setHideEmpty(false); setPage(1); };
  const detailHref = (row: PartnerQualityRow) => (recordLinks ? `/app/publishers/${row.partner_id}?tab=quality` : `/app/partner-quality/${row.partner_id}?${periodQuery(active)}`);
  const open = (row: PartnerQualityRow, metric: PartnerQualityMetric) => drilldown.open({ label: `${row.partner_name} · ${metricLabel(metric)}`, partnerId: row.partner_id, metric, period: active });

  function exportCsv() {
    downloadCsv(`partner-quality-${active.from}-to-${active.to}.csv`,
      ["Partner", "Type", "Sent", "Claimed", "Worked", "Submitted", "Screening pass %", "Duplicates", "Duplicate %", "Conversion %", "DQ %", "Prev sent", "Prev submitted", "Prev conversion %"],
      shown.map((row) => [row.partner_name, partnerTypeLabel(row.partner_type), row.sent, row.claimed, row.worked, row.submitted, screeningPassRate(row), row.duplicates, row.duplicate_rate, row.conversion_rate, row.disqualification_rate, row.previous.sent, row.previous.submitted, row.previous.conversion_rate]));
  }

  const th = (key: SortKey, label: string, hint?: string) => <th className="text-right" title={hint}><SortButton label={label} active={sort.key === key} onClick={() => toggleSort(key)} /></th>;

  return <div className="m-stagger flex w-full min-w-0 flex-col gap-6">
    <PageHeader visible title="Partner Quality" description="How good each lead source's leads are, against the period before." breadcrumbs={[{ label: "Reports" }, { label: "Partner Quality" }]} />

    {/* Four figures an operator acts on (2026-10-06 redesign). Partners with leads rides on Leads
        sent and the duplicate rate on Screening pass; both stay columns and drill-downs below. */}
    {/* Partners A4 (2026-10-25): four glass tiles, each with its change on the prior period. */}
        <section aria-label="Partner quality totals" className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4">
      <StatTile className="m-glass rounded-xl border border-border" label="Leads sent" value={count(total.sent)} delta={sentChange == null ? undefined : { value: sentChange }} footnote={`prev ${count(previous.sent)} · ${count(withLeads)} of ${data.rows.length} partners sent (prev ${count(previousWithLeads)})`} />
      <StatTile className="m-glass rounded-xl border border-border" label="Screening pass" value={total.sent ? percent(pass) : "—"} valueTone={pass != null && pass < 90 ? "warning" : undefined} delta={total.sent ? ptsDelta(pass, previousPass, "up") : undefined} footnote={`${count(screeningFlags(total.screening))} flagged · ${total.sent ? percent(duplicateRate) : "—"} duplicates`} />
      <StatTile className="m-glass rounded-xl border border-border" label="Conversion" value={total.sent ? percent(conversion) : "—"} delta={total.sent ? ptsDelta(conversion, percentOf(previous.submitted, previous.sent), "up") : undefined} footnote={`${count(total.submitted)} submitted`} />
      <StatTile className="m-glass rounded-xl border border-border" label="DQ rate" value={total.sent ? percent(dqRate) : "—"} delta={total.sent ? ptsDelta(dqRate, percentOf(previous.disqualified, previous.sent), "down") : undefined} footnote={`${count(total.disqualified)} leads`} />
    </section>

    <TableCard
      className={`${FILL_CARD} min-h-[calc(100dvh-var(--top-bar-h)-292px)]`}
      toolbar={<>
        <DataToolbar actions={<>
          {filtered && <ClearFiltersButton onClick={clearFilters} />}
          <Button type="button" variant="outline" onClick={exportCsv} disabled={shown.length === 0}><Download aria-hidden="true" />Export</Button>
          <RefreshButton onClick={() => void load(period)} refreshing={loading} />
        </>}>
          <ToolbarSearch value={search} onChange={(value) => { setSearch(value); setPage(1); }} placeholder="Search partners" />
          <PeriodInputs value={active} onChange={changePeriod} />
          <select aria-label="Partner type" className={toolbarControl} value={typeFilter} onChange={(event) => { setTypeFilter(event.target.value); setPage(1); }}>
            <option value="all">All types</option>
            {PARTNER_TYPES.map((type) => <option key={type} value={type}>{PARTNER_TYPE_LABELS[type]}</option>)}
          </select>
          {/* LA-1.18: idle partners show by default; this narrows to the ones that sent something. */}
          <ToggleChip selected={hideEmpty} onClick={() => { setHideEmpty((value) => !value); setPage(1); }}>With leads only</ToggleChip>
        </DataToolbar>
        {error && <p role="alert" className="w-full text-sm text-destructive">{error}</p>}
      </>}
      footer={<Pager page={current} total={shown.length} pageSize={pageSize} noun="partners" onPage={setPage} suffix={`${SORT_LABEL[sort.key]} first`} />}
    >
      {data.rows.length === 0
        ? <EmptyState title="No partners yet" hint="Add a partner to track its lead quality." action={<Button asChild variant="outline"><Link href="/app/publishers">Open partners</Link></Button>} />
        : shown.length === 0
          ? <NoMatches noun="partners" onClear={clearFilters} />
          : <table className="portal-lead-table w-full min-w-[1200px] text-left text-sm">
              <thead>
                <tr>
                  <th><SortButton label="Partner" active={sort.key === "partner_name"} onClick={() => toggleSort("partner_name")} /></th>
                  <th>Type</th>
                  {th("sent", "Sent")}
                  {th("claimed", "Claimed")}
                  {th("worked", "Worked")}
                  {th("submitted", "Submitted")}
                  {th("screening_pass", "Screening pass")}
                  {th("duplicates", "Duplicates")}
                  {th("conversion_rate", "Conversion", NO_COST_HINT)}
                  {th("disqualification_rate", "DQ %")}
                  <th className="text-right"><span className="sr-only">View</span></th>
                </tr>
              </thead>
              <tbody className="m-seq">
                {pageRows.map((row, index) => {
                  const prior = row.previous;
                  const rowPass = screeningPassRate(row);
                  return (
                    <tr key={row.partner_id} className={cn("m-row", index === 0 && current === 1 && sort.key === "sent" && sort.direction === "desc" && row.sent > 0 && "bg-[var(--primary-soft)]")}>
                      <td className="max-w-[280px]"><Link href={detailHref(row)} title={row.partner_name} className="block truncate font-semibold text-foreground underline-offset-4 hover:underline">{row.partner_name}</Link></td>
                      <td className="whitespace-nowrap text-muted-foreground">{partnerTypeLabel(row.partner_type)}</td>
                      <td className="text-right"><MetricCell label={`${row.partner_name}: sent ${row.sent}; open leads`} onClick={() => open(row, "sent")}>{count(row.sent)}</MetricCell><Prior label="Sent" value={count(prior.sent)} /></td>
                      <td className="text-right"><MetricCell label={`${row.partner_name}: claimed ${row.claimed}; open leads`} onClick={() => open(row, "claimed")}>{count(row.claimed)}</MetricCell><Prior label="Claimed" value={count(prior.claimed)} /></td>
                      <td className="text-right"><MetricCell label={`${row.partner_name}: worked ${row.worked}; open leads`} onClick={() => open(row, "worked")}>{count(row.worked)}</MetricCell><Prior label="Worked" value={count(prior.worked)} /></td>
                      <td className="text-right"><MetricCell label={`${row.partner_name}: submitted ${row.submitted}; open leads`} onClick={() => open(row, "submitted")}>{count(row.submitted)}</MetricCell><Prior label="Submitted" value={count(prior.submitted)} /></td>
                      <td className="text-right tabular-nums" title={`${count(screeningFlags(row.screening))} of ${count(row.sent)} flagged`}>{rate(rowPass, row.sent)}<Prior label="Screening pass" value={rate(screeningPassRate(prior), prior.sent)} /></td>
                      <td className="text-right"><MetricCell label={`${row.partner_name}: duplicates ${row.duplicates}; open leads`} onClick={() => open(row, "duplicate")}>{count(row.duplicates)}</MetricCell><Prior label="Duplicates" value={count(Math.round(((prior.duplicate_rate ?? 0) * prior.sent) / 100))} /></td>
                      <td className="text-right">
                        <span className="flex items-center justify-end gap-3">
                          <ConversionBars now={row.sent ? row.conversion_rate : null} prior={prior.sent ? prior.conversion_rate : null} max={conversionMax} />
                          <span><MetricCell label={`${row.partner_name}: conversion ${rate(row.conversion_rate, row.sent)}, ${row.submitted} of ${row.sent}; open submitted leads`} onClick={() => open(row, "submitted")}>{rate(row.conversion_rate, row.sent)}</MetricCell><Prior label="Conversion" value={rate(prior.conversion_rate, prior.sent)} /></span>
                        </span>
                      </td>
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
