"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { Download } from "lucide-react";

import { Button } from "@/components/ui/button";
import { ClearFiltersButton, DataToolbar, RefreshButton, ToolbarSearch, toolbarControl } from "@/components/ui/data-toolbar";
import { PageHeader } from "@/components/ui/page-header";
import { PageLoading } from "@/components/ui/page-loading";
import { EmptyState, NoMatches, SectionLoading } from "@/components/ui/page-states";
import { StatStrip, StatTile, type MeterTone } from "@/components/ui/stat";
import { StatusChip } from "@/components/ui/status-chip";
import { TableCard } from "@/components/ui/table-card";
import { Segmented, ViewTabs } from "@/components/app/view-tabs";
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

/**
 * Activity & scorecard, laid out to the UI consistency standard (docs/design/UI-CONSISTENCY.md): one
 * strip of four figures against the window before, then the views as tabs (2026-10-06 redesign:
 * Activity, Scorecard, Setters, Close-out, Fresh vs recycled and Data integrity, one at a time,
 * where the scorecard view used to stack four tables), each one table whose toolbar holds the
 * search, the window and the filters on one line.
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
/** The tabs: the three the page can open on (?view=), plus the parts of the old scorecard view. */
type Tab = View | "setters" | "closeout" | "recycle";
type IntegrityFilter = "any" | "zero_click_disposition";
type Range = "7" | "30" | "90" | "custom";
type SetterReport = {
  scope: "team" | "own";
  rows: Array<{ userId: string; name: string; day: string; dials: number; contacts: number; booked: number; showed: number; noShow: number; pending: number; neverClosedOut: number; sold: number; showRatePct: number | null; closedOut: number; closeable: number; coveragePct: number | null; bookPerContactPct: number | null }>;
  roster: Array<{ userId: string; name: string; role: string; timezone: string; localLabel: string; onShiftNow: boolean; hasHours?: boolean }>;
};

/** The tab's one card reaches the bottom of the window. */
const FILL = "flex min-h-[calc(100dvh-var(--top-bar-h)-330px)] flex-col [&>*:nth-child(2)]:flex-1";
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

function humanize(value: string) {
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
function served(value: string) {
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

/** Rows per page that fit the window under the page's chrome (the Inbound list's rule). */
function useFittingPageSize(reserved: number, rowHeight: number) {
  const [size, setSize] = useState(10);
  useEffect(() => {
    const fit = () => setSize(Math.min(10, Math.max(5, Math.floor((window.innerHeight - reserved) / rowHeight))));
    fit();
    window.addEventListener("resize", fit);
    return () => window.removeEventListener("resize", fit);
  }, [reserved, rowHeight]);
  return size;
}

/**
 * A served card, one even row: the outcome, what it led to (each from its own record), how long
 * after the card opened it was logged, the lead and its state, when it was served and whether Dial
 * was pressed — or that it was not, in red when an outcome was logged anyway.
 */
function ServedRow({ row, showFlags }: { row: ActivityRow; showFlags: boolean }) {
  const zeroClick = row.integrity_flags.includes("zero_click_disposition");
  const span = formatSpan(row.open_to_log_seconds);
  const details = outcomeDetails(row).join(" · ");
  return (
    <tr className={`m-row ${zeroClick ? "bg-[var(--error-surface)]" : ""}`}>
      <td className="max-w-[140px] truncate" title={row.agent_name}>{row.agent_name}</td>
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
function BlockedRow({ row }: { row: BlockedDialRow }) {
  const reason = `${refusalLabel(row.reason)}${row.inbound ? " · inbound return call" : ""}`;
  const detail = [reason, row.message].filter(Boolean).join(" · ");
  return (
    <tr className="m-row">
      <td className="max-w-[140px] truncate" title={row.agent_name}>{row.agent_name}</td>
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

export function ActivityLogWorkspace({ initialView = "activity", role = "" }: { initialView?: View; role?: string } = {}) {
  const reviewsZeroClick = mayReviewZeroClick(role);
  const [range, setRange] = useState<Range>("30");
  // Set once mounted, not during render: the server and the browser would each read their own
  // "now", and the export link built from it would differ between the two (a hydration mismatch).
  const [anchor, setAnchor] = useState<number | null>(null);
  const [customFrom, setCustomFrom] = useState("");
  const [customTo, setCustomTo] = useState("");
  const [search, setSearch] = useState("");
  const [debounced, setDebounced] = useState("");
  const [agentId, setAgentId] = useState("");
  const [campaignId, setCampaignId] = useState("");
  const [disposition, setDisposition] = useState("");
  const [tab, setTab] = useState<Tab>(initialView);
  // The report the page reads: the integrity review for its tab, the activity log for every other.
  const view: View = tab === "integrity" ? "integrity" : tab === "activity" ? "activity" : "scorecard";
  const [integrityFilter, setIntegrityFilter] = useState<IntegrityFilter>("any");
  const zeroClickOnly = view === "integrity" && reviewsZeroClick && integrityFilter === "zero_click_disposition";
  const [page, setPage] = useState(1);
  const [setterPage, setSetterPage] = useState(1);
  const [setterList, setSetterList] = useState<"outcomes" | "roster">("outcomes");
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

  const setterDays = windows?.days ?? 30;
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
  const setterRows = setters?.rows ?? [];
  const roster = setters?.scope === "team" ? setters.roster : [];
  const outcomeSlice = paginate(setterRows, setterPage, pageSize);
  const rosterSlice = paginate(roster, setterPage, pageSize);
  const setterSlice = setterList === "roster" ? rosterSlice : outcomeSlice;
  const windowLabel = range === "custom" && !windows ? "Choose a from and to date" : windows?.label;

  // First read of the page: the one loading look, header and all.
  if (loading && !report && !error) return <PageLoading />;

  return (
    <div className="m-stagger flex flex-col gap-6">
      <PageHeader title="Activity & scorecard" description="What each agent did, and how it turned out." />

      <StatStrip label="Activity totals">
        <StatTile
          label="Leads served"
          value={loading || !now_ ? "…" : now_.served.toLocaleString()}
          valueTone={tone(now_?.served ?? null, then?.served ?? null)}
          footnote={
            <>
              {vs(then?.served)}
              {!loading && now_ && now_.served > 0 && (
                <span className="block font-semibold text-[var(--warning-ink)]">{now_.neverDialed.toLocaleString()} never dialled</span>
              )}
            </>
          }
        />
        <StatTile
          label="Dials"
          value={loading || !now_ ? "…" : now_.dials.toLocaleString()}
          valueTone={tone(now_?.dials ?? null, then?.dials ?? null)}
          footnote={
            <>
              {vs(then?.dials)}
              {!loading && now_ && reviewsZeroClick && now_.zeroClick != null && (
                <span className={`block font-semibold ${now_.zeroClick > 0 ? "text-[var(--error-ink)]" : "text-muted-foreground"}`}>{now_.zeroClick.toLocaleString()} logged with no dial</span>
              )}
              {!loading && now_ && (now_.blocked ?? 0) > 0 && (
                <span className="block">{(now_.blocked ?? 0).toLocaleString()} blocked, not counted</span>
              )}
            </>
          }
        />
        <StatTile label="Contact rate" value={loading || now_?.contactRate == null ? "—" : now_.contactRate} unit={loading || now_?.contactRate == null ? undefined : "%"} valueTone={tone(now_?.contactRate ?? null, then?.contactRate ?? null)} footnote={vs(then?.contactRate, "%")} />
        <StatTile label="Appointments" value={loading || !now_ ? "…" : now_.appointments.toLocaleString()} valueTone={tone(now_?.appointments ?? null, then?.appointments ?? null)} footnote={vs(then?.appointments)} />
      </StatStrip>

      {error && <p role="alert" className="rounded-lg border border-[color-mix(in_srgb,var(--error)_24%,transparent)] bg-[var(--error-surface)] px-4 py-2.5 text-sm text-[var(--error-ink)]">{error}</p>}

      {view === "integrity" && reviewsZeroClick && !loading && concentration.total > 0 && (
        <p role="note" className="rounded-lg border border-[color-mix(in_srgb,var(--error)_24%,transparent)] bg-[var(--error-surface)] px-4 py-2.5 text-sm font-semibold text-[var(--error-ink)]">
          {`${concentration.total.toLocaleString()} ${concentration.total === 1 ? "outcome was" : "outcomes were"} logged without a Dial press${concentration.top ? (concentration.top.count === concentration.total ? `, all by ${concentration.top.name}` : `, ${concentration.top.count.toLocaleString()} of them by ${concentration.top.name}`) : ""}.`}
        </p>
      )}

      {/* The views on the left; the export of what the log shows on the right. */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <ViewTabs
          label="Activity views"
          value={tab}
          onChange={choose}
          tabs={[
            { key: "activity", label: "Activity" },
            { key: "scorecard", label: "Scorecard" },
            { key: "setters", label: "Setters" },
            { key: "closeout", label: "Close-out" },
            { key: "recycle", label: "Fresh vs recycled" },
            { key: "integrity", label: "Data integrity" },
          ]}
        />
        <Button asChild variant="outline"><a href={`/api/app/activity?${exportQuery}`}><Download aria-hidden="true" />Export</a></Button>
      </div>

      {tab === "closeout" ? <AppointmentCloseOutStrip /> : (
      <TableCard
        className={FILL}
        toolbar={
          <DataToolbar
            actions={<>
              {filtered && <ClearFiltersButton onClick={clearAll} />}
              <RefreshButton onClick={refresh} refreshing={loading || (tab === "setters" && settersLoading)} />
            </>}
          >
            {(tab === "activity" || tab === "integrity") && <ToolbarSearch value={search} onChange={setSearch} placeholder="Search leads" />}
            <select
              aria-label="Date range"
              className={toolbarControl}
              value={range}
              onChange={(event) => { setRange(event.target.value as Range); setAnchor(now()); setPage(1); }}
            >
              <option value="7">Last 7 days</option>
              <option value="30">Last 30 days</option>
              <option value="90">Last 90 days</option>
              <option value="custom">Custom range</option>
            </select>
            {range === "custom" && (
              <>
                <input type="date" aria-label="From" className={toolbarControl} value={customFrom} onChange={(event) => { setCustomFrom(event.target.value); setPage(1); }} />
                <input type="date" aria-label="To" className={toolbarControl} value={customTo} onChange={(event) => { setCustomTo(event.target.value); setPage(1); }} />
              </>
            )}
            {tab !== "setters" && (
              <>
                <select aria-label="Agent" className={toolbarControl} value={agentId} onChange={(event) => { setAgentId(event.target.value); setPage(1); }}>
                  <option value="">All agents</option>
                  {agents.map(([id, name]) => <option key={id} value={id}>{name}</option>)}
                </select>
                <select aria-label="Campaign" className={toolbarControl} value={campaignId} onChange={(event) => { setCampaignId(event.target.value); setPage(1); }}>
                  <option value="">All campaigns</option>
                  {campaigns.map(([id, name]) => <option key={id} value={id}>{name}</option>)}
                </select>
                <select aria-label="Disposition" className={toolbarControl} value={disposition} onChange={(event) => { setDisposition(event.target.value); setPage(1); }}>
                  <option value="">All dispositions</option>
                  {dispositions.map((key) => <option key={key} value={key}>{humanize(key)}</option>)}
                </select>
              </>
            )}
            {tab === "integrity" && reviewsZeroClick && (
              <select aria-label="Flag" className={toolbarControl} value={integrityFilter} onChange={(event) => { setIntegrityFilter(event.target.value as IntegrityFilter); setPage(1); }}>
                <option value="any">All flags</option>
                <option value="zero_click_disposition">{`Logged without a dial${now_?.zeroClick != null ? ` · ${now_.zeroClick.toLocaleString()}` : ""}`}</option>
              </select>
            )}
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
        footer={tab === "activity" || tab === "integrity" ? (
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
          <span>{windowLabel}</span>
        )}
      >
        {tab === "setters" ? (
          <>
            {settersError && <p className="bg-[var(--error-surface)] px-4 py-2.5 text-sm text-[var(--error-ink)]" role="alert">{settersError}</p>}
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
              <EmptyState title="No setter outcomes in this window" hint="Setters' dials, bookings and shows appear here day by day." />
            )}
          </>
        ) : loading ? <SectionLoading rows={6} columns={6} />
          : tab === "scorecard" ? (
            report?.scorecard.length ? (
              <table className="portal-activity-table w-full min-w-[1050px] text-left text-sm">
                <thead><tr><th>Agent</th><th className="text-right">Served</th><th className="text-right">Dialled</th><th className="text-right">Logged</th><th className="text-right">Worked</th><th className="text-right">Contact rate</th><th className="text-right">Callbacks booked / kept</th><th className="text-right">Appointments booked / showed</th><th className="text-right">Applications started / submitted</th></tr></thead>
                <tbody>
                  {report.scorecard.map((row) => (
                    <tr key={row.agent_user_id ?? "unknown"}>
                      <td className="font-medium">{row.agent_name ?? "Unknown agent"}</td>
                      <td className="text-right tabular-nums">{row.served}</td>
                      <td className="text-right tabular-nums">{row.clicked}</td>
                      <td className="text-right tabular-nums">{row.logged}</td>
                      <td className="text-right tabular-nums" title="Logged outcomes that count as work, per Settings → Dispositions">{row.worked ?? 0}</td>
                      <td className="text-right tabular-nums">{row.contact_rate_percent == null ? "—" : `${row.contact_rate_percent}%`}</td>
                      <td className="text-right tabular-nums">{row.callbacks_booked} / {row.callbacks_kept}</td>
                      <td className="text-right tabular-nums">{row.appointments_booked} / {row.appointments_showed}</td>
                      <td className="text-right tabular-nums">{row.applications_started} / {row.applications_submitted}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            ) : filtered ? <NoMatches noun="agents" onClear={clearAll} /> : <EmptyState title="No activity in this window" hint="Each agent's served leads, dials and outcomes appear here." />
          ) : tab === "recycle" ? (
            report?.recycle_performance.length ? (
              <table className="portal-activity-table w-full min-w-[640px] text-left text-sm">
                <thead><tr><th>Source</th><th className="text-right">Served</th><th className="text-right">Dialled</th><th className="text-right">Contacts</th><th className="text-right">Contact rate</th></tr></thead>
                <tbody>
                  {report.recycle_performance.map((row) => (
                    <tr key={row.source_type}>
                      <td className="font-medium capitalize">{row.source_type}</td>
                      <td className="text-right tabular-nums">{row.served}</td>
                      <td className="text-right tabular-nums">{row.clicked}</td>
                      <td className="text-right tabular-nums">{row.contacts}</td>
                      <td className="text-right tabular-nums">{row.contact_rate_percent == null ? "—" : `${row.contact_rate_percent}%`}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            ) : filtered ? <NoMatches noun="sources" onClear={clearAll} /> : <EmptyState title="No fresh or recycled activity in this window" hint="Dials on fresh and recycled leads are compared here." />
          ) : entries.length === 0 ? (
            filtered
              ? <NoMatches noun={view === "integrity" ? "flagged events" : "served leads"} onClear={clearAll} />
              : view === "integrity"
                ? <EmptyState title="Nothing to review" hint="Every event in this window is consistent." />
                : <EmptyState title="No activity in this window" hint="Each lead served to an agent appears here, newest first." />
          ) : (
            <table className="portal-activity-table w-full min-w-[1180px] text-left text-sm">
              <thead>
                <tr>
                  <th scope="col">Agent</th>
                  <th scope="col">Campaign</th>
                  <th scope="col">Disposition</th>
                  <th scope="col">Led to</th>
                  <th scope="col" title="How long after the card opened the outcome was logged">Logged after</th>
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
  );
}
