"use client";

import { useCallback, useEffect, useMemo, useState, type ReactNode } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Download } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { BarList, BarSeries, LineSeries, type BarListRow, type LinePoint } from "@/components/ui/chart";
import { ActiveFilters, DataToolbar, FilterButton, FilterField, FilterPanel, RefreshButton, ToolbarSearch, toolbarControl, type ActiveFilter } from "@/components/ui/data-toolbar";
import { PageHeader } from "@/components/ui/page-header";
import { PageLoading } from "@/components/ui/page-loading";
import { FramedLoading } from "@/components/app/reports/reports-slot";
import { EmptyState, NoMatches, SectionLoading } from "@/components/ui/page-states";
import { StatStrip, StatTile } from "@/components/ui/stat";
import { StatusChip, type StatusTone } from "@/components/ui/status-chip";
import { TableCard } from "@/components/ui/table-card";
import { ViewTabs } from "@/components/ui/view-tabs";
import { useShow } from "@/components/ui/view-switch";
import { Callout } from "@/components/app/settings/primitives";
import { InReportsSlot, ReportsSlot, useUrlTab } from "@/components/app/reports/reports-slot";
import { ActivityChartCard } from "@/components/app/activity/activity-chart-card";
import { keepSharedPeriod } from "@/lib/reports/views";
import { showHref } from "@/lib/reports/show";
import {
  contactsOf,
  formatSpan,
  mayReviewZeroClick,
  outcomeDetails,
  refusalLabel,
  weekKeyOfDay,
  weekLabel,
  zeroClickConcentration,
  type ActivityReport,
  type ActivityRow,
  type ActivityWeek,
  type ActivityWeeks,
  type BlockedDialRow,
  type ScorecardRow,
} from "@/lib/activityLog/types";
import { AppointmentCloseOutStrip, closeOutDay, closeOutDayLabel, type CloseOutRow } from "@/components/app/appointment-close-out-strip";
import { Pager, paginate } from "@/components/ui/pager";
import { useFittingPageSize } from "@/components/ui/use-fitting-page-size";
import { cn } from "@/lib/utils";
import { csvCellMinimal } from "@/lib/csv/cell";
import { load as loadResource, peek, readResource, seed } from "@/lib/client/resource-cache";

/**
 * Team activity (was Activity & scorecard; redesign 2026-10-26, owner pick A, canvas M2 · Outbound results). Five
 * tabs: Agents (the home), Call log, Setters, and two that are work, To review and Close out.
 *
 * Reports round 7 (owner pick 2·A, 2026-11-11, docs/la4/mockups-r7/reports.html §2): the report tabs open on their
 * chart, with the "Table · Chart" switch on the title line (`?show=`). To review and Close out are work: they have the
 * switch too (owner 2026-11-12, every Reports sub-page) but open on their table. Agents draws dials by agent as horizontal bars with contacts solid inside them, then the team's
 * week as a line; Call log is served and dialled by week; Setters is booked against showed, by setter and by week.
 * The cards stay, each with its figure's week as a sparkline (owner pick 0·C). Every bar, point and legend row opens
 * the rows behind it: an agent's page, or the table view for that week. Tables are one line a row, colour only in
 * the one status chip. Close out's decision is a dialog, not buttons in the row.
 *
 * Every figure names its comparison window, and nothing here is talk time: click-to-call hands the call to the
 * handset, so the platform never sees how long it lasted. Dials the product refused sit in the log as their own
 * "Blocked" rows, never counted as dials. The zero-click review is for owners and producers only, and a setter sees
 * only their own rows (the report pins that in SQL).
 */

type View = "activity" | "scorecard" | "integrity";
/** The five tabs. ?view= opens one: scorecard → Agents, integrity → To review, log → Call log. */
type Tab = "agents" | "log" | "setters" | "review" | "closeout";
const TAB_KEYS: Tab[] = ["agents", "log", "setters", "review", "closeout"];
const TAB_ALIAS: Record<string, Tab> = { scorecard: "agents", integrity: "review", activity: "log" };
type IntegrityFilter = "any" | "zero_click_disposition";
type Range = "7" | "30" | "90" | "custom";
type SetterReport = {
  scope: "team" | "own";
  rows: Array<{ userId: string; name: string; day: string; dials: number; contacts: number; booked: number; showed: number; noShow: number; pending: number; neverClosedOut: number; sold: number; showRatePct: number | null; closedOut: number; closeable: number; coveragePct: number | null; bookPerContactPct: number | null }>;
  roster: Array<{ userId: string; name: string; role: string; timezone: string; localLabel: string; onShiftNow: boolean; hasHours?: boolean }>;
};
type RosterMember = SetterReport["roster"][number];
/** One setter over the whole period (was one row a setter a day; the days are the setter's page). */
type SetterLine = { userId: string; name: string; dials: number; contacts: number; booked: number; showed: number; neverClosedOut: number; member: RosterMember | null };

/** The setter scorecard's read, as the app's cache keys it (lib/client/resource-cache.ts). */
const scorecardKey = (days: number) => `/api/app/scorecard?days=${days}`;
const DAY = 86_400_000;
const RANGE_LABEL: Record<Exclude<Range, "custom">, string> = { "7": "Last 7 days", "30": "Last 30 days", "90": "Last 90 days" };
const FLAG_LABEL: Record<string, string> = {
  zero_click_disposition: "Logged without a dial",
  served_never_dispositioned: "Never logged",
  impossibly_fast_disposition: "Logged in under 5 seconds",
};

/** Read outside render so the window is fixed when it is chosen, not on every paint. */
function now() {
  return Date.now();
}

const count = (value: number) => value.toLocaleString("en-US");
const percent = (part: number, whole: number) => (whole > 0 ? Math.round((part / whole) * 1000) / 10 : null);
const dayOf = (ms: number) => { const d = new Date(ms); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`; };

/** A table on screen as a CSV file, with values that could run as a formula neutralised. */
function downloadCsv(name: string, header: string[], rows: Array<Array<string | number | null>>) {
  const body = [header, ...rows].map((row) => row.map(csvCellMinimal).join(",")).join("\n");
  const url = URL.createObjectURL(new Blob([body], { type: "text/csv;charset=utf-8" }));
  const link = document.createElement("a");
  link.href = url;
  link.download = name;
  link.click();
  URL.revokeObjectURL(url);
}

export function humanize(value: string) {
  const text = value.replace(/_/g, " ").trim();
  return text.charAt(0).toUpperCase() + text.slice(1);
}

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/**
 * "14:41" today, "23 Sep 14:41" before — the window spans weeks, so a bare time would be ambiguous.
 * Built by hand: some ICU versions write "Sept", which widens the column and wraps it.
 */
export function served(value: string) {
  const date = new Date(value);
  const time = `${String(date.getHours()).padStart(2, "0")}:${String(date.getMinutes()).padStart(2, "0")}`;
  return date.toDateString() === new Date().toDateString() ? time : `${date.getDate()} ${MONTHS[date.getMonth()]} ${time}`;
}

function totals(report: ActivityReport | null) {
  if (!report) return null;
  const served = report.scorecard.reduce((n, row) => n + row.served, 0);
  const dials = report.scorecard.reduce((n, row) => n + row.clicked, 0);
  const appointments = report.scorecard.reduce((n, row) => n + row.appointments_booked, 0);
  // Null until the report counts it per agent (20260925705100).
  const zeroClick = report.scorecard.some((row) => row.zero_click != null) ? report.scorecard.reduce((n, row) => n + Number(row.zero_click ?? 0), 0) : null;
  // Contacts per dial, the same measure as the scorecard's contact rate and the fresh/recycled table.
  // Per served lead it read as a fraction of that, because most served cards are never dialled.
  const recycleDials = report.recycle_performance.reduce((n, row) => n + row.clicked, 0);
  const contacts = report.recycle_performance.reduce((n, row) => n + row.contacts, 0);
  const contactRate = recycleDials > 0 ? Math.round((contacts / recycleDials) * 1000) / 10 : null;
  return { served, dials, appointments, contacts, contactRate, zeroClick, neverDialed: Math.max(0, served - dials), blocked: report.blocked_total };
}

/** The one chip on a served card's row: the one thing about it worth colour, or that it was logged. */
export function callStatus(row: ActivityRow): { tone: StatusTone; text: string } {
  if (row.on_internal_dnc) return { tone: "danger", text: "DNC" };
  if (row.integrity_flags.includes("zero_click_disposition")) return { tone: "danger", text: "No dial" };
  if (row.integrity_flags.includes("impossibly_fast_disposition")) return { tone: "warning", text: "Under 5 seconds" };
  if (!row.disposition) return { tone: "neutral", text: row.clicked_at ? "Never logged" : "Not dialled" };
  return { tone: "neutral", text: "Logged" };
}

/** What a row's tooltip carries: what the outcome led to, how long after the card it was logged, the attempt. */
function callTitle(row: ActivityRow) {
  const span = row.disposition ? formatSpan(row.open_to_log_seconds) : null;
  return [
    ...outcomeDetails(row),
    span ? `logged after ${span}` : null,
    row.clicked_at ? `dialled ${served(row.clicked_at)}` : null,
    row.attempt ? `attempt ${row.attempt}` : null,
    row.lead_state ? `state ${row.lead_state}` : null,
    ...row.integrity_flags.map((flag) => FLAG_LABEL[flag] ?? humanize(flag)),
  ].filter(Boolean).join(" · ") || undefined;
}

const leadHref = (leadId: string) => `/app/leads/${leadId}`;

/** One served card, or one refused dial, in the log's newest-first order. */
export type LogEntry = { kind: "served"; at: number; row: ActivityRow } | { kind: "blocked"; at: number; row: BlockedDialRow };

/**
 * A row of the log, one line (round 7): when it was served, whose it was, the lead, the campaign, the outcome, and
 * the one chip. The row opens the lead. What used to be columns of its own (led to, logged after, attempt, state)
 * is the row's tooltip and the lead's call. A refused dial is its own row: never a dial, its reason as the outcome.
 */
export function LogRow({ entry, showAgent = true }: { entry: LogEntry; showAgent?: boolean }) {
  const router = useRouter();
  const row = entry.row;
  const href = leadHref(row.lead_id);
  const blocked = entry.kind === "blocked";
  const status = entry.kind === "blocked" ? { tone: "warning" as const, text: "Blocked" } : callStatus(entry.row);
  const outcome = entry.kind === "blocked"
    ? [`${refusalLabel(entry.row.reason)}${entry.row.inbound ? " · inbound return call" : ""}`, entry.row.message].filter(Boolean).join(" · ")
    : entry.row.disposition ? humanize(entry.row.disposition) : "—";
  const at = entry.kind === "blocked" ? entry.row.at : entry.row.served_at;
  return (
    <tr className="m-row cursor-pointer" onClick={() => router.push(href)} title={entry.kind === "served" ? callTitle(entry.row) : outcome}>
      <td className="whitespace-nowrap font-medium tabular-nums">{served(at)}</td>
      {showAgent && <td className="max-w-[160px] truncate">{row.agent_name}</td>}
      <td className="max-w-[240px] truncate"><Link href={href} className="hover:underline" onClick={(event) => event.stopPropagation()}>{row.lead_name ?? "Unnamed lead"}</Link></td>
      <td className="max-w-[200px] truncate">{row.campaign_name ?? <span className="text-muted-foreground">—</span>}</td>
      <td className={cn("max-w-[220px] truncate", !blocked && outcome === "—" && "text-muted-foreground")}>{outcome}</td>
      <td className="whitespace-nowrap"><StatusChip tone={status.tone}>{status.text}</StatusChip></td>
    </tr>
  );
}

/** A flagged call on To review: whose, the lead, the outcome logged, when it was served, the flag, Review ›. */
function ReviewRow({ row }: { row: ActivityRow }) {
  const router = useRouter();
  const href = leadHref(row.lead_id);
  const flag = row.integrity_flags.includes("zero_click_disposition") ? { tone: "danger" as const, text: "No dial" }
    : row.integrity_flags.includes("impossibly_fast_disposition") ? { tone: "warning" as const, text: "Under 5 seconds" }
    : row.integrity_flags.includes("served_never_dispositioned") ? { tone: "warning" as const, text: "Never logged" }
    : callStatus(row);
  return (
    <tr className="m-row cursor-pointer" onClick={() => router.push(href)} title={callTitle(row)}>
      <td className="max-w-[160px] truncate font-medium">{row.agent_name}</td>
      <td className="max-w-[240px] truncate"><Link href={href} className="hover:underline" onClick={(event) => event.stopPropagation()}>{row.lead_name ?? "Unnamed lead"}</Link></td>
      <td className="max-w-[200px] truncate">{row.disposition ? humanize(row.disposition) : <span className="text-muted-foreground">—</span>}</td>
      <td className="whitespace-nowrap tabular-nums text-muted-foreground">{served(row.served_at)}</td>
      <td className="whitespace-nowrap"><StatusChip tone={flag.tone}>{flag.text}</StatusChip></td>
      <td className="whitespace-nowrap">Review ›</td>
    </tr>
  );
}

/** A week series as the kit's points. */
const points = (weeks: readonly { key: string; label: string }[], value: (index: number) => number): LinePoint[] => weeks.map((week, index) => ({ key: week.key, label: week.label, value: value(index) }));

/** The team's figures as the cards' sparklines: one point a week. */
function sparks(weeks: ActivityWeek[] | null) {
  if (!weeks || weeks.length < 2) return null;
  return {
    served: weeks.map((week) => week.served),
    dials: weeks.map((week) => week.dials),
    contactRate: weeks.map((week) => percent(week.contacts, week.dials) ?? 0),
    booked: weeks.map((week) => week.booked),
    started: weeks.map((week) => week.started),
  };
}

/**
 * `framed`: inside the Reports page (components/app/reports/reports-page.tsx), which draws the title; the tabs go to
 * its title line and Export to its corner. `initialPeriod`: the Reports views' shared period (`?from&to`), opened as a
 * custom range; a window picked here is kept in the address for the others, and a chart's week link sets it.
 *
 * Foundation pass (2026-11-03, docs/reports/FOUNDATION-PASS.md): an agent opens their own page
 * (/app/activity/agent/[agentId]) instead of a panel beside the table; the appointments to close out are their own
 * tab; agent, campaign and outcome sit in the Filters panel; the tab is in the address and each card opens its tab.
 */
export function ActivityLogWorkspace({ initialView = "agents", role = "", framed = false, initialPeriod = null, initialAgent = "" }: { initialView?: Tab; role?: string; framed?: boolean; initialPeriod?: { from: string; to: string } | null; initialAgent?: string } = {}) {
  const router = useRouter();
  const reviewsZeroClick = mayReviewZeroClick(role);
  const [range, setRange] = useState<Range>(initialPeriod ? "custom" : "30");
  // Set once mounted, not during render: the server and the browser would each read their own
  // "now", and the export link built from it would differ between the two (a hydration mismatch).
  const [anchor, setAnchor] = useState<number | null>(null);
  const [customFrom, setCustomFrom] = useState(initialPeriod?.from ?? "");
  const [customTo, setCustomTo] = useState(initialPeriod?.to ?? "");
  // Only a window the person picks here is shared; opening the page changes nothing.
  const [periodPicked, setPeriodPicked] = useState(false);
  const [search, setSearch] = useState("");
  const [debounced, setDebounced] = useState("");
  const [agentId, setAgentId] = useState(initialAgent);
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [campaignId, setCampaignId] = useState("");
  const [disposition, setDisposition] = useState("");
  const { tab, href: tabHref } = useUrlTab(TAB_KEYS, initialView, "view", TAB_ALIAS);
  // To review and Close out are work: they open on their table (app/app/(shell)/activity/page.tsx passes the same
  // default), and their chart is the queue's shape: whose, and when.
  const work = (tab === "review" || tab === "closeout") && reviewsZeroClick;
  const show = useShow(work ? "table" : "chart");
  const charts = show === "chart";
  // The report the page reads: the integrity review for its tab, the activity log for the call log,
  // the scorecard for the rest.
  const view: View = tab === "review" ? "integrity" : tab === "log" ? "activity" : "scorecard";
  const [integrityFilter, setIntegrityFilter] = useState<IntegrityFilter>("any");
  const zeroClickOnly = view === "integrity" && reviewsZeroClick && integrityFilter === "zero_click_disposition";
  const [page, setPage] = useState(1);
  const [setterPage, setSetterPage] = useState(1);
  const [closeOuts, setCloseOuts] = useState<number | null>(null);
  const pageSize = useFittingPageSize(480, 41);

  // A link into this page (a chart's week, an agent's "in the team's call log") changes ?from&to or ?agent=; follow
  // it. Adjusted while rendering, React's way of following a prop, so the read starts on the new window at once.
  const periodKey = initialPeriod ? `${initialPeriod.from}|${initialPeriod.to}` : "";
  const [seenPeriod, setSeenPeriod] = useState(periodKey);
  if (periodKey !== seenPeriod) {
    setSeenPeriod(periodKey);
    if (initialPeriod) { setRange("custom"); setCustomFrom(initialPeriod.from); setCustomTo(initialPeriod.to); setPage(1); }
  }
  const [seenAgent, setSeenAgent] = useState(initialAgent);
  if (initialAgent !== seenAgent) { setSeenAgent(initialAgent); setAgentId(initialAgent); setPage(1); }
  // A new tab starts on its first page with no flag chosen.
  const [seenTab, setSeenTab] = useState(tab);
  if (tab !== seenTab) { setSeenTab(tab); setIntegrityFilter("any"); setPage(1); setSetterPage(1); }

  const [report, setReport] = useState<ActivityReport | null>(null);
  const [prior, setPrior] = useState<ActivityReport | null>(null);
  const [inRange, setInRange] = useState<number | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [weeks, setWeeks] = useState<ActivityWeek[] | null>(null);
  // The setter scorecard's default window (30 days) starts from the kept answer; a custom window has no stable key.
  const [setters, setSetters] = useState<SetterReport | null>(() => (initialPeriod ? null : seed<SetterReport>(scorecardKey(30))?.data ?? null));
  const [settersError, setSettersError] = useState("");
  const [settersLoading, setSettersLoading] = useState(() => (initialPeriod ? true : !seed(scorecardKey(30))?.data));

  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(() => { setAnchor(now()); }, []);

  // Typing narrows the table once the person pauses, not on every keystroke.
  useEffect(() => {
    const timer = window.setTimeout(() => { setDebounced(search.trim()); setPage(1); }, 250);
    return () => window.clearTimeout(timer);
  }, [search]);

  // The appointments waiting for an outcome: Close out's count (owners and producers only, like the list).
  useEffect(() => {
    if (!reviewsZeroClick) return;
    const controller = new AbortController();
    void fetch("/api/app/appointments/close-out", { cache: "no-store", signal: controller.signal })
      .then((response) => (response.ok ? response.json() : null))
      .then((body) => { if (body && Array.isArray(body.appointments)) setCloseOuts(body.appointments.length); })
      .catch(() => undefined);
    return () => controller.abort();
  }, [reviewsZeroClick]);

  // The chosen window and the one of the same length immediately before it.
  const windows = useMemo(() => {
    if (range === "custom") {
      if (!customFrom || !customTo) return null;
      const from = new Date(`${customFrom}T00:00:00`).getTime();
      const to = new Date(`${customTo}T00:00:00`).getTime() + DAY;
      if (!(to > from)) return null;
      return { from, to, priorFrom: from - (to - from), days: Math.round((to - from) / DAY), label: `${customFrom} – ${customTo}` };
    }
    if (anchor == null) return null;
    const days = Number(range);
    return { from: anchor - days * DAY, to: anchor, priorFrom: anchor - 2 * days * DAY, days, label: RANGE_LABEL[range] };
  }, [range, anchor, customFrom, customTo]);

  // The picked window, as the day it starts and the day it ends, for the other Reports views.
  useEffect(() => {
    if (!framed || !periodPicked || !windows) return;
    keepSharedPeriod(range === "custom" ? { from: customFrom, to: customTo } : { from: dayOf(windows.from), to: dayOf(windows.to) });
  }, [framed, periodPicked, windows, range, customFrom, customTo]);

  const base = useMemo(() => {
    const params = new URLSearchParams();
    if (agentId) params.set("agent_id", agentId);
    if (campaignId) params.set("campaign_id", campaignId);
    if (disposition) params.set("disposition", disposition);
    return params;
  }, [agentId, campaignId, disposition]);

  const pageQuery = useMemo(() => {
    if (!windows) return null;
    const params = new URLSearchParams(base);
    params.set("from", new Date(windows.from).toISOString());
    params.set("to", new Date(windows.to).toISOString());
    if (debounced) params.set("q", debounced);
    if (view === "integrity") params.set("view", "integrity");
    if (zeroClickOnly) params.set("flag", "zero_click_disposition");
    params.set("page", String(page));
    params.set("page_size", String(pageSize));
    return params.toString();
  }, [base, windows, debounced, view, page, zeroClickOnly, pageSize]);

  const load = useCallback(async () => {
    if (!pageQuery || !windows) return;
    setLoading(true);
    setError("");
    const span = (from: number, to: number, extra: URLSearchParams) => {
      const params = new URLSearchParams(extra);
      params.set("from", new Date(from).toISOString());
      params.set("to", new Date(to).toISOString());
      params.set("page", "1");
      params.set("page_size", "1");
      // Only the totals are read from these two; the refused dials are not needed.
      params.set("blocked", "0");
      return params.toString();
    };
    try {
      const get = async (query: string) => {
        const response = await fetch(`/api/app/activity?${query}`, { cache: "no-store" });
        const body = await response.json().catch(() => null);
        if (!response.ok) throw new Error(body?.error ?? "Could not load activity");
        return body as ActivityReport;
      };
      // Three reads, together: this page, the same filters over the window before (for every
      // "vs" line), and the unfiltered count in this window (for "X of Y served leads").
      const [current, before, everything] = await Promise.all([
        get(pageQuery),
        get(span(windows.priorFrom, windows.from, base)),
        get(span(windows.from, windows.to, new URLSearchParams())),
      ]);
      setReport(current);
      setPrior(before);
      setInRange(everything.total);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not load activity");
    } finally {
      setLoading(false);
    }
  }, [pageQuery, windows, base]);

  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(() => { void load(); }, [load]);

  // The window by week (the line charts and the cards' sparklines): the same filters, read on the server.
  const weeksKey = useMemo(() => {
    if (!windows) return null;
    const params = new URLSearchParams(base);
    params.set("series", "weeks");
    params.set("from", new Date(windows.from).toISOString());
    params.set("to", new Date(windows.to).toISOString());
    return `/api/app/activity?${params}`;
  }, [base, windows]);
  const loadWeeks = useCallback(async (fresh = false) => {
    if (!weeksKey) return;
    try {
      const body = await (fresh ? loadResource<ActivityWeeks>(weeksKey) : readResource<ActivityWeeks>(weeksKey));
      setWeeks(body.weeks);
    } catch {
      // The charts and sparklines wait; the figures and tables still load.
      setWeeks(null);
    }
  }, [weeksKey]);
  useEffect(() => {
    if (!weeksKey) return;
    const kept = peek<ActivityWeeks>(weeksKey);
    // eslint-disable-next-line react-hooks/set-state-in-effect -- the kept answer, read from storage after hydration
    if (kept?.data) setWeeks(kept.data.weeks);
    void loadWeeks();
  }, [weeksKey, loadWeeks]);

  // The setter report counts days back from today, so a custom range asks for enough days to reach its
  // start and keeps only the days inside it (2026-10-26: the dates you picked, not "N days back").
  const setterDays = range === "custom" && windows && anchor != null ? Math.min(180, Math.max(1, Math.ceil((anchor - windows.from) / DAY))) : windows?.days ?? 30;
  const loadSetters = useCallback(async (fresh = false) => {
    setSettersLoading(true);
    setSettersError("");
    try {
      const key = scorecardKey(setterDays);
      const body = await (fresh ? loadResource<SetterReport>(key) : readResource<SetterReport>(key));
      setSetters(body);
    } catch (cause) {
      setSetters(null);
      setSettersError(cause instanceof Error ? cause.message : "Could not load setter scorecard");
    } finally {
      setSettersLoading(false);
    }
  }, [setterDays]);

  useEffect(() => {
    if (tab !== "setters") return;
    const kept = peek<SetterReport>(scorecardKey(setterDays));
    // eslint-disable-next-line react-hooks/set-state-in-effect -- the kept answer, read from storage after hydration
    if (kept?.data) setSetters((current) => current ?? kept.data ?? null);
    void loadSetters();
  }, [tab, setterDays, loadSetters]);

  const now_ = totals(report);
  const then = totals(prior);
  const windowWords = windows ? (range === "custom" ? `${windows.days} days before` : `prior ${windows.days} days`) : "";
  const vs = (value: number | null | undefined, unit = "") =>
    value == null ? "no earlier data" : `vs ${value.toLocaleString()}${unit} ${windowWords}`;
  const applications = report ? report.scorecard.reduce((n, row) => n + row.applications_started, 0) : null;
  const submitted = report ? report.scorecard.reduce((n, row) => n + row.applications_submitted, 0) : null;
  const applicationsBefore = prior ? prior.scorecard.reduce((n, row) => n + row.applications_started, 0) : null;
  const spark = sparks(weeks);

  const agents = useMemo(
    () => [...new Map((report?.scorecard ?? []).filter((row) => row.agent_user_id).map((row) => [row.agent_user_id!, row.agent_name ?? "Unknown agent"])).entries()],
    [report],
  );
  const campaigns = useMemo(
    () => [...new Map((report?.rows ?? []).filter((row) => row.campaign_id).map((row) => [row.campaign_id!, row.campaign_name ?? "Unnamed campaign"])).entries()],
    [report],
  );
  const dispositions = useMemo(
    () => [...new Set((report?.scorecard ?? []).flatMap((row) => Object.keys(row.disposition_breakdown ?? {})))].sort(),
    [report],
  );
  // The Agents order everywhere (the table, the bars, an agent page's ‹ ›): dials, most first.
  const scorecard = useMemo<ScorecardRow[]>(() => [...(report?.scorecard ?? [])].sort((a, b) => b.clicked - a.clicked || b.served - a.served || (a.agent_name ?? "").localeCompare(b.agent_name ?? "")), [report]);

  const filtered = Boolean(agentId || campaignId || disposition || debounced || search.trim() || integrityFilter !== "any");
  const clearAll = () => { setAgentId(""); setCampaignId(""); setDisposition(""); setSearch(""); setIntegrityFilter("any"); setPage(1); };
  const total = report?.total ?? 0;
  const noun = view === "integrity" ? (zeroClickOnly ? "outcomes logged without a dial" : "flagged events") : "served leads";

  const exportQuery = useMemo(() => {
    if (!windows) return "";
    const params = new URLSearchParams(base);
    params.set("from", new Date(windows.from).toISOString());
    params.set("to", new Date(windows.to).toISOString());
    if (debounced) params.set("q", debounced);
    if (view === "integrity") params.set("view", "integrity");
    if (zeroClickOnly) params.set("flag", "zero_click_disposition");
    params.set("format", "csv");
    return params.toString();
  }, [base, windows, debounced, view, zeroClickOnly]);

  // Served cards and refused dials, newest first. The report hands over only the refusals that
  // fall between this page's rows, so paging never shows one twice.
  const entries = useMemo<LogEntry[]>(() => {
    const served: LogEntry[] = (report?.rows ?? []).map((row) => ({ kind: "served", at: Date.parse(row.served_at), row }));
    const blocked: LogEntry[] = view === "activity" ? (report?.blocked ?? []).map((row) => ({ kind: "blocked", at: Date.parse(row.at), row })) : [];
    return [...served, ...blocked].sort((a, b) => b.at - a.at);
  }, [report, view]);
  const blockedShown = entries.filter((entry) => entry.kind === "blocked").length;
  const concentration = useMemo(() => zeroClickConcentration(report?.scorecard ?? []), [report]);

  const refresh = () => { void load(); void loadWeeks(true); if (tab === "setters") void loadSetters(true); };
  const inCustomRange = (day: string) => range !== "custom" || ((!customFrom || day >= customFrom) && (!customTo || day <= customTo));
  const setterRows = (setters?.rows ?? []).filter((row) => inCustomRange(row.day));
  const roster = setters?.scope === "team" ? setters.roster : [];
  // One line a setter for the period; Roster folded in (its shift is the chip, its local time the setter's page).
  const setterLines = useMemo<SetterLine[]>(() => {
    const byId = new Map<string, SetterLine>();
    const members = new Map(roster.map((member) => [member.userId, member]));
    for (const row of setterRows) {
      const line = byId.get(row.userId) ?? { userId: row.userId, name: row.name, dials: 0, contacts: 0, booked: 0, showed: 0, neverClosedOut: 0, member: members.get(row.userId) ?? null };
      line.dials += row.dials; line.contacts += row.contacts; line.booked += row.booked; line.showed += row.showed; line.neverClosedOut += row.neverClosedOut;
      byId.set(row.userId, line);
    }
    for (const member of roster) if (!byId.has(member.userId)) byId.set(member.userId, { userId: member.userId, name: member.name, dials: 0, contacts: 0, booked: 0, showed: 0, neverClosedOut: 0, member });
    return [...byId.values()].sort((a, b) => b.booked - a.booked || b.dials - a.dials || a.name.localeCompare(b.name));
  }, [setterRows, roster]);
  const setterSlice = paginate(setterLines, setterPage, pageSize);
  const windowLabel = range === "custom" && !windows ? "Choose a from and to date" : windows?.label;
  // An agent's page keeps the window on screen (the shared period), so their figures match these.
  const periodQuery = windows ? `from=${dayOf(windows.to - 1 - (windows.days - 1) * DAY)}&to=${dayOf(windows.to - 1)}` : "";
  const agentHref = (id: string, agentTab?: "calls" | "outcomes" | "days") => `/app/activity/agent/${id}${periodQuery || agentTab ? `?${[periodQuery, agentTab ? `tab=${agentTab}` : ""].filter(Boolean).join("&")}` : ""}`;
  /** A tab's link. Crossing between a report tab and a work tab drops ?show=, so each opens on its own default. */
  const openTab = (target: Tab) => {
    const href = tabHref(target);
    if (((target === "review" || target === "closeout") && reviewsZeroClick) === work) return href;
    const [path, search = ""] = href.split("?");
    const params = new URLSearchParams(search);
    params.delete("show");
    const rest = params.toString();
    return rest ? `${path}?${rest}` : path;
  };
  /** The table view of a tab, optionally narrowed to a week (a point's link) or an agent. */
  const tableHref = (target: Tab, extra?: Record<string, string | null>) => showHref(tabHref(target), "table", extra);
  const weekHref = (target: Tab, key: string) => {
    const week = weeks?.find((item) => item.key === key);
    return week ? tableHref(target, { from: week.fromDay, to: week.toDay }) : null;
  };
  const filterChips: ActiveFilter[] = [
    agentId ? { key: "agent", label: "Agent", value: agents.find(([id]) => id === agentId)?.[1] ?? "One agent", onRemove: () => { setAgentId(""); setPage(1); } } : null,
    campaignId ? { key: "campaign", label: "Campaign", value: campaigns.find(([id]) => id === campaignId)?.[1] ?? "One campaign", onRemove: () => { setCampaignId(""); setPage(1); } } : null,
    disposition ? { key: "disposition", label: "Outcome", value: humanize(disposition), onRemove: () => { setDisposition(""); setPage(1); } } : null,
  ].filter((chip): chip is ActiveFilter => Boolean(chip));

  /** "Export": the table's rows, in either view. The log and the flags come from the server, with every column. */
  function exportTable() {
    if (tab === "agents" && report) {
      downloadCsv("agents.csv", ["Agent", "Served", "Dialled", "Logged", "Worked", "Contact rate %", "Callbacks booked", "Callbacks kept", "Appointments booked", "Appointments showed", "Applications started", "Applications submitted", "Logged without a dial"],
        scorecard.map((row) => [row.agent_name ?? "Unknown agent", row.served, row.clicked, row.logged, row.worked ?? 0, row.contact_rate_percent, row.callbacks_booked, row.callbacks_kept, row.appointments_booked, row.appointments_showed, row.applications_started, row.applications_submitted, reviewsZeroClick ? row.zero_click ?? null : null]));
    } else if (tab === "setters") {
      downloadCsv("setters.csv", ["Setter", "Dials", "Contacts", "Booked", "Showed", "Show rate %", "Overdue close-outs", "Shift"],
        setterLines.map((line) => [line.name, line.dials, line.contacts, line.booked, line.showed, percent(line.showed, line.booked), line.neverClosedOut, line.member ? shiftLabel(line.member) : null]));
    }
  }
  const serverExport = tab === "log" || tab === "review";
  const exportButton = serverExport
    ? <Button asChild variant="outline"><a href={`/api/app/activity?${exportQuery}`}><Download aria-hidden="true" />Export</a></Button>
    : <Button type="button" variant="outline" onClick={exportTable} disabled={tab === "agents" ? !report?.scorecard.length : !setterLines.length}><Download aria-hidden="true" />Export</Button>;

  // First read of the page: the one loading look, header and all.
  if (loading && !report && !error) return framed ? <FramedLoading /> : <PageLoading />;

  const flagged = reviewsZeroClick ? now_?.zeroClick ?? 0 : 0;

  const toolbar = (
    <DataToolbar actions={<RefreshButton onClick={refresh} refreshing={loading || (tab === "setters" && settersLoading)} />}>
      {!charts && (tab === "log" || tab === "review") && <ToolbarSearch value={search} onChange={setSearch} placeholder="Search leads" />}
      <select
        aria-label="Period"
        className={toolbarControl}
        value={range}
        onChange={(event) => { setRange(event.target.value as Range); setAnchor(now()); setPage(1); setPeriodPicked(true); }}
      >
        <option value="7">Last 7 days</option>
        <option value="30">Last 30 days</option>
        <option value="90">Last 90 days</option>
        <option value="custom">Custom dates</option>
      </select>
      {range === "custom" && (
        <>
          <input type="date" aria-label="From" className={cn(toolbarControl, "w-[150px]")} value={customFrom} onChange={(event) => { setCustomFrom(event.target.value); setPage(1); setPeriodPicked(true); }} />
          <input type="date" aria-label="To" className={cn(toolbarControl, "w-[150px]")} value={customTo} onChange={(event) => { setCustomTo(event.target.value); setPage(1); setPeriodPicked(true); }} />
        </>
      )}
      {tab !== "setters" && tab !== "closeout" && <FilterButton open={filtersOpen} count={filterChips.length + (integrityFilter !== "any" ? 1 : 0)} controls="activity-filters" onClick={() => setFiltersOpen(!filtersOpen)} />}
    </DataToolbar>
  );
  const filters = tab === "setters" || tab === "closeout" ? undefined : <>
    <FilterPanel id="activity-filters" open={filtersOpen}>
      <FilterField label="Agent" htmlFor="activity-agent"><select id="activity-agent" className={toolbarControl} value={agentId} onChange={(event) => { setAgentId(event.target.value); setPage(1); }}>
        <option value="">All agents</option>
        {agents.map(([id, name]) => <option key={id} value={id}>{name}</option>)}
      </select></FilterField>
      <FilterField label="Campaign" htmlFor="activity-campaign"><select id="activity-campaign" className={toolbarControl} value={campaignId} onChange={(event) => { setCampaignId(event.target.value); setPage(1); }}>
        <option value="">All campaigns</option>
        {campaigns.map(([id, name]) => <option key={id} value={id}>{name}</option>)}
      </select></FilterField>
      <FilterField label="Outcome" htmlFor="activity-outcome"><select id="activity-outcome" className={toolbarControl} value={disposition} onChange={(event) => { setDisposition(event.target.value); setPage(1); }}>
        <option value="">All outcomes</option>
        {dispositions.map((key) => <option key={key} value={key}>{humanize(key)}</option>)}
      </select></FilterField>
      {tab === "review" && reviewsZeroClick && (
        <FilterField label="Flag" htmlFor="activity-flag"><select id="activity-flag" className={toolbarControl} value={integrityFilter} onChange={(event) => { setIntegrityFilter(event.target.value as IntegrityFilter); setPage(1); }}>
          <option value="any">All flags</option>
          <option value="zero_click_disposition">{`Logged without a dial${now_?.zeroClick != null ? ` · ${now_.zeroClick.toLocaleString()}` : ""}`}</option>
        </select></FilterField>
      )}
    </FilterPanel>
    <ActiveFilters filters={[...filterChips, ...(integrityFilter !== "any" ? [{ key: "flag", label: "Flag", value: "Logged without a dial", onRemove: () => { setIntegrityFilter("any"); setPage(1); } }] : [])]} onClear={clearAll} />
  </>;

  return (
    <div className="m-stagger flex flex-col gap-6">
      {framed
        ? <ReportsSlot slot="corner">{tab === "closeout" ? null : exportButton}</ReportsSlot>
        : <PageHeader title="Team activity" description="What each agent did, and how it turned out." actions={exportButton} />}

      {/* What waits on someone is a count on its tab, never a "Next step" line (UI-CONSISTENCY §3). */}
      {error && <Callout tone="error" title="Activity did not load">{error}</Callout>}

      {/* The cards stay (owner pick 0·C), each with its week as a sparkline; plain figures, a problem said in one chip.
          Each tile opens the tab its figure is read from (owner 2026-11-02: the tiles are the links). */}
      <StatStrip label="Activity totals">
        <StatTile
          label="Leads served"
          href={openTab("log")}
          value={loading || !now_ ? "…" : now_.served.toLocaleString()}
          trend={spark ? { points: spark.served, tone: "primary", placement: "under" } : undefined}
          footnote={<>{vs(then?.served)}{!loading && now_ && now_.served > 0 ? ` · ${now_.neverDialed.toLocaleString()} never dialled` : ""}</>}
        />
        <StatTile
          label="Dials"
          href={openTab(flagged > 0 ? "review" : "log")}
          value={loading || !now_ ? "…" : now_.dials.toLocaleString()}
          trend={spark ? { points: spark.dials, tone: "primary", placement: "under" } : undefined}
          footnote={<>{vs(then?.dials)}{!loading && now_ && (now_.blocked ?? 0) > 0 ? ` · ${(now_.blocked ?? 0).toLocaleString()} blocked` : ""}{!loading && flagged > 0 ? <StatusChip tone="danger" className="ml-1.5">{flagged.toLocaleString()} logged with no dial</StatusChip> : null}</>}
        />
        <StatTile label="Contact rate" href={openTab("agents")} value={loading || now_?.contactRate == null ? "—" : now_.contactRate} unit={loading || now_?.contactRate == null ? undefined : "%"} trend={spark ? { points: spark.contactRate, tone: "primary", placement: "under" } : undefined} footnote={vs(then?.contactRate, "%")} />
        <StatTile label="Appointments" href={openTab(reviewsZeroClick && closeOuts ? "closeout" : "setters")} value={loading || !now_ ? "…" : now_.appointments.toLocaleString()} trend={spark ? { points: spark.booked, tone: "primary", placement: "under" } : undefined} footnote={vs(then?.appointments)} />
        <StatTile label="Applications" href={openTab("agents")} value={loading || applications == null ? "…" : applications.toLocaleString()} trend={spark ? { points: spark.started, tone: "primary", placement: "under" } : undefined} footnote={<>{vs(applicationsBefore)}{!loading && submitted != null ? ` · ${submitted.toLocaleString()} submitted` : ""}</>} />
      </StatStrip>

      <InReportsSlot framed={framed} slot="lead">
        <ViewTabs
          label="Activity views"
          idPrefix="activity-view"
          value={tab}
          // Links, not buttons: the title line's Table · Chart switch is the server page's, and a work tab has none.
          tabs={[
            { key: "agents" as const, label: "Agents" },
            { key: "log" as const, label: "Call log" },
            { key: "setters" as const, label: "Setters" },
            ...(reviewsZeroClick ? [
              { key: "review" as const, label: "To review", count: flagged || null, tone: "danger" as const },
              { key: "closeout" as const, label: "Close out", count: closeOuts || null, tone: "danger" as const },
            ] : []),
          ].map((item) => ({ ...item, href: openTab(item.key) }))}
        />
      </InReportsSlot>

      <div role="tabpanel" aria-labelledby={`activity-view-${tab}`} className="flex min-w-0 flex-col gap-6">
      {tab === "closeout" && reviewsZeroClick ? (charts
        ? <CloseOutCharts setterHref={(id) => agentHref(id, "days")} tableHref={(extra) => tableHref("closeout", extra)} />
        : <AppointmentCloseOutStrip onCount={setCloseOuts} />) : charts ? (
        <>
          <div className="flex flex-col gap-3">{toolbar}{filters}</div>
          {tab === "agents" ? (
            <AgentsCharts
              scorecard={scorecard}
              weeks={weeks}
              totals={now_}
              loading={loading}
              windowLabel={windowLabel ?? ""}
              solo={role === "setter"}
              reviews={reviewsZeroClick}
              agentHref={agentHref}
              tableHref={tableHref}
              weekHref={weekHref}
            />
          ) : tab === "log" ? (
            <ActivityChartCard title="Served and dialled, by week" period={[windowLabel, now_ ? `${count(now_.served)} served · ${count(now_.dials)} dialled` : null].filter(Boolean).join(" · ")} tableHref={tableHref("log")}>
              {weeks?.length ? (
                <LineSeries
                  points={points(weeks, (i) => weeks[i].served)}
                  summary="Leads served and dialled, by week"
                  unit="leads"
                  legend={{ label: "Served", figure: now_ ? count(now_.served) : undefined, href: tableHref("log") }}
                  lines={[{ key: "dials", label: "Dialled", points: points(weeks, (i) => weeks[i].dials), figure: now_ ? count(now_.dials) : undefined, href: tableHref("agents") }]}
                  hrefFor={(point) => weekHref("log", point.key)}
                />
              ) : weeks ? <EmptyState title="No activity in this window" hint="Served leads show up here, week by week." /> : <SectionLoading rows={4} columns={1} label="Loading the week" />}
            </ActivityChartCard>
          ) : tab === "review" ? (
            <ReviewCharts scorecard={scorecard} weeks={weeks} loading={loading} windowLabel={windowLabel ?? ""} tableHref={tableHref} weekHref={weekHref} />
          ) : (
            <SettersCharts lines={setterLines} rows={setterRows} loading={settersLoading} error={settersError} windowLabel={windowLabel ?? ""} agentHref={agentHref} tableHref={tableHref("setters")} />
          )}
        </>
      ) : (
      <TableCard
        className="min-w-0"
        title={tab === "review" ? "Calls flagged" : undefined}
        // Whose they are, in one line under the title, not a red box over the table.
        description={tab === "review" && !loading && concentration.total > 0 ? `${concentration.total.toLocaleString()} ${concentration.total === 1 ? "outcome was" : "outcomes were"} logged without a Dial press${concentration.top ? (concentration.top.count === concentration.total ? `, all by ${concentration.top.name}` : `, ${concentration.top.count.toLocaleString()} of them by ${concentration.top.name}`) : ""}.` : undefined}
        toolbar={toolbar}
        filters={filters}
        footer={tab === "log" || tab === "review" ? (
          range === "custom" && !windows ? (
            <span>Choose a from and to date</span>
          ) : (
            <Pager
              page={page}
              total={total}
              pageSize={pageSize}
              noun={noun}
              disabled={loading}
              onPage={setPage}
              suffix={[
                inRange != null && inRange !== total ? `${inRange.toLocaleString()} served in the window` : null,
                "newest first",
                blockedShown > 0 ? `${blockedShown.toLocaleString()} blocked ${blockedShown === 1 ? "dial" : "dials"} between them, not counted` : null,
                "a row opens the lead",
              ].filter(Boolean).join(" · ")}
            />
          )
        ) : tab === "setters" && !settersLoading && setterLines.length > 0 ? (
          <Pager
            page={setterSlice.current}
            total={setterLines.length}
            pageSize={pageSize}
            noun="setters"
            onPage={setSetterPage}
            suffix={[windowLabel, setters?.scope === "own" ? "your own setter metrics" : null, "a row opens the setter's days"].filter(Boolean).join(" · ")}
          />
        ) : (
          <span>{windowLabel}{tab === "agents" && scorecard.length ? ` · ${scorecard.length.toLocaleString()} ${scorecard.length === 1 ? "agent" : "agents"} · served, callbacks and showed are on the agent's page · a row opens the agent` : ""}</span>
        )}
      >
        {tab === "setters" ? (
          <>
            {settersError && <Callout tone="error" title="Setter outcomes did not load">{settersError}</Callout>}
            {settersLoading ? (
              <SectionLoading rows={4} columns={6} label="Loading setter outcomes" />
            ) : setterLines.length ? (
              <table className="portal-activity-table w-full min-w-[640px] text-left text-sm">
                <thead><tr><th>Setter</th><th className="text-right">Dials</th><th className="text-right">Booked</th><th className="text-right">Showed</th><th className="text-right">Show rate</th><th>Status</th></tr></thead>
                <tbody className="m-seq">
                  {setterSlice.rows.map((line) => {
                    const href = agentHref(line.userId, "days");
                    const rate = percent(line.showed, line.booked);
                    const member = line.member;
                    return (
                      <tr key={line.userId} className="m-row cursor-pointer" onClick={() => router.push(href)}>
                        <td className="max-w-[220px] truncate font-medium"><Link href={href} className="hover:underline" onClick={(event) => event.stopPropagation()}>{line.name}</Link></td>
                        <td className="text-right tabular-nums">{count(line.dials)}</td>
                        <td className="text-right tabular-nums">{count(line.booked)}</td>
                        <td className="text-right tabular-nums">{count(line.showed)}</td>
                        <td className="text-right tabular-nums">{rate == null ? <span className="text-muted-foreground">—</span> : `${rate}%`}</td>
                        <td className="whitespace-nowrap">
                          {line.neverClosedOut > 0 ? <StatusChip tone="danger">{line.neverClosedOut.toLocaleString()} overdue</StatusChip>
                            : member ? <StatusChip tone={member.hasHours !== false && member.onShiftNow ? "good" : "neutral"}>{member.hasHours === false ? "No hours set" : member.onShiftNow ? "On shift" : "Off shift"}</StatusChip>
                            : <span className="text-muted-foreground">—</span>}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            ) : (
              <EmptyState title="No setter outcomes in this window" hint="Dials, bookings and shows, setter by setter." />
            )}
          </>
        ) : loading ? <SectionLoading rows={6} columns={6} />
          : tab === "agents" ? (
            scorecard.length ? (
              <table className="portal-activity-table w-full min-w-[720px] text-left text-sm">
                <thead><tr><th>Agent</th><th className="text-right">Dialled</th><th className="text-right">Contact rate</th><th className="text-right">Appointments</th><th className="text-right">Applications</th><th>Status</th></tr></thead>
                <tbody className="m-seq">
                  {scorecard.map((row) => {
                    const key = row.agent_user_id ?? "unknown";
                    const chip = agentChip(row, reviewsZeroClick);
                    return (
                      <tr key={key} className={cn("m-row", row.agent_user_id && "cursor-pointer")} onClick={row.agent_user_id ? () => router.push(agentHref(row.agent_user_id!)) : undefined}>
                        <td className="max-w-[220px] truncate font-medium">{row.agent_user_id ? <Link href={agentHref(row.agent_user_id)} className="hover:underline" onClick={(event) => event.stopPropagation()}>{row.agent_name ?? "Unknown agent"}</Link> : row.agent_name ?? "Unknown agent"}</td>
                        <td className="text-right tabular-nums">{count(row.clicked)}</td>
                        <td className="text-right tabular-nums">{row.contact_rate_percent == null ? <span className="text-muted-foreground">—</span> : `${row.contact_rate_percent}%`}</td>
                        <td className="text-right tabular-nums">{count(row.appointments_booked)}</td>
                        <td className="text-right tabular-nums" title={`${row.applications_started.toLocaleString()} started · ${row.applications_submitted.toLocaleString()} submitted · ${(row.worked ?? 0).toLocaleString()} worked`}>{count(row.applications_submitted)}</td>
                        <td className="whitespace-nowrap">{chip ?? <span className="text-muted-foreground">—</span>}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            ) : filtered ? <NoMatches noun="agents" onClear={clearAll} /> : <EmptyState title="No activity in this window" hint="Each agent's dials and outcomes show up here." action={<Button variant="outline" asChild><Link href="/app/dialer">Open the dialer</Link></Button>} />
          ) : entries.length === 0 ? (
            filtered
              ? <NoMatches noun={view === "integrity" ? "flagged events" : "served leads"} onClear={clearAll} />
              : view === "integrity"
                ? <EmptyState title="Nothing to review" hint="Every event in this window is consistent." />
                : <EmptyState title="No activity in this window" hint="Served leads show up here, newest first." action={<Button variant="outline" asChild><Link href="/app/dialer">Open the dialer</Link></Button>} />
          ) : view === "integrity" ? (
            <table className="portal-activity-table w-full min-w-[820px] text-left text-sm">
              <thead><tr><th scope="col">Agent</th><th scope="col">Lead</th><th scope="col">Outcome logged</th><th scope="col">Served</th><th scope="col">Status</th><th scope="col">Next step</th></tr></thead>
              <tbody className="m-seq">
                {entries.map((entry) => entry.kind === "served" ? <ReviewRow key={entry.row.id} row={entry.row} /> : null)}
              </tbody>
            </table>
          ) : (
            <table className="portal-activity-table w-full min-w-[880px] text-left text-sm">
              <thead><tr><th scope="col">Served</th><th scope="col">Agent</th><th scope="col">Lead</th><th scope="col">Campaign</th><th scope="col">Outcome</th><th scope="col">Status</th></tr></thead>
              <tbody className="m-seq">
                {entries.map((entry) => <LogRow key={`${entry.kind}-${entry.row.id}`} entry={entry} />)}
              </tbody>
            </table>
          )}
      </TableCard>
      )}
      </div>
    </div>
  );
}

function shiftLabel(member: RosterMember) {
  return member.hasHours === false ? "No hours set" : member.onShiftNow ? "On shift" : "Off shift";
}

/** An agent row's one chip: never dialled, or the outcomes they logged without a dial (a reviewer's). */
function agentChip(row: ScorecardRow, reviews: boolean): ReactNode {
  if (row.served > 0 && row.clicked === 0) return <StatusChip>Never dialled</StatusChip>;
  const flags = Number(row.zero_click ?? 0);
  if (reviews && flags > 0) return <StatusChip tone="warning">{flags.toLocaleString()} logged without a dial</StatusChip>;
  return null;
}

/**
 * Agents › Chart (2·A): who is dialling and who is reaching people, as horizontal bars, longest first, contacts solid
 * inside dials; then when, as the team's week. A setter's own page has one bar, so it opens on the week alone. A
 * reviewer also gets the outcomes logged without a dial, by agent: the drawing To review's count stands for.
 */
function AgentsCharts({ scorecard, weeks, totals: t, loading, windowLabel, solo, reviews, agentHref, tableHref, weekHref }: {
  scorecard: ScorecardRow[]; weeks: ActivityWeek[] | null; totals: ReturnType<typeof totals>; loading: boolean; windowLabel: string; solo: boolean; reviews: boolean;
  agentHref: (id: string) => string; tableHref: (target: Tab, extra?: Record<string, string | null>) => string; weekHref: (target: Tab, key: string) => string | null;
}) {
  const named = scorecard.filter((row) => row.agent_user_id);
  const rows: BarListRow[] = named.map((row) => {
    const contacts = contactsOf(row);
    return {
      key: row.agent_user_id!,
      label: row.agent_name ?? "Unknown agent",
      value: row.clicked,
      inner: contacts,
      figure: count(row.clicked),
      caption: row.clicked === 0 ? (row.served > 0 ? "never dialled" : "no dials") : `${count(contacts)} contacts`,
      href: agentHref(row.agent_user_id!),
    };
  });
  const flags = reviews ? named.filter((row) => Number(row.zero_click ?? 0) > 0).sort((a, b) => Number(b.zero_click) - Number(a.zero_click)) : [];
  const flagTotal = flags.reduce((sum, row) => sum + Number(row.zero_click ?? 0), 0);
  const weekContacts = weeks?.reduce((sum, week) => sum + week.contacts, 0) ?? 0;
  const weekDials = weeks?.reduce((sum, week) => sum + week.dials, 0) ?? 0;
  if (loading && !scorecard.length) return <Card className="px-4"><SectionLoading rows={6} columns={2} label="Loading the agents" /></Card>;
  if (!named.length) return <Card className="px-4"><EmptyState title="No activity in this window" hint="Each agent's dials and outcomes show up here." action={<Button variant="outline" asChild><Link href="/app/dialer">Open the dialer</Link></Button>} /></Card>;
  return (
    <>
      {!solo && (
        <ActivityChartCard title="Dials and contacts, by agent" period={[windowLabel, t ? `${count(t.dials)} dials` : null, "solid is contacts (dialled × contact rate)"].filter(Boolean).join(" · ")} tableHref={tableHref("agents")}>
          <BarList
            rows={rows}
            summary="Dials by agent, with the contacts each reached drawn inside"
            unit="dials"
            total={t ? { label: `Team · ${t.contactRate == null ? "—" : `${t.contactRate}%`} contact rate`, figure: `${count(t.dials)} dials`, caption: `${count(t.contacts)} contacts`, href: tableHref("agents") } : undefined}
          />
        </ActivityChartCard>
      )}
      <ActivityChartCard title={solo ? "Your week" : "The team's week"} period={[windowLabel, "dials and contacts, by week"].filter(Boolean).join(" · ")} tableHref={tableHref("log")}>
        {weeks?.length ? (
          <LineSeries
            points={points(weeks, (i) => weeks[i].dials)}
            summary="Dials and contacts, by week"
            unit="dials"
            legend={{ label: "Dials", figure: count(weekDials), href: tableHref("agents") }}
            lines={[{ key: "contacts", label: "Contacts", points: points(weeks, (i) => weeks[i].contacts), figure: count(weekContacts), href: tableHref("agents") }]}
            hrefFor={(point) => weekHref("log", point.key)}
          />
        ) : weeks ? <EmptyState title="No dials in this window" hint="The week's dials and contacts show here." /> : <SectionLoading rows={4} columns={1} label="Loading the week" />}
      </ActivityChartCard>
      {flags.length > 0 && (
        <ActivityChartCard
          title="Outcomes logged without a dial, by agent"
          period={[windowLabel, `${count(flagTotal)} to review`].filter(Boolean).join(" · ")}
          action={<Link href={tableHref("review")} className="whitespace-nowrap text-sm font-medium text-[var(--accent-ink)] hover:underline">Review the oldest ›</Link>}
        >
          <BarList
            rows={flags.map((row) => ({ key: row.agent_user_id!, label: row.agent_name ?? "Unknown agent", value: Number(row.zero_click ?? 0), caption: row.clicked > 0 ? `${percent(Number(row.zero_click ?? 0), row.clicked)}% of dials` : undefined, tone: "warning" as const, href: tableHref("review", { agent: row.agent_user_id }) }))}
            summary="Outcomes logged without a Dial press, by agent"
            unit="outcomes"
            total={{ label: "Team", figure: `${count(flagTotal)} to review`, href: tableHref("review") }}
          />
        </ActivityChartCard>
      )}
    </>
  );
}

/** Setters › Chart (2·3): booked against showed, by setter (showed solid inside booked) and by week. */
function SettersCharts({ lines, rows, loading, error, windowLabel, agentHref, tableHref }: {
  lines: SetterLine[]; rows: SetterReport["rows"]; loading: boolean; error: string; windowLabel: string;
  agentHref: (id: string, tab?: "days") => string; tableHref: string;
}) {
  const weeks = useMemo(() => {
    const byWeek = new Map<string, { booked: number; showed: number }>();
    for (const row of rows) {
      const key = weekKeyOfDay(row.day);
      if (!key) continue;
      const week = byWeek.get(key) ?? { booked: 0, showed: 0 };
      week.booked += row.booked; week.showed += row.showed;
      byWeek.set(key, week);
    }
    return [...byWeek.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([key, value]) => ({ key, label: weekLabel(key), ...value }));
  }, [rows]);
  if (error) return <Callout tone="error" title="Setter outcomes did not load">{error}</Callout>;
  if (loading && !lines.length) return <Card className="px-4"><SectionLoading rows={4} columns={2} label="Loading setter outcomes" /></Card>;
  if (!lines.length) return <Card className="px-4"><EmptyState title="No setter outcomes in this window" hint="Dials, bookings and shows, setter by setter." /></Card>;
  const booked = lines.reduce((sum, line) => sum + line.booked, 0);
  const showed = lines.reduce((sum, line) => sum + line.showed, 0);
  const rate = percent(showed, booked);
  return (
    <>
      {lines.length > 1 && (
        <ActivityChartCard title="Appointments booked and showed, by setter" period={[windowLabel, `${count(booked)} booked · ${count(showed)} showed`].filter(Boolean).join(" · ")} tableHref={tableHref}>
          <BarList
            rows={lines.map((line) => ({ key: line.userId, label: line.name, value: line.booked, inner: line.showed, figure: `${count(line.booked)} booked`, caption: `${count(line.showed)} showed${line.booked ? ` · ${percent(line.showed, line.booked)}%` : ""}`, href: agentHref(line.userId, "days") }))}
            summary="Appointments booked by setter, with those that showed drawn inside"
            unit="appointments"
            total={{ label: `Team${rate == null ? "" : ` · ${rate}% showed`}`, figure: `${count(booked)} booked`, caption: `${count(showed)} showed`, href: tableHref }}
          />
        </ActivityChartCard>
      )}
      <ActivityChartCard title="Booked and showed, by week" period={[windowLabel, `${count(booked)} booked · ${count(showed)} showed`].filter(Boolean).join(" · ")} tableHref={tableHref}>
        {weeks.length ? (
          <LineSeries
            points={points(weeks, (i) => weeks[i].booked)}
            summary="Appointments booked and showed, by week"
            unit="appointments"
            legend={{ label: "Booked", figure: count(booked), href: tableHref }}
            lines={[{ key: "showed", label: "Showed", points: points(weeks, (i) => weeks[i].showed), figure: count(showed), href: tableHref }]}
            hrefFor={(point) => showHref(tableHref, "table", { from: point.key, to: new Date(Date.parse(`${point.key}T00:00:00Z`) + 6 * DAY).toISOString().slice(0, 10) })}
          />
        ) : <EmptyState title="No bookings in this window" hint="Bookings and shows, week by week." />}
      </ActivityChartCard>
    </>
  );
}

/**
 * To review › Chart (owner 2026-11-12): the outcomes logged without a Dial press, by agent (a bar opens To review's
 * table on that agent) and by week (a point opens it on that week). Read from what the tab already loads: the
 * integrity report's scorecard (`zero_click` per agent) and the window's weeks (`zeroClick` per week).
 */
function ReviewCharts({ scorecard, weeks, loading, windowLabel, tableHref, weekHref }: {
  scorecard: ScorecardRow[]; weeks: ActivityWeek[] | null; loading: boolean; windowLabel: string;
  tableHref: (target: Tab, extra?: Record<string, string | null>) => string; weekHref: (target: Tab, key: string) => string | null;
}) {
  const flags = scorecard.filter((row) => row.agent_user_id && Number(row.zero_click ?? 0) > 0).sort((a, b) => Number(b.zero_click) - Number(a.zero_click));
  const flagTotal = flags.reduce((sum, row) => sum + Number(row.zero_click ?? 0), 0);
  const weekTotal = weeks?.reduce((sum, week) => sum + (week.zeroClick ?? 0), 0) ?? 0;
  if (loading && !scorecard.length) return <Card className="px-4"><SectionLoading rows={4} columns={2} label="Loading the review" /></Card>;
  return (
    <>
      <ActivityChartCard title="Outcomes logged without a dial, by agent" period={[windowLabel, `${count(flagTotal)} to review`].filter(Boolean).join(" · ")} tableHref={tableHref("review")}>
        {flags.length ? (
          <BarList
            rows={flags.map((row) => ({ key: row.agent_user_id!, label: row.agent_name ?? "Unknown agent", value: Number(row.zero_click ?? 0), caption: row.clicked > 0 ? `${percent(Number(row.zero_click ?? 0), row.clicked)}% of dials` : "no dials", tone: "warning" as const, href: tableHref("review", { agent: row.agent_user_id }) }))}
            summary="Outcomes logged without a Dial press, by agent"
            unit="outcomes"
            total={flags.length > 1 ? { label: "Team", figure: `${count(flagTotal)} to review`, href: tableHref("review") } : undefined}
          />
        ) : <EmptyState title="Nothing to review" hint="Every outcome in this window had a Dial press before it." />}
      </ActivityChartCard>
      <ActivityChartCard title="Outcomes logged without a dial, by week" period={[windowLabel, `${count(weekTotal)} in the window`].filter(Boolean).join(" · ")} tableHref={tableHref("review")}>
        {weeks?.length ? (
          <LineSeries
            points={points(weeks, (i) => weeks[i].zeroClick ?? 0)}
            summary="Outcomes logged without a Dial press, by week"
            unit="outcomes"
            legend={{ label: "Logged without a dial", figure: count(weekTotal), href: tableHref("review") }}
            hrefFor={(point) => weekHref("review", point.key)}
          />
        ) : weeks ? <EmptyState title="Nothing logged in this window" hint="Outcomes logged without a dial show here, week by week." /> : <SectionLoading rows={4} columns={1} label="Loading the week" />}
      </ActivityChartCard>
    </>
  );
}

/**
 * Close out › Chart (owner 2026-11-12): the appointments waiting for an outcome, by the setter who booked them and by
 * the appointment's day. The days are counted from the close-out list itself (a bar opens the table on that day);
 * the setters from the setter scorecard's `pending` (booked in the last 90 days, slot in the last 3 days, no outcome:
 * the list's own rule), because the list does not carry who booked each one. A setter's bar opens their page.
 */
function CloseOutCharts({ setterHref, tableHref }: { setterHref: (id: string) => string; tableHref: (extra?: Record<string, string | null>) => string }) {
  const [list, setList] = useState<CloseOutRow[] | null>(null);
  const [error, setError] = useState("");
  const [setters, setSetters] = useState<SetterReport | null>(null);
  const [settersFailed, setSettersFailed] = useState(false);
  useEffect(() => {
    const controller = new AbortController();
    void fetch("/api/app/appointments/close-out", { cache: "no-store", signal: controller.signal })
      .then(async (response) => {
        const body = await response.json().catch(() => null);
        if (!response.ok) throw new Error(body?.error ?? "Could not load appointment close-outs");
        setList(Array.isArray(body?.appointments) ? body.appointments : []);
      })
      .catch((cause) => { if (!controller.signal.aborted) setError(cause instanceof Error ? cause.message : "Could not load appointment close-outs"); });
    void readResource<SetterReport>(scorecardKey(90))
      .then((body) => { if (!controller.signal.aborted) setSetters(body); })
      .catch(() => { if (!controller.signal.aborted) setSettersFailed(true); });
    return () => controller.abort();
  }, []);
  const days = useMemo(() => {
    const byDay = new Map<string, number>();
    for (const item of list ?? []) {
      const day = closeOutDay(item);
      if (day) byDay.set(day, (byDay.get(day) ?? 0) + 1);
    }
    return [...byDay.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([key, value]) => ({ key, label: closeOutDayLabel(key), value }));
  }, [list]);
  const bySetter = useMemo(() => {
    const byId = new Map<string, { userId: string; name: string; pending: number }>();
    for (const row of setters?.rows ?? []) {
      if (!row.pending) continue;
      const line = byId.get(row.userId) ?? { userId: row.userId, name: row.name, pending: 0 };
      line.pending += row.pending;
      byId.set(row.userId, line);
    }
    return [...byId.values()].sort((a, b) => b.pending - a.pending || a.name.localeCompare(b.name));
  }, [setters]);
  if (error) return <Callout tone="error" title="Close-outs did not load">{error}</Callout>;
  if (!list) return <Card className="px-4"><SectionLoading rows={4} columns={2} label="Loading close-outs" /></Card>;
  if (!list.length) return <Card className="px-4"><EmptyState title="No appointments to close out" hint="Appointments that ended and still need an outcome show here." /></Card>;
  const setterTotal = bySetter.reduce((sum, line) => sum + line.pending, 0);
  return (
    <>
      <ActivityChartCard title="Waiting for an outcome, by setter" period={`${count(setterTotal)} waiting · by who booked it`} tableHref={tableHref()}>
        {bySetter.length ? (
          <BarList
            rows={bySetter.map((line) => ({ key: line.userId, label: line.name, value: line.pending, figure: count(line.pending), tone: "warning" as const, href: setterHref(line.userId) }))}
            summary="Appointments waiting for an outcome, by the setter who booked them"
            unit="appointments"
            total={bySetter.length > 1 ? { label: "Team", figure: `${count(setterTotal)} waiting`, href: tableHref() } : undefined}
          />
        ) : settersFailed ? <EmptyState title="The setters did not load" hint="The setter scorecard is unavailable; the days below still count every appointment." />
          : setters ? <EmptyState title="None booked by a setter" hint="Every appointment waiting here was booked without a setter on it." />
          : <SectionLoading rows={3} columns={1} label="Loading the setters" />}
      </ActivityChartCard>
      <ActivityChartCard title="Waiting for an outcome, by appointment day" period={`${count(list.length)} waiting · the client's day`} tableHref={tableHref()}>
        <BarSeries
          bars={days.map((day) => ({ key: day.key, label: day.label, value: day.value }))}
          summary="Appointments waiting for an outcome, by the day they were for"
          unit="appointments"
          labels="all"
          hrefFor={(bar) => tableHref({ day: bar.key })}
        />
      </ActivityChartCard>
    </>
  );
}
