"use client";

import { useCallback, useEffect, useMemo, useState, type ReactNode } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { Download } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cardSurface } from "@/components/ui/card";
import { BarList, ChartHeading, ChartLegend, type BarListRow } from "@/components/ui/chart";
import { ClearFiltersButton, DataToolbar, RefreshButton, ToolbarSearch, toolbarControl } from "@/components/ui/data-toolbar";
import { PageHeader } from "@/components/ui/page-header";
import { PageLoading } from "@/components/ui/page-loading";
import { FramedLoading, InReportsSlot, useUrlTab } from "@/components/app/reports/reports-slot";
import { EmptyState, ErrorState, NoMatches } from "@/components/ui/page-states";
import { StatStrip, StatTile } from "@/components/ui/stat";
import { StatusChip } from "@/components/ui/status-chip";
import { TableCard } from "@/components/ui/table-card";
import { ViewTabs } from "@/components/ui/view-tabs";
import { useShow } from "@/components/ui/view-switch";
import { PARTNER_TYPES, PARTNER_TYPE_LABELS } from "@/lib/partners/constants";
import { defaultPartnerQualityPeriod, partnersBySent, percentChange, percentOf, pointChange, screeningFlags, screeningPassRate, weeklyRate } from "@/lib/partnerQuality/metrics";
import type { PartnerQualityReport, PartnerQualityRow } from "@/lib/partnerQuality/types";
import { showHref } from "@/lib/reports/show";
import { notify } from "@/lib/notify";
import { cn } from "@/lib/utils";
import { count, downloadCsv, drilldownHref, FigureLink, metricLabel, paginate, Pager, partnerTypeLabel, percent, NO_COST_HINT, PeriodInputs, periodQuery, periodText, replaceParams, replacePeriodInUrl, SortButton, type Period } from "./partner-quality-parts";
import { useFittingRows } from "./use-fitting-rows";
import { load as loadResource, peek, readResource, seed } from "@/lib/client/resource-cache";

/** The report's read, as the app's cache keys it (lib/client/resource-cache.ts). */
export const partnerQualityKey = (period: Period) => `/api/app/partner-quality?${periodQuery(period)}`;

/** The list's two tabs (8·1): partners that sent something in the period (the default), and every partner. */
const LIST_TABS = ["leads", "all"] as const;

type SortKey = "partner" | "type" | "sent" | "submitted" | "conversion" | "flags" | "dq";
const SORT_KEYS: SortKey[] = ["partner", "type", "sent", "submitted", "conversion", "flags", "dq"];

/** A partner's flags: screening flags (TCPA, DNC, invalid phone) and duplicates. */
function flagCount(row: PartnerQualityRow) { return screeningFlags(row.screening) + row.duplicates; }

const SORT_VALUE: Record<SortKey, (row: PartnerQualityRow) => string | number> = {
  partner: (row) => row.partner_name,
  type: (row) => partnerTypeLabel(row.partner_type),
  sent: (row) => row.sent,
  submitted: (row) => row.submitted,
  conversion: (row) => (row.sent ? row.conversion_rate ?? -1 : -1),
  flags: flagCount,
  dq: (row) => (row.sent ? row.disqualification_rate ?? -1 : -1),
};

const SORT_LABEL: Record<SortKey, string> = { partner: "partner name", type: "type", sent: "most leads sent", submitted: "most submitted", conversion: "best conversion", flags: "most flags", dq: "highest DQ %" };

/** `?sort=sent.desc` (8·1: the sort is in the address). */
function sortOf(raw: string | null): { key: SortKey; direction: "asc" | "desc" } {
  const [key, direction] = (raw ?? "").split(".");
  return SORT_KEYS.includes(key as SortKey) ? { key: key as SortKey, direction: direction === "asc" ? "asc" : "desc" } : { key: "sent", direction: "desc" };
}

/** Rate shown only when the partner sent something; "—" otherwise. */
function rate(value: number | null, sent: number) { return sent ? percent(value) : "—"; }

/** The row's one chip (one-line rule, 2026-11-11): its flags in amber when any, "None" in grey. */
function FlagsChip({ row }: { row: PartnerQualityRow }) {
  if (!row.sent) return <span className="text-muted-foreground">—</span>;
  const kinds = ([[row.screening.dnc, "DNC"], [row.screening.tcpa, "TCPA"], [row.screening.invalid, "invalid phone"], [row.duplicates, row.duplicates === 1 ? "duplicate" : "duplicates"]] as const).filter(([n]) => n > 0);
  if (!kinds.length) return <StatusChip>None</StatusChip>;
  const words = kinds.map(([n, word]) => `${count(n)} ${word}`);
  return <StatusChip tone="warning" title={words.join(" · ")}>{kinds.length === 1 ? words[0] : `${count(flagCount(row))} flags`}</StatusChip>;
}

/**
 * Reports › Partner quality (Reports round 7, owner pick 8·A, 2026-11-11). Two tabs on the title line (With leads ·
 * All partners), the "Table · Chart" switch beside them (`?show=`, the chart by default), and four tiles, each with
 * its figure's week-by-week line. The chart is one BarList: a bar a partner, sent, with submitted solid inside; a bar
 * opens the partner's page. The table is one line a partner, six columns, one chip (Flags); a figure opens its leads.
 *
 * `framed`: inside the Reports page (components/app/reports/reports-page.tsx), which draws the title and trail.
 */
export function PartnerQualityWorkspace({ initialPeriod, framed = false }: { initialPeriod?: Period | null; framed?: boolean }) {
  const router = useRouter();
  const query = useSearchParams();
  const show = useShow("chart");
  const [period, setPeriod] = useState<Period>(() => initialPeriod ?? defaultPartnerQualityPeriod());
  const [data, setData] = useState<PartnerQualityReport | null>(() => seed<PartnerQualityReport>(partnerQualityKey(period))?.data ?? null);
  const [loading, setLoading] = useState(() => !seed(partnerQualityKey(period))?.data);
  const [error, setError] = useState("");
  const [search, setSearch] = useState("");
  const [typeFilter, setTypeFilter] = useState("all");
  const [page, setPage] = useState(1);
  const { tab, setTab } = useUrlTab(LIST_TABS, "leads");
  const sort = sortOf(query.get("sort"));
  // Strip, toolbar, column heads and pager around the one-line rows.
  const pageSize = useFittingRows(380, 45);

  const load = useCallback(async (next: Period, fresh = false) => {
    setLoading(true); setError("");
    try {
      const key = partnerQualityKey(next);
      const body = await (fresh ? loadResource<PartnerQualityReport>(key) : readResource<PartnerQualityReport>(key));
      setData(body);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Could not load partner quality");
    } finally {
      setLoading(false);
    }
  }, []);
  // The report is tenant-scoped on the server; this effect only hydrates the client view.
  useEffect(() => {
    const kept = peek<PartnerQualityReport>(partnerQualityKey(period));
    // eslint-disable-next-line react-hooks/set-state-in-effect -- the kept answer, read from storage after hydration
    if (kept?.data) setData((current) => current ?? kept.data ?? null);
    void load(period);
  }, [period, load]);
  // A failed reload with figures still on screen is a toast (8·7), never a notice on the page.
  useEffect(() => { if (error && data) notify.fail("Partner quality did not reload", { detail: "The figures shown are from the last load." }); }, [error]); // eslint-disable-line react-hooks/exhaustive-deps

  function changePeriod(next: Period) {
    setPeriod(next); setPage(1);
    replacePeriodInUrl(next);
  }

  const sorted = useMemo(() => {
    if (!data) return [];
    const value = SORT_VALUE[sort.key];
    return [...data.rows].sort((a, b) => {
      const left = value(a); const right = value(b);
      const comparison = typeof left === "string" && typeof right === "string" ? left.localeCompare(right) : Number(left) - Number(right);
      return (sort.direction === "asc" ? comparison : -comparison) || a.partner_name.localeCompare(b.partner_name);
    });
  }, [data, sort.key, sort.direction]);

  function toggleSort(key: SortKey) {
    const direction = sort.key === key ? (sort.direction === "asc" ? "desc" : "asc") : key === "partner" || key === "type" ? "asc" : "desc";
    replaceParams({ sort: `${key}.${direction}` });
    setPage(1);
  }

  if (loading && !data) return framed ? <FramedLoading /> : <PageLoading />;
  if (!data) return <div className="space-y-6">{!framed && <PageHeader title="Partner quality" />}<ErrorState detail={error || "Could not load partner quality"} action={<Button variant="outline" onClick={() => void load(period)}>Try again</Button>} /></div>;

  const active: Period = { from: data.from, to: data.to };
  const total = data.summary;
  const previous = data.previous_summary;
  const pass = screeningPassRate(total);
  const conversion = percentOf(total.submitted, total.sent);
  const duplicateRate = percentOf(total.duplicates, total.sent);
  const dqRate = percentOf(total.disqualified, total.sent);
  const withLeads = data.rows.filter((row) => row.sent > 0).length;
  // A comparison only when the period before had leads (8·0: every delta compared against nothing).
  const compare = previous.sent > 0;
  const ptsDelta = (current: number | null, prior: number | null, goodWhen: "up" | "down") => { const value = compare ? pointChange(current, prior) : null; return value == null ? undefined : { value, unit: " pts", goodWhen }; };
  const sentChange = compare ? percentChange(total.sent, previous.sent) : null;

  const needle = search.trim().toLowerCase();
  const matches = (row: PartnerQualityRow) => (tab === "all" || row.sent > 0) && (typeFilter === "all" || row.partner_type === typeFilter) && (!needle || row.partner_name.toLowerCase().includes(needle));
  const shown = sorted.filter(matches);
  const flagged = shown.reduce((sum, row) => sum + flagCount(row), 0);
  const { current, rows: pageRows } = paginate(shown, page, pageSize);
  const filtered = typeFilter !== "all" || needle !== "";
  const clearFilters = () => { setSearch(""); setTypeFilter("all"); setPage(1); };
  // The list's own address with the period and tab, so a tile or a key row opens the table view of these rows.
  const listBase = `/app/partner-quality?${new URLSearchParams({ ...active, tab })}`;
  const detailHref = (row: PartnerQualityRow) => `/app/partner-quality/${row.partner_id}?${new URLSearchParams({ ...active, show })}`;
  const leadsHref = (row: PartnerQualityRow, metric: "sent" | "submitted") => drilldownHref({ label: `${row.partner_name} · ${metricLabel(metric)}`, partnerId: row.partner_id, metric, period: active });

  function exportCsv() {
    downloadCsv(`partner-quality-${active.from}-to-${active.to}.csv`,
      ["Partner", "Type", "Sent", "Claimed", "Worked", "Submitted", "Screening pass %", "Duplicates", "Duplicate %", "Conversion %", "DQ %", "Prev sent", "Prev submitted", "Prev conversion %"],
      shown.map((row) => [row.partner_name, partnerTypeLabel(row.partner_type), row.sent, row.claimed, row.worked, row.submitted, screeningPassRate(row), row.duplicates, row.duplicate_rate, row.conversion_rate, row.disqualification_rate, row.previous.sent, row.previous.submitted, row.previous.conversion_rate]));
    notify.done(`Exported ${count(shown.length)} partners`, { detail: `Partner quality · ${periodText(active)}.csv` });
  }

  const th = (key: SortKey, label: string, right = true, hint?: string) => <th className={right ? "text-right" : undefined} title={hint}><SortButton label={label} active={sort.key === key} onClick={() => toggleSort(key)} /></th>;
  const toolbar = (
    <DataToolbar actions={<>
      {filtered && <ClearFiltersButton onClick={clearFilters} />}
      {show === "table" && <Button type="button" variant="outline" size="icon" onClick={exportCsv} disabled={shown.length === 0} aria-label="Export the partners as CSV" title="Export the partners as CSV"><Download aria-hidden="true" /></Button>}
      <RefreshButton onClick={() => void load(period, true)} refreshing={loading} />
    </>}>
      <ToolbarSearch value={search} onChange={(value) => { setSearch(value); setPage(1); }} placeholder="Search partners" />
      <PeriodInputs value={active} onChange={changePeriod} />
      <select aria-label="Partner type" className={toolbarControl} value={typeFilter} onChange={(event) => { setTypeFilter(event.target.value); setPage(1); }}>
        <option value="all">All types</option>
        {PARTNER_TYPES.map((type) => <option key={type} value={type}>{PARTNER_TYPE_LABELS[type]}</option>)}
      </select>
    </DataToolbar>
  );
  const empty: ReactNode = data.rows.length === 0
    ? <EmptyState title="No partners yet" hint="Add a partner to track its lead quality." action={<Button asChild variant="outline"><Link href="/app/publishers">Open partners</Link></Button>} />
    : shown.length === 0
      ? (filtered ? <NoMatches noun="partners" onClear={clearFilters} /> : <EmptyState title="No leads in this period" hint="Widen the period to see earlier leads." action={<Button type="button" variant="outline" onClick={() => setTab("all")}>Show all partners</Button>} />)
      : null;

  const chartRows: BarListRow[] = partnersBySent(shown, true).map((row) => ({
    key: row.partner_id,
    label: row.partner_name,
    value: row.sent,
    inner: row.submitted,
    figure: `${count(row.sent)} sent`,
    caption: row.sent ? `${count(row.submitted)} submitted · ${rate(row.conversion_rate, row.sent)}` : undefined,
    href: detailHref(row),
  }));
  const shownSent = shown.reduce((sum, row) => sum + row.sent, 0);
  const shownSubmitted = shown.reduce((sum, row) => sum + row.submitted, 0);

  return <div className="m-stagger flex w-full min-w-0 flex-col gap-6">
    {!framed && <PageHeader title="Partner quality" description="How good each lead source's leads are, against the period before." breadcrumbs={[{ label: "Reports" }, { label: "Partner quality" }]} />}

    <InReportsSlot framed={framed} slot="lead">
      <ViewTabs label="Partners" tabs={[{ key: "leads", label: "With leads", count: withLeads }, { key: "all", label: "All partners", count: data.rows.length }]} value={tab} onChange={(next) => { setTab(next); setPage(1); }} />
    </InReportsSlot>

    {/* The cards stay (owner 2026-11-11), each with its figure week by week; a tile opens the table view of the rows. */}
    <StatStrip label="Partner quality totals">
      <StatTile label="Leads sent" href={showHref(listBase, "table", { sort: "sent.desc" })} value={count(total.sent)} delta={sentChange == null ? undefined : { value: sentChange }} footnote={`${count(withLeads)} of ${count(data.rows.length)} partners sent${compare ? ` · prev ${count(previous.sent)}` : ""}`}
        trend={{ points: data.weeks.map((week) => week.sent), tone: "primary", placement: "under" }} />
      <StatTile label="Screening pass" labelTitle="Sent leads with no TCPA, DNC or invalid-phone flag" href={showHref(listBase, "table", { sort: "flags.desc" })} value={total.sent ? percent(pass) : "—"} delta={total.sent ? ptsDelta(pass, screeningPassRate(previous), "up") : undefined}
        footnote={<span className="inline-flex flex-wrap items-center gap-1.5">{`${count(screeningFlags(total.screening))} flagged · ${total.sent ? percent(duplicateRate) : "—"} duplicates`}{pass != null && pass < 90 && <StatusChip tone="warning">Below 90%</StatusChip>}</span>}
        trend={{ points: weeklyRate(data.weeks, (week) => week.sent - week.flagged), tone: "primary", placement: "under" }} />
      <StatTile label="Conversion" labelTitle={NO_COST_HINT} href={showHref(listBase, "table", { sort: "conversion.desc" })} value={total.sent ? percent(conversion) : "—"} delta={total.sent ? ptsDelta(conversion, percentOf(previous.submitted, previous.sent), "up") : undefined} footnote={`${count(total.submitted)} submitted`}
        trend={{ points: weeklyRate(data.weeks, (week) => week.submitted), tone: "primary", placement: "under" }} />
      <StatTile label="DQ rate" href={showHref(listBase, "table", { sort: "dq.desc" })} value={total.sent ? percent(dqRate) : "—"} delta={total.sent ? ptsDelta(dqRate, percentOf(previous.disqualified, previous.sent), "down") : undefined} footnote={`${count(total.disqualified)} leads`}
        trend={{ points: weeklyRate(data.weeks, (week) => week.disqualified), tone: "primary", placement: "under" }} />
    </StatStrip>

    {show === "chart" ? (
      <section aria-label="Leads sent and submitted, by partner" className={cn(cardSurface, "flex min-w-0 flex-col gap-4 p-4")}>
        {toolbar}
        {empty ?? <>
          <ChartHeading
            title="Leads sent and submitted, by partner"
            period={`${periodText(active)} · ${count(shownSent)} sent · ${count(shownSubmitted)} submitted (${rate(percentOf(shownSubmitted, shownSent), shownSent)})${total.sent ? ` · ${percent(pass)} passed screening` : ""}`}
            action={<Link href={showHref(listBase, "table")} className="whitespace-nowrap text-sm font-medium text-foreground underline-offset-4 hover:underline">Open the rows ›</Link>}
          />
          <BarList rows={chartRows} summary={`Leads sent by each partner, ${periodText(active)}, with the submitted part solid inside.`} unit="leads" labelWidth="14rem" />
          <ChartLegend items={[
            { key: "sent", label: "Sent", tone: "faint", figure: count(shownSent), href: showHref(listBase, "table", { sort: "sent.desc" }) },
            { key: "submitted", label: "Submitted", tone: "strong", figure: count(shownSubmitted), detail: rate(percentOf(shownSubmitted, shownSent), shownSent), href: showHref(listBase, "table", { sort: "submitted.desc" }) },
          ]} />
        </>}
      </section>
    ) : (
      <TableCard
        toolbar={toolbar}
        footer={shown.length ? <Pager page={current} total={shown.length} pageSize={pageSize} noun="partners" onPage={setPage} suffix={`${SORT_LABEL[sort.key]} first · ${count(flagged)} flagged`} /> : undefined}
      >
        {empty ?? <table className="portal-lead-table w-full min-w-[720px] text-left text-sm">
          <thead>
            <tr>
              {th("partner", "Partner", false)}
              {th("type", "Type", false)}
              {th("sent", "Sent")}
              {th("submitted", "Submitted")}
              {th("conversion", "Conversion", true, NO_COST_HINT)}
              {th("flags", "Flags", false, "DNC, TCPA, invalid phone and duplicates")}
            </tr>
          </thead>
          <tbody className="m-seq">
            {pageRows.map((row) => (
              <tr key={row.partner_id} className="m-row cursor-pointer" onClick={() => router.push(detailHref(row))}>
                <td className="max-w-[280px] truncate whitespace-nowrap"><Link href={detailHref(row)} title={row.partner_name} onClick={(event) => event.stopPropagation()} className="font-medium text-foreground underline-offset-4 hover:underline">{row.partner_name}</Link></td>
                <td className="whitespace-nowrap">{partnerTypeLabel(row.partner_type)}</td>
                <td className="text-right">{row.sent ? <FigureLink href={leadsHref(row, "sent")} label={`${row.partner_name}: ${row.sent} sent; open the leads`}>{count(row.sent)}</FigureLink> : <span className="tabular-nums">0</span>}</td>
                <td className="text-right">{row.submitted ? <FigureLink href={leadsHref(row, "submitted")} label={`${row.partner_name}: ${row.submitted} submitted; open the leads`}>{count(row.submitted)}</FigureLink> : <span className="tabular-nums">0</span>}</td>
                <td className="text-right tabular-nums">{rate(row.conversion_rate, row.sent)}</td>
                <td className="whitespace-nowrap"><FlagsChip row={row} /></td>
              </tr>
            ))}
          </tbody>
        </table>}
      </TableCard>
    )}
  </div>;
}
