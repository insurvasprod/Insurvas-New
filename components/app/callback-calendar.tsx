"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { CircleAlert, Download, ExternalLink, Plus } from "lucide-react";
import { notify } from "@/lib/notify";
import { Button } from "@/components/ui/button";
import { BulkBar, RowCheckbox, SelectAllCheckbox, useRowSelection, type RowSelection } from "@/components/ui/bulk-bar";
import { SavedViews, type BuiltInView, type ViewState } from "@/components/ui/saved-views";
import { downloadCsv } from "@/components/app/partner-quality-parts";
import { ClearFiltersButton, DataToolbar, FilterButton, RefreshButton, ToolbarSearch, toolbarControl } from "@/components/ui/data-toolbar";
import { DetailPanel } from "@/components/ui/detail-panel";
import { PageHeader } from "@/components/ui/page-header";
import { PageLoading } from "@/components/ui/page-loading";
import { EmptyState, NoMatches } from "@/components/ui/page-states";
import { Pager, paginate } from "@/components/ui/pager";
import { TableCard } from "@/components/ui/table-card";
import { st } from "@/components/app/settings/primitives";
import { ActionButton, CardActions, CardList, cardItem, COMPACT_TOOLBAR, useMediaQuery, WIDE_QUERY, type RowAction } from "@/components/app/responsive-list";
import { cn } from "@/lib/utils";
import { insideWindow, hourLabel, STATE_NAMES, windowSummary, type CallbackWindowFacts } from "@/lib/callbacks/windowFacts";
import type { CallbackView } from "@/lib/callbacks/service";
import type { CallbackRefusalNotice } from "@/lib/callbacks/refusals";
import type { NearestLegalTime } from "@/lib/callbacks/nearest";

/**
 * Callbacks (p-app-callbacks): what is overdue, what is due today, what is coming, and one card to
 * book a callback in the customer's own time — with the calling window checked while the agent
 * picks, and again by the server before anything is stored.
 *
 * LA-1 §6.3 (concept board): a callback counts when the call comes back. A contact on a dial of the
 * lead from 15 minutes before it is due to the end of the customer's day keeps it; the customer's
 * window closing on the due day with no kept call misses it (20260925708500/708700). A refused time
 * comes back with the nearest legal one, as a suggestion only.
 */
const TERMINAL_STATUSES = new Set(["completed", "cancelled"]);
const OPEN_STATUSES = new Set(["scheduled", "due", "missed"]);
const THIRTY_DAYS = 30 * 86_400_000;

type ChipTone = "neutral" | "success" | "warning" | "error" | "accent";
type Viewer = { userId: string; role: string };
type Scope = "mine" | "all";

function localParts(utc: string | Date, timezone: string) {
  const parts = new Intl.DateTimeFormat("en-US", { timeZone: timezone, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hour12: false }).formatToParts(new Date(utc));
  const values = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return { date: `${values.year}-${values.month}-${values.day}`, time: `${values.hour === "24" ? "00" : values.hour}:${values.minute}` };
}

/** "11:00 am EDT" — the time as a person says it, with the zone it is in. */
function shortTime(utc: string | Date, timezone: string, withZone = true) {
  const text = new Intl.DateTimeFormat("en-US", { timeZone: timezone, hour: "numeric", minute: "2-digit", ...(withZone ? { timeZoneName: "short" } : {}) }).format(new Date(utc));
  return text.replace(" AM", " am").replace(" PM", " pm");
}

const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
// A fixed month list: some browsers' locale data spells September "Sept", and the boards say "Sep".
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/** "Thu 25 Sep · 2:30 pm MST" */
function longTime(utc: string | Date, timezone: string) {
  const { date } = localParts(utc, timezone);
  const [y, m, d] = date.split("-").map(Number);
  const weekday = WEEKDAYS[new Date(Date.UTC(y, m - 1, d)).getUTCDay()];
  return `${weekday} ${d} ${MONTHS[m - 1]} · ${shortTime(utc, timezone)}`;
}

function zoneAbbreviation(timezone: string, at: Date = new Date()) {
  return new Intl.DateTimeFormat("en-US", { timeZone: timezone, timeZoneName: "short" }).formatToParts(at).find((part) => part.type === "timeZoneName")?.value ?? timezone;
}

/** The instant a customer-local "YYYY-MM-DDTHH:mm" names in `timezone` (DST-safe to the minute). */
function zonedToUtc(local: string, timezone: string): Date | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/.exec(local);
  if (!match) return null;
  const [, y, mo, d, h, mi] = match.map(Number);
  let guess = Date.UTC(y, mo - 1, d, h, mi);
  for (let i = 0; i < 2; i += 1) {
    const seen = localParts(new Date(guess), timezone);
    const [sy, smo, sd] = seen.date.split("-").map(Number);
    const [sh, smi] = seen.time.split(":").map(Number);
    guess -= Date.UTC(sy, smo - 1, sd, sh, smi) - Date.UTC(y, mo - 1, d, h, mi);
  }
  return new Date(guess);
}

function durationShort(minutes: number) {
  if (minutes < 60) return `${minutes} min`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ${minutes % 60}m`;
  const days = Math.floor(hours / 24);
  return days === 1 ? "1 day" : `${days} days`;
}

/** Missed once, whatever happened after: a rebooked missed callback still counts as missed. */
function wasMissed(callback: CallbackView) {
  return callback.status !== "completed" && (callback.status === "missed" || Boolean(callback.missedAt));
}

function rowStatus(callback: CallbackView, now: number, callWindow: CallbackWindowFacts | undefined): { label: string; tone: ChipTone } {
  const at = new Date(callback.scheduledAtUtc).getTime();
  const minutes = Math.round((at - now) / 60_000);
  if (callback.status === "missed") return { label: "Missed", tone: "error" };
  if (callback.isOverdue) return { label: `${durationShort(Math.max(1, -minutes))} overdue`, tone: "error" };
  if (minutes >= 0 && minutes <= 60) return { label: `in ${Math.max(1, minutes)} min`, tone: "accent" };
  // A callback booked close to the end of the customer's window leaves no second chance today.
  if (callWindow && callback.isDueToday) {
    const { time } = localParts(callback.scheduledAtUtc, callback.customerTimezone);
    const [h, m] = time.split(":").map(Number);
    if (callWindow.effective.end * 60 - (h * 60 + m) <= 90) return { label: `Window closes ${hourLabel(callWindow.effective.end)}`, tone: "warning" };
  }
  return { label: "Scheduled", tone: "neutral" };
}

function Chip({ tone, children, dot = true }: { tone: ChipTone; children: React.ReactNode; dot?: boolean }) {
  return <span className={`portal-status-chip is-${tone}`}>{dot && <span aria-hidden="true" />}{children}</span>;
}

const SHOW_CALLBACK_DEMO = process.env.NODE_ENV !== "production" || process.env.NEXT_PUBLIC_DEMO_CALLBACKS === "true";

function createDemoCallbacks(): CallbackView[] {
  const entries = [
    { id: "demo-callback-1", name: "Michael Torres", product: "Whole Life Inquiry", offset: 1, timezone: "America/Los_Angeles", state: "CA", note: "Discuss options and next steps", status: "scheduled" as const, phone: "(555) 289-1034", email: "michael.torres@example.com" },
    { id: "demo-callback-2", name: "Emily Carter", product: "Final Application", offset: 3, timezone: "America/Chicago", state: "IL", note: "Check in on application status", status: "scheduled" as const, phone: "(555) 418-2077", email: "emily.carter@example.com" },
    { id: "demo-callback-3", name: "Sarah Reynolds", product: "Term Life Quote", offset: -4, timezone: "America/Los_Angeles", state: "CA", note: "Follow up on quote and answer questions", status: "missed" as const, phone: "(555) 627-1108", email: "sarah.reynolds@example.com" },
    { id: "demo-callback-4", name: "Robert Wilson", product: "Beneficiary Update", offset: 27, timezone: "America/Denver", state: "CO", note: "Confirm beneficiary details", status: "scheduled" as const, phone: "(555) 301-8842", email: "robert.wilson@example.com" },
  ];
  const agentZone = Intl.DateTimeFormat().resolvedOptions().timeZone;
  return entries.map((entry) => {
    const scheduledAtUtc = new Date(Date.now() + entry.offset * 3_600_000).toISOString();
    return {
      id: entry.id, leadId: `demo-lead-${entry.id.slice(-1)}`, workItemId: `demo-work-item-${entry.id.slice(-1)}`, customerName: entry.name, scheduledAtUtc,
      customerTimezone: entry.timezone, customerTime: longTime(scheduledAtUtc, entry.timezone), agentTime: longTime(scheduledAtUtc, agentZone), assignedTo: "demo-agent",
      assigneeName: "Jordan Davis", assigneeRole: "agent", note: entry.note, status: entry.status, productName: entry.product, phone: entry.phone, email: entry.email,
      state: entry.state, attemptNumber: 2, sourceName: "Demo source",
      isOverdue: entry.status === "missed", isDueToday: entry.status !== "missed" && entry.offset < 12,
      history: [{ id: `${entry.id}-history`, action: "scheduled", createdAt: scheduledAtUtc, actorName: "Demo Agent", oldScheduledAtUtc: null, newScheduledAtUtc: scheduledAtUtc, oldStatus: null, newStatus: "scheduled", note: entry.note, via: null }],
      completedVia: null, missedAt: entry.status === "missed" ? scheduledAtUtc : null, reopenedAt: null, releasedAt: null, inbound: false,
      isDemo: true,
    };
  });
}


/**
 * One callback, read once for the table row and the phone card alike (2026-10-09 mobile): its status,
 * when it is due in the customer's own time, who holds it, and what can be done to it.
 */
function callbackRow(callback: CallbackView, { now, callWindow, selected, readOnly, settled, onReschedule }: {
  now: number; callWindow: CallbackWindowFacts | undefined; selected: boolean; readOnly: boolean; settled: boolean; onReschedule: () => void;
}) {
  const status = settled ? settledLabel(callback) : rowStatus(callback, now, callWindow);
  const callable = !settled && (callback.isOverdue || callback.isDueToday);
  // Anything not due today shows the day it was promised, not only the time. Their time, with its zone.
  const due = callback.isDueToday && !settled ? shortTime(callback.scheduledAtUtc, callback.customerTimezone) : longTime(callback.scheduledAtUtc, callback.customerTimezone);
  // A lead handed to the shared queue has no single agent holding it.
  const agent = callback.releasedAt ? "Shared queue" : callback.assigneeName || "—";
  const actions: RowAction[] = [];
  if (callable) actions.push({ key: "call", primary: true, label: "Call now", title: "Opens the dialer on this lead", href: callback.isDemo ? "/app/dialer" : `/app/dialer?lead=${encodeURIComponent(callback.leadId)}` });
  if (!settled) actions.push({ key: "reschedule", label: "Reschedule", disabled: readOnly || callback.isDemo, onSelect: onReschedule, pressed: selected, opensPanel: true });
  if (!settled) actions.push({ key: "book", label: "Book a callback", icon: <Plus aria-hidden="true" />, disabled: readOnly || callback.isDemo, onSelect: onReschedule, opensPanel: true });
  if (settled && !callback.isDemo) actions.push({ key: "open", label: "Open lead", href: `/app/leads/${callback.leadId}` });
  return { status, due, agent, actions };
}

type CallbackRowProps = {
  callback: CallbackView; now: number; callWindow: CallbackWindowFacts | undefined; selected: boolean; readOnly: boolean; settled: boolean; selection: RowSelection; onReschedule: () => void;
};

/**
 * One callback as a table row. The details an agent reads before dialling sit under the name:
 * phone, attempt, source, who holds it, and the note. "Your time" and "Agent" are dropped while the
 * booking panel is open, so the table still fits beside it.
 */
function CallbackTableRow({ compact, rowHeight, ...props }: CallbackRowProps & { compact: boolean; rowHeight: number }) {
  const { callback, selected, selection } = props;
  const { status, due, agent, actions } = callbackRow(callback, props);
  return (
    // One line per cell and one shared height for every row, so every page reads the same.
    <tr className={cn("m-row", (selected || selection.isSelected(callback.id)) && "bg-[var(--primary-soft)]")} style={{ height: rowHeight }}>
      <td className={st.td}><RowCheckbox selection={selection} id={callback.id} label={`Select ${callback.customerName}`} /></td>
      <td className={cn(st.td, "whitespace-nowrap")}>
        {callback.isDemo
          ? <span className="font-semibold text-[var(--ink)]">{callback.customerName}</span>
          : <Link href={`/app/leads/${callback.leadId}`} className="font-semibold text-[var(--ink)] hover:underline" title={callback.note ?? undefined}>{callback.customerName}</Link>}
      </td>
      <td className={cn(st.td, "whitespace-nowrap tabular-nums")}>{callback.phone ?? "—"}</td>
      <td className={cn(st.td, "whitespace-nowrap tabular-nums")}>{callback.attemptNumber}</td>
      {!compact && <td className={st.td}><span className="block max-w-[220px] truncate" title={callback.sourceName ?? undefined}>{callback.sourceName ?? "—"}</span></td>}
      <td className={cn(st.td, "whitespace-nowrap font-semibold text-[var(--ink)]")}>{due}</td>
      <td className={st.td}><Chip tone={status.tone}>{status.label}</Chip></td>
      {!compact && <td className={cn(st.td, "whitespace-nowrap")}>{agent}</td>}
      <td className={cn(st.td, "whitespace-nowrap text-right")}>
        <span className="inline-flex flex-nowrap justify-end gap-2">
          {actions.map((action) => <ActionButton key={action.key} action={action} size="sm" />)}
        </span>
      </td>
    </tr>
  );
}

/**
 * The same callback as a card, below lg (2026-10-09 mobile). Up front: the customer, when it is due
 * in their own time (with the zone and their state, whose calling window applies) and the status —
 * "Window closes 8 pm" included. Call now is one tap; Reschedule and Book a callback open the booking
 * panel, a full-width sheet here.
 */
function CallbackCard(props: CallbackRowProps) {
  const { callback, selected, selection } = props;
  const { status, due, agent, actions } = callbackRow(callback, props);
  const facts = [callback.phone, `Attempt ${callback.attemptNumber}`, agent !== "—" ? agent : null].filter(Boolean).join(" · ");
  return (
    <li className={cn(cardItem, (selected || selection.isSelected(callback.id)) && "bg-[var(--primary-soft)]")}>
      <div className="flex items-start gap-1">
        {/* The checkbox inside a 36px target. */}
        <label className="-mt-1.5 -ml-2.5 inline-flex size-9 shrink-0 cursor-pointer items-center justify-center">
          <RowCheckbox selection={selection} id={callback.id} label={`Select ${callback.customerName}`} />
        </label>
        <span className="min-w-0 flex-1">
          {callback.isDemo
            ? <span className="block truncate text-sm leading-[1.5] font-semibold tracking-[-0.02em] text-[var(--ink)]">{callback.customerName}</span>
            : <Link href={`/app/leads/${callback.leadId}`} className="block truncate text-sm leading-[1.5] font-semibold tracking-[-0.02em] text-[var(--ink)] hover:underline">{callback.customerName}</Link>}
          <span className="block text-sm leading-[1.5] tracking-[-0.02em] text-[var(--ink)] tabular-nums">
            Due {due}{callback.state ? ` · ${callback.state}` : ""}
          </span>
        </span>
        <span className="shrink-0"><Chip tone={status.tone}>{status.label}</Chip></span>
      </div>
      <span className={st.sub}>{facts}</span>
      <CardActions actions={actions} label={callback.customerName} />
    </li>
  );
}

/** The gap the page keeps between blocks (gap-6), used again under the table. */
const BLOCK_GAP = 24;
/** Rows on every page, and the bounds of their shared height (sized so the rows fill the table). */
const PAGE_ROWS = 8;
const MIN_ROW_HEIGHT = 50;
/** Toolbar (two lines when the filters wrap), header row, pager and borders, as measured. */
const TABLE_CHROME = 200;

/**
 * The table fills the window: from where it starts down to one block gap above the bottom, the same
 * space as between the cards and the table. Measured, not guessed, so it holds whatever sits above
 * it (a notice, a refused-booking alert). Rows per page then fit that height, so the body never
 * scrolls inside itself.
 */
function useFillHeight() {
  // A callback ref kept in state, so measuring re-runs once the table is on the page.
  const [node, setNode] = useState<HTMLDivElement | null>(null);
  const [height, setHeight] = useState(560);
  // Everything in the card that is not a row, as drawn: toolbar (it wraps on narrow windows), header
  // row, pager, a horizontal scrollbar when the table is wider than the card, and the card's border.
  const [chrome, setChrome] = useState(TABLE_CHROME);
  useEffect(() => {
    if (!node) return;
    const fit = () => {
      const top = node.getBoundingClientRect().top + window.scrollY;
      setHeight(Math.max(TABLE_CHROME + MIN_ROW_HEIGHT * PAGE_ROWS, Math.floor(window.innerHeight - top - BLOCK_GAP)));
      const card = node.querySelector<HTMLElement>('[data-slot="table-card"]');
      const head = card?.querySelector("thead");
      if (!card || !head) return;
      const [toolbar, body, footer] = Array.from(card.children) as HTMLElement[];
      const scrollbar = body ? body.offsetHeight - body.clientHeight : 0;
      setChrome((toolbar?.getBoundingClientRect().height ?? 0) + (footer?.getBoundingClientRect().height ?? 0) + head.getBoundingClientRect().height + scrollbar + 2);
    };
    fit();
    // Again when the area or the toolbar changes size (the rows first draw, a notice appears above,
    // the filters wrap). None of these depend on the rows' height, so this cannot feed back.
    const observer = typeof ResizeObserver === "undefined" ? null : new ResizeObserver(() => fit());
    if (observer) {
      observer.observe(node);
      const toolbar = node.querySelector<HTMLElement>('[data-slot="table-card"]')?.children[0];
      if (toolbar) observer.observe(toolbar);
    }
    window.addEventListener("resize", fit);
    return () => { observer?.disconnect(); window.removeEventListener("resize", fit); };
  }, [node]);
  // Always PAGE_ROWS rows sharing one height: the rows' area split evenly (a collapsed-border row's
  // height already includes its rule), kept fractional so the last row ends exactly on the pager's
  // line. Never shorter than a row's own content (the action buttons and their padding).
  const rowHeight = Math.max(MIN_ROW_HEIGHT, Math.floor(((height - chrome) / PAGE_ROWS) * 100) / 100);
  return { setNode, height, rows: PAGE_ROWS, rowHeight };
}
type WhenFilter = "open" | "overdue" | "today" | "tomorrow" | "upcoming" | "settled";
const WHEN_LABEL: Record<WhenFilter, string> = { open: "All open", overdue: "Overdue", today: "Today", tomorrow: "Tomorrow", upcoming: "Upcoming", settled: "Settled" };

function settledLabel(callback: CallbackView): { label: string; tone: ChipTone } {
  if (callback.status === "completed") return callback.completedVia === "manual" ? { label: "Marked done", tone: "success" } : { label: "Kept", tone: "success" };
  if (wasMissed(callback)) return { label: "Missed", tone: "error" };
  return { label: "Cancelled", tone: "neutral" };
}

export function CallbackCalendar({ readOnly }: { readOnly: boolean }) {
  const [callbacks, setCallbacks] = useState<CallbackView[]>([]);
  const [windows, setWindows] = useState<Record<string, CallbackWindowFacts>>({});
  const [refusals, setRefusals] = useState<CallbackRefusalNotice[]>([]);
  const [viewer, setViewer] = useState<Viewer | null>(null);
  const [scope, setScope] = useState<Scope | null>(null);
  const [yourZone, setYourZone] = useState(() => Intl.DateTimeFormat().resolvedOptions().timeZone);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [draft, setDraft] = useState<{ id: string; date: string; time: string } | null>(null);
  const [nearest, setNearest] = useState<{ id: string; local: string; value: NearestLegalTime | null } | null>(null);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [historyLoading, setHistoryLoading] = useState(false);
  const [demoPreview, setDemoPreview] = useState(false);
  const [now, setNow] = useState(() => Date.now());
  const selectedIdRef = useRef<string | null>(null);

  useEffect(() => {
    const clock = window.setInterval(() => setNow(Date.now()), 30_000);
    return () => window.clearInterval(clock);
  }, []);

  const load = useCallback(async () => {
    setError("");
    const response = await fetch("/api/app/callbacks", { cache: "no-store" });
    const body = await response.json().catch(() => null);
    if (!response.ok) setError(body?.error ?? "Could not load callbacks.");
    else {
      const live = (body.callbacks ?? []) as CallbackView[];
      const next = live.length === 0 && SHOW_CALLBACK_DEMO ? createDemoCallbacks() : live;
      setDemoPreview(next.some((item) => item.isDemo === true));
      setCallbacks(next);
      setWindows((body.windows ?? {}) as Record<string, CallbackWindowFacts>);
      setRefusals(Array.isArray(body.refusals) ? body.refusals as CallbackRefusalNotice[] : []);
      const who = body.viewer && typeof body.viewer.userId === "string" ? body.viewer as Viewer : null;
      setViewer(who);
      // Owners start on every callback in the workspace; everyone else on their own.
      setScope((current) => current ?? (who && who.role !== "owner" ? "mine" : "all"));
      // "Your time" is the viewer's own zone (saved with their working hours), else the browser's —
      // never the agency's, which is nobody's clock in particular (LA-1.22).
      if (typeof body.viewerTimezone === "string" && body.viewerTimezone) setYourZone(body.viewerTimezone);
      // Book a callback opens on the most urgent open callback, as the board does.
      const mineFirst = who && who.role !== "owner" ? next.filter((item) => item.assignedTo === who.userId || item.isDemo) : next;
      const open = mineFirst.filter((item) => OPEN_STATUSES.has(item.status));
      const keep = selectedIdRef.current && next.some((item) => item.id === selectedIdRef.current) ? selectedIdRef.current : (open.find((item) => item.isOverdue) ?? open.find((item) => item.isDueToday) ?? open[0])?.id ?? null;
      selectedIdRef.current = keep;
      setSelectedId(keep);
    }
    setLoading(false);
  }, []);

  // The page is a client-side snapshot of the protected callback API and loads on mount.
  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(() => { void load(); }, [load]);

  const mineOnly = scope === "mine" && viewer !== null;
  const [search, setSearch] = useState("");
  // One table of every callback: a quick "when" filter, a date, the search, one pager.
  const [when, setWhen] = useState<WhenFilter>("open");
  const [day, setDay] = useState("");
  const [listPage, setListPage] = useState(1);
  // Below lg (2026-10-09 mobile) the rows are cards, the filters sit behind a Filters button, and the
  // list scrolls with the page; the fill-height sizing is for the table, from lg.
  const wide = useMediaQuery(WIDE_QUERY);
  const [filtersOpen, setFiltersOpen] = useState(false);
  // The booking panel opens beside the table (70 / 30) from "Book a callback" or a row's Reschedule.
  const [panelOpen, setPanelOpen] = useState(false);
  const { setNode: setFillNode, height: fillHeight, rows: pageSize, rowHeight } = useFillHeight();
  const needle = search.trim().toLowerCase();
  const visible = useMemo(() => {
    const scoped = mineOnly ? callbacks.filter((item) => item.isDemo || item.assignedTo === viewer?.userId) : callbacks;
    if (!needle) return scoped;
    return scoped.filter((item) => [item.customerName, item.phone, item.sourceName, item.note, item.assigneeName, item.state].some((value) => String(value ?? "").toLowerCase().includes(needle)));
  }, [callbacks, mineOnly, viewer, needle]);
  const open = useMemo(() => visible.filter((item) => OPEN_STATUSES.has(item.status)), [visible]);
  const overdue = useMemo(() => open.filter((item) => item.isOverdue).sort((a, b) => a.scheduledAtUtc.localeCompare(b.scheduledAtUtc)), [open]);
  const dueToday = useMemo(() => open.filter((item) => item.isDueToday && !item.isOverdue).sort((a, b) => a.scheduledAtUtc.localeCompare(b.scheduledAtUtc)), [open]);
  const upcoming = useMemo(() => open.filter((item) => !item.isDueToday && !item.isOverdue).sort((a, b) => a.scheduledAtUtc.localeCompare(b.scheduledAtUtc)), [open]);
  const settledOf = useCallback((items: CallbackView[]) => items.filter((item) => (item.status === "completed" || item.status === "missed" || item.status === "cancelled") && now - new Date(item.scheduledAtUtc).getTime() <= THIRTY_DAYS), [now]);
  const settledRecent = useMemo(() => settledOf(visible), [settledOf, visible]);
  const visibleRefusals = useMemo(() => (mineOnly ? refusals.filter((item) => item.actorId === viewer?.userId) : refusals), [refusals, mineOnly, viewer]);
  const selected = callbacks.find((item) => item.id === selectedId) ?? null;
  const selectedWindow = selected?.state ? windows[selected.state] : undefined;
  const current = selected ? localParts(selected.scheduledAtUtc, selected.customerTimezone) : null;
  const draftDate = draft && selected && draft.id === selected.id ? draft.date : current?.date ?? "";
  const draftTime = draft && selected && draft.id === selected.id ? draft.time : current?.time ?? "";
  const draftLocal = draftDate && draftTime ? `${draftDate}T${draftTime}` : "";
  const draftAt = selected && draftLocal ? zonedToUtc(draftLocal, selected.customerTimezone) : null;
  const [draftHour, draftMinute] = draftTime ? draftTime.split(":").map(Number) : [NaN, NaN];
  const inWindow = selectedWindow && Number.isFinite(draftHour) ? insideWindow(selectedWindow, draftHour, draftMinute) : null;
  const inFuture = draftAt ? draftAt.getTime() > now : null;
  const stateName = selected?.state ? STATE_NAMES[selected.state] ?? selected.state : null;
  const unchanged = Boolean(current && draftDate === current.date && draftTime === current.time);
  const terminal = selected ? TERMINAL_STATUSES.has(selected.status) : true;
  const canBook = Boolean(selected && !readOnly && !selected.isDemo && !terminal && !saving && inWindow !== false && inFuture === true && selected.state && !unchanged);
  const suggestion = nearest && selected && nearest.id === selected.id && nearest.local === draftLocal ? nearest.value : null;

  // "Outside the Oregon calling window" is answered with the next time that is not. Asked of the
  // server (next_callable_instant) so holidays, Sundays and the campaign are weighed too.
  const selectedLive = selected && !selected.isDemo && !terminal && !readOnly ? selected.id : null;
  useEffect(() => {
    if (!selectedLive || inWindow !== false || !draftLocal) return;
    const controller = new AbortController();
    const timer = window.setTimeout(() => {
      void fetch(`/api/app/callbacks?callback_id=${encodeURIComponent(selectedLive)}&suggest_local=${encodeURIComponent(draftLocal)}`, { cache: "no-store", signal: controller.signal })
        .then((response) => (response.ok ? response.json() : null))
        .then((body) => { if (body) setNearest({ id: selectedLive, local: draftLocal, value: (body.nearest ?? null) as NearestLegalTime | null }); })
        .catch(() => undefined);
    }, 300);
    return () => { controller.abort(); window.clearTimeout(timer); };
  }, [selectedLive, inWindow, draftLocal]);

  function choose(callback: CallbackView) {
    selectedIdRef.current = callback.id;
    setSelectedId(callback.id);
    setPanelOpen(true);
    setHistoryOpen(false);
    setDraft(null);
  }

  /** "Use that": the suggestion goes into the picker. The agent still books it. */
  function takeSuggestion(callback: CallbackView, value: NearestLegalTime) {
    choose(callback);
    const [date, time] = value.customerLocal.split("T");
    setDraft({ id: callback.id, date, time });
  }

  async function act(actionName: "reschedule" | "cancel" | "complete") {
    if (!selected) return;
    setSaving(true); setError("");
    const response = await fetch("/api/app/callbacks", { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: actionName, callback_id: selected.id, callback_local: actionName === "reschedule" ? draftLocal : undefined }) });
    const body = await response.json().catch(() => null);
    setSaving(false);
    if (!response.ok) {
      const message = body?.error ?? "Could not update the callback. Your choice is still on screen.";
      setError(message);
      notify.block(message);
      if (actionName === "reschedule" && body && "nearest" in body) setNearest({ id: selected.id, local: draftLocal, value: (body.nearest ?? null) as NearestLegalTime | null });
      return;
    }
    notify.done(actionName === "reschedule" ? "Callback booked" : actionName === "complete" ? "Callback marked done" : "Callback cancelled");
    setDraft(null);
    await load();
  }

  async function openHistory() {
    if (!selected || selected.isDemo) { setHistoryOpen((value) => !value); return; }
    if (historyOpen) { setHistoryOpen(false); return; }
    setHistoryOpen(true); setHistoryLoading(true);
    const response = await fetch(`/api/app/callbacks?callback_id=${encodeURIComponent(selected.id)}&include_history=true`, { cache: "no-store" });
    const body = await response.json().catch(() => null);
    const detail = response.ok ? (body?.callbacks ?? [])[0] as CallbackView | undefined : undefined;
    if (detail) setCallbacks((items) => items.map((item) => item.id === detail.id ? { ...item, history: detail.history } : item));
    setHistoryLoading(false);
  }

  // The quick "when" filter and the date pick the rows; the search was applied upstream (`visible`).
  // Worked out before the loading return so the row selection's hook always runs.
  const tomorrowDay = localParts(new Date(now + 86_400_000), yourZone).date;
  const byWhen: Record<WhenFilter, CallbackView[]> = {
    open: [...overdue, ...dueToday, ...upcoming],
    overdue,
    today: dueToday,
    tomorrow: upcoming.filter((item) => localParts(item.scheduledAtUtc, yourZone).date === tomorrowDay),
    upcoming,
    settled: [...settledRecent].sort((a, b) => b.scheduledAtUtc.localeCompare(a.scheduledAtUtc)),
  };
  const rows = day ? byWhen[when].filter((item) => localParts(item.scheduledAtUtc, yourZone).date === day) : byWhen[when];
  // Ticked rows (2026-10-09 saved views): kept across pages, dropped when a filter hides them.
  const selection = useRowSelection(rows.map((item) => item.id));

  if (loading) return <PageLoading />;

  const { current: listCurrent, rows: pageRows } = paginate(rows, listPage, pageSize);
  const filtersOn = Boolean(needle || day || when !== "open");
  const clearFilters = () => { setSearch(""); setDay(""); setWhen("open"); setListPage(1); };
  const compact = panelOpen;
  const settledView = when === "settled";

  // Saved views (2026-10-09 saved views): the quick filter, the date and the search, as one state.
  // Built-ins are the quick filters themselves. "Missed" is not one of them: missed callbacks sit
  // inside Settled, and no filter here picks them out alone.
  const viewState: ViewState = { when: when === "open" ? "" : when, day, q: search.trim() };
  const builtInViews: BuiltInView[] = (Object.keys(WHEN_LABEL) as WhenFilter[]).map((key) => ({ id: key, name: key === "today" ? "Due today" : key === "settled" ? "Settled, last 30 days" : WHEN_LABEL[key], state: { when: key === "open" ? "" : key } }));
  function applyView(state: ViewState) {
    const next = typeof state.when === "string" && state.when in WHEN_LABEL ? (state.when as WhenFilter) : "open";
    setWhen(next);
    setDay(typeof state.day === "string" && /^\d{4}-\d{2}-\d{2}$/.test(state.day) ? state.day : "");
    setSearch(typeof state.q === "string" ? state.q : "");
    setListPage(1);
  }
  /** Export selected: the table's columns for the ticked callbacks, built in the browser. Times are the customer's. */
  function exportSelected() {
    const chosen = rows.filter((item) => selection.selected.has(item.id));
    downloadCsv("callbacks-selected.csv",
      ["Customer", "Phone", "Attempt", "Source", "Due (customer time)", "Status", "Agent"],
      chosen.map((item) => [
        item.customerName,
        item.phone ?? "",
        item.attemptNumber,
        item.sourceName ?? "",
        longTime(item.scheduledAtUtc, item.customerTimezone),
        (settledView ? settledLabel(item) : rowStatus(item, now, item.state ? windows[item.state] : undefined)).label,
        item.releasedAt ? "Shared queue" : item.assigneeName || "",
      ]));
  }

  // The toolbar: search, the quick "when" filter, the date, saved views, Clear, Refresh. Below lg the
  // search takes the first row and the "when" filter and the date are the same controls behind a
  // Filters button, opening in the toolbar band (2026-10-09 mobile); saved views stay in the row.
  const searchBox = <ToolbarSearch value={search} onChange={(value) => { setSearch(value); setListPage(1); }} placeholder="Search customer, phone, note" label="Search callbacks by customer, phone, source, note or agent" />;
  const whenFilter = (
    <span role="group" aria-label="When" className={cn("inline-flex h-9 gap-0.5 rounded-md bg-[var(--canvas)] p-0.5", !wide && "max-w-full overflow-x-auto")}>
      {(Object.keys(WHEN_LABEL) as WhenFilter[]).map((key) => (
        <button key={key} type="button" aria-pressed={when === key} onClick={() => { setWhen(key); setListPage(1); }} className={cn("inline-flex h-8 items-center gap-1.5 rounded-md border px-2.5 text-sm font-semibold tracking-[-0.01em] whitespace-nowrap", !wide && "shrink-0", when === key ? "border-border bg-card text-foreground" : "border-transparent text-muted-foreground hover:text-foreground")}>
          {WHEN_LABEL[key]}
          <span className={cn("rounded-full px-1.5 text-xs tabular-nums", key === "overdue" && byWhen.overdue.length ? "bg-[var(--error-surface)] text-[var(--error-ink)]" : "bg-[var(--surface-alt)] text-muted-foreground")}>{byWhen[key].length}</span>
        </button>
      ))}
    </span>
  );
  const dateFilter = <input type="date" aria-label="Due on" className={wide ? toolbarControl : cn(toolbarControl, "w-full")} value={day} onChange={(event) => { setDay(event.target.value); setListPage(1); }} />;
  const savedViews = <SavedViews storageKey="callbacks" current={viewState} builtIns={builtInViews} onApply={applyView} />;
  const refreshActions = <>
    {filtersOn && <ClearFiltersButton onClick={clearFilters} />}
    <RefreshButton onClick={() => void load()} />
  </>;
  const toolbar = wide ? (
    <DataToolbar actions={refreshActions}>
      {searchBox}
      {whenFilter}
      {dateFilter}
      {savedViews}
    </DataToolbar>
  ) : (
    <>
      <DataToolbar
        className={COMPACT_TOOLBAR}
        actions={<>
          <FilterButton open={filtersOpen} onClick={() => setFiltersOpen((open) => !open)} count={(when !== "open" ? 1 : 0) + (day ? 1 : 0)} aria-controls="callbacks-filters" />
          {savedViews}
          <span className="ml-auto flex flex-wrap items-center gap-2">{refreshActions}</span>
        </>}
      >
        {searchBox}
      </DataToolbar>
      {filtersOpen && <div id="callbacks-filters" role="group" aria-label="Filters" className="flex w-full min-w-0 flex-col gap-2">{whenFilter}{dateFilter}</div>}
    </>
  );


  // 36px below lg, for a thumb.
  const smallSize = wide ? "sm" : "default";
  const scopeToggle = viewer && (
    <div role="group" aria-label="Whose callbacks" className="inline-flex gap-1">
      <Button type="button" size={smallSize} variant={scope === "mine" ? "default" : "outline"} aria-pressed={scope === "mine"} onClick={() => setScope("mine")}>Mine</Button>
      <Button type="button" size={smallSize} variant={scope === "all" ? "default" : "outline"} aria-pressed={scope === "all"} onClick={() => setScope("all")}>All</Button>
    </div>
  );

  // The panel's text buttons get a 36px target on a touch screen (below lg the panel is a sheet).
  const moreTarget = wide ? undefined : "min-h-9";
  const bookingPanel = (
    // Split beside the table (DetailPanel): it stretches to the table's height, so the two end on the
    // same line; long content scrolls inside, and "Book the callback" stays in the footer.
    <DetailPanel
      mode="split"
      title="Book a callback"
      subtitle={selected ? <>
        {selected.customerName}{stateName ? ` · ${stateName}` : ""}
        {!selected.isDemo && <> · <Link className="font-semibold text-[var(--accent-ink)]" href={`/app/leads/${selected.leadId}`}>Open lead <ExternalLink className="inline size-3.5" aria-hidden="true" /></Link></>}
      </> : undefined}
      onClose={() => setPanelOpen(false)}
      bodyClassName="flex flex-col"
      footer={selected ? <Button type="button" className="w-full" disabled={!canBook} onClick={() => void act("reschedule")}>{saving ? "Booking…" : "Book the callback"}</Button> : undefined}
    >
      {selected ? (
        <section className="portal-callbacks-card m-0 border-0 shadow-none">
          <div className="portal-callbacks-local">
            <span>Their local time</span>
            <strong>{draftAt ? longTime(draftAt, selected.customerTimezone) : "Choose a date and time"}</strong>
            <small>{draftAt ? `${shortTime(draftAt, yourZone, false)} your time (${zoneAbbreviation(yourZone, draftAt)})` : " "}</small>
          </div>
          <div className="portal-callbacks-fields">
            <label><span>Date</span><input type="date" value={draftDate} disabled={readOnly || selected.isDemo || terminal} onChange={(event) => setDraft({ id: selected.id, date: event.target.value, time: draftTime })} /></label>
            <label><span>Time &mdash; their timezone</span><input type="time" value={draftTime} disabled={readOnly || selected.isDemo || terminal} onChange={(event) => setDraft({ id: selected.id, date: draftDate, time: event.target.value })} /></label>
          </div>
          <div className="portal-callbacks-checks">
            <span>
              {!selected.state
                ? <Chip tone="warning">No state on this lead</Chip>
                : inWindow === null ? <Chip tone="neutral">Window not loaded</Chip>
                : inWindow ? <Chip tone="success">Inside the {stateName} calling window</Chip>
                : <Chip tone="error">Outside the {stateName} calling window</Chip>}
              <small>{!selected.state ? "Add a state to this lead — its calling window decides when it may be called." : selectedWindow ? windowSummary(selectedWindow) : "The server still checks it before booking."}</small>
            </span>
            {suggestion && (
              <span>
                <small className="text-[var(--body)]">Nearest legal time: <strong className="font-semibold text-[var(--ink)]">{longTime(suggestion.utc, selected.customerTimezone)}</strong> their time &mdash; {shortTime(suggestion.utc, yourZone, false)} yours</small>
                <Button type="button" size="sm" variant="outline" onClick={() => takeSuggestion(selected, suggestion)}>Use that</Button>
              </span>
            )}
            <span>
              {inFuture === null ? <Chip tone="neutral">Choose a time</Chip> : inFuture ? <Chip tone="success">In the future</Chip> : <Chip tone="error">In the past</Chip>}
            </span>
          </div>
          {!terminal && !selected.isDemo && !readOnly && (
            <div className="portal-callbacks-card-more">
              <button type="button" className={moreTarget} disabled={saving} onClick={() => void act("complete")} title="Records it as kept by hand. Where the lead goes next is the call's outcome, not this button.">Mark done</button>
              <button type="button" className={moreTarget} disabled={saving} onClick={() => void act("cancel")}>Cancel callback</button>
              <button type="button" className={moreTarget} aria-expanded={historyOpen} onClick={() => void openHistory()}>History</button>
            </div>
          )}
          {historyOpen && (
            historyLoading ? <p className="portal-callbacks-history-note" role="status">Loading history…</p>
              : selected.history.length === 0 ? <p className="portal-callbacks-history-note">No history recorded yet.</p>
              : <ol className="portal-callbacks-history">{[...selected.history].reverse().map((entry) => <li key={entry.id}><strong>{longTime(entry.createdAt, yourZone)}</strong><span>{entry.action.replaceAll("_", " ")}{entry.via === "manual" ? " by hand" : entry.via === "call" ? " on the call" : ""} · {entry.actorName}</span>{entry.note && <small>{entry.note}</small>}</li>)}</ol>
          )}
        </section>
      ) : (
        <p className="m-0 px-4 py-6 text-sm text-muted-foreground">Pick Reschedule on a callback to book it.</p>
      )}
    </DetailPanel>
  );

  return (
    <main className="m-stagger flex w-full min-w-0 flex-col gap-6">
      <PageHeader
        title="Callbacks"
        actions={<div className="flex flex-wrap items-center gap-2">{scopeToggle}<Button variant="outline" asChild><Link href="/app/dialer">Open the queue</Link></Button></div>}
      />
      {demoPreview && <div role="status" className="portal-callbacks-notice">Demo preview — sample callbacks, read-only and not stored.</div>}
      {readOnly && <div role="status" className="portal-callbacks-notice">Account suspended — callbacks are read-only.</div>}
      {error && <div role="alert" className="portal-callbacks-error"><CircleAlert className="size-4" aria-hidden="true" />{error}</div>}


      {/* A refused booking is the one note worth keeping on the page: it carries the next legal time. */}
      {visibleRefusals.map((refusal) => {
        const asked = refusal.requestedLocal ? zonedToUtc(refusal.requestedLocal, refusal.timezone) : null;
        const openOne = callbacks.find((item) => item.leadId === refusal.leadId && OPEN_STATUSES.has(item.status) && !item.isDemo);
        return (
          <div key={refusal.id} className="portal-callbacks-note is-error" role="status">
            <strong>{refusal.customerName}&rsquo;s callback could not be booked{asked ? ` for ${shortTime(asked, refusal.timezone)}` : ""}</strong>
            <p>
              {refusal.message}
              {refusal.nearest && <> The nearest legal time is {longTime(refusal.nearest.utc, refusal.timezone)} their time, which is {shortTime(refusal.nearest.utc, yourZone, false)} yours.</>}
            </p>
            <div className="mt-2 flex flex-wrap items-center gap-3">
              {refusal.nearest && openOne && !readOnly && <Button type="button" size={smallSize} variant="outline" onClick={() => takeSuggestion(openOne, refusal.nearest as NearestLegalTime)}>Use that time</Button>}
              <Link className="portal-callbacks-link" href={`/app/leads/${refusal.leadId}`}>Open lead</Link>
            </div>
          </div>
        );
      })}

      {/* The table takes the full width; "Book a callback" splits it 70 / 30 with the booking panel. */}
      <div ref={setFillNode} className="flex flex-col gap-4 lg:flex-row lg:items-stretch lg:[height:var(--fill-h)]" style={{ "--fill-h": `${fillHeight}px` } as React.CSSProperties}>
        <TableCard
          className="flex min-h-0 min-w-0 flex-1 flex-col [&>*:nth-child(2)]:min-h-0 [&>*:nth-child(2)]:flex-1 [&>*:nth-child(2)]:overflow-y-auto"
          toolbar={<>
            {toolbar}
            {/* In the toolbar band rather than above the rows: the table fits the window by measuring
                the toolbar (useFillHeight), so the bar appearing re-fits the rows instead of
                pushing the last one out of view. Drawn as a full-width band at the band's foot. */}
            <BulkBar
              className="-mx-4 -mb-3 w-[calc(100%+2rem)] border-t border-b-0"
              count={selection.count}
              noun={["callback", "callbacks"]}
              onClear={selection.clear}
              actions={<Button type="button" variant="outline" onClick={exportSelected}><Download aria-hidden="true" />Export selected</Button>}
            />
          </>}
          footer={<Pager page={listCurrent} total={rows.length} pageSize={pageSize} noun="callbacks" suffix={settledView ? "newest first" : "soonest first"} onPage={setListPage} />}
        >
          <div>
            {pageRows.length === 0 ? (
              filtersOn
                ? <NoMatches noun="callbacks" onClear={clearFilters} />
                : mineOnly
                  ? <EmptyState title="You have no open callbacks" hint="Others' callbacks are under All." action={<Button type="button" variant="outline" onClick={() => setScope("all")}>Show all callbacks</Button>} />
                  : <EmptyState title="No open callbacks" hint="Book one from a call outcome." action={<Button asChild variant="outline"><Link href="/app/dialer">Open the dialer</Link></Button>} />
            ) : !wide ? (
              <>
                {/* Select the page, as the table's header checkbox does. */}
                <div className="flex items-center border-b border-border px-4 py-1">
                  <label className="inline-flex h-9 cursor-pointer items-center gap-2 text-sm text-[var(--body)]">
                    <SelectAllCheckbox selection={selection} ids={pageRows.map((item) => item.id)} label="Select every callback on this page" />
                    Select page
                  </label>
                </div>
                <CardList label="Callbacks">
                  {pageRows.map((callback) => (
                    <CallbackCard
                      key={callback.id}
                      callback={callback}
                      now={now}
                      callWindow={callback.state ? windows[callback.state] : undefined}
                      selected={panelOpen && callback.id === selectedId}
                      readOnly={readOnly}
                      settled={settledView}
                      selection={selection}
                      onReschedule={() => choose(callback)}
                    />
                  ))}
                </CardList>
              </>
            ) : (
              <table className={st.table}>
                <thead>
                  <tr className={st.headRow}>
                    <th scope="col" className={cn(st.th, "w-10")}><SelectAllCheckbox selection={selection} ids={pageRows.map((item) => item.id)} label="Select every callback on this page" /></th>
                    <th scope="col" className={cn(st.th, "min-w-[180px]")}>Customer</th>
                    <th scope="col" className={st.th}>Phone</th>
                    <th scope="col" className={st.th}>Attempt</th>
                    {!compact && <th scope="col" className={st.th}>Source</th>}
                    <th scope="col" className={st.th}>Due</th>
                    <th scope="col" className={st.th}>Status</th>
                    {!compact && <th scope="col" className={st.th}>Agent</th>}
                    <th scope="col" className={cn(st.th, "text-right")}><span className="sr-only">Actions</span></th>
                  </tr>
                </thead>
                <tbody>
                  {pageRows.map((callback) => (
                    <CallbackTableRow
                      key={callback.id}
                      callback={callback}
                      now={now}
                      callWindow={callback.state ? windows[callback.state] : undefined}
                      selected={panelOpen && callback.id === selectedId}
                      readOnly={readOnly}
                      compact={compact}
                      settled={settledView}
                      rowHeight={rowHeight}
                      selection={selection}
                      onReschedule={() => choose(callback)}
                    />
                  ))}
                </tbody>
              </table>
            )}
          </div>
        </TableCard>
        {panelOpen && bookingPanel}
      </div>
    </main>
  );
}
