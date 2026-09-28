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
 */

import { Fragment, useCallback, useEffect, useMemo, useRef, useState, type FormEvent, type ReactNode } from "react";
import Link from "next/link";
import { ChevronDown, Copy, Download, Plus, X } from "lucide-react";

import { Button } from "@/components/ui/button";
import { DataToolbar, FilterButton, RefreshButton, ToolbarSearch, toolbarControl } from "@/components/ui/data-toolbar";
import { PageHeader } from "@/components/ui/page-header";
import { PageLoading } from "@/components/ui/page-loading";
import { EmptyState, NoMatches, SectionLoading } from "@/components/ui/page-states";
import { StatStrip, StatTile } from "@/components/ui/stat";
import { TableCard } from "@/components/ui/table-card";
import { DealFlowFunnel } from "@/components/app/deal-flow-funnel";
import { IssuedPolicyPanel } from "@/components/app/issued-policy-panel";
import { Field, KeyValues, Pill, control, st, type PillTone } from "@/components/app/settings/primitives";
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

type Data = DealFlowReport & { readOnly: boolean };
type Filters = { from: string; to: string; partner_id: string; product_line: string; agent_id: string; stage_type: string; status: string };
type Draft = { local_date: string; carrier: string; product_type: string; monthly_premium: string; face_amount: string; draft_date: string; status: DealFlowStatus; call_result: string; notes: string };

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const DEAL_RECORD_LABEL: Record<DealFlowStatus, string> = { partial: "Partial", completed: "Completed", dropped: "Dropped" };
const STAGE_TONE: Record<DealFlowStageType, PillTone> = { open: "info", won: "success", lost: "error" };
const MONEY_HINT = "Money values must use dollars and cents, for example 71.40";

/** A 40px control for the inline edit row; the 44px `control` is for forms. */
const select40 =
  "mt-1.5 box-border h-10 w-full rounded-[8px] border border-[var(--border-strong)] bg-[var(--surface)] px-3 text-[14px] leading-[1.5] tracking-[-0.02em] text-[var(--ink)] outline-none focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--ring-color)]";
const label12 = "text-[12px] leading-[1.33] font-semibold tracking-[0.02em] uppercase text-[var(--muted)]";

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
            <span className="block text-[14px] leading-[1.5] font-semibold tracking-[-0.02em] text-[var(--ink)]">{item.title}</span>
            <span className="block text-[12px] leading-[1.5] tracking-[-0.01em] text-[var(--muted)] tabular-nums">{item.sub}</span>
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

function Card({ title, children, className }: { title: ReactNode; children: ReactNode; className?: string }) {
  return (
    <section className={cn("min-w-0 rounded-lg border border-border bg-card p-5", className)}>
      <h2 className="m-0 text-lg font-semibold leading-[1.28] tracking-[-0.015em] text-foreground">{title}</h2>
      <div className="mt-4">{children}</div>
    </section>
  );
}

function StagePill({ row }: { row: DealFlowRow }) {
  if (!row.stage_name) return <Pill tone="neutral" dot>No stage</Pill>;
  return <Pill tone={STAGE_TONE[row.stage_type ?? "open"]} dot>{row.stage_name}</Pill>;
}

function CopyId({ leadId }: { leadId: string }) {
  const id = shortLeadId(leadId);
  function copy() {
    if (!navigator.clipboard) { notify.block("Copying is not available in this browser", { detail: `The short ID is ${id}.` }); return; }
    navigator.clipboard.writeText(id).then(() => notify.done(`Copied ${id}`), () => notify.block("Could not copy the ID", { detail: `The short ID is ${id}.` }));
  }
  return (
    <button type="button" onClick={copy} aria-label={`Copy short ID ${id}`} title="Copy short ID" className="inline-flex items-center gap-1 rounded-[6px] px-1.5 align-middle font-mono text-[13px] font-normal tracking-normal text-[var(--muted)] hover:bg-[var(--surface-alt)] hover:text-[var(--ink)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--ring-color)]">
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
  const [showPartnerSummary, setShowPartnerSummary] = useState(false);
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
    window.setTimeout(() => document.getElementById(`deal-edit-${row.id}`)?.scrollIntoView({ behavior: "smooth", block: "nearest" }), 50);
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

  const header = (
    <PageHeader
      title="Daily deal flow"
      actions={
        <>
          <Button asChild variant="outline"><a href={csvHref} aria-label="Export the deals in this range as CSV"><Download aria-hidden="true" />Export</a></Button>
          <Button type="button" disabled={!data || data.readOnly} onClick={() => setShowManual((value) => !value)}>
            {showManual ? <X aria-hidden="true" /> : <Plus aria-hidden="true" />}
            {showManual ? "Close deal update" : "Add deal update"}
          </Button>
        </>
      }
    />
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
  const firstShown = data.total === 0 ? 0 : (data.page - 1) * data.pageSize + 1;
  const lastShown = data.total === 0 ? 0 : firstShown + data.rows.length - 1;
  const hasNarrowing = extraFilters > 0 || !!search;
  const update = (key: keyof Draft, value: string) => setDraft((current) => (current ? { ...current, [key]: value } : current));
  const oldest = kpis.oldest_in_progress_days;
  const inProgressFoot = kpis.in_progress === 0 ? "none open" : oldest == null ? "no start time recorded" : oldest < 1 ? "oldest under a day" : `oldest ${oldest} ${oldest === 1 ? "day" : "days"}`;
  const wonFoot = `${formatCentsAsCurrency(kpis.won_annualised_cents)} annualised${kpis.won_unpriced > 0 ? ` · ${kpis.won_unpriced} with no premium` : ""}`;
  const dayTitle = `Dates are the agent’s local day${timeZone ? `; today is ${formatDay(today)} in ${timeZone}` : ""}`;

  return (
    <div className="m-stagger flex w-full min-w-0 flex-col gap-6">
      {header}

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

      {showManual && !data.readOnly && (
        <section className="min-w-0 rounded-lg border border-border bg-card p-5">
          <h2 className="m-0 text-lg font-semibold leading-[1.28] tracking-[-0.015em] text-foreground">Add deal update</h2>
          <form onSubmit={createManual} className="mt-4 grid gap-4 md:grid-cols-3">
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
            <div className="flex gap-2 md:col-span-3">
              <Button type="submit" disabled={saving}>{saving ? "Saving…" : "Save deal update"}</Button>
              <Button type="button" variant="ghost" onClick={() => setShowManual(false)}>Cancel</Button>
            </div>
          </form>
        </section>
      )}

      <TableCard
        toolbar={
          <>
            <DataToolbar actions={<RefreshButton onClick={() => void load(query)} refreshing={loading} />}>
              <ToolbarSearch value={searchTerm} onChange={setSearchTerm} placeholder="Customer, phone, campaign, ID…" label="Search deals" />
              <input type="date" aria-label="From" title={dayTitle} className={toolbarControl} value={filters.from} max={filters.to || undefined} onChange={(event) => setDate("from", event.target.value)} />
              <input type="date" aria-label="To" title={dayTitle} className={toolbarControl} value={filters.to} min={filters.from || undefined} onChange={(event) => setDate("to", event.target.value)} />
              {!isToday && <Button type="button" variant="outline" onClick={resetToToday} aria-label="Show today’s deals">Today</Button>}
              <select aria-label="Filter by partner" className={cn(toolbarControl, "max-w-[200px]")} value={filters.partner_id} onChange={(event) => applyFilter({ partner_id: event.target.value })}>
                <option value="">All partners</option>
                {data.options.partners.map((partner) => <option key={partner.id} value={partner.id}>{partner.name}</option>)}
              </select>
              <select aria-label="Filter by status" className={toolbarControl} value={filters.stage_type} onChange={(event) => applyFilter({ stage_type: event.target.value })}>
                <option value="">All statuses</option>
                {DEAL_FLOW_STAGE_TYPES.map((type) => <option key={type} value={type}>{STAGE_TYPE_LABEL[type]}</option>)}
              </select>
              <FilterButton open={showFilters} onClick={() => setShowFilters((value) => !value)} count={[active.status, active.product_line, active.agent_id].filter(Boolean).length} />
              {hasNarrowing && <Button type="button" variant="ghost" onClick={clearFilters}>Clear filters</Button>}
            </DataToolbar>
            {showFilters && (
              <div id="deal-flow-filters" className="flex w-full flex-wrap items-center gap-2">
                <select aria-label="Filter by deal record" className={toolbarControl} value={filters.status} onChange={(event) => applyFilter({ status: event.target.value })}>
                  <option value="">Any deal record</option>
                  {DEAL_FLOW_STATUSES.map((item) => <option key={item} value={item}>{DEAL_RECORD_LABEL[item]}</option>)}
                </select>
                <input aria-label="Filter by product line" className={toolbarControl} value={filters.product_line} placeholder="Product line, e.g. term_life" onChange={(event) => setFilters({ ...filters, product_line: event.target.value })} onBlur={() => applyFilter({})} onKeyDown={(event) => { if (event.key === "Enter") applyFilter({}); }} />
                <select aria-label="Filter by agent" className={cn(toolbarControl, "max-w-[220px]")} value={filters.agent_id} onChange={(event) => applyFilter({ agent_id: event.target.value })}>
                  <option value="">All agents</option>
                  {data.options.agents.map((agent) => <option key={agent.id} value={agent.id}>{agent.name} · {agent.role}</option>)}
                </select>
              </div>
            )}
          </>
        }
        footer={<>
          <span role="status">
            {loading ? "" : data.total === 0 ? "No deals" : `Showing ${firstShown}–${lastShown} of ${data.total} ${data.total === 1 ? "deal" : "deals"}`}
            {!loading && focusedRow ? ` · focused on ${customerName(focusedRow)}` : ""}
          </span>
          <span className="flex gap-2">
            <Button type="button" variant="outline" size="sm" disabled={loading || data.page <= 1} onClick={() => setPage(data.page - 1)}>Previous</Button>
            <Button type="button" variant="outline" size="sm" disabled={loading || lastShown >= data.total} onClick={() => setPage(data.page + 1)}>Next</Button>
          </span>
        </>}
      >
        {loading ? <SectionLoading rows={6} columns={7} label="Loading deals" /> : (
          <table className={cn(st.table, "min-w-[1060px]")}>
            <thead>
              <tr className={st.headRow}>
                <th scope="col" className={cn(st.th, "w-[210px]")}>Lead</th>
                <th scope="col" className={cn(st.th, "w-[170px]")}>Campaign</th>
                <th scope="col" className={cn(st.th, "w-[150px]")}>Vendor</th>
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
                const isSelected = selectedRow?.id === row.id;
                const isPinned = pinned?.id === row.id;
                const editingRow = editing === row.id && draft;
                return (
                  <Fragment key={row.id}>
                    <tr
                      data-lead-id={row.lead_id}
                      aria-selected={isSelected}
                      onClick={() => setSelectedId(row.id)}
                      className={cn("m-row cursor-pointer", isFocused ? "portal-deal-flow-focused-row bg-[var(--brand-50)]" : isSelected ? "bg-[var(--surface-alt)]" : "hover:bg-[var(--surface-alt)]")}
                    >
                      <td className={st.td}>
                        <button type="button" onClick={(event) => { event.stopPropagation(); setSelectedId(row.id); }} className="block max-w-full truncate rounded-[4px] text-left text-inherit focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--ring-color)]">
                          {customerName(row)}
                        </button>
                        {isPinned && <span className={st.sub}>Outside these filters</span>}
                      </td>
                      <td className={st.td}>{row.campaign_name ?? "—"}</td>
                      <td className={st.td}>{row.vendor_name ?? "—"}</td>
                      <td className={st.td}>{row.customer_state ?? "—"}</td>
                      <td className={st.td}><StagePill row={row} /></td>
                      <td className={st.td}>{shortPerson(row.agent_name)}</td>
                      <td className={cn(st.td, "tabular-nums")}>{annualised(row.monthly_premium_cents)}</td>
                      <td className={cn(st.td, "text-right")}>
                        <Button asChild variant="outline" size="sm">
                          <Link href={`/app/leads/${row.lead_id}`} onClick={(event) => event.stopPropagation()}>Open lead</Link>
                        </Button>
                      </td>
                    </tr>
                    {editingRow && (
                      <tr id={`deal-edit-${row.id}`}>
                        <td colSpan={8} className={cn(st.td, "bg-[var(--canvas)] px-4 py-4")}>
                          <form onSubmit={(event) => void saveRow(event, row)} className="grid gap-3 md:grid-cols-3 lg:grid-cols-5" aria-label={`Edit ${customerName(row)}`}>
                            <Field label="Deal date" htmlFor={`edit-date-${row.id}`}><input id={`edit-date-${row.id}`} type="date" required className={select40} value={draft.local_date} onChange={(event) => update("local_date", event.target.value)} /></Field>
                            <Field label="Deal record" htmlFor={`edit-status-${row.id}`}><select id={`edit-status-${row.id}`} className={select40} value={draft.status} onChange={(event) => update("status", event.target.value)}>{DEAL_FLOW_STATUSES.map((item) => <option key={item} value={item}>{DEAL_RECORD_LABEL[item]}</option>)}</select></Field>
                            <Field label="Call result" htmlFor={`edit-result-${row.id}`}><input id={`edit-result-${row.id}`} className={select40} maxLength={120} value={draft.call_result} onChange={(event) => update("call_result", event.target.value)} /></Field>
                            <Field label="Carrier" htmlFor={`edit-carrier-${row.id}`}><input id={`edit-carrier-${row.id}`} className={select40} maxLength={160} value={draft.carrier} onChange={(event) => update("carrier", event.target.value)} /></Field>
                            <Field label="Product type" htmlFor={`edit-type-${row.id}`}><input id={`edit-type-${row.id}`} className={select40} maxLength={160} value={draft.product_type} onChange={(event) => update("product_type", event.target.value)} /></Field>
                            <Field label="Monthly premium ($)" htmlFor={`edit-premium-${row.id}`} hint="For example 71.40"><input id={`edit-premium-${row.id}`} className={select40} inputMode="decimal" value={draft.monthly_premium} onChange={(event) => update("monthly_premium", event.target.value)} /></Field>
                            <Field label="Face amount ($)" htmlFor={`edit-face-${row.id}`}><input id={`edit-face-${row.id}`} className={select40} inputMode="decimal" value={draft.face_amount} onChange={(event) => update("face_amount", event.target.value)} /></Field>
                            <Field label="Draft date" htmlFor={`edit-draft-${row.id}`}><input id={`edit-draft-${row.id}`} type="date" className={select40} value={draft.draft_date} onChange={(event) => update("draft_date", event.target.value)} /></Field>
                            <Field label="Notes" htmlFor={`edit-notes-${row.id}`} className="md:col-span-3 lg:col-span-2"><input id={`edit-notes-${row.id}`} className={select40} maxLength={5000} value={draft.notes} onChange={(event) => update("notes", event.target.value)} /></Field>
                            <div className="flex items-end gap-2 md:col-span-3 lg:col-span-5">
                              <Button type="submit" size="sm" disabled={saving}>{saving ? "Saving…" : "Save"}</Button>
                              <Button type="button" variant="outline" size="sm" onClick={cancelEdit}>Cancel</Button>
                            </div>
                          </form>
                        </td>
                      </tr>
                    )}
                  </Fragment>
                );
              })}
              {tableRows.length === 0 && (
                <tr>
                  <td colSpan={8} className={st.td}>
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

      {selectedRow && (
        <div className="flex flex-col gap-5 lg:flex-row">
          <Card title={<>{customerName(selectedRow)} <span className="text-[var(--muted)]">&middot;</span> <CopyId leadId={selectedRow.lead_id} /></>} className="lg:w-[380px] lg:shrink-0">
            <KeyValues
              items={[
                { label: "Carrier", value: selectedRow.carrier ?? "—" },
                { label: "Annualised", value: annualised(selectedRow.monthly_premium_cents) },
                { label: "Written", value: formatStamp(selectedRow.created_at, timeZone) ?? "—" },
                { label: "Owner", value: shortPerson(selectedRow.agent_name) },
                // LA-1.13-2: the buffer who took the call first, when one did.
                { label: "Buffer", value: selectedRow.buffer_agent_name ? shortPerson(selectedRow.buffer_agent_name) : "—" },
              ]}
            />
            <div className="mt-4 border-t border-[var(--border)] pt-4">
              <KeyValues
                items={[
                  { label: "Product", value: selectedRow.product_type ? `${selectedRow.product_line} · ${selectedRow.product_type}` : selectedRow.product_line || "—" },
                  { label: "Face amount", value: money(selectedRow.face_amount_cents) },
                  { label: "Monthly premium", value: money(selectedRow.monthly_premium_cents) },
                  { label: "Draft date", value: formatDay(selectedRow.draft_date) },
                  { label: "Phone", value: selectedRow.phone ?? "—" },
                  { label: "Partner", value: selectedRow.partner_name },
                  { label: "Initial quote", value: selectedRow.initial_quote ?? "—" },
                ]}
              />
            </div>
            <div className="mt-4 border-t border-[var(--border)] pt-4">
              <div className={label12}>Next action</div>
              <div className="mt-1 text-[14px] leading-[1.5] font-semibold tracking-[-0.02em] text-[var(--ink)]">{dispositionLabel(selectedRow) ?? "No call outcome recorded yet"}</div>
              {selectedRow.notes && <p className="mt-1 mb-0 text-[14px] leading-[1.5] tracking-[-0.02em] break-words text-[var(--body)]">{selectedRow.notes}</p>}
            </div>
            <IssuedPolicyPanel dealId={selectedRow.id} defaultCarrier={selectedRow.carrier} readOnly={data.readOnly} onChanged={() => void load(query)} />
            <div className="mt-4 flex flex-wrap gap-2">
              <Button type="button" variant="outline" disabled={data.readOnly || editing === selectedRow.id} onClick={() => startEdit(selectedRow)}>Edit record</Button>
              {/* LA-1.20-5: every lead list links to the lead workspace. */}
              <Button asChild variant="outline"><Link href={`/app/leads/${selectedRow.lead_id}`}>Open lead</Link></Button>
            </div>
          </Card>
          <Card title="Submission timeline" className="lg:w-[380px] lg:shrink-0">
            <Timeline items={timelineFor(selectedRow, timeZone)} />
          </Card>
        </div>
      )}

      <DealFlowFunnel from={active.from} to={active.to} agentId={active.agent_id} isToday={isToday} />

      {data.summary.length > 0 && (
        <TableCard
          title="Partner production summary"
          action={
            <Button type="button" variant="outline" aria-expanded={showPartnerSummary} aria-controls="deal-flow-partner-summary" onClick={() => setShowPartnerSummary((value) => !value)}>
              {showPartnerSummary ? "Hide" : "Show"}
              <ChevronDown aria-hidden className={cn("transition-transform", showPartnerSummary && "rotate-180")} />
            </Button>
          }
        >
          {showPartnerSummary && (
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
    </div>
  );
}
