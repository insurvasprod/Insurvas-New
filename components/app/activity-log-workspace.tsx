"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { ChevronDown, Download, Search, SlidersHorizontal, X } from "lucide-react";

import { Button } from "@/components/ui/button";
import { PageHeader } from "@/components/ui/page-header";
import { StatTile, type MeterTone } from "@/components/ui/stat";
import { TableCard } from "@/components/ui/table-card";
import { sectionForPath } from "@/lib/menu/definition";
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
import { Callout, Pill } from "@/components/app/settings/primitives";

/**
 * Activity & scorecard, as the board draws it: four figures against the window before, one control
 * bar, the chips it has applied, and one table — with the scorecard and the data-integrity review
 * behind the view switch rather than stacked below it.
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
type IntegrityFilter = "any" | "zero_click_disposition";
type Range = "7" | "30" | "90" | "custom";
type SetterReport = {
  scope: "team" | "own";
  rows: Array<{ userId: string; name: string; day: string; dials: number; contacts: number; booked: number; showed: number; noShow: number; pending: number; neverClosedOut: number; sold: number; showRatePct: number | null; closedOut: number; closeable: number; coveragePct: number | null; bookPerContactPct: number | null }>;
  roster: Array<{ userId: string; name: string; role: string; timezone: string; localLabel: string; onShiftNow: boolean }>;
};

const PAGE_SIZE = 25;
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

function Chip({ label, onRemove }: { label: string; onRemove: () => void }) {
  return (
    <span className="inline-flex items-center gap-2 rounded-full border border-border bg-card py-1 pl-3 pr-2 text-xs font-semibold leading-normal tracking-[-0.01em] text-[var(--body)]">
      {label}
      <button type="button" onClick={onRemove} aria-label={`Remove ${label}`} className="inline-flex size-4 items-center justify-center rounded-full bg-[var(--surface-alt)] text-[var(--body)]">
        <X className="size-2.5" aria-hidden="true" />
      </button>
    </span>
  );
}

/**
 * A served card. Under the outcome, what it led to (each from its own record) and how long after
 * the card opened it was logged; under the lead, its state; under the time, the Dial press — or
 * that there was none, in red when an outcome was logged anyway.
 */
function ServedRow({ row, showFlags }: { row: ActivityRow; showFlags: boolean }) {
  const zeroClick = row.integrity_flags.includes("zero_click_disposition");
  const span = formatSpan(row.open_to_log_seconds);
  const details = outcomeDetails(row);
  return (
    <tr className={`m-row align-top ${zeroClick ? "bg-[var(--error-surface)]" : ""}`}>
      <td className="max-w-[130px] truncate" title={row.agent_name}>{row.agent_name}</td>
      <td className="max-w-[170px] truncate" title={row.campaign_name ?? undefined}>{row.campaign_name ?? "—"}</td>
      <td>
        {row.disposition ? <span className="font-semibold">{humanize(row.disposition)}</span> : <span className="text-muted-foreground">Not logged</span>}
        {details.map((line) => <span key={line} className="block text-xs text-muted-foreground">{line}</span>)}
        {row.disposition && span && (
          <span className={`block text-xs tabular-nums ${zeroClick ? "font-semibold text-[var(--error-ink)]" : "text-muted-foreground"}`}>Logged {span} after opening</span>
        )}
      </td>
      <td className="max-w-[260px]">
        <span className="block truncate" title={row.lead_name ?? undefined}>{row.lead_name ?? <span className="text-muted-foreground">Unnamed lead</span>}</span>
        {row.lead_state && <span className="block text-xs text-muted-foreground">{row.lead_state}</span>}
      </td>
      {showFlags && <td className="text-[var(--warning-ink)]">{row.integrity_flags.map((flag) => FLAG_LABEL[flag] ?? humanize(flag)).join(", ")}</td>}
      <td className="whitespace-nowrap text-right tabular-nums">
        {served(row.served_at)}
        {row.clicked_at ? (
          <span className="block text-xs text-muted-foreground">Dialled {clock(row.clicked_at)}</span>
        ) : row.disposition ? (
          <span className="block text-xs font-semibold text-[var(--error-ink)]">Never dialled</span>
        ) : (
          <span className="block text-xs text-muted-foreground">Not dialled</span>
        )}
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
  return (
    <tr className="m-row align-top">
      <td className="max-w-[130px] truncate" title={row.agent_name}>{row.agent_name}</td>
      <td className="max-w-[170px] truncate" title={row.campaign_name ?? undefined}>{row.campaign_name ?? "—"}</td>
      <td>
        <Pill tone="warning" dot>Blocked</Pill>
        <span className="mt-1 block text-xs font-semibold text-[var(--warning-ink)]">{refusalLabel(row.reason)}{row.inbound ? " · inbound return call" : ""}</span>
        {row.message && <span className="block text-xs text-muted-foreground">{row.message}</span>}
      </td>
      <td className="max-w-[260px]">
        <span className="block truncate" title={row.lead_name ?? undefined}>{row.lead_name ?? <span className="text-muted-foreground">Unnamed lead</span>}</span>
        {row.lead_state && <span className="block text-xs text-muted-foreground">{row.lead_state}</span>}
      </td>
      <td className="whitespace-nowrap text-right tabular-nums">
        {served(row.at)}
        <span className="block text-xs text-muted-foreground">Not placed</span>
      </td>
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
  const [view, setView] = useState<View>(initialView);
  const [integrityFilter, setIntegrityFilter] = useState<IntegrityFilter>("any");
  const zeroClickOnly = view === "integrity" && reviewsZeroClick && integrityFilter === "zero_click_disposition";
  const [page, setPage] = useState(1);
  const [showFilters, setShowFilters] = useState(false);

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
    params.set("page_size", String(PAGE_SIZE));
    return params.toString();
  }, [base, windows, debounced, view, page, zeroClickOnly]);

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
  useEffect(() => { if (view === "scorecard") void loadSetters(); }, [view, loadSetters]);

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

  const activeFilters = [
    agentId && { key: "agent", label: `Agent: ${agents.find(([id]) => id === agentId)?.[1] ?? "selected"}`, clear: () => setAgentId("") },
    campaignId && { key: "campaign", label: `Campaign: ${campaigns.find(([id]) => id === campaignId)?.[1] ?? "selected"}`, clear: () => setCampaignId("") },
    disposition && { key: "disposition", label: `Disposition: ${humanize(disposition)}`, clear: () => setDisposition("") },
  ].filter(Boolean) as { key: string; label: string; clear: () => void }[];

  const clearAll = () => { setAgentId(""); setCampaignId(""); setDisposition(""); setSearch(""); setPage(1); };
  const total = report?.total ?? 0;
  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const first = total === 0 ? 0 : (page - 1) * PAGE_SIZE + 1;
  const last = Math.min(page * PAGE_SIZE, total);
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

  return (
    <div className="m-stagger portal-activity-page flex flex-col gap-6">
      <PageHeader
        className="portal-activity-header"
        eyebrow={sectionForPath("/app/activity") ?? undefined}
        title="Activity & scorecard"
        description="What each agent did, and how it turned out."
        actions={
          <Button asChild variant="outline" className="h-11 border-[var(--border-strong)] px-4">
            <a href={`/api/app/activity?${exportQuery}`}><Download aria-hidden="true" />Export CSV</a>
          </Button>
        }
      />

      <div className="portal-activity-kpis grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
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
      </div>

      <div className="portal-activity-filters">
        <label className="relative inline-flex items-center">
          <span className="sr-only">Date range</span>
          <select
            value={range}
            onChange={(event) => { setRange(event.target.value as Range); setAnchor(now()); setPage(1); if (event.target.value === "custom") setShowFilters(true); }}
            className="appearance-none rounded-lg border border-[var(--border-strong)] bg-card pl-3.5 pr-9 font-semibold text-foreground"
          >
            <option value="7">Last 7 days</option>
            <option value="30">Last 30 days</option>
            <option value="90">Last 90 days</option>
            <option value="custom">Custom range</option>
          </select>
          <ChevronDown className="pointer-events-none absolute right-3 size-4 text-muted-foreground" aria-hidden="true" />
        </label>
        <label className="relative flex w-full items-center sm:w-[248px]">
          <Search className="pointer-events-none absolute left-3 size-4 text-muted-foreground" aria-hidden="true" />
          <input
            type="search"
            aria-label="Search leads"
            placeholder="Search leads"
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            className="w-full rounded-lg border border-[var(--border-strong)] bg-card pl-9 pr-3 text-foreground placeholder:text-muted-foreground"
          />
        </label>
        <Button type="button" variant="outline" aria-expanded={showFilters} onClick={() => setShowFilters((open) => !open)} className="border-[var(--border-strong)] px-3.5">
          <SlidersHorizontal aria-hidden="true" />Filters
          {activeFilters.length > 0 && (
            <span className="inline-flex h-5 min-w-5 items-center justify-center rounded-full bg-[var(--surface-alt)] px-1.5 text-xs font-semibold">{activeFilters.length}</span>
          )}
        </Button>
        <span className="flex-1" />
        <span role="group" aria-label="View" className="inline-flex gap-[3px] rounded-lg bg-[var(--surface-alt)] p-[3px]">
          {([["activity", "Activity"], ["scorecard", "Scorecard"], ["integrity", "Data integrity"]] as const).map(([key, label]) => (
            <button
              key={key}
              type="button"
              aria-pressed={view === key}
              onClick={() => { setView(key); setIntegrityFilter("any"); setPage(1); }}
              className={`!h-8 !min-h-8 rounded-lg px-3.5 text-sm font-semibold ${view === key ? "bg-card text-foreground shadow-[0_1px_2px_rgba(16,20,26,.08)]" : "bg-transparent text-muted-foreground"}`}
            >
              {label}
            </button>
          ))}
        </span>
      </div>

      {showFilters && (
        <div className="grid gap-3 rounded-lg border border-border bg-card p-4 sm:grid-cols-2 lg:grid-cols-5">
          <label className="text-xs font-semibold uppercase leading-[1.33] tracking-[0.02em] text-muted-foreground">
            Agent
            <select value={agentId} onChange={(event) => { setAgentId(event.target.value); setPage(1); }} className="mt-1.5 block h-10 w-full rounded-lg border border-[var(--border-strong)] bg-card px-3 text-sm font-normal normal-case tracking-normal text-foreground">
              <option value="">All agents</option>
              {agents.map(([id, name]) => <option key={id} value={id}>{name}</option>)}
            </select>
          </label>
          <label className="text-xs font-semibold uppercase leading-[1.33] tracking-[0.02em] text-muted-foreground">
            Campaign
            <select value={campaignId} onChange={(event) => { setCampaignId(event.target.value); setPage(1); }} className="mt-1.5 block h-10 w-full rounded-lg border border-[var(--border-strong)] bg-card px-3 text-sm font-normal normal-case tracking-normal text-foreground">
              <option value="">All campaigns</option>
              {campaigns.map(([id, name]) => <option key={id} value={id}>{name}</option>)}
            </select>
          </label>
          <label className="text-xs font-semibold uppercase leading-[1.33] tracking-[0.02em] text-muted-foreground">
            Disposition
            <select value={disposition} onChange={(event) => { setDisposition(event.target.value); setPage(1); }} className="mt-1.5 block h-10 w-full rounded-lg border border-[var(--border-strong)] bg-card px-3 text-sm font-normal normal-case tracking-normal text-foreground">
              <option value="">All dispositions</option>
              {dispositions.map((key) => <option key={key} value={key}>{humanize(key)}</option>)}
            </select>
          </label>
          {range === "custom" && (
            <>
              <label className="text-xs font-semibold uppercase leading-[1.33] tracking-[0.02em] text-muted-foreground">
                From
                <input type="date" value={customFrom} onChange={(event) => { setCustomFrom(event.target.value); setPage(1); }} className="mt-1.5 block h-10 w-full rounded-lg border border-[var(--border-strong)] bg-card px-3 text-sm font-normal normal-case tracking-normal text-foreground" />
              </label>
              <label className="text-xs font-semibold uppercase leading-[1.33] tracking-[0.02em] text-muted-foreground">
                To
                <input type="date" value={customTo} onChange={(event) => { setCustomTo(event.target.value); setPage(1); }} className="mt-1.5 block h-10 w-full rounded-lg border border-[var(--border-strong)] bg-card px-3 text-sm font-normal normal-case tracking-normal text-foreground" />
              </label>
            </>
          )}
        </div>
      )}

      <div className="flex flex-wrap items-center gap-2">
        {view === "integrity" && reviewsZeroClick && (
          <span role="group" aria-label="Flag" className="inline-flex gap-2">
            {([["any", "All flags"], ["zero_click_disposition", `Logged without a dial${now_?.zeroClick != null ? ` · ${now_.zeroClick.toLocaleString()}` : ""}`]] as const).map(([key, label]) => (
              <button
                key={key}
                type="button"
                aria-pressed={integrityFilter === key}
                onClick={() => { setIntegrityFilter(key); setPage(1); }}
                className={`rounded-full border px-3 py-1 text-xs font-semibold leading-normal ${integrityFilter === key
                  ? key === "zero_click_disposition" ? "border-[var(--error)] bg-[var(--error-surface)] text-[var(--error-ink)]" : "border-[var(--border-strong)] bg-card text-foreground"
                  : "border-border bg-card text-[var(--body)]"}`}
              >
                {label}
              </button>
            ))}
          </span>
        )}
        {activeFilters.map((filter) => <Chip key={filter.key} label={filter.label} onRemove={() => { filter.clear(); setPage(1); }} />)}
        {(activeFilters.length > 0 || debounced) && (
          <button type="button" onClick={clearAll} className="bg-transparent p-1 text-xs font-semibold text-foreground">Clear all</button>
        )}
        <span className="text-xs leading-normal tracking-[-0.01em] text-muted-foreground">
          {range === "custom" && !windows
            ? "Choose a from and to date"
            : view === "scorecard"
              ? windows?.label
              : `${total.toLocaleString()} of ${(inRange ?? total).toLocaleString()} ${view === "integrity" ? (zeroClickOnly ? "served leads logged without a dial" : "served leads flagged") : "served leads"}`}
        </span>
      </div>

      {error && <p role="alert" className="rounded-lg border border-[color-mix(in_srgb,var(--error)_24%,transparent)] bg-[var(--error-surface)] px-4 py-3 text-sm text-[var(--error-ink)]">{error}</p>}

      {view === "integrity" && reviewsZeroClick && !loading && concentration.total > 0 && (
        <Callout
          tone="error"
          title={`${concentration.total.toLocaleString()} ${concentration.total === 1 ? "outcome was" : "outcomes were"} logged without a Dial press${concentration.top ? (concentration.top.count === concentration.total ? `, all by ${concentration.top.name}` : `, ${concentration.top.count.toLocaleString()} of them by ${concentration.top.name}`) : ""}.`}
        >
          The dialer will not save an outcome before Dial is pressed, so each of these was recorded some other way: a call placed
          from a phone the platform cannot see, or an outcome for a call that never happened. Both are worth a conversation; only
          one is a data problem.
        </Callout>
      )}

      {view !== "scorecard" && (
        <TableCard
          footer={
            <>
              <span className="text-xs leading-normal tracking-[-0.01em] text-muted-foreground">
                {total === 0 ? `No ${noun}` : `Showing ${first}–${last} of ${total.toLocaleString()} ${noun} · newest first`}
                {blockedShown > 0 && ` · ${blockedShown.toLocaleString()} blocked ${blockedShown === 1 ? "dial" : "dials"} between them, not counted`}
              </span>
              <span className="flex gap-2">
                <Button type="button" variant="outline" size="sm" className="border-[var(--border-strong)] px-4" disabled={page <= 1 || loading} onClick={() => setPage((value) => value - 1)}>Previous</Button>
                <Button type="button" variant="outline" size="sm" className="border-[var(--border-strong)] px-4" disabled={page >= totalPages || loading} onClick={() => setPage((value) => value + 1)}>Next</Button>
              </span>
            </>
          }
        >
          <table className="portal-activity-table w-full min-w-[860px] text-left text-sm">
            <thead>
              <tr>
                <th scope="col" className="w-[130px]">Agent</th>
                <th scope="col" className="w-[170px]">Campaign</th>
                <th scope="col" className="w-[210px]">Disposition</th>
                <th scope="col">Lead</th>
                {view === "integrity" && <th scope="col" className="w-[210px]">Flag</th>}
                <th scope="col" className="w-[130px] text-right">Time</th>
                <th scope="col" className="w-[80px] text-right">Attempt</th>
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
          {!loading && entries.length === 0 && (
            <p className="px-4 py-8 text-center text-sm text-muted-foreground">
              {view === "integrity" ? "Nothing to review — every event in this window is consistent." : "No activity matched these filters."}
            </p>
          )}
        </TableCard>
      )}

      {view === "scorecard" && (
        <>
          <TableCard title="Agent scorecard" description="Served, dialled and logged are deliberately separate: a card can be opened and never dialled, and dialled and never logged. None of them is talk time.">
            <table className="portal-activity-table w-full min-w-[1050px] text-left text-sm">
              <thead><tr><th>Agent</th><th className="text-right">Served</th><th className="text-right">Dialled</th><th className="text-right">Logged</th><th className="text-right">Worked</th><th className="text-right">Contact rate</th><th className="text-right">Callbacks booked / kept</th><th className="text-right">Appointments booked / showed</th><th className="text-right">Applications started / submitted</th></tr></thead>
              <tbody>
                {report?.scorecard.map((row) => (
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
            {report?.scorecard.length === 0 && <p className="px-4 py-6 text-center text-sm text-muted-foreground">No activity in this window.</p>}
          </TableCard>

          <AppointmentCloseOutStrip />

          <TableCard
            title="Setter outcomes"
            description={`${setters?.scope === "own" ? "Your setter metrics only." : "Team setter metrics with outcome coverage and close-out status."} Show rate is always paired with coverage so a small sample is not mistaken for a stable result.`}
          >
            {settersError && <p className="mx-4 mb-4 rounded-lg border border-[color-mix(in_srgb,var(--error)_24%,transparent)] bg-[var(--error-surface)] p-3 text-sm text-[var(--error-ink)]" role="alert">{settersError}</p>}
            {settersLoading ? (
              <p className="px-4 py-6 text-center text-sm text-muted-foreground" role="status">Loading setter outcomes…</p>
            ) : setters?.rows.length ? (
              <table className="portal-activity-table w-full min-w-[1080px] text-left text-sm">
                <thead><tr><th>Setter / day</th><th className="text-right">Dials</th><th className="text-right">Contacts</th><th className="text-right">Booked</th><th className="text-right">Showed</th><th className="text-right">Show rate</th><th className="text-right">Coverage</th><th className="text-right">Sold</th><th>Close-out</th></tr></thead>
                <tbody>
                  {setters.rows.map((row) => (
                    <tr key={`${row.userId}-${row.day}`} className="align-top">
                      <td><span className="font-medium">{row.name}</span><br /><span className="text-xs text-muted-foreground">{row.day}</span></td>
                      <td className="text-right tabular-nums">{row.dials}</td>
                      <td className="text-right tabular-nums">{row.contacts}</td>
                      <td className="text-right tabular-nums">{row.booked}</td>
                      <td className="text-right tabular-nums">{row.showed}</td>
                      <td className="text-right tabular-nums">{row.showRatePct == null ? "—" : `${row.showRatePct}%`}</td>
                      <td className="text-right tabular-nums">{row.coveragePct == null ? "—" : `${row.coveragePct}%`}<span className="block text-xs text-muted-foreground">{row.closedOut}/{row.closeable} closed</span></td>
                      <td className="text-right tabular-nums">{row.sold}</td>
                      <td>{row.neverClosedOut ? <span className="text-[var(--error-ink)]">{row.neverClosedOut} overdue</span> : row.pending ? `${row.pending} pending` : "Clear"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            ) : (
              <p className="px-4 py-6 text-center text-sm text-muted-foreground">No setter outcomes in this window.</p>
            )}
            {setters?.scope === "team" && setters.roster.length > 0 && (
              <div className="border-t border-border px-4 py-4">
                <h3 className="mb-2 text-sm font-semibold">Setter roster</h3>
                <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
                  {setters.roster.map((member) => (
                    <div className="rounded-lg border border-border p-3 text-sm" key={member.userId}>
                      <div className="flex items-center justify-between gap-2">
                        <span className="font-medium">{member.name}</span>
                        <span className={`text-xs font-semibold ${member.onShiftNow ? "text-[var(--success-ink)]" : "text-muted-foreground"}`}>{member.onShiftNow ? "On shift" : "Off shift"}</span>
                      </div>
                      <p className="mt-1 text-xs text-muted-foreground">{member.role} · {member.localLabel} · {member.timezone}</p>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </TableCard>

          <TableCard title="Fresh vs recycled performance" description="Recycled contacts are reported separately from fresh acquisition; this is contact evidence, not talk time.">
            <table className="portal-activity-table w-full min-w-[640px] text-left text-sm">
              <thead><tr><th>Source</th><th className="text-right">Served</th><th className="text-right">Dialled</th><th className="text-right">Contacts</th><th className="text-right">Contact rate</th></tr></thead>
              <tbody>
                {report?.recycle_performance.map((row) => (
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
            {report?.recycle_performance.length === 0 && <p className="px-4 py-6 text-center text-sm text-muted-foreground">No fresh or recycled activity in this window.</p>}
          </TableCard>
        </>
      )}

      <div className="rounded-lg border border-border border-l-[3px] border-l-[var(--warning)] bg-[var(--warning-surface)] px-4 py-3.5 text-sm leading-normal tracking-[-0.02em]">
        <p className="font-semibold text-[var(--warning-ink)]">There is no talk-time column, on purpose</p>
        <p className="mt-1.5 text-[var(--body)]">
          Click-to-call hands the call to the handset, so the platform never sees its duration, and nothing here pretends to. What the
          log does know is when a card was opened, when Dial was pressed and when the outcome was logged. Every delta above names its
          comparison window.
        </p>
      </div>
    </div>
  );
}
