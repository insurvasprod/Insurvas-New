"use client";

import { useCallback, useEffect, useMemo, useState, type ReactNode } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { Button } from "@/components/ui/button";
import { cardSurface } from "@/components/ui/card";
import { BarList, BarSeries, ChartHeading, LineSeries, ShareBar, type BarListRow, type ShareSegment } from "@/components/ui/chart";
import { ActiveFilters, DataToolbar, FilterButton, FilterField, FilterPanel, RefreshButton, ToolbarSearch, toolbarControl, type ActiveFilter } from "@/components/ui/data-toolbar";
import { MoreMenu } from "@/components/ui/more-menu";
import { PageHeader } from "@/components/ui/page-header";
import { PageLoading } from "@/components/ui/page-loading";
import { FramedLoading } from "@/components/app/reports/reports-slot";
import { EmptyState, ErrorState, NoMatches, SectionLoading } from "@/components/ui/page-states";
import { StatStrip, StatTile } from "@/components/ui/stat";
import { StatusChip, type StatusTone } from "@/components/ui/status-chip";
import { TableCard } from "@/components/ui/table-card";
import { ToggleChip } from "@/components/ui/toggle-chip";
import { useShow } from "@/components/ui/view-switch";
import { defaultPartnerQualityPeriod, partnersBySent, percentChange, percentOf, pointChange, screeningFlags, weeklyRate } from "@/lib/partnerQuality/metrics";
import type { PartnerQualityDetail, PartnerQualityDetailLead, PartnerQualityMember, PartnerQualityMetric, PartnerQualityPeriodMetrics, PartnerQualityReport, PartnerQualityWeek } from "@/lib/partnerQuality/types";
import { showHref } from "@/lib/reports/show";
import { notify } from "@/lib/notify";
import { cn } from "@/lib/utils";
import { count, dateText, dispositionText, downloadCsv, drilldownHref, FigureLink, metricLabel, paginate, Pager, PartnerStepper, partnerTypeLabel, percent, PeriodInputs, periodQuery, periodText, productText, replacePeriodInUrl, type Period } from "./partner-quality-parts";
import { partnerQualityKey } from "./partner-quality-workspace";
import { useFittingRows } from "./use-fitting-rows";
import { ViewTabs } from "@/components/ui/view-tabs";
import { InReportsSlot, useReportsTitle, useUrlTab } from "@/components/app/reports/reports-slot";
import { load as loadResource, peek, readResource, seed } from "@/lib/client/resource-cache";

/** The partner's report, as the app's cache keys it (lib/client/resource-cache.ts). */
const partnerQualityDetailKey = (partnerId: string, period: Period) => `/api/app/partner-quality/${partnerId}?${periodQuery(period)}`;

/**
 * The partner's sections, one at a time (2026-10-06 redesign: five stacked tables became tabs; foundation
 * pass 2026-11-03: Outcomes and Screening, two tables side by side, are a tab each). `?section=` opens one
 * (not `?tab=`: on a partner record that already names the record's own tab).
 */
const DETAIL_TABS = ["leads", "outcomes", "screening", "team", "agents", "daily"] as const;
type DetailTab = (typeof DETAIL_TABS)[number];

type LeadFilter = "all" | "unclaimed" | "claimed" | "worked" | "submitted" | "flagged" | "duplicate" | "disqualified";
const LEAD_FILTERS: { value: LeadFilter; label: string }[] = [
  { value: "all", label: "All leads" },
  { value: "unclaimed", label: "Not claimed" },
  { value: "claimed", label: "Claimed" },
  { value: "worked", label: "Worked" },
  { value: "submitted", label: "Submitted" },
  { value: "flagged", label: "Screening flagged" },
  { value: "duplicate", label: "Duplicates" },
  { value: "disqualified", label: "Disqualified" },
];
const FLAGGED = new Set(["TCPA blocked", "DNC flagged", "Invalid phone"]);

function matchesFilter(lead: PartnerQualityDetailLead, filter: LeadFilter) {
  switch (filter) {
    case "unclaimed": return !lead.claimed;
    case "claimed": return lead.claimed;
    case "worked": return lead.worked;
    case "submitted": return lead.submitted;
    case "flagged": return FLAGGED.has(lead.screening);
    case "duplicate": return lead.duplicate;
    case "disqualified": return lead.screening === "Disqualified";
    default: return true;
  }
}

/**
 * A lead's one chip (8·4: Screening, Duplicate and Claimed by fold into the Status): a screening flag, a
 * disqualification or a duplicate first, in amber; then what became of it.
 */
function leadState(lead: PartnerQualityDetailLead, labels: Record<string, string>): { text: string; tone: StatusTone } {
  if (FLAGGED.has(lead.screening)) return { text: lead.screening, tone: "warning" };
  if (lead.screening === "Disqualified") return { text: "Disqualified", tone: "warning" };
  if (lead.duplicate) return { text: "Duplicate", tone: "warning" };
  if (lead.submitted) return { text: "Application submitted", tone: "good" };
  if (lead.disposition) return { text: dispositionText(lead.disposition, labels), tone: "neutral" };
  if (!lead.claimed) return { text: "Not claimed", tone: "neutral" };
  return { text: "No outcome yet", tone: "neutral" };
}

function shortDate(value: string) { return new Intl.DateTimeFormat(undefined, { month: "short", day: "numeric", weekday: "short", timeZone: "UTC" }).format(new Date(`${value}T00:00:00Z`)); }

function rate(value: number | null, sent: number) { return sent ? percent(value) : "—"; }

/** Count tiles compare as a percent change; rate tiles as percentage points; only when the period before sent something. */
function countDelta(current: number, previous: number, goodWhen: "up" | "down" = "up") { const value = previous ? percentChange(current, previous) : null; return value == null ? undefined : { value, goodWhen }; }
function rateDelta(current: number | null, previous: number | null, compare: boolean, goodWhen: "up" | "down" = "up") { const value = compare ? pointChange(current, previous) : null; return value == null ? undefined : { value, unit: " pts", goodWhen }; }

/** A chart view's card: the period and Refresh on top (the toolbar both views share), then the heading and the chart. */
function ChartCard({ label, toolbar, children }: { label: string; toolbar: ReactNode; children: ReactNode }) {
  return <section aria-label={label} className={cn(cardSurface, "flex min-w-0 flex-col gap-4 p-4")}>{toolbar}{children}</section>;
}

function OpenLink({ href, children }: { href: string; children: ReactNode }) {
  return <Link href={href} className="whitespace-nowrap text-sm font-medium text-foreground underline-offset-4 hover:underline">{children}</Link>;
}

/**
 * `embedded`: shown as the Quality tab of the partner's own record (2026-10-25, Module 1 simplified): the record
 * already names the partner, so the title is left out and the tables show (there is no switch there).
 *
 * `framed`: inside the Reports page (components/app/reports/reports-page.tsx), Reports round 7 (owner pick 8·A,
 * 2026-11-11): the partner's name is the title; the six tabs (no counts), ‹ › naming the neighbouring partners, the
 * "Table · Chart" switch and ⋯ share its line, and the period moved into the toolbar so the line fits at 1600px with
 * the rail open. The chart view draws each tab: Leads sent a line by week, Outcomes, Team and By agent a BarList,
 * Screening a ShareBar, Daily volume bars by week. Every point, bar and row opens the leads behind it.
 */
export function PartnerQualityDetailWorkspace({ partnerId, initialPeriod, embedded = false, framed = false, recordLinks = false }: { partnerId: string; initialPeriod?: Period | null; embedded?: boolean; framed?: boolean; recordLinks?: boolean }) {
  const router = useRouter();
  const query = useSearchParams();
  const switched = useShow("chart");
  const show = framed ? switched : "table";
  const [period, setPeriod] = useState<Period>(() => initialPeriod ?? defaultPartnerQualityPeriod());
  const [data, setData] = useState<PartnerQualityDetail | null>(() => seed<PartnerQualityDetail>(partnerQualityDetailKey(partnerId, period))?.data ?? null);
  const [loading, setLoading] = useState(() => !seed(partnerQualityDetailKey(partnerId, period))?.data);
  const [error, setError] = useState("");
  const [list, setList] = useState<PartnerQualityReport | null>(null);
  const q = query.get("q");
  const [search, setSearch] = useState(() => q ?? "");
  // "Open the flagged ›" opens the Leads table with that filter (`?filter=`).
  const filterParam = LEAD_FILTERS.find((option) => option.value === query.get("filter"))?.value ?? null;
  const [filter, setFilter] = useState<LeadFilter>(() => filterParam ?? "all");
  const [leadFiltersOpen, setLeadFiltersOpen] = useState(false);
  const [emptyDays, setEmptyDays] = useState(false);
  const [leadPage, setLeadPage] = useState(1);
  const [dayPage, setDayPage] = useState(1);
  const [teamPage, setTeamPage] = useState(1);
  const [agentPage, setAgentPage] = useState(1);
  const { tab, setTab, href: tabHref } = useUrlTab(DETAIL_TABS, "leads", "section");
  // Header, strip, toolbar, column heads and pager around the one-line rows.
  const pageSize = useFittingRows(420, 45);

  // An agent's bar opens the Leads table searched for that agent (`?q=`); follow it when the address changes.
  useEffect(() => { if (q != null) { setSearch(q); setLeadPage(1); } }, [q]); // eslint-disable-line react-hooks/set-state-in-effect
  useEffect(() => { if (filterParam) { setFilter(filterParam); setLeadPage(1); } }, [filterParam]); // eslint-disable-line react-hooks/set-state-in-effect

  const load = useCallback(async (next: Period, fresh = false) => {
    setLoading(true); setError("");
    try {
      const key = partnerQualityDetailKey(partnerId, next);
      const body = await (fresh ? loadResource<PartnerQualityDetail>(key) : readResource<PartnerQualityDetail>(key));
      setData(body);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Could not load this partner");
    } finally {
      setLoading(false);
    }
  }, [partnerId]);
  useEffect(() => {
    const kept = peek<PartnerQualityDetail>(partnerQualityDetailKey(partnerId, period));
    // eslint-disable-next-line react-hooks/set-state-in-effect -- the kept answer, read from storage after hydration
    if (kept?.data) setData((current) => current ?? kept.data ?? null);
    void load(period);
  }, [partnerId, period, load]);
  // ‹ ›: the list for the same period (usually already in the cache from the list page), in its order.
  useEffect(() => {
    if (!framed) return;
    let live = true;
    readResource<PartnerQualityReport>(partnerQualityKey(period)).then((body) => { if (live) setList(body); }, () => { /* no neighbours, no buttons */ });
    return () => { live = false; };
  }, [framed, period]);
  // A failed reload with figures still on screen is a toast (8·7), never a notice on the page.
  useEffect(() => { if (error && data) notify.fail("This partner did not reload", { detail: "The figures shown are from the last load." }); }, [error]); // eslint-disable-line react-hooks/exhaustive-deps

  function changePeriod(next: Period) {
    setPeriod(next); setLeadPage(1); setDayPage(1);
    replacePeriodInUrl(next);
  }

  const labels = useMemo(() => data?.disposition_labels ?? {}, [data]);
  const shownLeads = useMemo(() => {
    if (!data) return [];
    const needle = search.trim().toLowerCase();
    return data.leads.filter((lead) => matchesFilter(lead, filter) && (!needle || [lead.full_name, lead.phone, lead.state, lead.product, lead.agent_name, lead.submitted_by, leadState(lead, labels).text].some((value) => value?.toLowerCase().includes(needle))));
  }, [data, filter, search, labels]);

  // The header: the partner's name, and its type and the period as the facts line (owner 2026-11-02).
  useReportsTitle(framed ? data?.partner.name ?? null : null, framed && data ? `${partnerTypeLabel(data.partner.partner_type)} · ${periodText({ from: data.from, to: data.to })}` : undefined);
  const backHref = `/app/partner-quality?${periodQuery(period)}`;
  // The way back is the trail above the title (owner 2026-10-30), keeping the period.
  const trail = (current: string) => [{ label: "Reports" }, { label: "Partner quality", href: backHref }, { label: current }];

  if (loading && !data) return framed ? <FramedLoading /> : <PageLoading />;
  if (!data) return <div className="flex flex-col gap-6">{!framed && <PageHeader title="Partner" breadcrumbs={trail("Partner")} />}<ErrorState detail={error || "Could not load this partner"} action={<Button variant="outline" onClick={() => void load(period)}>Try again</Button>} /></div>;

  const active: Period = { from: data.from, to: data.to };
  const now = data.current;
  const prev = data.previous;
  const compare = prev.sent > 0;
  const name = data.partner.name;
  const drill = (metric: PartnerQualityMetric, extra: { disposition?: string; member?: PartnerQualityMember; period?: Period; label?: string } = {}) => drilldownHref({
    label: `${extra.member?.name ?? name} · ${extra.label ?? (extra.disposition ? dispositionText(extra.disposition, labels) : metricLabel(metric))}`,
    partnerId: data.partner.id, metric, period: extra.period ?? active, disposition: extra.disposition, partnerUserId: extra.member?.user_id,
  });
  const weekDrill = (week: PartnerQualityWeek, metric: "sent" | "submitted" = "sent") => drill(metric, { period: { from: week.from, to: week.to }, label: `${metricLabel(metric)} · week of ${week.label}` });
  const weekOf = (key: string) => data.weeks.find((week) => week.key === key);
  const shownDays = emptyDays ? data.daily : data.daily.filter((day) => day.sent > 0);
  const { current: leadCurrent, rows: leadRows } = paginate(shownLeads, leadPage, pageSize);
  const { current: dayCurrent, rows: dayRows } = paginate(shownDays, dayPage, pageSize);
  const { current: teamCurrent, pages: teamPages, rows: teamRows } = paginate(data.team, teamPage, pageSize);
  const { current: agentCurrent, rows: agentRows } = paginate(data.agents, agentPage, pageSize);
  const section = (content: ReactNode, columns = 4) => loading ? <SectionLoading rows={4} columns={columns} /> : content;
  const clearLeadFilters = () => { setSearch(""); setFilter("all"); setLeadPage(1); };
  const leadsTable = (extra: Record<string, string | null> = {}) => showHref(tabHref("leads"), "table", extra);

  function exportLeads() {
    downloadCsv(`${name.replace(/[^a-z0-9]+/gi, "-").toLowerCase()}-leads-${active.from}-to-${active.to}.csv`,
      ["Received", "Customer", "Phone", "State", "Product", "Screening", "Duplicate", "Submitted by", "Claimed by", "Status"],
      shownLeads.map((lead) => [lead.date, lead.full_name, lead.phone, lead.state, lead.product, lead.screening, lead.duplicate ? "Yes" : "No", lead.submitted_by, lead.agent_name, leadState(lead, labels).text]));
    notify.done(`Exported ${count(shownLeads.length)} leads`, { detail: `${name} · ${periodText(active)}.csv` });
  }

  // ‹ ›: the partners either side in the list's order (most sent first), keeping the period, the view and the tab.
  const order = list ? partnersBySent(list.rows, !list.rows.some((row) => row.partner_id === data.partner.id && row.sent > 0)) : [];
  const at = order.findIndex((row) => row.partner_id === data.partner.id);
  const neighbour = (index: number) => {
    const row = at >= 0 ? order[index] : undefined;
    return row ? { href: `/app/partner-quality/${row.partner_id}?${new URLSearchParams({ ...active, show, section: tab })}`, label: row.partner_name } : null;
  };

  const leadActive: ActiveFilter[] = filter === "all" ? [] : [{ key: "show", label: "Show", value: LEAD_FILTERS.find((option) => option.value === filter)?.label ?? filter, onRemove: () => { setFilter("all"); setLeadPage(1); } }];
  const dispositioned = data.dispositions.reduce((sum, item) => sum + item.count, 0);
  const screeningRows: { label: string; value: number; prior: number; metric?: PartnerQualityMetric }[] = [
    { label: "Passed", value: now.sent - screeningFlags(now.screening), prior: prev.sent - screeningFlags(prev.screening) },
    { label: "TCPA blocked", value: now.screening.tcpa, prior: prev.screening.tcpa, metric: "tcpa" },
    { label: "DNC flagged", value: now.screening.dnc, prior: prev.screening.dnc, metric: "dnc" },
    { label: "Invalid phone", value: now.screening.invalid, prior: prev.screening.invalid, metric: "invalid" },
    { label: "Disqualified", value: now.disqualified, prior: prev.disqualified, metric: "disqualified" },
    { label: "Duplicates", value: now.duplicates, prior: prev.duplicates, metric: "duplicate" },
    // LA-6.2: transfers the gate rejected (never billable, never in deal flow), and accepts whose
    // checks only ran at submit, with a closer already on the line.
    { label: "Rejected at transfer", value: data.gate.current.rejected, prior: data.gate.previous.rejected },
    { label: "Screened only at submit", value: data.gate.current.screenedLate, prior: data.gate.previous.screenedLate },
    // LA-6.4: a partner generating complaints is a partner about to cost the agent a licence.
    { label: "Complaints", value: data.gate.current.complaints, prior: data.gate.previous.complaints },
  ];
  // No counts on the tabs (8·4 fix, 2026-11-11): the tabs, ‹ ›, the switch and ⋯ keep one line at 1600px.
  const tabs: { key: DetailTab; label: string }[] = [
    { key: "leads", label: "Leads sent" },
    { key: "outcomes", label: "Outcomes" },
    { key: "screening", label: "Screening" },
    { key: "team", label: "Team" },
    { key: "agents", label: "By agent" },
    { key: "daily", label: "Daily volume" },
  ];
  // Every tab's toolbar starts with the period (which every tab reads) and ends with Refresh.
  const periodTool = <PeriodInputs value={active} onChange={changePeriod} />;
  const refreshTool = <RefreshButton onClick={() => void load(period, true)} refreshing={loading} />;
  const plainToolbar = <DataToolbar actions={refreshTool}>{periodTool}</DataToolbar>;
  const headline = `${periodText(active)} · ${count(now.sent)} sent · ${count(now.submitted)} submitted (${rate(now.conversion_rate, now.sent)})${now.sent ? ` · ${percent(now.screening_pass_rate)} passed screening` : ""}`;
  const noLeads = <EmptyState title="No leads in this period" hint="Widen the period to see earlier leads." />;

  // ── The chart view of each tab ──────────────────────────────────────────────────────────────
  function chart(): ReactNode {
    if (loading) return <SectionLoading rows={4} columns={4} />;
    if (tab === "leads") {
      if (!now.sent) return noLeads;
      const points = data!.weeks.map((week) => ({ key: week.key, label: week.label, value: week.sent }));
      return <>
        <ChartHeading title="Leads sent and submitted, by week" period={headline} action={<OpenLink href={leadsTable()}>{`Open the ${count(now.sent)} leads ›`}</OpenLink>} />
        <LineSeries
          points={points}
          summary={`${name}: leads sent and submitted each week, ${periodText(active)}.`}
          unit="leads"
          minHeight={220}
          legend={{ label: "Sent", figure: count(now.sent), href: drill("sent") }}
          lines={[{ key: "submitted", label: "Submitted", dashed: true, points: data!.weeks.map((week) => ({ key: week.key, label: week.label, value: week.submitted })), figure: count(now.submitted), href: drill("submitted") }]}
          // The period before, a week against a week, drawn only when it sent something (8·7).
          compare={compare ? { label: "Sent, the period before", figure: count(prev.sent), href: drill("sent", { period: { from: data!.previous_from, to: data!.previous_to }, label: "Sent · the period before" }), points: data!.weeks.map((week, index) => ({ key: week.key, label: week.label, value: data!.previous_weeks[index]?.sent ?? 0 })) } : undefined}
          hrefFor={(point) => { const week = weekOf(point.key); return week ? weekDrill(week) : null; }}
        />
      </>;
    }
    if (tab === "outcomes") {
      if (!now.sent) return noLeads;
      const rows: BarListRow[] = data!.dispositions.map((item) => ({ key: item.key, label: dispositionText(item.key, labels), value: item.count, caption: percent(percentOf(item.count, now.sent)), href: drill("disposition", { disposition: item.key }) }));
      if (now.sent - dispositioned > 0) rows.push({ key: "none", label: "No outcome yet", value: now.sent - dispositioned, caption: percent(percentOf(now.sent - dispositioned, now.sent)), tone: "quiet", href: leadsTable() });
      return <>
        <ChartHeading title="Outcomes" period={`${count(now.sent)} leads · the last disposition on each`} action={<OpenLink href={leadsTable()}>Open the leads ›</OpenLink>} />
        <BarList rows={rows} summary={`What became of ${name}'s ${count(now.sent)} leads, by last disposition.`} unit="leads" max={now.sent} labelWidth="14rem" />
      </>;
    }
    if (tab === "screening") {
      if (!now.sent) return noLeads;
      const passed = now.sent - screeningFlags(now.screening);
      const segments: ShareSegment[] = [
        { key: "passed", label: "Passed", value: Math.max(0, passed), tone: "strong", href: leadsTable() },
        { key: "dnc", label: "DNC flagged", value: now.screening.dnc, tone: "warning", href: drill("dnc") },
        { key: "tcpa", label: "TCPA blocked", value: now.screening.tcpa, tone: "cat4", href: drill("tcpa") },
        { key: "invalid", label: "Invalid phone", value: now.screening.invalid, tone: "cat6", href: drill("invalid") },
      ];
      const after: BarListRow[] = [
        { key: "dq", label: "Disqualified", value: now.disqualified, caption: rate(now.disqualification_rate, now.sent), href: drill("disqualified") },
        { key: "dup", label: "Duplicates", value: now.duplicates, caption: rate(now.duplicate_rate, now.sent), href: drill("duplicate") },
      ];
      const gate = data!.gate.current;
      const gateSegments: ShareSegment[] = [
        { key: "accepted", label: "Accepted, screened first", value: Math.max(0, gate.accepted - gate.screenedLate), tone: "strong" },
        { key: "late", label: "Screened only at submit", value: gate.screenedLate, tone: "warning" },
        { key: "rejected", label: "Rejected at transfer", value: gate.rejected, tone: "cat4" },
      ];
      return <>
        <ChartHeading title="Screening" period={`${count(now.sent)} sent · ${percent(now.screening_pass_rate)} passed`} action={<OpenLink href={leadsTable({ filter: "flagged" })}>Open the flagged ›</OpenLink>} />
        <ShareBar segments={segments} summary={`${name}: how its ${count(now.sent)} leads screened.`} unit="leads" />
        <BarList rows={after} summary={`${name}: leads disqualified and duplicated, of ${count(now.sent)} sent.`} unit="leads" max={now.sent} labelWidth="14rem" />
        {/* LA-6.2/6.4: the transfer gate and complaints, as a second bar only when any are non-zero (8·5). */}
        {gate.accepted + gate.rejected > 0 && <>
          <ChartHeading title="At the transfer gate" period={`${count(gate.rejected)} rejected at transfer · ${count(gate.screenedLate)} screened only at submit · ${count(gate.accepted)} accepted · ${count(gate.complaints)} ${gate.complaints === 1 ? "complaint" : "complaints"}`} />
          <ShareBar segments={gateSegments} summary={`${name}: transfers at the pre-transfer gate.`} unit="transfers" />
        </>}
      </>;
    }
    if (tab === "team") {
      if (!data!.team.length && !data!.unattributed.sent) return <EmptyState title="No partner users" hint="Invite them from the partner's record." action={recordLinks ? <Button asChild variant="outline"><Link href={`/app/publishers/${data!.partner.id}`}>Open partner</Link></Button> : undefined} />;
      const rows: BarListRow[] = data!.team.map((member) => ({ key: member.id, label: member.name, value: member.sent, inner: member.submitted, figure: `${count(member.sent)} sent`, caption: member.sent ? `${count(member.submitted)} submitted · ${rate(member.conversion_rate, member.sent)}` : undefined, href: drill("sent", { member }) }));
      if (data!.unattributed.sent) rows.push({ key: "other", label: "Other sources", value: data!.unattributed.sent, inner: data!.unattributed.submitted, figure: `${count(data!.unattributed.sent)} sent`, caption: `${count(data!.unattributed.submitted)} submitted · API or agency import`, tone: "quiet", href: showHref(tabHref("team"), "table") });
      return <>
        <ChartHeading title="Team · who sent them" period={`the partner's ${count(data!.team.length)} ${data!.team.length === 1 ? "person" : "people"} · sent, with submitted inside`} action={<OpenLink href={showHref(tabHref("team"), "table")}>Open the team ›</OpenLink>} />
        <BarList rows={rows} summary={`${name}: leads each partner user sent, with the submitted part inside.`} unit="leads" labelWidth="14rem" />
      </>;
    }
    if (tab === "agents") {
      if (!data!.agents.length) return <EmptyState title="No leads claimed yet" hint="Agents appear here once they claim this partner's leads." />;
      const rows: BarListRow[] = data!.agents.map((agent) => ({ key: agent.user_id, label: agent.name, value: agent.leads, inner: agent.submitted, figure: `${count(agent.leads)} leads`, caption: `${count(agent.submitted)} submitted · ${percent(agent.conversion_rate)}`, href: leadsTable({ q: agent.name }) }));
      return <>
        <ChartHeading title="By agent · who worked them" period={`${count(data!.agents.length)} ${data!.agents.length === 1 ? "agent" : "agents"} claimed this partner's leads · leads, with submitted inside`} action={<OpenLink href={showHref(tabHref("agents"), "table")}>Open the agents ›</OpenLink>} />
        <BarList rows={rows} summary={`${name}: leads each agent claimed, with the submitted part inside.`} unit="leads" labelWidth="14rem" />
      </>;
    }
    if (!now.sent) return noLeads;
    return <>
      <ChartHeading title="Daily volume" period={`sent per week, submitted inside · ${periodText(active)} · the table keeps one row a day`} action={<OpenLink href={showHref(tabHref("daily"), "table")}>Open the days ›</OpenLink>} />
      <BarSeries
        bars={data!.weeks.map((week) => ({ key: week.key, label: week.label, value: week.sent, accent: week.submitted, partial: week.partial }))}
        summary={`${name}: leads sent each week, ${periodText(active)}, with the submitted part inside.`}
        unit="leads"
        labels="all"
        minHeight={200}
        names={{ value: "Sent", accent: "Submitted" }}
        legend={[{ key: "sent", label: "Sent", tone: "faint", figure: count(now.sent), href: drill("sent") }, { key: "submitted", label: "Submitted", tone: "strong", figure: count(now.submitted), href: drill("submitted") }]}
        hrefFor={(bar) => { const week = weekOf(bar.key); return week ? weekDrill(week) : null; }}
      />
    </>;
  }

  return <div className="m-stagger flex w-full min-w-0 flex-col gap-6">
    {embedded ? <p className="m-0 text-sm leading-[1.5] text-muted-foreground">{periodText(active)}</p> : framed ? null : <PageHeader title={name} breadcrumbs={trail(name)} description={`${partnerTypeLabel(data.partner.partner_type)} · ${periodText(active)}`} />}

    {/* Four figures, each with its week-by-week line (the cards stay, owner 2026-11-11). A tile opens its tab. */}
    <StatStrip label={`${name} totals`}>
      <StatTile label="Sent" href={tabHref("leads")} value={count(now.sent)} delta={countDelta(now.sent, prev.sent)} footnote={`${count(now.claimed)} claimed · ${count(now.worked)} worked${compare ? ` · prev ${count(prev.sent)}` : ""}`}
        trend={{ points: data.weeks.map((week) => week.sent), tone: "primary", placement: "under" }} />
      <StatTile label="Conversion" href={tabHref("agents")} value={rate(now.conversion_rate, now.sent)} delta={rateDelta(now.conversion_rate, prev.conversion_rate, compare)} footnote={`${count(now.submitted)} submitted`}
        trend={{ points: weeklyRate(data.weeks, (week) => week.submitted), tone: "primary", placement: "under" }} />
      <StatTile label="Screening" href={tabHref("screening")} labelTitle="Screening pass rate: sent leads with no TCPA, DNC or invalid-phone flag" value={rate(now.screening_pass_rate, now.sent)} delta={rateDelta(now.screening_pass_rate, prev.screening_pass_rate, compare)}
        footnote={<span className="inline-flex flex-wrap items-center gap-1.5">{`${count(screeningFlags(now.screening))} flagged`}{now.screening_pass_rate != null && now.screening_pass_rate < 90 && <StatusChip tone="warning">Below 90%</StatusChip>}</span>}
        trend={{ points: weeklyRate(data.weeks, (week) => week.sent - week.flagged), tone: "primary", placement: "under" }} />
      <StatTile label="DQ %" href={tabHref("screening")} value={rate(now.disqualification_rate, now.sent)} delta={rateDelta(now.disqualification_rate, prev.disqualification_rate, compare, "down")} footnote={`${count(now.disqualified)} leads · ${count(now.duplicates)} duplicates`}
        trend={{ points: weeklyRate(data.weeks, (week) => week.disqualified), tone: "primary", placement: "under" }} />
    </StatStrip>

    {/* The six tabs, then ‹ › at the line's end (the switch and ⋯ follow, in the frame's corner). */}
    <InReportsSlot framed={framed} slot="lead">
      <ViewTabs label="Partner sections" tabs={tabs} value={tab} onChange={setTab} idPrefix="partner-tab" controls="partner-view" />
      {framed && <PartnerStepper previous={neighbour(at - 1)} next={neighbour(at + 1)} />}
    </InReportsSlot>
    {framed && <InReportsSlot framed slot="corner">
      <MoreMenu row label={`More for ${name}`} items={[
        recordLinks && { label: "Open the partner's record", href: `/app/publishers/${data.partner.id}` },
        { label: "Download CSV", onSelect: exportLeads, disabled: shownLeads.length === 0 },
      ]} />
    </InReportsSlot>}

    {/* The selected section, as the tab panel: it fades in when the tab changes (2026-10-09). */}
    <div key={`${tab}-${show}`} role="tabpanel" id="partner-view" aria-labelledby={`partner-tab-${tab}`} className="flex min-w-0 flex-col gap-6">
    {show === "chart" && <ChartCard label={tabs.find((entry) => entry.key === tab)?.label ?? "Chart"} toolbar={plainToolbar}>{chart()}</ChartCard>}

    {show === "table" && tab === "leads" && <TableCard
      toolbar={<>
        <DataToolbar actions={<>
          <FilterButton open={leadFiltersOpen} count={leadActive.length} controls="partner-lead-filters" onClick={() => setLeadFiltersOpen((open) => !open)} />
          {refreshTool}
        </>}>
          <ToolbarSearch value={search} onChange={(value) => { setSearch(value); setLeadPage(1); }} placeholder="Search leads" />
          {periodTool}
        </DataToolbar>
        <FilterPanel id="partner-lead-filters" open={leadFiltersOpen}>
          <FilterField label="Show" htmlFor="partner-lead-show">
            <select id="partner-lead-show" className={toolbarControl} value={filter} onChange={(event) => { setFilter(event.target.value as LeadFilter); setLeadPage(1); }}>
              {LEAD_FILTERS.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
            </select>
          </FilterField>
        </FilterPanel>
        <ActiveFilters filters={leadActive} onClear={clearLeadFilters} />
      </>}
      footer={<Pager page={leadCurrent} total={shownLeads.length} pageSize={pageSize} noun="leads" onPage={setLeadPage} suffix={data.leads_truncated ? `newest ${count(data.leads.length)} of ${count(now.sent)} listed` : undefined} />}
    >
      {section(data.leads.length === 0
        ? noLeads
        : shownLeads.length === 0
          ? <NoMatches noun="leads" onClear={clearLeadFilters} />
          : <table className="portal-lead-table w-full min-w-[760px] text-left text-sm">
              <thead><tr><th>Received</th><th>Lead</th><th>State</th><th>Product</th><th>Submitted by</th><th>Status</th></tr></thead>
              <tbody className="m-seq">
                {leadRows.map((lead) => {
                  const state = leadState(lead, labels);
                  return (
                    <tr key={lead.lead_id} className="m-row cursor-pointer" onClick={() => router.push(`/app/leads/${lead.lead_id}`)}>
                      <td className="whitespace-nowrap tabular-nums">{dateText(lead.date)}</td>
                      <td className="max-w-[240px] truncate whitespace-nowrap"><Link href={`/app/leads/${lead.lead_id}`} title={`${lead.full_name}${lead.phone ? ` · ${lead.phone}` : ""}`} onClick={(event) => event.stopPropagation()} className="font-medium text-foreground underline-offset-4 hover:underline">{lead.full_name}</Link></td>
                      <td className="whitespace-nowrap">{lead.state ?? "—"}</td>
                      <td className="whitespace-nowrap">{productText(lead.product)}</td>
                      <td className="max-w-[200px] truncate whitespace-nowrap" title={lead.submitted_by ?? undefined}>{lead.submitted_by ?? "—"}</td>
                      <td className="whitespace-nowrap"><StatusChip tone={state.tone} title={lead.agent_name ? `Claimed by ${lead.agent_name}` : undefined}>{state.text}</StatusChip></td>
                    </tr>
                  );
                })}
              </tbody>
            </table>, 6)}
    </TableCard>}

    {show === "table" && tab === "outcomes" && <TableCard toolbar={plainToolbar}>
        {section(now.sent === 0
          ? <EmptyState title="No outcomes" hint="Nothing was sent in this period." />
          : <table className="portal-lead-table w-full min-w-0! text-left text-sm">
              <thead><tr><th>Disposition</th><th className="text-right">Leads</th><th className="text-right">Of sent</th></tr></thead>
              <tbody>
                {data.dispositions.map((item) => (
                  <tr key={item.key}>
                    <td className="whitespace-nowrap">{dispositionText(item.key, labels)}</td>
                    <td className="text-right"><FigureLink href={drill("disposition", { disposition: item.key })} label={`${dispositionText(item.key, labels)}: ${item.count}; open the leads`}>{count(item.count)}</FigureLink></td>
                    <td className="text-right tabular-nums">{percent(percentOf(item.count, now.sent))}</td>
                  </tr>
                ))}
                {now.sent - dispositioned > 0 && <tr><td className="whitespace-nowrap">No outcome yet</td><td className="text-right tabular-nums">{count(now.sent - dispositioned)}</td><td className="text-right tabular-nums">{percent(percentOf(now.sent - dispositioned, now.sent))}</td></tr>}
              </tbody>
            </table>, 3)}
      </TableCard>}
    {show === "table" && tab === "screening" && <TableCard toolbar={plainToolbar}>
        {section(<table className="portal-lead-table w-full min-w-0! text-left text-sm">
          <thead><tr><th>Result</th><th className="text-right">Leads</th><th className="text-right">Of sent</th><th className="text-right">Prev</th></tr></thead>
          <tbody>
            {screeningRows.map((row) => (
              <tr key={row.label}>
                <td className="whitespace-nowrap">{row.label}</td>
                <td className="text-right">{row.metric && row.value ? <FigureLink href={drill(row.metric)} label={`${row.label}: ${row.value}; open the leads`}>{count(row.value)}</FigureLink> : <span className="tabular-nums">{count(row.value)}</span>}</td>
                <td className="text-right tabular-nums">{rate(percentOf(row.value, now.sent), now.sent)}</td>
                <td className="text-right tabular-nums">{count(row.prior)}</td>
              </tr>
            ))}
          </tbody>
        </table>, 4)}
      </TableCard>}

    {show === "table" && tab === "team" && <TableCard toolbar={plainToolbar} footer={data.team.length ? <Pager page={teamCurrent} total={data.team.length} pageSize={pageSize} noun="members" onPage={setTeamPage} /> : undefined}>
      {section(data.team.length === 0 && data.unattributed.sent === 0
        ? <EmptyState title="No partner users" hint="Invite them from the partner's record." action={recordLinks ? <Button asChild variant="outline"><Link href={`/app/publishers/${data.partner.id}`}>Open partner</Link></Button> : undefined} />
        : <table className="portal-lead-table w-full min-w-[720px] text-left text-sm">
            <thead><tr><th>Member</th><th>Role</th><th className="text-right">Sent</th><th className="text-right">Submitted</th><th className="text-right">Conversion</th><th>Access</th></tr></thead>
            <tbody>
              {teamRows.map((member) => (
                <tr key={member.id}>
                  <td className="max-w-[260px] truncate whitespace-nowrap font-medium text-foreground" title={member.email ? `${member.name} · ${member.email}` : member.name}>{member.name}</td>
                  <td className="whitespace-nowrap" title={member.role === "partner_admin" ? undefined : `Reports to ${member.partner_admin_name ?? "no one yet"}`}>{member.role === "partner_admin" ? "Partner admin" : "Partner user"}</td>
                  <td className="text-right">{member.sent ? <FigureLink href={drill("sent", { member })} label={`${member.name}: sent ${member.sent}; open the leads`}>{count(member.sent)}</FigureLink> : <span className="tabular-nums">0</span>}</td>
                  <td className="text-right">{member.submitted ? <FigureLink href={drill("submitted", { member })} label={`${member.name}: submitted ${member.submitted}; open the leads`}>{count(member.submitted)}</FigureLink> : <span className="tabular-nums">0</span>}</td>
                  <td className="text-right tabular-nums">{rate(member.conversion_rate, member.sent)}</td>
                  <td className="whitespace-nowrap"><StatusChip tone={member.status === "revoked" ? "neutral" : "good"}>{member.status === "revoked" ? "Revoked" : "Active"}</StatusChip></td>
                </tr>
              ))}
              {data.unattributed.sent > 0 && teamCurrent === teamPages && <UnattributedRow metrics={data.unattributed} />}
            </tbody>
          </table>, 6)}
    </TableCard>}

    {show === "table" && tab === "agents" && <TableCard toolbar={plainToolbar} footer={data.agents.length ? <Pager page={agentCurrent} total={data.agents.length} pageSize={pageSize} noun="agents" onPage={setAgentPage} /> : undefined}>
      {section(data.agents.length === 0
        ? <EmptyState title="No leads claimed yet" hint="Agents appear here once they claim this partner's leads." />
        : <table className="portal-lead-table w-full min-w-[640px] text-left text-sm">
            <thead><tr><th>Agent</th><th className="text-right">Leads</th><th className="text-right">Worked</th><th className="text-right">Submitted</th><th className="text-right">Conversion</th></tr></thead>
            <tbody>
              {agentRows.map((agent) => (
                <tr key={agent.user_id}>
                  <td className="whitespace-nowrap"><Link href={leadsTable({ q: agent.name })} className="font-medium text-foreground underline-offset-4 hover:underline">{agent.name}</Link></td>
                  <td className="text-right tabular-nums">{count(agent.leads)}</td>
                  <td className="text-right tabular-nums">{count(agent.worked)}</td>
                  <td className="text-right tabular-nums">{count(agent.submitted)}</td>
                  <td className="text-right tabular-nums">{percent(agent.conversion_rate)}</td>
                </tr>
              ))}
            </tbody>
          </table>, 5)}
    </TableCard>}

    {show === "table" && tab === "daily" && <TableCard
      toolbar={<DataToolbar actions={refreshTool}>{periodTool}<ToggleChip selected={emptyDays} onClick={() => { setEmptyDays((value) => !value); setDayPage(1); }}>Show empty days</ToggleChip></DataToolbar>}
      footer={shownDays.length ? <Pager page={dayCurrent} total={shownDays.length} pageSize={pageSize} noun="days" onPage={setDayPage} /> : undefined}
    >
      {section(shownDays.length === 0 ? noLeads : <table className="portal-lead-table w-full min-w-[640px] text-left text-sm">
        <thead><tr><th>Date</th><th className="text-right">Sent</th><th className="text-right">Claimed</th><th className="text-right">Submitted</th><th className="text-right">Flagged</th><th className="text-right">Duplicates</th></tr></thead>
        <tbody>
          {dayRows.map((day) => (
            <tr key={day.date}>
              <td className="whitespace-nowrap tabular-nums">{shortDate(day.date)}</td>
              <td className="text-right">{day.sent ? <FigureLink href={drill("sent", { period: { from: day.date, to: day.date }, label: `Sent · ${shortDate(day.date)}` })} label={`${shortDate(day.date)}: ${day.sent} sent; open the leads`}>{count(day.sent)}</FigureLink> : <span className="tabular-nums">0</span>}</td>
              <td className="text-right tabular-nums">{count(day.claimed)}</td>
              <td className="text-right tabular-nums">{count(day.submitted)}</td>
              <td className="text-right tabular-nums">{count(day.flagged)}</td>
              <td className="text-right tabular-nums">{count(day.duplicates)}</td>
            </tr>
          ))}
        </tbody>
      </table>, 6)}
    </TableCard>}
    </div>
  </div>;
}

/** Leads no partner account submitted (API posts, agency imports), so the team rows add up to Sent. */
function UnattributedRow({ metrics }: { metrics: PartnerQualityPeriodMetrics }) {
  return <tr>
    <td className="whitespace-nowrap" title="API posts or agency imports">Other sources</td>
    <td>—</td>
    <td className="text-right tabular-nums">{count(metrics.sent)}</td>
    <td className="text-right tabular-nums">{count(metrics.submitted)}</td>
    <td className="text-right tabular-nums">{rate(metrics.conversion_rate, metrics.sent)}</td>
    <td>—</td>
  </tr>;
}
