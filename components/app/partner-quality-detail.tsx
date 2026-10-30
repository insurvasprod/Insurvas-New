"use client";

import { useCallback, useEffect, useMemo, useState, type ReactNode } from "react";
import Link from "next/link";
import { Download } from "lucide-react";
import { Button } from "@/components/ui/button";
import { ClearFiltersButton, DataToolbar, RefreshButton, ToolbarSearch, toolbarControl } from "@/components/ui/data-toolbar";
import { PageHeader } from "@/components/ui/page-header";
import { PageLoading } from "@/components/ui/page-loading";
import { EmptyState, ErrorState, NoMatches, SectionLoading } from "@/components/ui/page-states";
import { StatStrip, StatTile } from "@/components/ui/stat";
import { TableCard } from "@/components/ui/table-card";
import { defaultPartnerQualityPeriod, percentChange, percentOf, pointChange, screeningFlags } from "@/lib/partnerQuality/metrics";
import type { PartnerQualityDetail, PartnerQualityDetailLead, PartnerQualityMember, PartnerQualityMetric, PartnerQualityPeriodMetrics } from "@/lib/partnerQuality/types";
import { count, dateText, dispositionText, downloadCsv, humanize, MetricCell, metricLabel, paginate, Pager, partnerTypeLabel, percent, PeriodInputs, periodQuery, periodText, Prior, productText, useDrilldown, type Period } from "./partner-quality-parts";
import { FILL_CARD, useFittingRows } from "./use-fitting-rows";
import { ViewTabs } from "@/components/ui/view-tabs";

/** The partner's sections, one at a time (2026-10-06 redesign: five stacked tables became tabs). */
type DetailTab = "leads" | "outcomes" | "team" | "agents" | "daily";

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

function leadStatus(lead: PartnerQualityDetailLead, labels: Record<string, string>) {
  if (lead.disposition) return dispositionText(lead.disposition, labels);
  if (lead.submitted) return "Submitted";
  return lead.queue_status ? humanize(lead.queue_status) : "Not queued";
}

function shortDate(value: string) { return new Intl.DateTimeFormat(undefined, { month: "short", day: "numeric", weekday: "short", timeZone: "UTC" }).format(new Date(`${value}T00:00:00Z`)); }

function rate(value: number | null, sent: number) { return sent ? percent(value) : "—"; }

/** Count tiles compare as a percent change; rate tiles as percentage points. */
function countDelta(current: number, previous: number, goodWhen: "up" | "down" = "up") { const value = percentChange(current, previous); return value == null ? undefined : { value, goodWhen }; }
function rateDelta(current: number | null, previous: number | null, goodWhen: "up" | "down" = "up") { const value = pointChange(current, previous); return value == null ? undefined : { value, unit: " pts", goodWhen }; }

/**
 * `embedded`: shown as the Quality tab of the partner's own record (2026-10-25, Module 1 simplified):
 * the record already names the partner, so the back link and the title are left out here.
 */
export function PartnerQualityDetailWorkspace({ partnerId, initialPeriod, embedded = false }: { partnerId: string; initialPeriod?: Period | null; embedded?: boolean }) {
  const [period, setPeriod] = useState<Period>(() => initialPeriod ?? defaultPartnerQualityPeriod());
  const [data, setData] = useState<PartnerQualityDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [search, setSearch] = useState("");
  const [filter, setFilter] = useState<LeadFilter>("all");
  const [leadPage, setLeadPage] = useState(1);
  const [dayPage, setDayPage] = useState(1);
  const [teamPage, setTeamPage] = useState(1);
  const [agentPage, setAgentPage] = useState(1);
  const [tab, setTab] = useState<DetailTab>("leads");
  // Back link, header, strip, tab row, toolbar, column heads and pager around the rows.
  const pageSize = useFittingRows(480, 45);
  const drilldown = useDrilldown(data?.disposition_labels);

  const load = useCallback(async (next: Period) => {
    setLoading(true); setError("");
    try {
      const response = await fetch(`/api/app/partner-quality/${partnerId}?${periodQuery(next)}`, { cache: "no-store" });
      const body = await response.json().catch(() => null);
      if (!response.ok) setError(body?.error ?? "Could not load this partner"); else setData(body);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Could not load this partner");
    } finally {
      setLoading(false);
    }
  }, [partnerId]);
  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(() => { void load(period); }, [period, load]);

  function changePeriod(next: Period) {
    setPeriod(next); setLeadPage(1); setDayPage(1);
    try { window.history.replaceState(null, "", `?${periodQuery(next)}`); } catch { /* not fatal */ }
  }

  const labels = useMemo(() => data?.disposition_labels ?? {}, [data]);
  const shownLeads = useMemo(() => {
    if (!data) return [];
    const needle = search.trim().toLowerCase();
    return data.leads.filter((lead) => matchesFilter(lead, filter) && (!needle || [lead.full_name, lead.phone, lead.state, lead.product, lead.agent_name, lead.submitted_by, leadStatus(lead, labels)].some((value) => value?.toLowerCase().includes(needle))));
  }, [data, filter, search, labels]);

  const backHref = `/app/partner-quality?${periodQuery(period)}`;
  // The way back is the trail above the title (owner 2026-10-30), keeping the period.
  const trail = (current: string) => [{ label: "Reports" }, { label: "Partner quality", href: backHref }, { label: current }];

  if (loading && !data) return <PageLoading />;
  if (!data) return <div className="flex flex-col gap-6"><PageHeader title="Partner" breadcrumbs={trail("Partner")} /><ErrorState detail={error || "Could not load this partner"} action={<Button variant="outline" onClick={() => void load(period)}>Try again</Button>} /></div>;

  const active: Period = { from: data.from, to: data.to };
  const now = data.current;
  const prev = data.previous;
  const name = data.partner.name;
  const open = (metric: PartnerQualityMetric, extra: { disposition?: string; member?: PartnerQualityMember } = {}) => drilldown.open({
    label: `${extra.member?.name ?? name} · ${extra.disposition ? dispositionText(extra.disposition, labels) : metricLabel(metric)}`,
    partnerId: data.partner.id, metric, period: active, disposition: extra.disposition, partnerUserId: extra.member?.user_id,
  });
  const { current: leadCurrent, rows: leadRows } = paginate(shownLeads, leadPage, pageSize);
  const { current: dayCurrent, rows: dayRows } = paginate(data.daily, dayPage, pageSize);
  const { current: teamCurrent, pages: teamPages, rows: teamRows } = paginate(data.team, teamPage, pageSize);
  const { current: agentCurrent, rows: agentRows } = paginate(data.agents, agentPage, pageSize);
  const section = (content: ReactNode, columns = 4) => loading ? <SectionLoading rows={4} columns={columns} /> : content;
  const leadsFiltered = filter !== "all" || search.trim() !== "";
  const clearLeadFilters = () => { setSearch(""); setFilter("all"); setLeadPage(1); };

  function exportLeads() {
    downloadCsv(`${name.replace(/[^a-z0-9]+/gi, "-").toLowerCase()}-leads-${active.from}-to-${active.to}.csv`,
      ["Received", "Customer", "Phone", "State", "Product", "Screening", "Duplicate", "Submitted by", "Claimed by", "Status"],
      shownLeads.map((lead) => [lead.date, lead.full_name, lead.phone, lead.state, lead.product, lead.screening, lead.duplicate ? "Yes" : "No", lead.submitted_by, lead.agent_name, leadStatus(lead, labels)]));
  }

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
  const tabs: { key: DetailTab; label: string; count?: number }[] = [
    { key: "leads", label: "Leads sent", count: data.leads.length },
    { key: "outcomes", label: "Outcomes & screening" },
    { key: "team", label: "Team", count: data.team.length },
    { key: "agents", label: "By agent", count: data.agents.length },
    { key: "daily", label: "Daily volume" },
  ];
  const fill = `${FILL_CARD} min-h-[calc(100dvh-var(--top-bar-h)-362px)]`;

  return <div className="m-stagger flex w-full min-w-0 flex-col gap-6">
    {embedded ? <p className="m-0 text-sm leading-[1.5] text-muted-foreground">{periodText(active)}</p> : <PageHeader title={name} breadcrumbs={trail(name)} description={`${partnerTypeLabel(data.partner.partner_type)} · ${periodText(active)}`} />}

    {/* Four figures (2026-10-06 redesign): claimed and worked ride on Sent's footnote, duplicates
        on DQ's. Every count is still in the Team and Daily tabs, and opens its leads there. */}
    <StatStrip label={`${name} totals`}>
      <StatTile label="Sent" value={count(now.sent)} delta={countDelta(now.sent, prev.sent)} footnote={`prev ${count(prev.sent)} · ${count(now.claimed)} claimed · ${count(now.worked)} worked`} />
      <StatTile label="Conversion" value={rate(now.conversion_rate, now.sent)} delta={rateDelta(now.conversion_rate, prev.conversion_rate)} footnote={`${count(now.submitted)} submitted · prev ${rate(prev.conversion_rate, prev.sent)}`} />
      <StatTile label="Screening" labelTitle="Screening pass rate: sent leads with no TCPA, DNC or invalid-phone flag" value={rate(now.screening_pass_rate, now.sent)} valueTone={now.screening_pass_rate != null && now.screening_pass_rate < 90 ? "warning" : undefined} delta={rateDelta(now.screening_pass_rate, prev.screening_pass_rate)} footnote={`prev ${rate(prev.screening_pass_rate, prev.sent)}`} />
      <StatTile label="DQ %" value={rate(now.disqualification_rate, now.sent)} delta={rateDelta(now.disqualification_rate, prev.disqualification_rate, "down")} footnote={`${count(now.duplicates)} duplicates · prev ${rate(prev.disqualification_rate, prev.sent)}`} />
    </StatStrip>

    {/* Sections as tabs on the left, the period (which every tab reads) on the right. */}
    <div className="flex flex-wrap items-center justify-between gap-3">
      <ViewTabs label="Partner sections" tabs={tabs} value={tab} onChange={setTab} idPrefix="partner-tab" controls="partner-view" />
      <div className="flex flex-wrap items-center gap-2">
        <PeriodInputs value={active} onChange={changePeriod} />
        <RefreshButton onClick={() => void load(period)} refreshing={loading} />
      </div>
    </div>
    {error && <p role="alert" className="text-sm text-destructive">{error}</p>}

    {/* The selected section, as the tab panel: it fades in when the tab changes (2026-10-09). */}
    <div key={tab} role="tabpanel" id="partner-view" aria-labelledby={`partner-tab-${tab}`} className="flex min-w-0 flex-col gap-6">
    {tab === "leads" && <TableCard
      className={fill}
      toolbar={
        <DataToolbar actions={<>
          {leadsFiltered && <ClearFiltersButton onClick={clearLeadFilters} />}
          <Button type="button" variant="outline" onClick={exportLeads} disabled={shownLeads.length === 0}><Download aria-hidden="true" />Export</Button>
        </>}>
          <ToolbarSearch value={search} onChange={(value) => { setSearch(value); setLeadPage(1); }} placeholder="Search leads" />
          <select aria-label="Show leads" className={toolbarControl} value={filter} onChange={(event) => { setFilter(event.target.value as LeadFilter); setLeadPage(1); }}>
            {LEAD_FILTERS.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
          </select>
        </DataToolbar>
      }
      footer={<Pager page={leadCurrent} total={shownLeads.length} pageSize={pageSize} noun="leads" onPage={setLeadPage} suffix={data.leads_truncated ? `newest ${count(data.leads.length)} of ${count(now.sent)} listed` : undefined} />}
    >
      {section(data.leads.length === 0
        ? <EmptyState title="No leads in this period" hint="Widen the period to see earlier leads." />
        : shownLeads.length === 0
          ? <NoMatches noun="leads" onClear={clearLeadFilters} />
          : <table className="portal-lead-table w-full min-w-[1180px] text-left text-sm">
              <thead><tr><th>Received</th><th>Customer</th><th>Phone</th><th>State</th><th>Product</th><th>Screening</th><th>Duplicate</th><th>Submitted by</th><th>Claimed by</th><th>Status</th><th className="text-right"><span className="sr-only">Open</span></th></tr></thead>
              <tbody className="m-seq">
                {leadRows.map((lead) => (
                  <tr key={lead.lead_id} className="m-row">
                    <td className="whitespace-nowrap tabular-nums">{dateText(lead.date)}</td>
                    <td className="max-w-[220px]"><span className="block truncate font-semibold" title={lead.full_name}>{lead.full_name}</span></td>
                    <td className="whitespace-nowrap tabular-nums text-muted-foreground">{lead.phone ?? "No phone"}</td>
                    <td>{lead.state ?? "—"}</td>
                    <td className="whitespace-nowrap">{productText(lead.product)}</td>
                    <td className="whitespace-nowrap"><span className={FLAGGED.has(lead.screening) || lead.screening === "Disqualified" ? "font-semibold text-[var(--warning-ink)]" : undefined}>{lead.screening}</span></td>
                    <td>{lead.duplicate ? "Duplicate" : <span className="text-muted-foreground">—</span>}</td>
                    <td className="max-w-[180px] truncate" title={lead.submitted_by ?? undefined}>{lead.submitted_by ?? <span className="text-muted-foreground">—</span>}</td>
                    <td className="max-w-[180px] truncate" title={lead.agent_name ?? undefined}>{lead.agent_name ?? <span className="text-muted-foreground">Unclaimed</span>}</td>
                    <td className="whitespace-nowrap">{leadStatus(lead, labels)}</td>
                    <td className="text-right"><Button asChild variant="outline" size="sm"><Link href={`/app/leads/${lead.lead_id}`} aria-label={`Open ${lead.full_name}`}>Open</Link></Button></td>
                  </tr>
                ))}
              </tbody>
            </table>, 6)}
    </TableCard>}

    {tab === "outcomes" && <div className="grid items-start gap-6 lg:grid-cols-2">
      <TableCard title="Outcomes">
        {section(now.sent === 0
          ? <EmptyState title="No outcomes" hint="Nothing was sent in this period." />
          : <table className="portal-lead-table w-full min-w-0! text-left text-sm">
              <thead><tr><th>Disposition</th><th className="text-right">Leads</th><th className="text-right">Of sent</th></tr></thead>
              <tbody>
                {data.dispositions.map((item) => (
                  <tr key={item.key}>
                    <td>{dispositionText(item.key, labels)}</td>
                    <td className="text-right"><MetricCell label={`${dispositionText(item.key, labels)}: ${item.count}; open leads`} onClick={() => open("disposition", { disposition: item.key })}>{count(item.count)}</MetricCell></td>
                    <td className="text-right tabular-nums">{percent(percentOf(item.count, now.sent))}</td>
                  </tr>
                ))}
                {now.sent - dispositioned > 0 && <tr><td className="text-muted-foreground">No outcome yet</td><td className="text-right tabular-nums">{count(now.sent - dispositioned)}</td><td className="text-right tabular-nums">{percent(percentOf(now.sent - dispositioned, now.sent))}</td></tr>}
              </tbody>
            </table>, 3)}
      </TableCard>

      <TableCard title="Screening">
        {section(<table className="portal-lead-table w-full min-w-0! text-left text-sm">
          <thead><tr><th>Result</th><th className="text-right">Leads</th><th className="text-right">Of sent</th><th className="text-right">Prev</th></tr></thead>
          <tbody>
            {screeningRows.map((row) => (
              <tr key={row.label}>
                <td>{row.label}</td>
                <td className="text-right">{row.metric ? <MetricCell label={`${row.label}: ${row.value}; open leads`} onClick={() => open(row.metric!)}>{count(row.value)}</MetricCell> : <span className="px-1 tabular-nums">{count(row.value)}</span>}</td>
                <td className="text-right tabular-nums">{rate(percentOf(row.value, now.sent), now.sent)}</td>
                <td className="text-right tabular-nums text-muted-foreground">{count(row.prior)}</td>
              </tr>
            ))}
          </tbody>
        </table>, 4)}
      </TableCard>
    </div>}

    {tab === "team" && <TableCard className={fill} footer={data.team.length ? <Pager page={teamCurrent} total={data.team.length} pageSize={pageSize} noun="members" onPage={setTeamPage} /> : undefined}>
      {section(data.team.length === 0 && data.unattributed.sent === 0
        ? <EmptyState title="No partner users" hint="Invite them from the partner's record." action={<Button asChild variant="outline"><Link href={`/app/publishers/${data.partner.id}`}>Open partner</Link></Button>} />
        : <table className="portal-lead-table w-full min-w-[1180px] text-left text-sm">
            <thead><tr><th>Member</th><th>Email</th><th>Role</th><th>Access</th><th>Reports to</th><th className="text-right">Sent</th><th className="text-right">Claimed</th><th className="text-right">Worked</th><th className="text-right">Submitted</th><th className="text-right">Conversion</th></tr></thead>
            <tbody>
              {teamRows.map((member) => (
                <tr key={member.id}>
                  <td className="max-w-[200px]"><span className="block truncate font-semibold" title={member.name}>{member.name}</span></td>
                  <td className="max-w-[220px] truncate text-muted-foreground" title={member.email ?? undefined}>{member.email}</td>
                  <td className="whitespace-nowrap">{member.role === "partner_admin" ? "Partner admin" : "Partner user"}</td>
                  <td className="whitespace-nowrap">{member.status === "revoked" ? <span className="text-muted-foreground">Revoked</span> : "Active"}</td>
                  <td className="whitespace-nowrap">{member.role === "partner_admin" ? "—" : member.partner_admin_name ?? "Unassigned"}</td>
                  <td className="text-right"><MetricCell label={`${member.name}: sent ${member.sent}; open leads`} onClick={() => open("sent", { member })}>{count(member.sent)}</MetricCell><Prior label="Sent" value={count(member.previous.sent)} /></td>
                  <td className="text-right"><MetricCell label={`${member.name}: claimed ${member.claimed}; open leads`} onClick={() => open("claimed", { member })}>{count(member.claimed)}</MetricCell><Prior label="Claimed" value={count(member.previous.claimed)} /></td>
                  <td className="text-right"><MetricCell label={`${member.name}: worked ${member.worked}; open leads`} onClick={() => open("worked", { member })}>{count(member.worked)}</MetricCell><Prior label="Worked" value={count(member.previous.worked)} /></td>
                  <td className="text-right"><MetricCell label={`${member.name}: submitted ${member.submitted}; open leads`} onClick={() => open("submitted", { member })}>{count(member.submitted)}</MetricCell><Prior label="Submitted" value={count(member.previous.submitted)} /></td>
                  <td className="text-right tabular-nums">{rate(member.conversion_rate, member.sent)}<Prior label="Conversion" value={rate(member.previous.conversion_rate, member.previous.sent)} /></td>
                </tr>
              ))}
              {data.unattributed.sent > 0 && teamCurrent === teamPages && <UnattributedRow metrics={data.unattributed} />}
            </tbody>
          </table>, 6)}
    </TableCard>}

    {tab === "agents" && <TableCard className={fill} footer={data.agents.length ? <Pager page={agentCurrent} total={data.agents.length} pageSize={pageSize} noun="agents" onPage={setAgentPage} /> : undefined}>
      {section(data.agents.length === 0
        ? <EmptyState title="No leads claimed yet" hint="Agents appear here once they claim this partner's leads." />
        : <table className="portal-lead-table w-full min-w-[640px] text-left text-sm">
            <thead><tr><th>Agent</th><th className="text-right">Leads</th><th className="text-right">Worked</th><th className="text-right">Submitted</th><th className="text-right">Conversion</th></tr></thead>
            <tbody>
              {agentRows.map((agent) => (
                <tr key={agent.user_id}>
                  <td className="font-semibold">{agent.name}</td>
                  <td className="text-right tabular-nums">{count(agent.leads)}</td>
                  <td className="text-right tabular-nums">{count(agent.worked)}</td>
                  <td className="text-right tabular-nums">{count(agent.submitted)}</td>
                  <td className="text-right tabular-nums">{percent(agent.conversion_rate)}</td>
                </tr>
              ))}
            </tbody>
          </table>, 5)}
    </TableCard>}

    {tab === "daily" && <TableCard className={fill} footer={<Pager page={dayCurrent} total={data.daily.length} pageSize={pageSize} noun="days" onPage={setDayPage} />}>
      {section(<table className="portal-lead-table w-full min-w-[720px] text-left text-sm">
        <thead><tr><th>Date</th><th className="text-right">Sent</th><th className="text-right">Claimed</th><th className="text-right">Worked</th><th className="text-right">Submitted</th><th className="text-right">Flagged</th><th className="text-right">Dupes</th></tr></thead>
        <tbody>
          {dayRows.map((day) => (
            <tr key={day.date} className={day.sent === 0 ? "text-muted-foreground" : undefined}>
              <td className="tabular-nums">{shortDate(day.date)}</td>
              <td className="text-right tabular-nums">{count(day.sent)}</td>
              <td className="text-right tabular-nums">{count(day.claimed)}</td>
              <td className="text-right tabular-nums">{count(day.worked)}</td>
              <td className="text-right tabular-nums">{count(day.submitted)}</td>
              <td className="text-right tabular-nums">{count(day.flagged)}</td>
              <td className="text-right tabular-nums">{count(day.duplicates)}</td>
            </tr>
          ))}
        </tbody>
      </table>, 7)}
    </TableCard>}
    </div>
    {drilldown.drawer}
  </div>;
}

/** Leads no partner account submitted (API posts, agency imports), so the team rows add up to Sent. */
function UnattributedRow({ metrics }: { metrics: PartnerQualityPeriodMetrics }) {
  return <tr className="text-muted-foreground">
    <td className="whitespace-nowrap">Other sources</td>
    <td>API or agency import</td>
    <td>—</td>
    <td>—</td>
    <td>—</td>
    <td className="text-right tabular-nums"><span className="px-1">{count(metrics.sent)}</span></td>
    <td className="text-right tabular-nums"><span className="px-1">{count(metrics.claimed)}</span></td>
    <td className="text-right tabular-nums"><span className="px-1">{count(metrics.worked)}</span></td>
    <td className="text-right tabular-nums"><span className="px-1">{count(metrics.submitted)}</span></td>
    <td className="text-right tabular-nums">{rate(metrics.conversion_rate, metrics.sent)}</td>
  </tr>;
}
