"use client";

import { useCallback, useEffect, useMemo, useState, type ReactNode } from "react";
import Link from "next/link";
import { ChevronLeft, Download } from "lucide-react";
import { Button } from "@/components/ui/button";
import { DataToolbar, RefreshButton, ToolbarSearch, toolbarControl } from "@/components/ui/data-toolbar";
import { PageHeader } from "@/components/ui/page-header";
import { PageLoading } from "@/components/ui/page-loading";
import { EmptyState, ErrorState, NoMatches, SectionLoading } from "@/components/ui/page-states";
import { StatStrip, StatTile } from "@/components/ui/stat";
import { TableCard } from "@/components/ui/table-card";
import { defaultPartnerQualityPeriod, percentChange, percentOf, pointChange, screeningFlags } from "@/lib/partnerQuality/metrics";
import type { PartnerQualityDetail, PartnerQualityDetailLead, PartnerQualityMember, PartnerQualityMetric, PartnerQualityPeriodMetrics } from "@/lib/partnerQuality/types";
import { count, dateText, dispositionText, downloadCsv, humanize, MetricCell, metricLabel, paginate, Pager, partnerTypeLabel, percent, PeriodInputs, periodQuery, periodText, Prior, productText, useDrilldown, type Period } from "./partner-quality-parts";

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

export function PartnerQualityDetailWorkspace({ partnerId, initialPeriod }: { partnerId: string; initialPeriod?: Period | null }) {
  const [period, setPeriod] = useState<Period>(() => initialPeriod ?? defaultPartnerQualityPeriod());
  const [data, setData] = useState<PartnerQualityDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [search, setSearch] = useState("");
  const [filter, setFilter] = useState<LeadFilter>("all");
  const [leadPage, setLeadPage] = useState(1);
  const [dayPage, setDayPage] = useState(1);
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
  const back = <Link href={backHref} className="inline-flex w-fit items-center gap-1.5 text-sm font-semibold tracking-[-0.01em] text-muted-foreground transition-colors hover:text-foreground"><ChevronLeft className="size-4" aria-hidden="true" />Partner quality</Link>;

  if (loading && !data) return <PageLoading />;
  if (!data) return <div className="flex flex-col gap-6">{back}<PageHeader title="Partner quality" /><ErrorState detail={error || "Could not load this partner"} action={<Button variant="outline" onClick={() => void load(period)}>Try again</Button>} /></div>;

  const active: Period = { from: data.from, to: data.to };
  const now = data.current;
  const prev = data.previous;
  const name = data.partner.name;
  const open = (metric: PartnerQualityMetric, extra: { disposition?: string; member?: PartnerQualityMember } = {}) => drilldown.open({
    label: `${extra.member?.name ?? name} · ${extra.disposition ? dispositionText(extra.disposition, labels) : metricLabel(metric)}`,
    partnerId: data.partner.id, metric, period: active, disposition: extra.disposition, partnerUserId: extra.member?.user_id,
  });
  const { current: leadCurrent, rows: leadRows } = paginate(shownLeads, leadPage);
  const { current: dayCurrent, rows: dayRows } = paginate(data.daily, dayPage);
  const section = (content: ReactNode, columns = 4) => loading ? <SectionLoading rows={4} columns={columns} /> : content;

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
  ];

  return <div className="m-stagger portal-partner-quality-page flex flex-col gap-6">
    {back}
    <PageHeader title={name} description={`${partnerTypeLabel(data.partner.partner_type)} · ${periodText(active)}`} />

    <StatStrip label={`${name} totals`}>
      <StatTile label="Sent" value={count(now.sent)} delta={countDelta(now.sent, prev.sent)} footnote={`prev ${count(prev.sent)}`} />
      <StatTile label="Claimed" value={count(now.claimed)} delta={countDelta(now.claimed, prev.claimed)} footnote={`prev ${count(prev.claimed)}`} />
      <StatTile label="Worked" value={count(now.worked)} delta={countDelta(now.worked, prev.worked)} footnote={`prev ${count(prev.worked)}`} />
      <StatTile label="Submitted" value={count(now.submitted)} delta={countDelta(now.submitted, prev.submitted)} footnote={`prev ${count(prev.submitted)}`} />
      <StatTile label="Conversion" value={rate(now.conversion_rate, now.sent)} delta={rateDelta(now.conversion_rate, prev.conversion_rate)} footnote={`prev ${rate(prev.conversion_rate, prev.sent)}`} />
      <StatTile label="Screening" labelTitle="Screening pass rate: sent leads with no TCPA, DNC or invalid-phone flag" value={rate(now.screening_pass_rate, now.sent)} valueTone={now.screening_pass_rate != null && now.screening_pass_rate < 90 ? "warning" : undefined} delta={rateDelta(now.screening_pass_rate, prev.screening_pass_rate)} footnote={`prev ${rate(prev.screening_pass_rate, prev.sent)}`} />
      <StatTile label="Duplicates" value={count(now.duplicates)} delta={countDelta(now.duplicates, prev.duplicates, "down")} footnote={`prev ${count(prev.duplicates)}`} />
      <StatTile label="DQ %" value={rate(now.disqualification_rate, now.sent)} delta={rateDelta(now.disqualification_rate, prev.disqualification_rate, "down")} footnote={`prev ${rate(prev.disqualification_rate, prev.sent)}`} />
    </StatStrip>

    <TableCard
      title="Leads sent"
      toolbar={<>
        <DataToolbar actions={<>
          <Button type="button" variant="outline" onClick={exportLeads} disabled={shownLeads.length === 0}><Download aria-hidden="true" />Export</Button>
          <RefreshButton onClick={() => void load(period)} refreshing={loading} />
        </>}>
          <ToolbarSearch value={search} onChange={(value) => { setSearch(value); setLeadPage(1); }} placeholder="Search leads" />
          <PeriodInputs value={active} onChange={changePeriod} />
          <select aria-label="Show leads" className={toolbarControl} value={filter} onChange={(event) => { setFilter(event.target.value as LeadFilter); setLeadPage(1); }}>
            {LEAD_FILTERS.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
          </select>
        </DataToolbar>
        {error && <p role="alert" className="w-full text-sm text-destructive">{error}</p>}
      </>}
      footer={<Pager page={leadCurrent} total={shownLeads.length} noun="leads" onPage={setLeadPage} suffix={data.leads_truncated ? `newest ${count(data.leads.length)} of ${count(now.sent)} listed` : undefined} />}
    >
      {section(data.leads.length === 0
        ? <EmptyState title="No leads in this period" hint="Widen the period to see earlier leads." />
        : shownLeads.length === 0
          ? <NoMatches noun="leads" onClear={() => { setSearch(""); setFilter("all"); setLeadPage(1); }} />
          : <table className="portal-lead-table w-full min-w-[1080px] text-left text-sm">
              <thead><tr><th className="w-[120px]">Received</th><th>Customer</th><th className="w-[70px]">State</th><th>Product</th><th>Screening</th><th>Submitted by</th><th>Claimed by</th><th>Status</th><th className="w-[84px] text-right"><span className="sr-only">Open</span></th></tr></thead>
              <tbody className="m-seq">
                {leadRows.map((lead) => (
                  <tr key={lead.lead_id} className="m-row">
                    <td className="tabular-nums">{dateText(lead.date)}</td>
                    <td><span className="block font-semibold">{lead.full_name}</span><span className="block text-xs text-muted-foreground tabular-nums">{lead.phone ?? "No phone"}</span></td>
                    <td>{lead.state ?? "—"}</td>
                    <td>{productText(lead.product)}</td>
                    <td><span className={FLAGGED.has(lead.screening) || lead.screening === "Disqualified" ? "font-semibold text-[var(--warning-ink)]" : undefined}>{lead.screening}</span>{lead.duplicate && <span className="block text-xs text-muted-foreground">Duplicate</span>}</td>
                    <td>{lead.submitted_by ?? <span className="text-muted-foreground">—</span>}</td>
                    <td>{lead.agent_name ?? <span className="text-muted-foreground">Unclaimed</span>}</td>
                    <td>{leadStatus(lead, labels)}</td>
                    <td className="text-right"><Button asChild variant="outline" size="sm"><Link href={`/app/leads/${lead.lead_id}`} aria-label={`Open ${lead.full_name}`}>Open</Link></Button></td>
                  </tr>
                ))}
              </tbody>
            </table>, 6)}
    </TableCard>

    <div className="grid items-start gap-6 lg:grid-cols-2">
      <TableCard title="Outcomes">
        {section(now.sent === 0
          ? <EmptyState title="No outcomes" hint="Nothing was sent in this period." />
          : <table className="portal-lead-table w-full min-w-0! text-left text-sm">
              <thead><tr><th>Disposition</th><th className="w-[100px] text-right">Leads</th><th className="w-[110px] text-right">Of sent</th></tr></thead>
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
          <thead><tr><th>Result</th><th className="w-[100px] text-right">Leads</th><th className="w-[100px] text-right">Of sent</th><th className="w-[90px] text-right">Prev</th></tr></thead>
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
    </div>

    <TableCard title="Team">
      {section(data.team.length === 0 && data.unattributed.sent === 0
        ? <EmptyState title="No partner users" hint="This partner has no portal accounts." />
        : <table className="portal-lead-table w-full min-w-[980px] text-left text-sm">
            <thead><tr><th>Member</th><th>Role</th><th>Reports to</th><th className="w-[96px] text-right">Sent</th><th className="w-[100px] text-right">Claimed</th><th className="w-[96px] text-right">Worked</th><th className="w-[110px] text-right">Submitted</th><th className="w-[116px] text-right">Conversion</th></tr></thead>
            <tbody>
              {data.team.map((member) => (
                <tr key={member.id}>
                  <td><span className="block font-semibold">{member.name}</span><span className="block text-xs text-muted-foreground">{member.email}</span></td>
                  <td>{member.role === "partner_admin" ? "Partner admin" : "Partner user"}{member.status === "revoked" && <span className="block text-xs text-muted-foreground">Revoked</span>}</td>
                  <td>{member.role === "partner_admin" ? "—" : member.partner_admin_name ?? "Unassigned"}</td>
                  <td className="text-right"><MetricCell label={`${member.name}: sent ${member.sent}; open leads`} onClick={() => open("sent", { member })}>{count(member.sent)}</MetricCell><Prior label="Sent" value={count(member.previous.sent)} /></td>
                  <td className="text-right"><MetricCell label={`${member.name}: claimed ${member.claimed}; open leads`} onClick={() => open("claimed", { member })}>{count(member.claimed)}</MetricCell><Prior label="Claimed" value={count(member.previous.claimed)} /></td>
                  <td className="text-right"><MetricCell label={`${member.name}: worked ${member.worked}; open leads`} onClick={() => open("worked", { member })}>{count(member.worked)}</MetricCell><Prior label="Worked" value={count(member.previous.worked)} /></td>
                  <td className="text-right"><MetricCell label={`${member.name}: submitted ${member.submitted}; open leads`} onClick={() => open("submitted", { member })}>{count(member.submitted)}</MetricCell><Prior label="Submitted" value={count(member.previous.submitted)} /></td>
                  <td className="text-right tabular-nums">{rate(member.conversion_rate, member.sent)}<Prior label="Conversion" value={rate(member.previous.conversion_rate, member.previous.sent)} /></td>
                </tr>
              ))}
              {data.unattributed.sent > 0 && <UnattributedRow metrics={data.unattributed} />}
            </tbody>
          </table>, 6)}
    </TableCard>

    <div className="grid items-start gap-6 lg:grid-cols-2">
      <TableCard title="By agent">
        {section(data.agents.length === 0
          ? <EmptyState title="No leads claimed yet" hint="Agents appear here once they claim this partner's leads." />
          : <table className="portal-lead-table w-full min-w-0! text-left text-sm">
              <thead><tr><th>Agent</th><th className="w-[80px] text-right">Leads</th><th className="w-[84px] text-right">Worked</th><th className="w-[100px] text-right">Submitted</th><th className="w-[110px] text-right">Conversion</th></tr></thead>
              <tbody>
                {data.agents.map((agent) => (
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
      </TableCard>

      <TableCard title="Daily volume" footer={<Pager page={dayCurrent} total={data.daily.length} noun="days" onPage={setDayPage} />}>
        {section(<table className="portal-lead-table w-full min-w-0! text-left text-sm">
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
      </TableCard>
    </div>
    {drilldown.drawer}
  </div>;
}

/** Leads no partner account submitted (API posts, agency imports), so the team rows add up to Sent. */
function UnattributedRow({ metrics }: { metrics: PartnerQualityPeriodMetrics }) {
  return <tr className="text-muted-foreground">
    <td>Other sources<span className="block text-xs">API or agency import</span></td>
    <td>—</td>
    <td>—</td>
    <td className="text-right tabular-nums"><span className="px-1">{count(metrics.sent)}</span></td>
    <td className="text-right tabular-nums"><span className="px-1">{count(metrics.claimed)}</span></td>
    <td className="text-right tabular-nums"><span className="px-1">{count(metrics.worked)}</span></td>
    <td className="text-right tabular-nums"><span className="px-1">{count(metrics.submitted)}</span></td>
    <td className="text-right tabular-nums">{rate(metrics.conversion_rate, metrics.sent)}</td>
  </tr>;
}
