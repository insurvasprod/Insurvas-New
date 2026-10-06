"use client";

/**
 * /app/deal-flow — Daily deal flow, built to the p-app-deal-flow board.
 *
 * Every figure is read, not drawn. The Status pill is the lead's CURRENT pipeline stage, toned by
 * its stage type; the KPIs are computed by list_deal_flow_report over the whole filtered range, not
 * the page on screen; the timeline shows only events something actually recorded. Before migration
 * 20260924320000 the service rebuilds what it can from the old report and the page says what is
 * missing (disposition history and issued policies).
 *
 * There are no lead numbers. A deal is named by its customer, with a copyable short ID.
 *
 * 2026-10-06 redesign: Deals, the dial funnel and the partner summary are tabs under the title with
 * Export and Add deal update on the right of the same row. A deal opens in a side panel (X or Esc
 * closes it) and the table drops its Campaign and Vendor columns while it is open; adding and
 * editing a deal open in dialogs instead of cards pushed into the page.
 */

import { useCallback, useEffect, useMemo, useRef, useState, type FormEvent, type ReactNode } from "react";
import Link from "next/link";
import { Copy, Download, Plus, X } from "lucide-react";

import { Button } from "@/components/ui/button";
import { ClearFiltersButton, DataToolbar, FilterButton, RefreshButton, ToolbarSearch, toolbarControl } from "@/components/ui/data-toolbar";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { PageHeader } from "@/components/ui/page-header";
import { PageLoading } from "@/components/ui/page-loading";
import { EmptyState, NoMatches, SectionLoading } from "@/components/ui/page-states";
import { StatStrip, StatTile } from "@/components/ui/stat";
import { StatusChip, type StatusTone } from "@/components/ui/status-chip";
import { TableCard } from "@/components/ui/table-card";
import { ViewTabs } from "@/components/app/book-of-business-views";
import { DealFlowFunnel } from "@/components/app/deal-flow-funnel";
import { IssuedPolicyPanel } from "@/components/app/issued-policy-panel";
import { Field, KeyValues, control, st } from "@/components/app/settings/primitives";
import { intakeLocalDate } from "@/lib/dealFlow/localDate";
import {
  DEAL_FLOW_PAGE_SIZE,
  DEAL_FLOW_STAGE_TYPES,
  DEAL_FLOW_STATUSES,
  STAGE_TYPE_LABEL,
  shortLeadId,
  type DealFlowReport,
  type DealFlowRow,
  type DealFlowStageType,
  type DealFlowStatus,
} from "@/lib/dealFlow/types";
import { formatCentsAsCurrency, parseDollarsToCents } from "@/lib/money";
import { notify } from "@/lib/notify";
import { cn } from "@/lib/utils";
import { Pager } from "@/components/ui/pager";

type Data = DealFlowReport & { readOnly: boolean };
type Filters = { from: string; to: string; partner_id: string; product_line: string; agent_id: string; stage_type: string; status: string };
type Draft = { local_date: string; carrier: string; product_type: string; monthly_premium: string; face_amount: string; draft_date: string; status: DealFlowStatus; call_result: string; notes: string };

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const DEAL_RECORD_LABEL: Record<DealFlowStatus, string> = { partial: "Partial", completed: "Completed", dropped: "Dropped" };
const STAGE_TONE: Record<DealFlowStageType, StatusTone> = { open: "info", won: "good", lost: "danger" };
const MONEY_HINT = "Money values must use dollars and cents, for example 71.40";

const label12 = "text-xs leading-[1.33] font-semibold tracking-[0.02em] uppercase text-[var(--muted)]";
type View = "deals" | "funnel" | "partners";

function todayFor(timeZone: string | null) {
  if (timeZone) {
    try {
      return intakeLocalDate(timeZone);
    } catch {
      /* an unknown zone falls through to the browser's day */
    }
  }
  return new Intl.DateTimeFormat("en-CA").format(new Date());
}

/** "22 Sep 2026" — built by hand because en-GB now abbreviates September as "Sept". */
function formatDay(value: string | null | undefined) {
  if (!value) return "—";
  const [y, m, d] = value.slice(0, 10).split("-").map(Number);
  if (!y || !m || !d) return value;
  return `${d} ${MONTHS[m - 1]} ${y}`;
}

/** "22 Sep, 11:04" (or "22 Sep 11:04" for the timeline), on the agency's clock when it has one. */
function formatStamp(value: string | null | undefined, timeZone: string | null, comma = true) {
  if (!value) return null;
  const at = new Date(value);
  if (Number.isNaN(at.getTime())) return null;
  let parts: Intl.DateTimeFormatPart[];
  try {
    parts = new Intl.DateTimeFormat("en-GB", { timeZone: timeZone ?? undefined, day: "numeric", month: "numeric", hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).formatToParts(at);
  } catch {
    parts = new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "numeric", hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).formatToParts(at);
  }
  const part = (type: string) => parts.find((p) => p.type === type)?.value ?? "";
  return `${part("day")} ${MONTHS[Number(part("month")) - 1] ?? ""}${comma ? "," : ""} ${part("hour")}:${part("minute")}`;
}

function rangeText(from: string, to: string) {
  return `${formatDay(from)} – ${formatDay(to)}`;
}

/** "Rosa Delgado" → "R. Delgado", the board's owner form. */
function shortPerson(name: string) {
  const words = name.trim().split(/\s+/);
  if (words.length < 2 || ["Unassigned", "Unknown agent"].includes(name)) return name;
  return `${words[0][0]}. ${words.slice(1).join(" ")}`;
}

function humanise(key: string | null | undefined) {
  if (!key) return null;
  const words = key.replace(/_/g, " ").trim();
  return words ? words[0].toUpperCase() + words.slice(1) : null;
}

/** The disposition as its label, never its key. */
function dispositionLabel(row: DealFlowRow) {
  return row.call_result_label ?? humanise(row.call_result);
}

function annualised(cents: number | null) {
  return cents == null ? "—" : formatCentsAsCurrency(cents * 12);
}

function money(cents: number | null) {
  return cents == null ? "—" : formatCentsAsCurrency(cents);
}

function customerName(row: DealFlowRow) {
  return row.insured_name ?? "Unnamed customer";
}

function draftFor(row: DealFlowRow): Draft {
  return { local_date: row.local_date, carrier: row.carrier ?? "", product_type: row.product_type ?? "", monthly_premium: row.monthly_premium_cents == null ? "" : (row.monthly_premium_cents / 100).toFixed(2), face_amount: row.face_amount_cents == null ? "" : (row.face_amount_cents / 100).toFixed(2), draft_date: row.draft_date ?? "", status: row.status, call_result: row.call_result ?? "", notes: row.notes ?? "" };
}

type TimelineTone = "success" | "info" | "muted" | "error";
type TimelineItem = { title: string; sub: string; tone: TimelineTone; at: number };

/** Real events only: where the deal came from, what was recorded on it, and an issued policy if one exists. */
function timelineFor(row: DealFlowRow, timeZone: string | null): TimelineItem[] {
  const items: TimelineItem[] = [];
  const time = (value: string | null) => { const at = value ? Date.parse(value) : NaN; return Number.isNaN(at) ? 0 : at; };
  const joined = (...parts: Array<string | null | undefined>) => parts.filter(Boolean).join(" · ");
  if (row.issued_at) items.push({ title: "Policy issued", sub: joined("Issued policy on file", formatStamp(row.issued_at, timeZone, false)), tone: "success", at: time(row.issued_at) });
  const latest = dispositionLabel(row);
  const latestAt = time(row.disposition_at);
  if (latest) items.push({ title: latest, sub: joined(row.disposition_by_name, formatStamp(row.disposition_at, timeZone, false) ?? "time not recorded"), tone: row.stage_type === "lost" ? "error" : "info", at: latestAt || time(row.created_at) + 1 });
  for (const event of row.history) {
    const at = time(event.at);
    // The latest outcome is usually also the newest history entry; it is shown once.
    if (latest && latestAt && Math.abs(at - latestAt) < 120_000) continue;
    items.push({ title: event.label ?? humanise(event.disposition) ?? "Call outcome recorded", sub: joined(event.by_name, formatStamp(event.at, timeZone, false)), tone: "info", at });
  }
  const created = formatStamp(row.created_at, timeZone, false);
  if (row.manual_entry || row.source === "manual") items.push({ title: `Added by ${row.agent_name === "Unassigned" ? "a teammate" : row.agent_name}`, sub: joined("Deal update", created), tone: "muted", at: time(row.created_at) });
  else if (row.source === "outbound") items.push({ title: "Application started", sub: joined(row.worked_by ? row.agent_name : null, created), tone: "muted", at: time(row.created_at) });
  else items.push({ title: `Received from ${row.partner_name}`, sub: joined(row.partner_id ? "Partner submission" : null, created), tone: "muted", at: time(row.created_at) });
  return items.sort((a, b) => b.at - a.at);
}

function Timeline({ items }: { items: TimelineItem[] }) {
  const dot: Record<TimelineTone, string> = { success: "bg-[var(--success)]", info: "bg-[var(--info)]", muted: "bg-[var(--muted)]", error: "bg-[var(--error)]" };
  return (
    <ol className="m-0 flex list-none flex-col gap-3.5 p-0">
      {items.map((item, index) => (
        <li key={`${item.title}-${item.at}-${index}`} className="flex gap-3">
          <span aria-hidden className={cn("mt-1.5 size-[7px] shrink-0 rounded-full", dot[item.tone])} />
          <span className="min-w-0">
            <span className="block text-sm font-semibold tracking-[-0.02em] text-[var(--ink)]">{item.title}</span>
            <span className="block text-xs tracking-[-0.01em] text-[var(--muted)] tabular-nums">{item.sub}</span>
          </span>
        </li>
      ))}
    </ol>
  );
}

/** A message the reader must act on now: one line, the shared alert look. */
function Alert({ tone, children }: { tone: "info" | "warning" | "error"; children: ReactNode }) {
  const look = tone === "error"
    ? "border-l-[var(--error)] bg-[var(--error-surface)] text-[var(--error-ink)]"
    : tone === "warning"
      ? "border-l-[var(--warning)] bg-[var(--warning-surface)] text-[var(--warning-ink)]"
      : "border-l-[var(--info)] bg-[var(--info-surface)] text-[var(--info-ink)]";
  return <div role={tone === "error" ? "alert" : "status"} className={cn("rounded-lg border border-border border-l-[3px] px-4 py-3 text-sm", look)}>{children}</div>;
}

function StagePill({ row }: { row: DealFlowRow }) {
  if (!row.stage_name) return <StatusChip tone="neutral" dot>No stage</StatusChip>;
  return <StatusChip tone={STAGE_TONE[row.stage_type ?? "open"]} dot>{row.stage_name}</StatusChip>;
}

function CopyId({ leadId }: { leadId: string }) {
  const id = shortLeadId(leadId);
  function copy() {
    if (!navigator.clipboard) { notify.block("Copying is not available in this browser", { detail: `The short ID is ${id}.` }); return; }
    navigator.clipboard.writeText(id).then(() => notify.done(`Copied ${id}`), () => notify.block("Could not copy the ID", { detail: `The short ID is ${id}.` }));
  }
  return (
    <button type="button" onClick={copy} aria-label={`Copy short ID ${id}`} title="Copy short ID" className="inline-flex items-center gap-1 rounded-[6px] px-1.5 align-middle font-mono text-xs font-normal tracking-normal text-[var(--muted)] hover:bg-[var(--surface-alt)] hover:text-[var(--ink)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--ring-color)]">
      {id}
      <Copy aria-hidden className="size-3.5" />
    </button>
  );
}

function queryFor(active: Filters, search: string, page: number | null, focusLeadId: string | null) {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(active)) if (value) params.set(key, value);
  if (search) params.set("search", search);
  if (focusLeadId) params.set("focus_lead_id", focusLeadId);
  if (page != null) params.set("page", String(page));
  params.set("page_size", String(DEAL_FLOW_PAGE_SIZE));
  return params.toString();
}

export function DealFlowWorkspace({ focusLeadId, timeZone = null }: { focusLeadId?: string | null; timeZone?: string | null }) {
  const today = todayFor(timeZone);
  const focus = focusLeadId ?? null;
  const [filters, setFilters] = useState<Filters>({ from: today, to: today, partner_id: "", product_line: "", agent_id: "", stage_type: "", status: "" });
  const [active, setActive] = useState<Filters>(filters);
  // null asks the report for the page that holds the focused deal.
  const [page, setPage] = useState<number | null>(focus ? null : 1);
  const [searchTerm, setSearchTerm] = useState("");
  const [search, setSearch] = useState("");
  const [data, setData] = useState<Data | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [editing, setEditing] = useState<string | null>(null);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [saving, setSaving] = useState(false);
  const [showFilters, setShowFilters] = useState(false);
  const [showManual, setShowManual] = useState(false);
  const [tab, setTab] = useState<View>("deals");
  // The deal panel opens on a click, or on arrival from the disposition wizard with a focus.
  const [panelOpen, setPanelOpen] = useState(Boolean(focus));
  const filtersRef = useRef<HTMLDivElement>(null);
  const [manual, setManual] = useState({ product_line: "term_life", insured_name: "", phone: "", partner_id: "", local_date: today, carrier: "", product_type: "", monthly_premium: "", face_amount: "", draft_date: "", initial_quote: "", notes: "" });
  const requestRef = useRef(0);
  const scrolledRef = useRef(false);

  const query = useMemo(() => queryFor(active, search, page, focus), [active, search, page, focus]);
  const load = useCallback(async (qs: string) => {
    const id = ++requestRef.current;
    setLoading(true);
    setError("");
    const response = await fetch(`/api/app/deal-flow?${qs}`, { cache: "no-store" }).catch(() => null);
    const body = response ? await response.json().catch(() => null) : null;
    if (id !== requestRef.current) return;
    if (!response || !response.ok) setError(body?.error ?? "Could not load daily deal flow");
    else setData(body as Data);
    setLoading(false);
  }, []);
  // The report refetches whenever the applied filters, search or page change.
  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(() => { void load(query); }, [query, load]);

  // Search runs in the report, a moment after typing stops.
  useEffect(() => {
    const next = searchTerm.trim();
    if (next === search) return;
    const timer = window.setTimeout(() => {
      setSearch(next);
      setPage(1);
    }, 300);
    return () => window.clearTimeout(timer);
  }, [searchTerm, search]);

  // The disposition wizard lands here with a focus; bring that row into view once.
  useEffect(() => {
    if (!focus || scrolledRef.current || !data) return;
    const row = document.querySelector<HTMLTableRowElement>(`[data-lead-id="${CSS.escape(focus)}"]`);
    if (!row) return;
    scrolledRef.current = true;
    const timer = window.setTimeout(() => row.scrollIntoView({ behavior: "smooth", block: "center" }), 100);
    return () => window.clearTimeout(timer);
  }, [data, focus]);

  const csvHref = useMemo(() => { const params = new URLSearchParams(queryFor(active, search, 1, null)); params.delete("page"); params.delete("page_size"); params.set("format", "csv"); return `/api/app/deal-flow?${params.toString()}`; }, [active, search]);
  const pinned = data?.focus && !data.focus.inFilter ? data.focus.row : null;
  const tableRows = useMemo(() => (pinned ? [pinned, ...(data?.rows ?? [])] : data?.rows ?? []), [data?.rows, pinned]);
  const selectedRow = tableRows.find((row) => row.id === selectedId) ?? tableRows.find((row) => row.lead_id === focus) ?? tableRows[0] ?? null;
  const focusedRow = focus ? tableRows.find((row) => row.lead_id === focus) ?? null : null;
  const extraFilters = [active.partner_id, active.stage_type, active.status, active.product_line, active.agent_id].filter(Boolean).length;

  // Every toolbar control applies as it changes. A date range is only applied once it is whole and
  // in order; until then the inputs hold it (their min/max keep it in order).
  function applyFilter(patch: Partial<Filters>) {
    const next = { ...filters, ...patch };
    setFilters(next);
    if (!next.from || !next.to || next.from > next.to) return;
    setActive(next);
    setPage(1);
  }
  function setDate(key: "from" | "to", value: string) {
    applyFilter({ [key]: value });
  }
  function resetToToday() {
    const next = { ...filters, from: today, to: today };
    setFilters(next);
    setActive(next);
    setPage(1);
  }
  function clearFilters() {
    const next = { ...active, partner_id: "", product_line: "", agent_id: "", stage_type: "", status: "" };
    setFilters(next);
    setActive(next);
    setSearchTerm("");
    setSearch("");
    setPage(1);
  }
  function startEdit(row: DealFlowRow) {
    setSelectedId(row.id);
    setEditing(row.id);
    setDraft(draftFor(row));
  }
  function openRow(row: DealFlowRow) {
    setSelectedId(row.id);
    setPanelOpen(true);
  }
  function cancelEdit() { setEditing(null); setDraft(null); }
  async function saveRow(event: FormEvent, row: DealFlowRow) {
    event.preventDefault();
    if (!draft) return;
    const monthly = parseDollarsToCents(draft.monthly_premium);
    const face = parseDollarsToCents(draft.face_amount);
    if ((draft.monthly_premium && monthly == null) || (draft.face_amount && face == null)) { notify.block(MONEY_HINT); return; }
    setSaving(true);
    const response = await fetch(`/api/app/deal-flow/${row.id}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ ...draft, monthly_premium_cents: monthly, face_amount_cents: face, draft_date: draft.draft_date || null }) }).catch(() => null);
    const body = response ? await response.json().catch(() => null) : null;
    setSaving(false);
    if (!response || !response.ok) { notify.block(body?.error ?? "Could not save deal"); return; }
    notify.done("Deal saved");
    cancelEdit();
    void load(query);
  }
  async function createManual(event: FormEvent) {
    event.preventDefault();
    const monthly = parseDollarsToCents(manual.monthly_premium);
    const face = parseDollarsToCents(manual.face_amount);
    if ((manual.monthly_premium && monthly == null) || (manual.face_amount && face == null)) { notify.block(MONEY_HINT); return; }
    setSaving(true);
    const response = await fetch("/api/app/deal-flow", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ ...manual, monthly_premium_cents: monthly, face_amount_cents: face, draft_date: manual.draft_date || null, partner_id: manual.partner_id || null }) }).catch(() => null);
    const body = response ? await response.json().catch(() => null) : null;
    setSaving(false);
    if (!response || !response.ok) { notify.block(body?.error ?? "Could not add the deal update"); return; }
    notify.done("Deal added to the flow");
    setShowManual(false);
    setManual({ ...manual, insured_name: "", phone: "", carrier: "", product_type: "", monthly_premium: "", face_amount: "", draft_date: "", initial_quote: "", notes: "" });
    void load(query);
  }

  // The Filters popover closes on Escape and on a click outside it; the deal panel closes on Escape.
  useEffect(() => {
    if (!showFilters) return;
    const onDown = (event: MouseEvent) => { if (filtersRef.current && !filtersRef.current.contains(event.target as Node)) setShowFilters(false); };
    const onKey = (event: KeyboardEvent) => { if (event.key === "Escape") setShowFilters(false); };
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => { document.removeEventListener("mousedown", onDown); document.removeEventListener("keydown", onKey); };
  }, [showFilters]);
  useEffect(() => {
    if (!panelOpen) return;
    const onKey = (event: KeyboardEvent) => { if (event.key === "Escape" && !document.querySelector("[role=dialog][data-state=open]")) setPanelOpen(false); };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [panelOpen]);

  const header = <PageHeader title="Daily deal flow" />;
  const pageActions = (
    <>
      <Button asChild variant="outline"><a href={csvHref} aria-label="Export the deals in this range as CSV"><Download aria-hidden="true" />Export</a></Button>
      <Button type="button" disabled={!data || data.readOnly} onClick={() => setShowManual(true)}>
        <Plus aria-hidden="true" />
        Add deal update
      </Button>
    </>
  );

  if (!data) {
    if (!error) return <PageLoading />;
    return (
      <div className="m-stagger flex w-full min-w-0 flex-col gap-6">
        {header}
        <Alert tone="error">
          Daily deal flow did not load: {error}{" "}
          <button type="button" className="font-semibold underline underline-offset-2" onClick={() => void load(query)}>Try again</button>
        </Alert>
      </div>
    );
  }

  const kpis = data.kpis;
  const isToday = active.from === today && active.to === today;
  const hasNarrowing = extraFilters > 0 || !!search;
  const update = (key: keyof Draft, value: string) => setDraft((current) => (current ? { ...current, [key]: value } : current));
  const oldest = kpis.oldest_in_progress_days;
  const inProgressFoot = kpis.in_progress === 0 ? "none open" : oldest == null ? "no start time recorded" : oldest < 1 ? "oldest under a day" : `oldest ${oldest} ${oldest === 1 ? "day" : "days"}`;
  const wonFoot = `${formatCentsAsCurrency(kpis.won_annualised_cents)} annualised${kpis.won_unpriced > 0 ? ` · ${kpis.won_unpriced} with no premium` : ""}`;
  const dayTitle = `Dates are the agent’s local day${timeZone ? `; today is ${formatDay(today)} in ${timeZone}` : ""}`;
  // applyFilter holds an incomplete or reversed range without applying it; say so while it is held.
  const rangeProblem = !filters.from || !filters.to ? "Choose both a From and a To date" : filters.from > filters.to ? "From must be on or before To" : null;
  const showPanel = panelOpen && tab === "deals" && selectedRow !== null;
  const editingRow = editing && draft ? tableRows.find((row) => row.id === editing) ?? null : null;
  const columns = showPanel ? 6 : 8;

  return (
    <div className="m-stagger flex w-full min-w-0 flex-col gap-6">
      {header}

      {/* The views on the left, the page's actions on the right: one row under the title. */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <ViewTabs
          label="Deal flow views"
          active={tab}
          onChange={setTab}
          tabs={[
            { key: "deals", label: "Deals", count: data.total },
            { key: "funnel", label: "Dial funnel" },
            { key: "partners", label: "By partner", count: data.summary.length },
          ]}
        />
        <div className="flex flex-wrap items-center gap-2">{pageActions}</div>
      </div>

      {data.readOnly && <Alert tone="warning">Your account is read-only. You can review and export the deal flow, but cannot add or edit deals.</Alert>}
      {data.schemaPending && <Alert tone="warning">Disposition history and issued policies need a database update that has not been applied yet.</Alert>}
      {data.focus && !data.focus.inFilter && !data.focus.row && <Alert tone="info">The lead you came from has no deal-flow row yet.</Alert>}
      {data.capped && <Alert tone="warning">Only the first 10,000 deals are shown. Narrow the date range to see the rest.</Alert>}
      {error && (
        <Alert tone="error">
          The latest refresh failed: {error}{" "}
          <button type="button" className="font-semibold underline underline-offset-2" onClick={() => void load(query)}>Try again</button>
        </Alert>
      )}

      <StatStrip label="Deal flow summary">
        <StatTile label="Deals worked" value={kpis.deals_worked} footnote={isToday ? "today" : active.from === active.to ? formatDay(active.from) : rangeText(active.from, active.to)} />
        <StatTile label="Won" value={kpis.won} valueTone={kpis.won ? "good" : undefined} footnote={wonFoot} />
        <StatTile label="In progress" value={kpis.in_progress} valueTone={kpis.in_progress ? "warning" : undefined} footnote={inProgressFoot} />
        <StatTile label="Lost" value={kpis.lost} valueTone={kpis.lost ? "danger" : undefined} footnote="no longer active" />
      </StatStrip>

      {tab === "deals" && (
        <div className="flex flex-col gap-4 lg:flex-row lg:items-stretch">
          <TableCard
            className="relative z-20 flex min-h-[calc(100dvh-var(--top-bar-h)-360px)] min-w-0 flex-1 flex-col [&>.overflow-x-auto]:flex-1"
            toolbar={
              <DataToolbar actions={<>
                {hasNarrowing && <ClearFiltersButton onClick={clearFilters} />}
                <RefreshButton onClick={() => void load(query)} refreshing={loading} />
              </>}>
                <ToolbarSearch value={searchTerm} onChange={setSearchTerm} placeholder="Customer, phone, campaign, ID…" label="Search deals" />
                <input type="date" aria-label="From" title={dayTitle} className={toolbarControl} value={filters.from} max={filters.to || undefined} onChange={(event) => setDate("from", event.target.value)} />
                <input type="date" aria-label="To" title={dayTitle} className={toolbarControl} value={filters.to} min={filters.from || undefined} onChange={(event) => setDate("to", event.target.value)} />
                {rangeProblem && <span role="alert" className="text-xs font-semibold text-[var(--error-ink)]">{rangeProblem}</span>}
                {!isToday && <Button type="button" variant="outline" onClick={resetToToday} aria-label="Show today’s deals">Today</Button>}
                <select aria-label="Filter by partner" className={cn(toolbarControl, "max-w-[200px]")} value={filters.partner_id} onChange={(event) => applyFilter({ partner_id: event.target.value })}>
                  <option value="">All partners</option>
                  {data.options.partners.map((partner) => <option key={partner.id} value={partner.id}>{partner.name}</option>)}
                </select>
                <select aria-label="Filter by status" className={toolbarControl} value={filters.stage_type} onChange={(event) => applyFilter({ stage_type: event.target.value })}>
                  <option value="">All statuses</option>
                  {DEAL_FLOW_STAGE_TYPES.map((type) => <option key={type} value={type}>{STAGE_TYPE_LABEL[type]}</option>)}
                </select>
                <div ref={filtersRef} className="relative">
                  <FilterButton open={showFilters} onClick={() => setShowFilters((value) => !value)} count={[active.status, active.product_line, active.agent_id].filter(Boolean).length} aria-controls="deal-flow-filters" />
                  {showFilters && (
                    <div id="deal-flow-filters" role="dialog" aria-label="More deal filters" className="absolute top-[calc(100%+6px)] left-0 z-30 grid w-[300px] gap-3 rounded-lg border border-[var(--border-strong)] bg-[var(--surface)] p-4 shadow-[var(--shadow-overlay)]">
                      <select aria-label="Filter by deal record" className={cn(toolbarControl, "w-full")} value={filters.status} onChange={(event) => applyFilter({ status: event.target.value })}>
                        <option value="">Any deal record</option>
                        {DEAL_FLOW_STATUSES.map((item) => <option key={item} value={item}>{DEAL_RECORD_LABEL[item]}</option>)}
                      </select>
                      <input aria-label="Filter by product line" className={cn(toolbarControl, "w-full")} value={filters.product_line} placeholder="Product line, e.g. term_life" onChange={(event) => setFilters({ ...filters, product_line: event.target.value })} onBlur={() => applyFilter({})} onKeyDown={(event) => { if (event.key === "Enter") applyFilter({}); }} />
                      <select aria-label="Filter by agent" className={cn(toolbarControl, "w-full")} value={filters.agent_id} onChange={(event) => applyFilter({ agent_id: event.target.value })}>
                        <option value="">All agents</option>
                        {data.options.agents.map((agent) => <option key={agent.id} value={agent.id}>{agent.name} · {agent.role}</option>)}
                      </select>
                      <div className="flex justify-end"><Button type="button" variant="outline" onClick={() => setShowFilters(false)}>Done</Button></div>
                    </div>
                  )}
                </div>
              </DataToolbar>
            }
            footer={<>
              <Pager page={data.page} total={data.total} pageSize={data.pageSize} noun={data.total === 1 ? "deal" : "deals"} suffix={!loading && focusedRow ? `focused on ${customerName(focusedRow)}` : undefined} disabled={loading} onPage={setPage} />
            </>}
          >
            {loading ? <SectionLoading rows={6} columns={7} label="Loading deals" /> : (
              <table className={cn(st.table, showPanel ? "min-w-[760px]" : "min-w-[1060px]")}>
                <thead>
                  <tr className={st.headRow}>
                    <th scope="col" className={cn(st.th, "w-[210px]")}>Lead</th>
                    {!showPanel && <th scope="col" className={cn(st.th, "w-[170px]")}>Campaign</th>}
                    {!showPanel && <th scope="col" className={cn(st.th, "w-[150px]")}>Vendor</th>}
                    <th scope="col" className={cn(st.th, "w-[60px]")}>State</th>
                    <th scope="col" className={cn(st.th, "w-[170px]")}>Status</th>
                    <th scope="col" className={cn(st.th, "w-[130px]")}>Owner</th>
                    <th scope="col" className={cn(st.th, "w-[160px]")}>Annualised premium</th>
                    <th scope="col" className={cn(st.th, "w-[110px] text-right")}>Actions</th>
                  </tr>
                </thead>
                <tbody className="m-seq">
                  {tableRows.map((row) => {
                    const isFocused = row.lead_id === focus;
                    const isSelected = showPanel && selectedRow?.id === row.id;
                    const isPinned = pinned?.id === row.id;
                    return (
                      <tr
                        key={row.id}
                        data-lead-id={row.lead_id}
                        aria-selected={isSelected}
                        onClick={() => openRow(row)}
                        className={cn("m-row cursor-pointer", isFocused ? "portal-deal-flow-focused-row bg-[var(--brand-50)]" : isSelected ? "bg-[var(--primary-soft)]" : "hover:bg-[var(--surface-alt)]")}
                      >
                        <td className={cn(st.td, "max-w-[220px]")}>
                          <button type="button" onClick={(event) => { event.stopPropagation(); openRow(row); }} title={isPinned ? `${customerName(row)} · outside these filters` : customerName(row)} className="block max-w-full truncate rounded-[4px] text-left text-inherit focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--ring-color)]">
                            {customerName(row)}
                          </button>
                        </td>
                        {!showPanel && <td className={cn(st.td, "max-w-[170px] truncate")} title={row.campaign_name ?? undefined}>{row.campaign_name ?? "—"}</td>}
                        {!showPanel && <td className={cn(st.td, "max-w-[150px] truncate")} title={row.vendor_name ?? undefined}>{row.vendor_name ?? "—"}</td>}
                        <td className={st.td}>{row.customer_state ?? "—"}</td>
                        <td className={st.td}>
                          <span className="inline-flex items-center gap-1.5">
                            <StagePill row={row} />
                            {isPinned && <StatusChip tone="neutral" title="This deal is outside the filters; it is pinned because you came from it.">Outside filters</StatusChip>}
                          </span>
                        </td>
                        <td className={cn(st.td, "whitespace-nowrap")}>{shortPerson(row.agent_name)}</td>
                        <td className={cn(st.td, "tabular-nums")}>{annualised(row.monthly_premium_cents)}</td>
                        <td className={cn(st.td, "text-right")}>
                          <Button asChild variant="outline" size="sm">
                            <Link href={`/app/leads/${row.lead_id}`} onClick={(event) => event.stopPropagation()}>Open lead</Link>
                          </Button>
                        </td>
                      </tr>
                    );
                  })}
                  {tableRows.length === 0 && (
                    <tr>
                      <td colSpan={columns} className={st.td}>
                        {hasNarrowing ? (
                          <NoMatches noun="deals" onClear={clearFilters} />
                        ) : (
                          <EmptyState title={isToday ? "No deals worked yet today" : "No deals worked in this range"} hint="A deal appears here when a partner submits one, an agent starts an application from the dialer, or someone adds a deal update." />
                        )}
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            )}
          </TableCard>

          {showPanel && selectedRow && (
            <aside aria-label={`Deal: ${customerName(selectedRow)}`} className="flex min-w-0 flex-col overflow-y-auto rounded-lg border border-border bg-card shadow-[0_1px_2px_rgba(16,20,26,.05)] lg:max-h-[calc(100dvh-var(--top-bar-h)-360px)] lg:min-h-[calc(100dvh-var(--top-bar-h)-360px)] lg:w-[30%] lg:shrink-0">
              <div className="flex items-start justify-between gap-3 border-b border-border px-4 py-3">
                <div className="min-w-0">
                  <h2 className="m-0 truncate text-base font-semibold text-foreground" title={customerName(selectedRow)}>{customerName(selectedRow)}</h2>
                  <div className="mt-0.5 flex flex-wrap items-center gap-2"><StagePill row={selectedRow} /><CopyId leadId={selectedRow.lead_id} /></div>
                </div>
                <button type="button" aria-label="Close deal details" onClick={() => setPanelOpen(false)} className="inline-flex size-8 shrink-0 items-center justify-center rounded-md text-muted-foreground hover:bg-[var(--surface-alt)] hover:text-foreground focus-visible:outline-2 focus-visible:outline-[var(--ring-color)]"><X aria-hidden className="size-4" /></button>
              </div>
              <div className="flex flex-col gap-4 px-4 py-4">
                <KeyValues
                  items={[
                    { label: "Carrier", value: selectedRow.carrier ?? "—" },
                    { label: "Annualised", value: annualised(selectedRow.monthly_premium_cents) },
                    { label: "Written", value: formatStamp(selectedRow.created_at, timeZone) ?? "—" },
                    { label: "Owner", value: shortPerson(selectedRow.agent_name) },
                    // LA-1.13-2: the buffer who took the call first, when one did.
                    { label: "Buffer", value: selectedRow.buffer_agent_name ? shortPerson(selectedRow.buffer_agent_name) : "—" },
                    { label: "Campaign", value: selectedRow.campaign_name ?? "—" },
                  ]}
                />
                <details className="group border-t border-border pt-3" open>
                  <summary className="cursor-pointer list-none text-xs font-semibold tracking-[0.02em] text-[var(--muted)] uppercase">Policy details</summary>
                  <div className="mt-3">
                    <KeyValues
                      items={[
                        { label: "Product", value: selectedRow.product_type ? `${selectedRow.product_line} · ${selectedRow.product_type}` : selectedRow.product_line || "—" },
                        { label: "Face amount", value: money(selectedRow.face_amount_cents) },
                        { label: "Monthly premium", value: money(selectedRow.monthly_premium_cents) },
                        { label: "Draft date", value: formatDay(selectedRow.draft_date) },
                        { label: "Phone", value: selectedRow.phone ?? "—" },
                        { label: "Partner", value: selectedRow.partner_name },
                        { label: "Vendor", value: selectedRow.vendor_name ?? "—" },
                        { label: "Initial quote", value: selectedRow.initial_quote ?? "—" },
                      ]}
                    />
                  </div>
                </details>
                <div className="border-t border-border pt-3">
                  <div className={label12}>Next action</div>
                  <div className="mt-1 text-sm font-semibold text-[var(--ink)]">{dispositionLabel(selectedRow) ?? "No call outcome recorded yet"}</div>
                  {selectedRow.notes && <p className="mt-1 mb-0 text-sm break-words text-[var(--body)]">{selectedRow.notes}</p>}
                </div>
                <IssuedPolicyPanel dealId={selectedRow.id} defaultCarrier={selectedRow.carrier} readOnly={data.readOnly} onChanged={() => void load(query)} />
                <details className="group border-t border-border pt-3">
                  <summary className="cursor-pointer list-none text-xs font-semibold tracking-[0.02em] text-[var(--muted)] uppercase">Submission timeline</summary>
                  <div className="mt-3"><Timeline items={timelineFor(selectedRow, timeZone)} /></div>
                </details>
                <div className="flex flex-wrap gap-2 border-t border-border pt-3">
                  <Button type="button" variant="outline" disabled={data.readOnly || editing === selectedRow.id} onClick={() => startEdit(selectedRow)}>Edit record</Button>
                  {/* LA-1.20-5: every lead list links to the lead workspace. */}
                  <Button asChild variant="outline"><Link href={`/app/leads/${selectedRow.lead_id}`}>Open lead</Link></Button>
                </div>
              </div>
            </aside>
          )}
        </div>
      )}

      {tab === "funnel" && <DealFlowFunnel from={active.from} to={active.to} agentId={active.agent_id} isToday={isToday} />}

      {tab === "partners" && (
        <TableCard
          className="flex min-h-[calc(100dvh-var(--top-bar-h)-360px)] flex-col [&>.overflow-x-auto]:flex-1"
          toolbar={<DataToolbar actions={<RefreshButton onClick={() => void load(query)} refreshing={loading} />}><span className="text-sm text-muted-foreground">{isToday ? "Today" : rangeText(active.from, active.to)}</span></DataToolbar>}
          footer={<span>{data.summary.length.toLocaleString("en-US")} {data.summary.length === 1 ? "partner" : "partners"} · the deals in the Deals tab&rsquo;s range and filters</span>}
        >
          {data.summary.length === 0 ? (
            <EmptyState title="No partner production in this range" hint="A partner appears here once one of its deals is worked in the range." />
          ) : (
            <table id="deal-flow-partner-summary" className={cn(st.table, "min-w-[560px]")}>
              <thead>
                <tr className={st.headRow}>
                  <th scope="col" className={st.th}>Partner</th>
                  <th scope="col" className={cn(st.th, "w-[110px] text-right")}>Deals</th>
                  <th scope="col" className={cn(st.th, "w-[110px] text-right")}>Won</th>
                  <th scope="col" className={cn(st.th, "w-[110px] text-right")}>In progress</th>
                  <th scope="col" className={cn(st.th, "w-[110px] text-right")}>Lost</th>
                </tr>
              </thead>
              <tbody>
                {data.summary.map((item) => (
                  <tr key={item.partner_id ?? "none"}>
                    <td className={cn(st.td, st.strong)}>{item.partner_name}</td>
                    <td className={cn(st.td, st.num)}>{item.total}</td>
                    <td className={cn(st.td, st.num)}>{item.won}</td>
                    <td className={cn(st.td, st.num)}>{item.in_progress}</td>
                    <td className={cn(st.td, st.num)}>{item.lost}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </TableCard>
      )}

      <Dialog open={showManual && !data.readOnly} onOpenChange={(next) => { if (!saving) setShowManual(next); }}>
        <DialogContent className="max-h-[calc(100vh-4rem)] overflow-y-auto sm:max-w-3xl">
          <DialogHeader>
            <DialogTitle className="text-base">Add deal update</DialogTitle>
            <DialogDescription>Records a deal worked outside the dialer or a partner submission.</DialogDescription>
          </DialogHeader>
          <form onSubmit={createManual} className="grid gap-4 md:grid-cols-3">
            <Field label="Customer name" htmlFor="manual-name" required><input id="manual-name" className={control} required maxLength={160} value={manual.insured_name} onChange={(event) => setManual({ ...manual, insured_name: event.target.value })} /></Field>
            <Field label="Phone" htmlFor="manual-phone"><input id="manual-phone" className={control} maxLength={40} value={manual.phone} onChange={(event) => setManual({ ...manual, phone: event.target.value })} /></Field>
            <Field label="Product line" htmlFor="manual-product" required><input id="manual-product" className={control} required maxLength={120} value={manual.product_line} onChange={(event) => setManual({ ...manual, product_line: event.target.value })} /></Field>
            <Field label="Agent local date" htmlFor="manual-date" required><input id="manual-date" className={control} required type="date" value={manual.local_date} onChange={(event) => setManual({ ...manual, local_date: event.target.value })} /></Field>
            <Field label="Partner" htmlFor="manual-partner"><select id="manual-partner" className={control} value={manual.partner_id} onChange={(event) => setManual({ ...manual, partner_id: event.target.value })}><option value="">No partner</option>{data.options.partners.map((partner) => <option key={partner.id} value={partner.id}>{partner.name}</option>)}</select></Field>
            <Field label="Carrier" htmlFor="manual-carrier"><input id="manual-carrier" className={control} maxLength={160} value={manual.carrier} onChange={(event) => setManual({ ...manual, carrier: event.target.value })} /></Field>
            <Field label="Product type" htmlFor="manual-type"><input id="manual-type" className={control} maxLength={160} value={manual.product_type} onChange={(event) => setManual({ ...manual, product_type: event.target.value })} /></Field>
            <Field label="Monthly premium ($)" htmlFor="manual-premium" hint="For example 71.40"><input id="manual-premium" className={control} inputMode="decimal" value={manual.monthly_premium} onChange={(event) => setManual({ ...manual, monthly_premium: event.target.value })} /></Field>
            <Field label="Face amount ($)" htmlFor="manual-face"><input id="manual-face" className={control} inputMode="decimal" value={manual.face_amount} onChange={(event) => setManual({ ...manual, face_amount: event.target.value })} /></Field>
            <Field label="Draft date" htmlFor="manual-draft"><input id="manual-draft" className={control} type="date" value={manual.draft_date} onChange={(event) => setManual({ ...manual, draft_date: event.target.value })} /></Field>
            <Field label="Initial quote" htmlFor="manual-quote" className="md:col-span-2"><input id="manual-quote" className={control} maxLength={1000} value={manual.initial_quote} onChange={(event) => setManual({ ...manual, initial_quote: event.target.value })} /></Field>
            <Field label="Notes" htmlFor="manual-notes" className="md:col-span-3"><textarea id="manual-notes" maxLength={5000} className={cn(control, "h-auto min-h-20 py-2")} value={manual.notes} onChange={(event) => setManual({ ...manual, notes: event.target.value })} /></Field>
            <DialogFooter className="md:col-span-3">
              <Button type="button" variant="outline" disabled={saving} onClick={() => setShowManual(false)}>Cancel</Button>
              <Button type="submit" disabled={saving}>{saving ? "Saving…" : "Save deal update"}</Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      <Dialog open={Boolean(editingRow && draft)} onOpenChange={(next) => { if (!next && !saving) cancelEdit(); }}>
        <DialogContent className="max-h-[calc(100vh-4rem)] overflow-y-auto sm:max-w-3xl">
          {editingRow && draft && (
            <>
              <DialogHeader>
                <DialogTitle className="text-base">Edit {customerName(editingRow)}</DialogTitle>
                <DialogDescription>{shortLeadId(editingRow.lead_id)} · {editingRow.partner_name}</DialogDescription>
              </DialogHeader>
              <form onSubmit={(event) => void saveRow(event, editingRow)} className="grid gap-4 md:grid-cols-3" aria-label={`Edit ${customerName(editingRow)}`}>
                <Field label="Deal date" htmlFor={`edit-date-${editingRow.id}`}><input id={`edit-date-${editingRow.id}`} type="date" required className={control} value={draft.local_date} onChange={(event) => update("local_date", event.target.value)} /></Field>
                <Field label="Deal record" htmlFor={`edit-status-${editingRow.id}`}><select id={`edit-status-${editingRow.id}`} className={control} value={draft.status} onChange={(event) => update("status", event.target.value)}>{DEAL_FLOW_STATUSES.map((item) => <option key={item} value={item}>{DEAL_RECORD_LABEL[item]}</option>)}</select></Field>
                <Field label="Call result" htmlFor={`edit-result-${editingRow.id}`}><input id={`edit-result-${editingRow.id}`} className={control} maxLength={120} value={draft.call_result} onChange={(event) => update("call_result", event.target.value)} /></Field>
                <Field label="Carrier" htmlFor={`edit-carrier-${editingRow.id}`}><input id={`edit-carrier-${editingRow.id}`} className={control} maxLength={160} value={draft.carrier} onChange={(event) => update("carrier", event.target.value)} /></Field>
                <Field label="Product type" htmlFor={`edit-type-${editingRow.id}`}><input id={`edit-type-${editingRow.id}`} className={control} maxLength={160} value={draft.product_type} onChange={(event) => update("product_type", event.target.value)} /></Field>
                <Field label="Monthly premium ($)" htmlFor={`edit-premium-${editingRow.id}`} hint="For example 71.40"><input id={`edit-premium-${editingRow.id}`} className={control} inputMode="decimal" value={draft.monthly_premium} onChange={(event) => update("monthly_premium", event.target.value)} /></Field>
                <Field label="Face amount ($)" htmlFor={`edit-face-${editingRow.id}`}><input id={`edit-face-${editingRow.id}`} className={control} inputMode="decimal" value={draft.face_amount} onChange={(event) => update("face_amount", event.target.value)} /></Field>
                <Field label="Draft date" htmlFor={`edit-draft-${editingRow.id}`}><input id={`edit-draft-${editingRow.id}`} type="date" className={control} value={draft.draft_date} onChange={(event) => update("draft_date", event.target.value)} /></Field>
                <Field label="Notes" htmlFor={`edit-notes-${editingRow.id}`} className="md:col-span-3"><textarea id={`edit-notes-${editingRow.id}`} className={cn(control, "h-auto min-h-20 py-2")} maxLength={5000} value={draft.notes} onChange={(event) => update("notes", event.target.value)} /></Field>
                <DialogFooter className="md:col-span-3">
                  <Button type="button" variant="outline" disabled={saving} onClick={cancelEdit}>Cancel</Button>
                  <Button type="submit" disabled={saving}>{saving ? "Saving…" : "Save"}</Button>
                </DialogFooter>
              </form>
            </>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
