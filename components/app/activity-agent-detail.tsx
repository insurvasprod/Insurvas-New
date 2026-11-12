"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { Download } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { BarList, LineSeries, type BarListRow } from "@/components/ui/chart";
import { ActiveFilters, DataToolbar, RefreshButton, ToolbarSearch } from "@/components/ui/data-toolbar";
import { EmptyState, ErrorState, NoMatches, SectionLoading } from "@/components/ui/page-states";
import { Pager, paginate } from "@/components/ui/pager";
import { StatStrip, StatTile } from "@/components/ui/stat";
import { StatusChip } from "@/components/ui/status-chip";
import { TableCard } from "@/components/ui/table-card";
import { ViewTabs } from "@/components/ui/view-tabs";
import { useShow } from "@/components/ui/view-switch";
import { useFittingPageSize } from "@/components/ui/use-fitting-page-size";
import { Callout } from "@/components/app/settings/primitives";
import { LogRow, humanize, type LogEntry } from "@/components/app/activity-log-workspace";
import { ActivityChartCard } from "@/components/app/activity/activity-chart-card";
import { RecordStepper, neighboursOf } from "@/components/app/accounting/record-stepper";
import { PeriodPicker, lastDays, type Period } from "@/components/app/reports/period-picker";
import { ReportsSlot, useReportsTitle, useUrlTab } from "@/components/app/reports/reports-slot";
import { keepSharedPeriod } from "@/lib/reports/views";
import { showHref } from "@/lib/reports/show";
import { contactsOf, mayReviewZeroClick, type ActivityReport, type ActivityWeek, type ActivityWeeks, type ScorecardRow } from "@/lib/activityLog/types";
import { load as loadResource, peek, readResource, seed } from "@/lib/client/resource-cache";

/**
 * Reports › Team activity › an agent (foundation pass 2026-11-03, docs/reports/FOUNDATION-PASS.md; Reports round 7,
 * owner pick 2·5, 2026-11-11). The title is the person, with one line of facts; ‹ › on the title line name the agents
 * either side in the Agents order (dials, most first). Tabs: their calls (the log, newest first, paged on the server),
 * how those calls ended, and, for a setter, their days (the old day-by-day Setters rows). A record page opens on the
 * table; the Table · Chart switch draws the calls as their week (dials and contacts), the outcomes as horizontal bars
 * (no donut: owner 2026-11-11) and the days as booked against showed. The cards stay, each with its week as a
 * sparkline. Read-only: opening it writes nothing. A setter reaching it sees only their own rows (the report pins it).
 */
const TABS = ["calls", "outcomes", "days"] as const;
const DAY = 86_400_000;

type SetterDays = {
  scope: "team" | "own";
  rows: Array<{ userId: string; name: string; day: string; dials: number; contacts: number; booked: number; showed: number; noShow: number; pending: number; neverClosedOut: number; closedOut: number; closeable: number }>;
  roster: Array<{ userId: string; name: string; role: string; timezone: string; localLabel: string; onShiftNow: boolean; hasHours?: boolean }>;
};

function isoRange(period: Period) {
  const from = new Date(`${period.from}T00:00:00`);
  const to = new Date(`${period.to}T00:00:00`);
  to.setDate(to.getDate() + 1);
  return { from: from.toISOString(), to: to.toISOString() };
}

/** One agent's activity page, as the app's cache keys it (lib/client/resource-cache.ts). */
function agentActivityKey(agentId: string, period: Period, page: number, pageSize: number, q: string, disposition = "") {
  const range = isoRange(period);
  const params = new URLSearchParams({ agent_id: agentId, from: range.from, to: range.to, page: String(page), page_size: String(pageSize) });
  if (q) params.set("q", q);
  if (disposition) params.set("disposition", disposition);
  return `/api/app/activity?${params}`;
}

const count = (value: number) => value.toLocaleString("en-US");
const percent = (part: number, whole: number) => (whole > 0 ? Math.round((part / whole) * 1000) / 10 : null);
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const dayLabel = (day: string) => { const [, month, date] = day.split("-").map(Number); return `${date} ${MONTHS[(month || 1) - 1]}`; };

export function ActivityAgentDetail({ agentId, role, initialPeriod }: { agentId: string; role: string; initialPeriod: Period | null }) {
  const router = useRouter();
  const query = useSearchParams();
  const reviews = mayReviewZeroClick(role);
  const { tab, href: tabHref } = useUrlTab(TABS, "calls");
  const show = useShow("table");
  const charts = show === "chart";
  const [period, setPeriod] = useState<Period>(() => initialPeriod ?? lastDays(30));
  // A link into this page (a week's point, the Agents chart) changes ?from&to; follow it while rendering.
  const periodKey = initialPeriod ? `${initialPeriod.from}|${initialPeriod.to}` : "";
  const [seenPeriod, setSeenPeriod] = useState(periodKey);
  if (periodKey !== seenPeriod) { setSeenPeriod(periodKey); if (initialPeriod) setPeriod(initialPeriod); }
  // An outcome's bar opens the calls with that outcome (?disposition=).
  const disposition = (query.get("disposition") ?? "").slice(0, 120);
  const [search, setSearch] = useState("");
  const [debounced, setDebounced] = useState("");
  const [page, setPage] = useState(1);
  const [daysPage, setDaysPage] = useState(1);
  const pageSize = useFittingPageSize(480, 41);
  const [report, setReport] = useState<ActivityReport | null>(() => seed<ActivityReport>(agentActivityKey(agentId, period, 1, pageSize, "", disposition))?.data ?? null);
  const [loading, setLoading] = useState(() => !seed(agentActivityKey(agentId, period, 1, pageSize, "", disposition))?.data);
  const [error, setError] = useState("");
  const [weeks, setWeeks] = useState<ActivityWeek[] | null>(null);
  const [team, setTeam] = useState<ScorecardRow[] | null>(null);
  const [days, setDays] = useState<SetterDays | null>(null);

  useEffect(() => {
    const timer = window.setTimeout(() => { setDebounced(search.trim()); setPage(1); }, 250);
    return () => window.clearTimeout(timer);
  }, [search]);

  const key = useMemo(() => agentActivityKey(agentId, period, page, pageSize, debounced, disposition), [agentId, period, page, pageSize, debounced, disposition]);
  // The outcome mix is the whole window's, never one outcome's: read without the outcome filter.
  const mixKey = useMemo(() => agentActivityKey(agentId, period, 1, 1, ""), [agentId, period]);
  const range = isoRange(period);
  const weeksKey = `/api/app/activity?${new URLSearchParams({ series: "weeks", agent_id: agentId, from: range.from, to: range.to })}`;
  // The Agents order, for ‹ ›: the team's scorecard over the same window (a setter's has only themselves).
  const teamKey = `/api/app/activity?${new URLSearchParams({ from: range.from, to: range.to, page: "1", page_size: "1", blocked: "0" })}`;

  const load = useCallback(async (fresh = false) => {
    setLoading(true); setError("");
    try {
      const body = await (fresh ? loadResource<ActivityReport>(key) : readResource<ActivityReport>(key));
      setReport(body);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not load this agent's activity");
    } finally {
      setLoading(false);
    }
  }, [key]);
  useEffect(() => {
    const kept = peek<ActivityReport>(key);
    // eslint-disable-next-line react-hooks/set-state-in-effect -- the kept answer, read from storage after hydration
    if (kept?.data) setReport((current) => current ?? kept.data ?? null);
    void load();
  }, [key, load]);

  // The side reads: the mix (when an outcome filter narrows the calls), the week, the team's order, the setter's days.
  // Each fails quietly: the page still shows the calls without it.
  const [mixReport, setMixReport] = useState<ActivityReport | null>(null);
  const rangeFrom = range.from;
  const loadSide = useCallback((fresh = false) => {
    const read = <T,>(k: string) => (fresh ? loadResource<T>(k) : readResource<T>(k));
    // A setter's days: the setter report reaches back from today far enough to cover the window's start.
    const daysKey = `/api/app/scorecard?days=${Math.min(180, Math.max(1, Math.ceil((Date.now() - Date.parse(rangeFrom)) / DAY)))}`;
    if (disposition) void read<ActivityReport>(mixKey).then(setMixReport, () => setMixReport(null));
    else setMixReport(null);
    void read<ActivityWeeks>(weeksKey).then((body) => setWeeks(body.weeks), () => setWeeks(null));
    void read<ActivityReport>(teamKey).then((body) => setTeam(body.scorecard), () => setTeam(null));
    void read<SetterDays>(daysKey).then(setDays, () => setDays(null));
  }, [disposition, mixKey, weeksKey, teamKey, rangeFrom]);
  useEffect(() => { loadSide(); }, [loadSide]);

  const row = (disposition ? mixReport : report)?.scorecard.find((item) => item.agent_user_id === agentId) ?? null;
  const name = row?.agent_name ?? (report ? "Agent" : null);
  const zeroClick = Number(row?.zero_click ?? 0);
  // "unlogged" counts served cards nobody logged: a fact of its own, not an outcome in the mix.
  const mix = useMemo(() => Object.entries(row?.disposition_breakdown ?? {}).filter(([key, value]) => value > 0 && key !== "unlogged").sort((a, b) => b[1] - a[1]), [row]);
  const unlogged = Number(row?.disposition_breakdown?.unlogged ?? 0);
  const mixTotal = mix.reduce((sum, [, value]) => sum + value, 0);
  const contacts = row ? contactsOf(row) : 0;

  const dayRows = useMemo(() => (days?.rows ?? []).filter((item) => item.userId === agentId && item.day >= period.from && item.day <= period.to).sort((a, b) => b.day.localeCompare(a.day)), [days, agentId, period]);
  const member = days?.roster.find((item) => item.userId === agentId) ?? null;
  const setter = dayRows.length > 0 || Boolean(member && member.role === "setter");
  const shift = member ? (member.hasHours === false ? "no hours set" : member.onShiftNow ? "on shift" : "off shift") : null;
  const facts = row
    ? [member ? `${member.localLabel} (${member.timezone})` : null, shift, `${count(row.served)} served`, `${count(row.clicked)} dialled`, `contact rate ${row.contact_rate_percent == null ? "—" : `${row.contact_rate_percent}%`}`, `${count(row.callbacks_booked)} callbacks booked, ${count(row.callbacks_kept)} kept`, `${count(row.applications_submitted)} applications submitted`].filter(Boolean).join(" · ")
    : undefined;
  useReportsTitle(name, facts);

  // ‹ ›: the agents either side in the Agents order (dials, most first), each named, on the same window.
  const ordered = useMemo(() => [...(team ?? [])].filter((item) => item.agent_user_id).sort((a, b) => b.clicked - a.clicked || b.served - a.served || (a.agent_name ?? "").localeCompare(b.agent_name ?? "")), [team]);
  const { previous, next } = neighboursOf(ordered, agentId, (item) => item.agent_user_id ?? "");
  const periodQuery = `from=${period.from}&to=${period.to}`;
  const neighbour = (item: ScorecardRow | null) => (item?.agent_user_id ? { href: `/app/activity/agent/${item.agent_user_id}?${periodQuery}${tab !== "calls" ? `&tab=${tab}` : ""}${show === "chart" ? "&show=chart" : ""}`, label: item.agent_name ?? "Unknown agent" } : null);

  const entries = useMemo<LogEntry[]>(() => {
    const served: LogEntry[] = (report?.rows ?? []).map((item) => ({ kind: "served", at: Date.parse(item.served_at), row: item }));
    const blocked: LogEntry[] = (report?.blocked ?? []).map((item) => ({ kind: "blocked", at: Date.parse(item.at), row: item }));
    return [...served, ...blocked].sort((a, b) => b.at - a.at);
  }, [report]);

  const changePeriod = (nextPeriod: Period) => { setPeriod(nextPeriod); setPage(1); setDaysPage(1); keepSharedPeriod(nextPeriod); };
  const exportHref = `/api/app/activity?${new URLSearchParams({ agent_id: agentId, from: range.from, to: range.to, format: "csv", ...(disposition ? { disposition } : {}) })}`;
  const logHref = `/app/activity?view=log&agent=${agentId}&${periodQuery}`;
  const reviewHref = `/app/activity?view=review&agent=${agentId}&${periodQuery}`;
  /** The table view of a tab here, optionally narrowed (an outcome, a week). */
  const tableHref = (target: (typeof TABS)[number], extra?: Record<string, string | null>) => showHref(tabHref(target), "table", extra);
  const weekHref = (key: string) => { const week = weeks?.find((item) => item.key === key); return week ? tableHref("calls", { from: week.fromDay, to: week.toDay, disposition: null }) : null; };
  const spark = (pick: (week: ActivityWeek) => number) => (weeks && weeks.length > 1 ? { points: weeks.map(pick), tone: "primary" as const, placement: "under" as const } : undefined);

  const toolbar = (
    <DataToolbar actions={<RefreshButton onClick={() => { void load(true); loadSide(true); }} refreshing={loading} />}>
      {tab === "calls" && !charts && <ToolbarSearch value={search} onChange={setSearch} placeholder="Search leads" />}
      <PeriodPicker value={period} onChange={changePeriod} presets={["7", "30", "90"]} />
    </DataToolbar>
  );
  const outcomeFilter = tab === "calls" && disposition
    ? <ActiveFilters filters={[{ key: "disposition", label: "Outcome", value: humanize(disposition), onRemove: () => { setPage(1); router.replace(showHref(tabHref("calls"), show, { disposition: null }), { scroll: false }); } }]} onClear={() => router.replace(showHref(tabHref("calls"), show, { disposition: null }), { scroll: false })} />
    : undefined;

  if (!report && error) return <TableCard><ErrorState title="This agent's activity did not load" detail={error} action={<Button variant="outline" onClick={() => void load()}>Try again</Button>} /></TableCard>;

  const daysSlice = paginate(dayRows, daysPage, pageSize);
  const outcomeRows: BarListRow[] = mix.map(([key, value]) => ({ key, label: humanize(key), value, caption: `${Math.round((value / mixTotal) * 100)}%`, href: tableHref("calls", { disposition: key }) }));

  return (
    <>
      <ReportsSlot slot="lead"><ViewTabs label="Agent views" value={tab} idPrefix="agent-view" tabs={[
        { key: "calls" as const, label: "Calls", count: disposition ? null : report?.total ?? null },
        { key: "outcomes" as const, label: "How the calls ended" },
        ...(setter ? [{ key: "days" as const, label: "Days", count: dayRows.length || null }] : []),
      ].map((item) => ({ ...item, href: tabHref(item.key) }))} /></ReportsSlot>
      {/* ‹ › name the neighbours; then at most two buttons (owner 2026-11-02): the flags to review, and the calls as a file. */}
      <ReportsSlot slot="corner">
        <RecordStepper previous={neighbour(previous)} next={neighbour(next)} noun="agent" />
        {reviews && zeroClick > 0 ? <Button asChild variant="outline"><Link href={reviewHref}>Review {zeroClick.toLocaleString()} {zeroClick === 1 ? "flag" : "flags"}</Link></Button> : null}
        <Button asChild variant="outline"><a href={exportHref}><Download aria-hidden="true" />Export calls</a></Button>
      </ReportsSlot>
      {error && <Callout tone="error" title="Activity did not reload">{error}</Callout>}

      {/* The cards stay (owner pick 0·C), each with this agent's week as a sparkline; plain figures, a problem in one chip. */}
      <StatStrip label={`${name ?? "Agent"} totals`}>
        <StatTile label="Served" value={row ? row.served.toLocaleString() : "…"} trend={spark((week) => week.served)} footnote={row ? `${Math.max(0, row.served - row.clicked).toLocaleString()} never dialled` : undefined} href={tabHref("calls")} />
        <StatTile label="Contact rate" value={row?.contact_rate_percent == null ? "—" : row.contact_rate_percent} unit={row?.contact_rate_percent == null ? undefined : "%"} trend={spark((week) => percent(week.contacts, week.dials) ?? 0)} footnote={row ? `${row.clicked.toLocaleString()} dialled · ${contacts.toLocaleString()} contacts` : undefined} href={tabHref("outcomes")} />
        {reviews && <StatTile label="Logged without a dial" value={row?.zero_click == null ? "—" : zeroClick.toLocaleString()} trend={spark((week) => week.zeroClick ?? 0)} footnote={zeroClick > 0 ? <StatusChip tone="danger">To review</StatusChip> : "outcomes with no Dial press"} href={zeroClick > 0 ? reviewHref : undefined} />}
        <StatTile label="Callbacks" value={row ? row.callbacks_booked.toLocaleString() : "…"} trend={spark((week) => week.callbacks)} footnote={row ? `booked · ${row.callbacks_kept.toLocaleString()} kept` : undefined} />
        <StatTile label="Appointments" value={row ? row.appointments_booked.toLocaleString() : "…"} trend={spark((week) => week.booked)} footnote={row ? `booked · ${row.appointments_showed.toLocaleString()} showed` : undefined} href={setter ? tabHref("days") : undefined} />
      </StatStrip>

      {charts ? (
        <>
          <div className="flex flex-col gap-3">{toolbar}{outcomeFilter}</div>
          {tab === "calls" ? (
            <ActivityChartCard title={name ? `${name}’s week` : "The week"} period={[`${period.from} – ${period.to}`, "dials and contacts, by week"].join(" · ")} tableHref={tableHref("calls")}>
              {weeks?.length ? (
                <LineSeries
                  points={weeks.map((week) => ({ key: week.key, label: week.label, value: week.dials }))}
                  summary="Dials and contacts, by week"
                  unit="dials"
                  legend={{ label: "Dials", figure: count(weeks.reduce((sum, week) => sum + week.dials, 0)), href: tableHref("calls") }}
                  lines={[{ key: "contacts", label: "Contacts", points: weeks.map((week) => ({ key: week.key, label: week.label, value: week.contacts })), figure: count(weeks.reduce((sum, week) => sum + week.contacts, 0)), href: tableHref("outcomes") }]}
                  hrefFor={(point) => weekHref(point.key)}
                />
              ) : weeks ? <EmptyState title="No calls in this window" hint="Widen the period to see earlier weeks." /> : <SectionLoading rows={4} columns={1} label="Loading the week" />}
            </ActivityChartCard>
          ) : tab === "outcomes" ? (
            <ActivityChartCard title="How the calls ended" period={[`${period.from} – ${period.to}`, `${count(mixTotal)} logged`, unlogged ? `${count(unlogged)} never logged` : null].filter(Boolean).join(" · ")} tableHref={tableHref("outcomes")}>
              {mixTotal ? (
                <BarList
                  rows={outcomeRows}
                  summary="This agent's logged outcomes, most first; a bar opens the calls with that outcome"
                  unit="calls"
                  total={{ label: "Logged", figure: count(mixTotal), caption: unlogged ? `${count(unlogged)} never logged` : undefined, href: tableHref("calls", { disposition: null }) }}
                />
              ) : <EmptyState title="No outcomes logged in this window" hint="Outcomes show once this agent logs a call." />}
            </ActivityChartCard>
          ) : (
            <ActivityChartCard title="Booked and showed, by day" period={[`${period.from} – ${period.to}`, `${count(dayRows.reduce((sum, item) => sum + item.booked, 0))} booked · ${count(dayRows.reduce((sum, item) => sum + item.showed, 0))} showed`].join(" · ")} tableHref={tableHref("days")}>
              {dayRows.length ? (
                <LineSeries
                  points={[...dayRows].reverse().map((item) => ({ key: item.day, label: dayLabel(item.day), value: item.booked }))}
                  summary="Appointments booked and showed, by day"
                  unit="appointments"
                  legend={{ label: "Booked", href: tableHref("days") }}
                  lines={[{ key: "showed", label: "Showed", points: [...dayRows].reverse().map((item) => ({ key: item.day, label: dayLabel(item.day), value: item.showed })), href: tableHref("days") }]}
                  hrefFor={(point) => tableHref("days", { from: point.key, to: point.key })}
                />
              ) : <EmptyState title="No setter days in this window" hint="Dials, bookings and shows, day by day." />}
            </ActivityChartCard>
          )}
        </>
      ) : tab === "calls" ? (
        <TableCard
          toolbar={toolbar}
          filters={outcomeFilter}
          footer={<Pager page={page} total={report?.total ?? 0} pageSize={pageSize} noun="served leads" disabled={loading} onPage={setPage} suffix={<>newest first · a row opens the lead · <Link href={logHref} className="hover:underline">in the team&rsquo;s call log</Link></>} />}
        >
          {loading && !report ? <SectionLoading rows={6} columns={5} />
            : entries.length === 0 ? (debounced || disposition ? <NoMatches noun="served leads" onClear={() => { setSearch(""); if (disposition) router.replace(showHref(tabHref("calls"), show, { disposition: null }), { scroll: false }); }} /> : <EmptyState title="No calls in this window" hint="Widen the period to see earlier calls." />)
            : (
              <table className="portal-activity-table w-full min-w-[760px] text-left text-sm">
                <thead><tr><th scope="col">Served</th><th scope="col">Lead</th><th scope="col">Campaign</th><th scope="col">Outcome</th><th scope="col">Status</th></tr></thead>
                <tbody className="m-seq">
                  {entries.map((entry) => <LogRow key={`${entry.kind}-${entry.row.id}`} entry={entry} showAgent={false} />)}
                </tbody>
              </table>
            )}
        </TableCard>
      ) : tab === "outcomes" ? (
        <TableCard toolbar={toolbar} footer={<span>{mixTotal.toLocaleString()} logged {mixTotal === 1 ? "outcome" : "outcomes"} in the window{unlogged ? ` · ${unlogged.toLocaleString()} served and never logged` : ""} · a row opens those calls</span>}>
          {!row && (loading || !mixReport) ? <SectionLoading rows={4} columns={3} />
            : mixTotal === 0 ? <EmptyState title="No outcomes logged in this window" hint="Outcomes show once this agent logs a call." />
            : (
              <table className="portal-lead-table w-full min-w-[480px] text-left text-sm">
                <thead><tr><th>Outcome</th><th className="text-right">Calls</th><th className="text-right">Of logged</th></tr></thead>
                <tbody className="m-seq">
                  {mix.map(([key, value]) => {
                    const href = tableHref("calls", { disposition: key });
                    return (
                      <tr key={key} className="m-row cursor-pointer" onClick={() => router.push(href)}>
                        <td className="font-medium"><Link href={href} className="hover:underline" onClick={(event) => event.stopPropagation()}>{humanize(key)}</Link></td>
                        <td className="text-right tabular-nums">{value.toLocaleString()}</td>
                        <td className="text-right tabular-nums">{Math.round((value / mixTotal) * 100)}%</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            )}
        </TableCard>
      ) : (
        <TableCard
          toolbar={toolbar}
          footer={dayRows.length ? <Pager page={daysSlice.current} total={dayRows.length} pageSize={pageSize} noun="days" onPage={setDaysPage} suffix="newest first" /> : <span>{`${period.from} – ${period.to}`}</span>}
        >
          {!days ? <SectionLoading rows={4} columns={6} label="Loading the setter's days" />
            : dayRows.length === 0 ? <EmptyState title="No setter days in this window" hint="Dials, bookings and shows, day by day." />
            : (
              <table className="portal-activity-table w-full min-w-[640px] text-left text-sm">
                <thead><tr><th>Day</th><th className="text-right">Dials</th><th className="text-right">Contacts</th><th className="text-right">Booked</th><th className="text-right">Showed</th><th>Status</th></tr></thead>
                <tbody className="m-seq">
                  {daysSlice.rows.map((item) => (
                    <tr key={item.day} className="m-row" title={`${item.closedOut.toLocaleString()} of ${item.closeable.toLocaleString()} closed out`}>
                      <td className="whitespace-nowrap font-medium tabular-nums">{item.day}</td>
                      <td className="text-right tabular-nums">{count(item.dials)}</td>
                      <td className="text-right tabular-nums">{count(item.contacts)}</td>
                      <td className="text-right tabular-nums">{count(item.booked)}</td>
                      <td className="text-right tabular-nums">{count(item.showed)}</td>
                      <td className="whitespace-nowrap">{item.neverClosedOut ? <StatusChip tone="danger">{item.neverClosedOut.toLocaleString()} overdue</StatusChip> : item.pending ? <StatusChip tone="warning">{item.pending.toLocaleString()} pending</StatusChip> : <StatusChip>Clear</StatusChip>}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
        </TableCard>
      )}
      {!row && !loading && report && !disposition && <Card className="px-4"><EmptyState title="No activity for this agent in this window" hint="Widen the period, or open the team's call log." action={<Button variant="outline" asChild><Link href={logHref}>Open the call log</Link></Button>} /></Card>}
    </>
  );
}
