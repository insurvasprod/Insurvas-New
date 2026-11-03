"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { Download } from "lucide-react";

import { Button } from "@/components/ui/button";
import { ActiveFilters, DataToolbar, FilterButton, FilterField, FilterPanel, RefreshButton, ToolbarSearch, toolbarControl, type ActiveFilter } from "@/components/ui/data-toolbar";
import { PageHeader } from "@/components/ui/page-header";
import { PageLoading } from "@/components/ui/page-loading";
import { FramedLoading } from "@/components/app/reports/reports-slot";
import { InfoTip } from "@/components/ui/info-tip";
import { EmptyState, NoMatches, SectionLoading } from "@/components/ui/page-states";
import { StatStrip, StatTile, type MeterTone } from "@/components/ui/stat";
import { StatusChip } from "@/components/ui/status-chip";
import { TableCard } from "@/components/ui/table-card";
import { Segmented, ViewTabs } from "@/components/app/view-tabs";
import { Callout } from "@/components/app/settings/primitives";
import { InReportsSlot, ReportsSlot, useUrlTab } from "@/components/app/reports/reports-slot";
import { keepSharedPeriod } from "@/lib/reports/views";
import {
  formatSpan,
  mayReviewZeroClick,
  outcomeDetails,
  refusalLabel,
  zeroClickConcentration,
  type ActivityReport,
  type ActivityRow,
  type BlockedDialRow,
} from "@/lib/activityLog/types";
import { AppointmentCloseOutStrip } from "@/components/app/appointment-close-out-strip";
import { Pager, paginate } from "@/components/ui/pager";
import { useFittingPageSize } from "@/components/ui/use-fitting-page-size";
import { cn } from "@/lib/utils";
import { csvCellMinimal } from "@/lib/csv/cell";

/**
 * Team activity (was Activity & scorecard; redesign 2026-10-26, owner pick A, canvas M2 · Outbound
 * results). Six tabs became four: Agents (the scorecard, the home), Call log, Setters, and To review —
 * the appointments waiting for an outcome and the flagged calls in one queue. Fresh against recycled
 * moved to Lead recycling. An agent opens beside the table with how their calls ended (the
 * disposition mix, LA-2.21) and the way into their calls and flags. "Export this table" downloads the
 * grid on screen (LA-2.21 AC3: every grid exports).
 *
 * Every figure names its comparison window, and nothing here is talk time: click-to-call hands the
 * call to the handset, so the platform never sees how long it lasted.
 *
 * Each row of the log is one served card: when it was opened, whether and when Dial was pressed,
 * the outcome and what it led to. Dials the product refused sit between them as their own
 * "Blocked" rows, never counted as dials. The zero-click review (outcomes with no Dial press, and
 * whose they are) is for owners and producers only.
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

function clock(value: string) {
  const date = new Date(value);
  return `${String(date.getHours()).padStart(2, "0")}:${String(date.getMinutes()).padStart(2, "0")}`;
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

/** Colour means direction against the prior window; a change under 2% is not a change. */
function tone(current: number | null, prior: number | null): MeterTone | undefined {
  if (current == null || prior == null || prior === 0) return undefined;
  const change = (current - prior) / prior;
  if (Math.abs(change) < 0.02) return undefined;
  return change > 0 ? "good" : "danger";
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
  return { served, dials, appointments, contactRate, zeroClick, neverDialed: Math.max(0, served - dials), blocked: report.blocked_total };
}


/**
 * A served card, one even row: the outcome, what it led to (each from its own record), how long
 * after the card opened it was logged, the lead and its state, when it was served and whether Dial
 * was pressed — or that it was not, in red when an outcome was logged anyway.
 */
export function ServedRow({ row, showFlags, showAgent = true }: { row: ActivityRow; showFlags: boolean; showAgent?: boolean }) {
  const zeroClick = row.integrity_flags.includes("zero_click_disposition");
  const span = formatSpan(row.open_to_log_seconds);
  const details = outcomeDetails(row).join(" · ");
  return (
    <tr className={`m-row ${zeroClick ? "bg-[var(--error-surface)]" : ""}`}>
      {showAgent && <td className="max-w-[140px] truncate" title={row.agent_name}>{row.agent_name}</td>}
      <td className="max-w-[170px] truncate" title={row.campaign_name ?? undefined}>{row.campaign_name ?? "—"}</td>
      <td className="whitespace-nowrap">
        {row.disposition ? <span className="font-semibold">{humanize(row.disposition)}</span> : <span className="text-muted-foreground">Not logged</span>}
        {row.on_internal_dnc && <StatusChip tone="danger" className="ml-2">DNC</StatusChip>}
      </td>
      <td className="max-w-[240px] truncate text-muted-foreground" title={details || undefined}>{details || "—"}</td>
      <td className={`whitespace-nowrap tabular-nums ${zeroClick ? "font-semibold text-[var(--error-ink)]" : "text-muted-foreground"}`}>{row.disposition && span ? span : "—"}</td>
      <td className="max-w-[220px] truncate" title={row.lead_name ?? undefined}>{row.lead_name ?? <span className="text-muted-foreground">Unnamed lead</span>}</td>
      <td className="whitespace-nowrap text-muted-foreground">{row.lead_state ?? "—"}</td>
      {showFlags && <td className="max-w-[220px] truncate text-[var(--warning-ink)]" title={row.integrity_flags.map((flag) => FLAG_LABEL[flag] ?? humanize(flag)).join(", ")}>{row.integrity_flags.map((flag) => FLAG_LABEL[flag] ?? humanize(flag)).join(", ")}</td>}
      <td className="whitespace-nowrap text-right tabular-nums">{served(row.served_at)}</td>
      <td className="whitespace-nowrap text-right tabular-nums">
        {row.clicked_at ? clock(row.clicked_at)
          : row.disposition ? <span className="font-semibold text-[var(--error-ink)]">Never dialled</span>
          : <span className="text-muted-foreground">Not dialled</span>}
      </td>
      <td className="text-right tabular-nums">{row.attempt ?? "—"}</td>
    </tr>
  );
}

/**
 * A dial the product refused. In the log as a refusal, not a call: no outcome, no attempt, and it
 * is not counted as a dial anywhere on the page. The reason is the screening's own sentence.
 */
export function BlockedRow({ row, showAgent = true }: { row: BlockedDialRow; showAgent?: boolean }) {
  const reason = `${refusalLabel(row.reason)}${row.inbound ? " · inbound return call" : ""}`;
  const detail = [reason, row.message].filter(Boolean).join(" · ");
  return (
    <tr className="m-row">
      {showAgent && <td className="max-w-[140px] truncate" title={row.agent_name}>{row.agent_name}</td>}
      <td className="max-w-[170px] truncate" title={row.campaign_name ?? undefined}>{row.campaign_name ?? "—"}</td>
      <td className="whitespace-nowrap"><StatusChip tone="warning">Blocked</StatusChip></td>
      <td className="max-w-[240px] truncate font-semibold text-[var(--warning-ink)]" title={detail}>{detail}</td>
      <td className="text-muted-foreground">—</td>
      <td className="max-w-[220px] truncate" title={row.lead_name ?? undefined}>{row.lead_name ?? <span className="text-muted-foreground">Unnamed lead</span>}</td>
      <td className="whitespace-nowrap text-muted-foreground">{row.lead_state ?? "—"}</td>
      <td className="whitespace-nowrap text-right tabular-nums">{served(row.at)}</td>
      <td className="whitespace-nowrap text-right text-muted-foreground">Not placed</td>
      <td className="text-right tabular-nums">—</td>
    </tr>
  );
}

/** One served card, or one refused dial, in the log's newest-first order. */
type LogEntry = { kind: "served"; at: number; row: ActivityRow } | { kind: "blocked"; at: number; row: BlockedDialRow };

/**
 * `framed`: inside the Reports page (components/app/reports/reports-page.tsx), which draws the title;
 * the tabs go to its top row and Export to its corner. `initialPeriod`: the Reports views' shared period
 * (`?from&to`), opened as a custom range; a window picked here is kept in the address for the others.
 *
 * Foundation pass (2026-11-03, docs/reports/FOUNDATION-PASS.md): an agent opens their own page
 * (/app/activity/agent/[agentId]) instead of a panel beside the table; the appointments to close out are
 * their own tab, not a card over the flagged calls; agent, campaign and outcome sit in the Filters panel;
 * the tab is in the address and each figure tile opens its tab; errors go to the bell.
 */
export function ActivityLogWorkspace({ initialView = "agents", role = "", framed = false, initialPeriod = null, initialAgent = "" }: { initialView?: Tab; role?: string; framed?: boolean; initialPeriod?: { from: string; to: string } | null; initialAgent?: string } = {}) {
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
  const { tab, setTab, href: tabHref } = useUrlTab(TAB_KEYS, initialView, "view", TAB_ALIAS);
  // The report the page reads: the integrity review for its tab, the activity log for the call log,
  // the scorecard for the rest.
  const view: View = tab === "review" ? "integrity" : tab === "log" ? "activity" : "scorecard";
  const [integrityFilter, setIntegrityFilter] = useState<IntegrityFilter>("any");
  const zeroClickOnly = view === "integrity" && reviewsZeroClick && integrityFilter === "zero_click_disposition";
  const [page, setPage] = useState(1);
  const [setterPage, setSetterPage] = useState(1);
  const [setterList, setSetterList] = useState<"outcomes" | "roster">("outcomes");
  const [closeOuts, setCloseOuts] = useState<number | null>(null);
  const pageSize = useFittingPageSize(480, 41);

  const [report, setReport] = useState<ActivityReport | null>(null);
  const [prior, setPrior] = useState<ActivityReport | null>(null);
  const [inRange, setInRange] = useState<number | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [setters, setSetters] = useState<SetterReport | null>(null);
  const [settersError, setSettersError] = useState("");
  const [settersLoading, setSettersLoading] = useState(true);

  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(() => { setAnchor(now()); }, []);

  // Typing narrows the table once the person pauses, not on every keystroke.
  useEffect(() => {
    const timer = window.setTimeout(() => { setDebounced(search.trim()); setPage(1); }, 250);
    return () => window.clearTimeout(timer);
  }, [search]);

  // The appointments waiting for an outcome, for the Next step line (owners and producers only, like the list).
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
    const day = (ms: number) => { const d = new Date(ms); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`; };
    keepSharedPeriod(range === "custom" ? { from: customFrom, to: customTo } : { from: day(windows.from), to: day(windows.to) });
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

  // The setter report counts days back from today, so a custom range asks for enough days to reach its
  // start and keeps only the days inside it (2026-10-26: the dates you picked, not "N days back").
  const setterDays = range === "custom" && windows && anchor != null ? Math.min(180, Math.max(1, Math.ceil((anchor - windows.from) / DAY))) : windows?.days ?? 30;
  const loadSetters = useCallback(async () => {
    setSettersLoading(true);
    setSettersError("");
    try {
      const response = await fetch(`/api/app/scorecard?days=${setterDays}`, { cache: "no-store" });
      const body = await response.json().catch(() => null);
      if (!response.ok) throw new Error(body?.error ?? "Could not load setter scorecard");
      setSetters(body);
    } catch (cause) {
      setSetters(null);
      setSettersError(cause instanceof Error ? cause.message : "Could not load setter scorecard");
    } finally {
      setSettersLoading(false);
    }
  }, [setterDays]);

  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(() => { if (tab === "setters") void loadSetters(); }, [tab, loadSetters]);

  const now_ = totals(report);
  const then = totals(prior);
  const windowWords = windows ? (range === "custom" ? `${windows.days} days before` : `prior ${windows.days} days`) : "";
  const vs = (value: number | null | undefined, unit = "") =>
    value == null ? "no earlier data" : `vs ${value.toLocaleString()}${unit} ${windowWords}`;
  const applications = report ? report.scorecard.reduce((n, row) => n + row.applications_started, 0) : null;
  const submitted = report ? report.scorecard.reduce((n, row) => n + row.applications_submitted, 0) : null;
  const applicationsBefore = prior ? prior.scorecard.reduce((n, row) => n + row.applications_started, 0) : null;

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

  const refresh = () => { void load(); if (tab === "setters") void loadSetters(); };
  const choose = (next: Tab) => { setTab(next); setIntegrityFilter("any"); setPage(1); setSetterPage(1); };
  const inCustomRange = (day: string) => range !== "custom" || ((!customFrom || day >= customFrom) && (!customTo || day <= customTo));
  const setterRows = (setters?.rows ?? []).filter((row) => inCustomRange(row.day));
  const roster = setters?.scope === "team" ? setters.roster : [];
  const outcomeSlice = paginate(setterRows, setterPage, pageSize);
  const rosterSlice = paginate(roster, setterPage, pageSize);
  const setterSlice = setterList === "roster" ? rosterSlice : outcomeSlice;
  const windowLabel = range === "custom" && !windows ? "Choose a from and to date" : windows?.label;
  // An agent's page keeps the window on screen (the shared period), so their figures match these.
  const periodQuery = windows ? (() => { const day = (ms: number) => { const d = new Date(ms); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`; }; return `from=${day(windows.to - 1 - (windows.days - 1) * DAY)}&to=${day(windows.to - 1)}`; })() : "";
  const agentHref = (id: string) => `/app/activity/agent/${id}${periodQuery ? `?${periodQuery}` : ""}`;
  const filterChips: ActiveFilter[] = [
    agentId ? { key: "agent", label: "Agent", value: agents.find(([id]) => id === agentId)?.[1] ?? "One agent", onRemove: () => { setAgentId(""); setPage(1); } } : null,
    campaignId ? { key: "campaign", label: "Campaign", value: campaigns.find(([id]) => id === campaignId)?.[1] ?? "One campaign", onRemove: () => { setCampaignId(""); setPage(1); } } : null,
    disposition ? { key: "disposition", label: "Outcome", value: humanize(disposition), onRemove: () => { setDisposition(""); setPage(1); } } : null,
  ].filter((chip): chip is ActiveFilter => Boolean(chip));

  /** "Export this table": the grid on screen. The log and the flags come from the server, with every column. */
  function exportTable() {
    if (tab === "agents" && report) {
      downloadCsv("agents.csv", ["Agent", "Served", "Dialled", "Logged", "Worked", "Contact rate %", "Callbacks booked", "Callbacks kept", "Appointments booked", "Appointments showed", "Applications started", "Applications submitted"],
        report.scorecard.map((row) => [row.agent_name ?? "Unknown agent", row.served, row.clicked, row.logged, row.worked ?? 0, row.contact_rate_percent, row.callbacks_booked, row.callbacks_kept, row.appointments_booked, row.appointments_showed, row.applications_started, row.applications_submitted]));
    } else if (tab === "setters" && setterList === "roster") {
      downloadCsv("setter-roster.csv", ["Setter", "Role", "Local time", "Timezone", "Shift"], roster.map((member) => [member.name, member.role, member.localLabel, member.timezone, member.hasHours === false ? "No hours set" : member.onShiftNow ? "On shift" : "Off shift"]));
    } else if (tab === "setters") {
      downloadCsv("setter-outcomes.csv", ["Setter", "Day", "Dials", "Contacts", "Booked", "Showed", "Show rate %", "Coverage %", "Closed out", "Closeable", "Sold", "Overdue", "Pending"],
        setterRows.map((row) => [row.name, row.day, row.dials, row.contacts, row.booked, row.showed, row.showRatePct, row.coveragePct, row.closedOut, row.closeable, row.sold, row.neverClosedOut, row.pending]));
    }
  }
  const serverExport = tab === "log" || tab === "review";
  const exportButton = serverExport
    ? <Button asChild variant="outline"><a href={`/api/app/activity?${exportQuery}`}><Download aria-hidden="true" />Export this table</a></Button>
    : <Button type="button" variant="outline" onClick={exportTable} disabled={tab === "agents" ? !report?.scorecard.length : !(setterList === "roster" ? roster : setterRows).length}><Download aria-hidden="true" />Export this table</Button>;

  // First read of the page: the one loading look, header and all.
  if (loading && !report && !error) return framed ? <FramedLoading /> : <PageLoading />;

  const flagged = reviewsZeroClick ? now_?.zeroClick ?? 0 : 0;

  return (
    <div className="m-stagger flex flex-col gap-6">
      {framed
        ? <ReportsSlot slot="corner">{tab === "closeout" ? null : exportButton}</ReportsSlot>
        : <PageHeader title="Team activity" description="What each agent did, and how it turned out." actions={exportButton} />}

      {/* What waits on someone is a count on its tab, never a "Next step" line (UI-CONSISTENCY §3). */}
      {error && <Callout tone="error" title="Activity did not load">{error}</Callout>}

      {/* Each tile opens the tab its figure is read from (owner 2026-11-02: the tiles are the links). */}
      <StatStrip label="Activity totals">
        <StatTile
          label="Leads served"
          href={tabHref("log")}
          value={loading || !now_ ? "…" : now_.served.toLocaleString()}
          valueTone={tone(now_?.served ?? null, then?.served ?? null)}
          footnote={<>{vs(then?.served)}{!loading && now_ && now_.served > 0 ? ` · ${now_.neverDialed.toLocaleString()} never dialled` : ""}</>}
        />
        <StatTile
          label="Dials"
          href={tabHref(flagged > 0 ? "review" : "log")}
          value={loading || !now_ ? "…" : now_.dials.toLocaleString()}
          valueTone={tone(now_?.dials ?? null, then?.dials ?? null)}
          footnote={<>{vs(then?.dials)}{!loading && now_ && reviewsZeroClick && now_.zeroClick ? <span className="font-semibold text-[var(--error-ink)]"> · {now_.zeroClick.toLocaleString()} logged with no dial</span> : null}{!loading && now_ && (now_.blocked ?? 0) > 0 ? ` · ${(now_.blocked ?? 0).toLocaleString()} blocked, not counted` : ""}</>}
        />
        <StatTile label="Contact rate" href={tabHref("agents")} value={loading || now_?.contactRate == null ? "—" : now_.contactRate} unit={loading || now_?.contactRate == null ? undefined : "%"} valueTone={tone(now_?.contactRate ?? null, then?.contactRate ?? null)} footnote={vs(then?.contactRate, "%")} />
        <StatTile label="Appointments" href={tabHref(reviewsZeroClick && closeOuts ? "closeout" : "setters")} value={loading || !now_ ? "…" : now_.appointments.toLocaleString()} valueTone={tone(now_?.appointments ?? null, then?.appointments ?? null)} footnote={vs(then?.appointments)} />
        <StatTile label="Applications" href={tabHref("agents")} value={loading || applications == null ? "…" : applications.toLocaleString()} valueTone={tone(applications, applicationsBefore)} footnote={<>{vs(applicationsBefore)}{!loading && submitted != null ? ` · ${submitted.toLocaleString()} submitted` : ""}</>} />
      </StatStrip>

      <InReportsSlot framed={framed} slot="lead">
        <ViewTabs
          label="Activity views"
          idPrefix="activity-view"
          value={tab}
          onChange={choose}
          tabs={[
            { key: "agents", label: "Agents" },
            { key: "log", label: "Call log" },
            { key: "setters", label: "Setters" },
            ...(reviewsZeroClick ? [
              { key: "review" as const, label: "To review", count: flagged || null, tone: "danger" as const },
              { key: "closeout" as const, label: "Close out", count: closeOuts || null, tone: "danger" as const },
            ] : []),
          ]}
        />
      </InReportsSlot>

      <div role="tabpanel" aria-labelledby={`activity-view-${tab}`} className="flex min-w-0 flex-col gap-6">
      {tab === "closeout" && reviewsZeroClick ? <AppointmentCloseOutStrip /> : (
      <TableCard
        className="min-w-0"
        title={tab === "review" ? "Calls flagged" : undefined}
        // Whose they are, in one line under the title, not a red box over the table.
        description={tab === "review" && !loading && concentration.total > 0 ? `${concentration.total.toLocaleString()} ${concentration.total === 1 ? "outcome was" : "outcomes were"} logged without a Dial press${concentration.top ? (concentration.top.count === concentration.total ? `, all by ${concentration.top.name}` : `, ${concentration.top.count.toLocaleString()} of them by ${concentration.top.name}`) : ""}.` : undefined}
        toolbar={
          <DataToolbar actions={<RefreshButton onClick={refresh} refreshing={loading || (tab === "setters" && settersLoading)} />}>
            {(tab === "log" || tab === "review") && <ToolbarSearch value={search} onChange={setSearch} placeholder="Search leads" />}
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
            {tab !== "setters" && <FilterButton open={filtersOpen} count={filterChips.length + (integrityFilter !== "any" ? 1 : 0)} controls="activity-filters" onClick={() => setFiltersOpen(!filtersOpen)} />}
            {tab === "setters" && setters?.scope === "team" && setters.roster.length > 0 && (
              <Segmented
                label="Setter list"
                value={setterList}
                onChange={(next) => { setSetterList(next); setSetterPage(1); }}
                options={[{ key: "outcomes", label: "Outcomes", count: setterRows.length }, { key: "roster", label: "Roster", count: setters.roster.length }]}
              />
            )}
          </DataToolbar>
        }
        filters={tab === "setters" ? undefined : <>
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
        </>}
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
              ].filter(Boolean).join(" · ")}
            />
          )
        ) : tab === "setters" && !settersLoading && (setterList === "roster" ? roster : setterRows).length > 0 ? (
          <Pager
            page={setterSlice.current}
            total={(setterList === "roster" ? roster : setterRows).length}
            pageSize={pageSize}
            noun={setterList === "roster" ? "setters" : "setter days"}
            onPage={setSetterPage}
            suffix={setterList === "roster" ? undefined : [windowLabel, setters?.scope === "own" ? "your own setter metrics" : null].filter(Boolean).join(" · ")}
          />
        ) : (
          <span>{windowLabel}{tab === "agents" && report?.scorecard.length ? " · open an agent for their calls and how they ended" : ""}</span>
        )}
      >
        {tab === "setters" ? (
          <>
            {settersError && <Callout tone="error" title="Setter outcomes did not load">{settersError}</Callout>}
            {settersLoading ? (
              <SectionLoading rows={4} columns={6} label="Loading setter outcomes" />
            ) : setterList === "roster" && roster.length > 0 ? (
              <table className="portal-activity-table w-full min-w-[640px] text-left text-sm">
                <thead><tr><th>Setter</th><th>Role</th><th>Local time</th><th>Timezone</th><th className="text-right">Shift</th></tr></thead>
                <tbody>
                  {rosterSlice.rows.map((member) => (
                    <tr key={member.userId}>
                      <td className="font-medium">{member.name}</td>
                      <td>{member.role}</td>
                      <td className="tabular-nums">{member.localLabel}</td>
                      <td className="text-muted-foreground">{member.timezone}</td>
                      <td className={`text-right text-xs font-semibold ${member.onShiftNow ? "text-[var(--success-ink)]" : "text-muted-foreground"}`}>{member.hasHours === false ? "No hours set" : member.onShiftNow ? "On shift" : "Off shift"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            ) : setterRows.length ? (
              <table className="portal-activity-table w-full min-w-[1160px] text-left text-sm">
                <thead><tr><th>Setter</th><th>Day</th><th className="text-right">Dials</th><th className="text-right">Contacts</th><th className="text-right">Booked</th><th className="text-right">Showed</th><th className="text-right">Show rate</th><th className="text-right">Coverage</th><th className="text-right">Closed out</th><th className="text-right">Sold</th><th>Close-out</th></tr></thead>
                <tbody>
                  {outcomeSlice.rows.map((row) => (
                    <tr key={`${row.userId}-${row.day}`}>
                      <td className="max-w-[180px] truncate font-medium" title={row.name}>{row.name}</td>
                      <td className="whitespace-nowrap tabular-nums text-muted-foreground">{row.day}</td>
                      <td className="text-right tabular-nums">{row.dials}</td>
                      <td className="text-right tabular-nums">{row.contacts}</td>
                      <td className="text-right tabular-nums">{row.booked}</td>
                      <td className="text-right tabular-nums">{row.showed}</td>
                      <td className="text-right tabular-nums">{row.showRatePct == null ? "—" : `${row.showRatePct}%`}</td>
                      <td className="text-right tabular-nums">{row.coveragePct == null ? "—" : `${row.coveragePct}%`}</td>
                      <td className="text-right tabular-nums">{row.closedOut}/{row.closeable}</td>
                      <td className="text-right tabular-nums">{row.sold}</td>
                      <td className="whitespace-nowrap">{row.neverClosedOut ? <span className="text-[var(--error-ink)]">{row.neverClosedOut} overdue</span> : row.pending ? `${row.pending} pending` : "Clear"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            ) : (
              <EmptyState title="No setter outcomes in this window" hint="Dials, bookings and shows, day by day." />
            )}
          </>
        ) : loading ? <SectionLoading rows={6} columns={6} />
          : tab === "agents" ? (
            report?.scorecard.length ? (
              <table className="portal-activity-table w-full min-w-[880px] text-left text-sm">
                <thead><tr><th>Agent</th><th className="text-right">Served</th><th className="text-right">Dialled</th><th className="text-right">Logged</th><th className="text-right"><span className="inline-flex items-center gap-1">Worked<InfoTip label="About worked">Logged outcomes that count as work, set in Settings → Dispositions.</InfoTip></span></th><th className="text-right">Contact rate</th><th className="text-right"><span className="block">Callbacks</span><span className="block text-xs font-normal">booked / kept</span></th><th className="text-right"><span className="block">Appointments</span><span className="block text-xs font-normal">booked / showed</span></th><th className="text-right"><span className="block">Applications</span><span className="block text-xs font-normal">started / submitted</span></th><th className="text-right"><span className="sr-only">Open</span></th></tr></thead>
                <tbody>
                  {report.scorecard.map((row) => {
                    const key = row.agent_user_id ?? "unknown";
                    return (
                      <tr key={key} className="m-row">
                        <td className="font-medium">{row.agent_user_id ? <Link href={agentHref(row.agent_user_id)} className="font-medium hover:underline">{row.agent_name ?? "Unknown agent"}</Link> : row.agent_name ?? "Unknown agent"}</td>
                        <td className="text-right tabular-nums">{row.served}</td>
                        <td className="text-right tabular-nums">{row.clicked}</td>
                        <td className="text-right tabular-nums">{row.logged}</td>
                        <td className="text-right tabular-nums" title="Logged outcomes that count as work, per Settings → Dispositions">{row.worked ?? 0}</td>
                        <td className="text-right tabular-nums">{row.contact_rate_percent == null ? "—" : `${row.contact_rate_percent}%`}</td>
                        <td className="text-right tabular-nums">{row.callbacks_booked} / {row.callbacks_kept}</td>
                        <td className="text-right tabular-nums">{row.appointments_booked} / {row.appointments_showed}</td>
                        <td className="text-right tabular-nums">{row.applications_started} / {row.applications_submitted}</td>
                        <td className="text-right">{row.agent_user_id ? <Button asChild size="sm" variant="outline"><Link href={agentHref(row.agent_user_id)} aria-label={`Open ${row.agent_name ?? "this agent"}`}>Open</Link></Button> : null}</td>
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
          ) : (
            <table className="portal-activity-table w-full min-w-[1180px] text-left text-sm">
              <thead>
                <tr>
                  <th scope="col">Agent</th>
                  <th scope="col">Campaign</th>
                  <th scope="col">Disposition</th>
                  <th scope="col">Led to</th>
                  <th scope="col"><span className="inline-flex items-center gap-1">Logged after<InfoTip label="About logged after">How long after the card opened the outcome was logged.</InfoTip></span></th>
                  <th scope="col">Lead</th>
                  <th scope="col">State</th>
                  {view === "integrity" && <th scope="col">Flag</th>}
                  <th scope="col" className="text-right">Served</th>
                  <th scope="col" className="text-right">Dialled</th>
                  <th scope="col" className="text-right">Attempt</th>
                </tr>
              </thead>
              <tbody className="m-seq">
                {entries.map((entry) => entry.kind === "blocked" ? (
                  <BlockedRow key={`blocked-${entry.row.id}`} row={entry.row} />
                ) : (
                  <ServedRow key={entry.row.id} row={entry.row} showFlags={view === "integrity"} />
                ))}
              </tbody>
            </table>
          )}
      </TableCard>
      )}
      </div>
    </div>
  );
}
