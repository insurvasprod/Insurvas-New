"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { AlarmClock, CalendarClock, CheckCircle2, CircleAlert, Download, ExternalLink, Phone, Plus, Shuffle, UserRoundPlus, Users } from "lucide-react";
import { notify } from "@/lib/notify";
import { Button } from "@/components/ui/button";
import { BulkBar, RowCheckbox, SelectAllCheckbox, useRowSelection, type RowSelection } from "@/components/ui/bulk-bar";
import { SavedViews, type BuiltInView, type ViewState } from "@/components/ui/saved-views";
import { downloadCsv } from "@/components/app/partner-quality-parts";
import { ClearFiltersButton, DataToolbar, FilterButton, FilterPanel, RefreshButton, ToolbarSearch, toolbarControl } from "@/components/ui/data-toolbar";
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
import { Chip, type ChipTone } from "@/components/app/callbacks/day-plan";
import { PersonHistory } from "@/components/app/callbacks/person-history";
import { AddCallbackDialog, type LeadPick } from "@/components/app/callbacks/add-callback-dialog";
import { SpreadDialog } from "@/components/app/callbacks/spread-dialog";
import { GiveToDialog, type Assignee } from "@/components/app/callbacks/give-to-dialog";
import { useSolo } from "@/components/app/solo-context";
import { confirmAction } from "@/components/ui/confirm-dialog";
import { StatCard, StatRow } from "@/components/ui/stat-card";
import { Segmented } from "@/components/ui/view-tabs";
import { durationShort, localParts, longTime, shortTime, zoneAbbreviation, zonedToUtc } from "@/components/app/callbacks/time";

/**
 * Callbacks (p-app-callbacks): what is overdue, what is due today, what is coming, and one card to
 * book a callback in the customer's own time — with the calling window checked while the agent
 * picks, and again by the server before anything is stored.
 *
 * Callbacks A · One work list (owner pick 2026-10-28, canvas page m2-callbacks): four figures, then
 * every open callback in the order to call it — Due now, Later today, Overdue (oldest first), Coming
 * up — with the person on the right. Ticked rows, or the whole overdue pile, can be spread into the
 * next open times inside each customer's window (SpreadDialog). The other quick filters (Overdue,
 * Today, Tomorrow, Upcoming, Settled) are the same table, flat and paged.
 *
 * LA-1 §6.3 (concept board): a callback counts when the call comes back. A contact on a dial of the
 * lead from 15 minutes before it is due to the end of the customer's day keeps it; the customer's
 * window closing on the due day with no kept call misses it (20260925708500/708700). A refused time
 * comes back with the nearest legal one, as a suggestion only.
 */
const TERMINAL_STATUSES = new Set(["completed", "cancelled"]);
const OPEN_STATUSES = new Set(["scheduled", "due", "missed"]);
const THIRTY_DAYS = 30 * 86_400_000;

type Viewer = { userId: string; role: string };
type Scope = "mine" | "all";

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
  const dialer = callback.isDemo ? "/app/dialer" : `/app/dialer?lead=${encodeURIComponent(callback.leadId)}`;
  const actions: RowAction[] = [];
  // One button a row (Callbacks A): Call now when it is due or late, Call early when it is not yet.
  if (callable) actions.push({ key: "call", primary: true, label: "Call now", icon: <Phone aria-hidden="true" />, title: "Opens the dialer on this lead", href: dialer });
  else if (!settled) actions.push({ key: "early", label: "Call early", title: "Opens the dialer on this lead before the callback is due", href: dialer });
  if (!settled) actions.push({ key: "reschedule", label: "Move", disabled: readOnly || callback.isDemo, onSelect: onReschedule, pressed: selected, opensPanel: true });
  if (settled && !callback.isDemo) actions.push({ key: "open", label: "Open lead", href: `/app/leads/${callback.leadId}` });
  return { status, due, agent, actions };
}

type CallbackRowProps = {
  callback: CallbackView; now: number; callWindow: CallbackWindowFacts | undefined; selected: boolean; readOnly: boolean; settled: boolean; selection: RowSelection; onReschedule: () => void; yourZone: string;
};

/**
 * One callback as a table row (Callbacks A): the customer with what they want and where they are, when
 * it is due in their time with yours under it, the status (a row inside "Later today" or "Coming up"
 * shows its source instead of repeating the group), who holds it, and one call button. A click anywhere
 * but a control opens the person panel, where Move, Mark done and Cancel live.
 */
function CallbackTableRow({ compact, rowHeight, quietStatus = false, ...props }: CallbackRowProps & { compact: boolean; rowHeight?: number; quietStatus?: boolean }) {
  const { callback, selected, selection, yourZone } = props;
  const { status, due, agent, actions } = callbackRow(callback, props);
  const sub = [callback.productName, callback.state, `attempt ${callback.attemptNumber}`].filter(Boolean).join(" · ");
  const callAction = actions.find((action) => action.key === "call" || action.key === "early" || action.key === "open");
  return (
    <tr className={cn("m-row cursor-pointer", (selected || selection.isSelected(callback.id)) && "bg-[var(--primary-soft)]", selected && "shadow-[inset_3px_0_0_var(--primary)]")} style={rowHeight ? { height: rowHeight } : undefined} onClick={(event) => { if (!(event.target as HTMLElement).closest("a, button, input, label")) props.onReschedule(); }}>
      <td className={st.td}><RowCheckbox selection={selection} id={callback.id} label={`Select ${callback.customerName}`} /></td>
      <td className={cn(st.td, "min-w-[180px]")}>
        <span className="block truncate font-semibold text-[var(--ink)]" title={callback.note ?? undefined}>{callback.customerName}</span>
        <span className="block truncate text-xs text-muted-foreground">{sub}</span>
      </td>
      <td className={cn(st.td, "whitespace-nowrap tabular-nums")}>
        <span className="block font-semibold text-[var(--ink)]">{due}</span>
        <span className="block text-xs text-muted-foreground">{shortTime(callback.scheduledAtUtc, yourZone, false)} your time</span>
      </td>
      <td className={st.td}>{quietStatus ? <span className="block max-w-[200px] truncate text-xs text-muted-foreground" title={callback.sourceName ?? undefined}>{callback.sourceName ?? "—"}</span> : <Chip tone={status.tone}>{status.label}</Chip>}</td>
      {!compact && <td className={cn(st.td, "whitespace-nowrap")}>{agent}</td>}
      <td className={cn(st.td, "whitespace-nowrap text-right")}>
        {callAction && <ActionButton action={callAction} size="sm" />}
      </td>
    </tr>
  );
}

/** A group's heading inside the work list: its name, how many, and its one action. */
function GroupRow({ label, count, tone, action, columns }: { label: string; count: React.ReactNode; tone?: "accent" | "error"; action?: React.ReactNode; columns: number }) {
  return (
    <tr className="bg-[var(--surface-alt)]">
      <td colSpan={columns} className="px-4 py-2">
        <span className="flex items-center gap-2">
          <strong className={cn("text-sm font-semibold", tone === "accent" ? "text-[var(--accent-ink)]" : tone === "error" ? "text-[var(--error-ink)]" : "text-[var(--ink)]")}>{label}</strong>
          <span className="text-xs text-muted-foreground tabular-nums">{count}</span>
          {action && <span className="ml-auto">{action}</span>}
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
  // Solo mode (owner 2026-10-29): an agent working alone has nobody to give a callback to, no shared
  // queue to put one in and no one else's callbacks to switch to, so those controls are left out.
  const solo = useSolo();
  const [callbacks, setCallbacks] = useState<CallbackView[]>([]);
  const [windows, setWindows] = useState<Record<string, CallbackWindowFacts>>({});
  const [refusals, setRefusals] = useState<CallbackRefusalNotice[]>([]);
  const [viewer, setViewer] = useState<Viewer | null>(null);
  const [scope, setScope] = useState<Scope | null>(null);
  const [yourZone, setYourZone] = useState(() => Intl.DateTimeFormat().resolvedOptions().timeZone);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  // The person panel opens beside the list from a row (and on load on a wide screen).
  const [panelOpen, setPanelOpen] = useState(false);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [draft, setDraft] = useState<{ id: string; date: string; time: string } | null>(null);
  const [nearest, setNearest] = useState<{ id: string; local: string; value: NearestLegalTime | null } | null>(null);
  // Callbacks A (2026-10-28): the move form in the person panel opens from its Move button.
  const [moveOpen, setMoveOpen] = useState(false);
  // How many overdue and coming-up rows the work list shows before "Show more".
  const [overdueShown, setOverdueShown] = useState(8);
  const [comingShown, setComingShown] = useState(8);
  // Clear the overdue: the callbacks being spread (null = closed).
  const [spreadIds, setSpreadIds] = useState<string[] | null>(null);
  // Hand-over (20261028400000): who callbacks may go to, and the callbacks the Give to… dialog is for.
  const [assignees, setAssignees] = useState<Assignee[]>([]);
  const [giveIds, setGiveIds] = useState<string[] | null>(null);
  const [handingOver, setHandingOver] = useState(false);
  const [demoPreview, setDemoPreview] = useState(false);
  // Add callback (2026-10-28): the dialog, and the person it was opened from (null = pick one).
  const [adding, setAdding] = useState<{ lead: LeadPick | null } | null>(null);
  const [now, setNow] = useState(() => Date.now());
  const selectedIdRef = useRef<string | null>(null);
  const openedOnce = useRef(false);

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
      setAssignees(Array.isArray(body.assignees) ? body.assignees as Assignee[] : []);
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
      // Callbacks A: on a wide screen the page opens with the first person beside the list.
      if (!openedOnce.current && keep && window.matchMedia("(min-width: 1280px)").matches) setPanelOpen(true);
      openedOnce.current = true;
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

  function choose(callback: CallbackView, move = false) {
    selectedIdRef.current = callback.id;
    setSelectedId(callback.id);
    setPanelOpen(true);
    setMoveOpen(move);
    setDraft(null);
    void loadHistory(callback);
  }

  /** "Use that": the suggestion goes into the picker. The agent still books it. */
  function takeSuggestion(callback: CallbackView, value: NearestLegalTime) {
    choose(callback, true);
    const [date, time] = value.customerLocal.split("T");
    setDraft({ id: callback.id, date, time });
  }

  async function act(actionName: "reschedule" | "cancel" | "complete") {
    if (!selected) return;
    if (actionName === "cancel" && !(await confirmAction({ title: `Cancel ${selected.customerName}'s callback?`, description: "Nobody will be reminded to call them back. The lead and its history stay.", confirmLabel: "Cancel callback", cancelLabel: "Keep it" }))) return;
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
    setMoveOpen(false);
    await load();
  }

  /**
   * Give callbacks to another agent, or put their leads in the shared queue. The server takes them one at
   * a time and says which could not move (a partner's transfer never goes to the pool, say).
   */
  async function handOver(ids: string[], to: string) {
    if (!ids.length) return;
    setHandingOver(true);
    const response = await fetch("/api/app/callbacks", { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "hand_over", callback_ids: ids, to }) }).catch(() => null);
    const body = response ? await response.json().catch(() => null) : null;
    setHandingOver(false);
    if (!response?.ok && !body?.result) { notify.block(body?.error ?? "The callbacks could not be handed over."); return; }
    const moved = Number(body?.result?.moved ?? 0);
    const failed = (body?.result?.failed ?? []) as Array<{ callbackId: string; error: string }>;
    const where = to === "queue" ? "put in the shared queue" : `given to ${assignees.find((person) => person.id === to)?.name ?? "the agent"}`;
    if (failed.length) notify.warn(moved ? `${moved} ${moved === 1 ? "callback" : "callbacks"} ${where}` : "Nothing was handed over", { detail: failed.slice(0, 2).map((item) => item.error).join(" ") });
    else notify.done(`${moved === 1 ? "Callback" : `${moved} callbacks`} ${where}`);
    setGiveIds(null);
    selection.clear();
    await load();
  }
  async function toQueue(ids: string[]) {
    if (!ids.length) return;
    const ok = await confirmAction({
      title: ids.length === 1 ? "Put this callback in the shared queue?" : `Put ${ids.length} callbacks in the shared queue?`,
      description: "Anyone on the team can call them from the queue. They keep their times; a partner's transfer stays with its agent.",
      confirmLabel: "Put in shared queue",
      cancelLabel: "Keep them",
      destructive: false,
    });
    if (ok) await handOver(ids, "queue");
  }

  /** The callback's own history, for the person panel when the lead record cannot be read. */
  async function loadHistory(callback: CallbackView) {
    if (callback.isDemo) return;
    const response = await fetch(`/api/app/callbacks?callback_id=${encodeURIComponent(callback.id)}&include_history=true`, { cache: "no-store" }).catch(() => null);
    const body = response ? await response.json().catch(() => null) : null;
    const detail = response?.ok ? (body?.callbacks ?? [])[0] as CallbackView | undefined : undefined;
    if (detail) setCallbacks((items) => items.map((item) => item.id === detail.id ? { ...item, history: detail.history } : item));
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
    <span role="group" aria-label="When" className={cn("inline-flex h-9 max-w-full min-w-0 gap-0.5 overflow-x-auto rounded-md bg-[var(--canvas)] p-0.5", (compact || !wide) && "w-full")}>
      {(Object.keys(WHEN_LABEL) as WhenFilter[]).map((key) => (
        <button key={key} type="button" aria-pressed={when === key} onClick={() => { setWhen(key); setListPage(1); }} className={cn("inline-flex h-8 shrink-0 items-center gap-1.5 rounded-md border px-2.5 text-sm font-semibold tracking-[-0.01em] whitespace-nowrap", when === key ? "border-border bg-card text-foreground" : "border-transparent text-muted-foreground hover:text-foreground")}>
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
      <FilterPanel id="callbacks-filters" open={filtersOpen} className="w-full min-w-0 border-b-0 px-0 py-0">{whenFilter}{dateFilter}</FilterPanel>
    </>
  );


  // 36px below lg, for a thumb.
  const smallSize = wide ? "sm" : "default";
  const scopeToggle = viewer && !solo && (
    <Segmented label="Whose callbacks" value={scope ?? "all"} onChange={setScope} options={[{ key: "mine", label: "Mine" }, { key: "all", label: "All" }]} />
  );
  const canAdd = !readOnly;
  const openAdd = (lead: LeadPick | null) => setAdding({ lead });
  // Offered in Add callback before anything is typed: the people waiting longest for their call.
  const waitingLeads: LeadPick[] = [...new Map(overdue.filter((item) => !item.isDemo).map((item) => [item.leadId, { id: item.leadId, name: item.customerName, meta: [rowStatus(item, now, undefined).label, item.state].filter(Boolean).join(" · ") }])).values()].slice(0, 5);

  // The panel's text buttons get a 36px target on a touch screen (below xl the panel is a sheet).
  const moreTarget = wide ? undefined : "min-h-9";
  const isSettled = (callback: CallbackView) => !OPEN_STATUSES.has(callback.status);
  const stateOf = (callback: CallbackView) => (isSettled(callback) ? settledLabel(callback) : rowStatus(callback, now, callback.state ? windows[callback.state] : undefined));
  const callHrefOf = (callback: CallbackView) => (!isSettled(callback) && (callback.isOverdue || callback.isDueToday) ? (callback.isDemo ? "/app/dialer" : `/app/dialer?lead=${encodeURIComponent(callback.leadId)}`) : null);
  const selectedCall = selected ? callHrefOf(selected) : null;
  // A fact tile (Callbacks A panel): label, value, one muted line under it.
  const fact = (label: string, value: React.ReactNode, note?: string) => (
    <div className="min-w-0 rounded-lg bg-[var(--surface-alt)] px-3 py-2"><dt className="text-xs font-medium text-muted-foreground">{label}</dt><dd className="m-0 mt-0.5 text-sm font-semibold break-words text-[var(--ink)]">{value}</dd>{note && <dd className="m-0 truncate text-xs text-muted-foreground">{note}</dd>}</div>
  );
  const sectionTitle = "m-0 text-xs font-semibold text-muted-foreground";

  // Callbacks C person panel (owner ask 2026-10-25): click anyone and everything about them is on the
  // right — when, how to reach them, Call now, moving the callback in their own time, and the whole
  // conversation and history with them.
  const personPanel = selected && (
    <DetailPanel
      mode="split"
      splitFrom="xl"
      title={selected.customerName}
      subtitle={<>
        {[selected.productName, stateName].filter(Boolean).join(" · ")}
        {!selected.isDemo && <> · <Link className="font-semibold text-[var(--accent-ink)]" href={`/app/leads/${selected.leadId}`}>Open lead <ExternalLink className="inline size-3.5" aria-hidden="true" /></Link></>}
      </>}
      status={<Chip tone={stateOf(selected).tone}>{stateOf(selected).label}</Chip>}
      onClose={() => setPanelOpen(false)}
      bodyClassName="flex flex-col gap-5 p-4"
      // Stays in view while the page scrolls; long content scrolls inside it.
      className="xl:sticky xl:top-[calc(var(--top-bar-h)+16px)] xl:max-h-[calc(100dvh-var(--top-bar-h)-32px)]"
    >
      <dl className="m-0 grid grid-cols-2 gap-2">
        {fact("Their time", longTime(selected.scheduledAtUtc, selected.customerTimezone), `${shortTime(selected.scheduledAtUtc, yourZone, false)} your time`)}
        {fact("Calling window", selectedWindow ? `${hourLabel(selectedWindow.effective.start)} – ${hourLabel(selectedWindow.effective.end)}` : "—", stateName ?? "No state on this lead")}
        {fact("Phone", selected.phone ?? "—", `Attempt ${selected.attemptNumber}`)}
        {fact("Held by", selected.releasedAt ? "Shared queue" : selected.assigneeName || "—", selected.sourceName ?? undefined)}
      </dl>
      {selectedCall && <Button asChild className="w-full"><Link href={selectedCall}><Phone aria-hidden="true" />Call now</Link></Button>}
      {selected.note && <div className="flex flex-col gap-1"><h3 className={sectionTitle}>Their note</h3><p className="m-0 text-sm leading-relaxed text-[var(--body)]">{selected.note}</p></div>}
      {!terminal && !selected.isDemo && !readOnly && (
        <div className="flex flex-wrap gap-2">
          <Button type="button" size="sm" variant={moveOpen ? "secondary" : "outline"} aria-expanded={moveOpen} onClick={() => setMoveOpen((value) => !value)}>Move</Button>
          <Button type="button" size="sm" variant="outline" disabled={saving} onClick={() => void act("complete")} title="Records it as kept by hand. Where the lead goes next is the call's outcome, not this button.">Mark done</Button>
          <Button type="button" size="sm" variant="outline" disabled={saving} onClick={() => void act("cancel")}>Cancel callback</Button>
          {!solo && <Button type="button" size="sm" variant="ghost" disabled={handingOver} onClick={() => setGiveIds([selected.id])}><UserRoundPlus aria-hidden="true" />Give to…</Button>}
          {!solo && !selected.inbound && !selected.releasedAt && <Button type="button" size="sm" variant="ghost" disabled={handingOver} onClick={() => void toQueue([selected.id])}><Users aria-hidden="true" />Shared queue</Button>}
        </div>
      )}

      {!terminal && moveOpen && (
        <section className="portal-callbacks-card m-0 flex flex-col gap-3 border-0 p-0 shadow-none" aria-label="Move the callback">
          <h3 className={sectionTitle}>Move the callback</h3>
          <div className="portal-callbacks-local">
            <span>Their local time</span>
            <strong>{draftAt ? longTime(draftAt, selected.customerTimezone) : "Choose a date and time"}</strong>
            <small>{draftAt ? `${shortTime(draftAt, yourZone, false)} your time (${zoneAbbreviation(yourZone, draftAt)})` : " "}</small>
          </div>
          <div className="portal-callbacks-fields">
            <label><span>Date</span><input type="date" value={draftDate} disabled={readOnly || selected.isDemo} onChange={(event) => setDraft({ id: selected.id, date: event.target.value, time: draftTime })} /></label>
            <label><span>Time &mdash; their timezone</span><input type="time" value={draftTime} disabled={readOnly || selected.isDemo} onChange={(event) => setDraft({ id: selected.id, date: draftDate, time: event.target.value })} /></label>
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
          <div className="flex flex-wrap items-center gap-2">
            <Button type="button" size="sm" disabled={!canBook} onClick={() => void act("reschedule")}>{saving ? "Booking…" : "Book the new time"}</Button>
            <Button type="button" size="sm" variant="ghost" className={moreTarget} onClick={() => { setMoveOpen(false); setDraft(null); }}>Close</Button>
          </div>
        </section>
      )}

      {terminal && canAdd && !selected.isDemo && (
        <Button type="button" variant="outline" className="w-full" onClick={() => openAdd({ id: selected.leadId, name: selected.customerName, meta: [selected.state, selected.phone].filter(Boolean).join(" · ") })}>
          <Plus aria-hidden="true" />Book another callback
        </Button>
      )}

      <section className="flex flex-col gap-2" aria-label="Conversation and history">
        <h3 className={sectionTitle}>Conversation &amp; history</h3>
        <PersonHistory key={selected.id} callback={selected} yourZone={yourZone} />
      </section>
    </DetailPanel>
  );

  // The four figures (Callbacks A). Each opens the rows behind it.
  const weekAgo = now - 7 * 86_400_000;
  const settledWeek = visible.filter((item) => (item.status === "completed" || wasMissed(item)) && new Date(item.scheduledAtUtc).getTime() >= weekAgo && new Date(item.scheduledAtUtc).getTime() <= now);
  const keptWeek = settledWeek.filter((item) => item.status === "completed").length;
  const comingWeek = upcoming.filter((item) => new Date(item.scheduledAtUtc).getTime() <= now + 7 * 86_400_000).length;
  const oldestOverdue = overdue[0] ? Math.max(0, Math.floor((now - new Date(overdue[0].scheduledAtUtc).getTime()) / 86_400_000)) : 0;
  const soon = (item: CallbackView) => new Date(item.scheduledAtUtc).getTime() <= now + 30 * 60_000;
  const dueNowCount = dueToday.filter(soon).length;
  const showWhen = (key: WhenFilter) => { setWhen(key); setDay(""); setListPage(1); };
  const stats = (
    <StatRow label="Callbacks at a glance">
      <StatCard icon={AlarmClock} label="Overdue" value={overdue.length} tone={overdue.length ? "warn" : "default"} fact={{ label: overdue.length ? `Oldest ${oldestOverdue === 0 ? "from today" : `${oldestOverdue} ${oldestOverdue === 1 ? "day" : "days"}`}` : "None late" }} action={overdue.length ? <Button type="button" size="sm" variant="ghost" onClick={() => showWhen("overdue")}>View</Button> : undefined} />
      <StatCard icon={Phone} label="Due today" value={dueToday.length} fact={{ label: dueNowCount ? `${dueNowCount} due now` : "None due right now" }} action={dueToday.length ? <Button type="button" size="sm" variant="ghost" onClick={() => showWhen("today")}>View</Button> : undefined} />
      <StatCard icon={CalendarClock} label="Coming up" period="7 days" value={comingWeek} fact={{ label: `${upcoming.length} booked in all` }} action={upcoming.length ? <Button type="button" size="sm" variant="ghost" onClick={() => showWhen("upcoming")}>View</Button> : undefined} />
      <StatCard icon={CheckCircle2} label="Kept" period="7 days" value={settledWeek.length ? Math.round((keptWeek / settledWeek.length) * 100) : 0} unit="%" fact={{ label: `${keptWeek} of ${settledWeek.length} called back` }} action={settledWeek.length ? <Button type="button" size="sm" variant="ghost" onClick={() => showWhen("settled")}>View</Button> : undefined} />
    </StatRow>
  );

  // The work list (when = "open"): every open callback in the order to call it, in four groups.
  const grouped = when === "open";
  const groupDueNow = rows.filter((item) => !item.isOverdue && item.isDueToday && soon(item));
  const groupLater = rows.filter((item) => !item.isOverdue && item.isDueToday && !soon(item));
  const groupOverdue = rows.filter((item) => item.isOverdue);
  const groupComing = rows.filter((item) => !item.isOverdue && !item.isDueToday);
  const spreadable = (items: CallbackView[]) => items.filter((item) => !item.isDemo && OPEN_STATUSES.has(item.status)).map((item) => item.id);
  const canSpread = !readOnly && !demoPreview;
  const tableColumns = compact ? 5 : 6;
  const rowProps = (callback: CallbackView) => ({
    callback, now, yourZone, callWindow: callback.state ? windows[callback.state] : undefined, selected: panelOpen && callback.id === selectedId,
    readOnly, settled: settledView, selection, onReschedule: () => choose(callback),
  });
  const moreRow = (label: string, onClick: () => void) => (
    <tr><td colSpan={tableColumns} className="px-4 py-2.5"><button type="button" onClick={onClick} className="text-sm font-semibold text-[var(--accent-ink)] hover:underline">{label}</button></td></tr>
  );
  const groupedBody = (
    <tbody>
      {groupDueNow.length > 0 && <GroupRow label="Due now" count={groupDueNow.length} tone="accent" columns={tableColumns} />}
      {groupDueNow.map((callback) => <CallbackTableRow key={callback.id} compact={compact} {...rowProps(callback)} />)}
      {groupLater.length > 0 && <GroupRow label="Later today" count={groupLater.length} columns={tableColumns} />}
      {groupLater.map((callback) => <CallbackTableRow key={callback.id} compact={compact} quietStatus {...rowProps(callback)} />)}
      {groupOverdue.length > 0 && <GroupRow label="Overdue" count={`${groupOverdue.length} · oldest first`} tone="error" columns={tableColumns}
        action={canSpread && spreadable(groupOverdue).length > 0 ? <Button type="button" size="sm" variant="outline" onClick={() => setSpreadIds(spreadable(groupOverdue))}><Shuffle aria-hidden="true" />Clear the overdue…</Button> : undefined} />}
      {groupOverdue.slice(0, overdueShown).map((callback) => <CallbackTableRow key={callback.id} compact={compact} {...rowProps(callback)} />)}
      {groupOverdue.length > overdueShown && moreRow(`Show ${Math.min(20, groupOverdue.length - overdueShown)} more overdue · ${groupOverdue.length - overdueShown} left`, () => setOverdueShown((count) => count + 20))}
      {groupComing.length > 0 && <GroupRow label="Coming up" count={groupComing.length} columns={tableColumns} />}
      {groupComing.slice(0, comingShown).map((callback) => <CallbackTableRow key={callback.id} compact={compact} quietStatus {...rowProps(callback)} />)}
      {groupComing.length > comingShown && moreRow(`Show ${Math.min(20, groupComing.length - comingShown)} more · ${groupComing.length - comingShown} left`, () => setComingShown((count) => count + 20))}
    </tbody>
  );
  const groupedCards = (
    <CardList label="Callbacks">
      {[...groupDueNow, ...groupLater, ...groupOverdue.slice(0, overdueShown), ...groupComing.slice(0, comingShown)].map((callback) => <CallbackCard key={callback.id} {...rowProps(callback)} />)}
    </CardList>
  );
  const shownRows = grouped ? rows : pageRows;
  const spreadNames = Object.fromEntries(callbacks.map((item) => [item.id, item.customerName]));

  return (
    <main className="m-stagger flex w-full min-w-0 flex-col gap-6">
      <PageHeader
        title="Callbacks"
        actions={<div className="flex flex-wrap items-center gap-2">
          {scopeToggle}
          <Button variant="outline" asChild><Link href="/app/dialer">Open the queue</Link></Button>
          {/* The page's one primary action. */}
          <Button type="button" disabled={!canAdd} onClick={() => openAdd(null)}><Plus aria-hidden="true" />Add callback</Button>
        </div>}
      />
      {stats}
      <GiveToDialog
        open={giveIds !== null}
        onOpenChange={(next) => { if (!next) setGiveIds(null); }}
        count={giveIds?.length ?? 0}
        people={assignees}
        currentHolder={(() => { const holders = new Set(callbacks.filter((item) => giveIds?.includes(item.id) && !item.releasedAt).map((item) => item.assignedTo)); return holders.size === 1 ? [...holders][0] ?? null : null; })()}
        viewerId={viewer?.userId ?? null}
        busy={handingOver}
        onGive={(assigneeId) => void handOver(giveIds ?? [], assigneeId)}
      />
      <SpreadDialog open={spreadIds !== null} onOpenChange={(next) => { if (!next) setSpreadIds(null); }} ids={spreadIds ?? []} names={spreadNames} yourZone={yourZone} onDone={() => { selection.clear(); void load(); }} />
      <AddCallbackDialog
        open={adding !== null}
        onOpenChange={(next) => { if (!next) setAdding(null); }}
        initialLead={adding?.lead ?? null}
        suggestions={waitingLeads}
        yourZone={yourZone}
        now={now}
        onBooked={() => void load()}
      />
      {demoPreview && <div role="status" className="portal-callbacks-notice">Demo preview — sample callbacks, read-only and not stored.</div>}
      {readOnly && <div role="status" className="portal-callbacks-notice">Account suspended — callbacks are read-only.</div>}
      {error && <div role="alert" className="portal-callbacks-error"><CircleAlert className="size-4" aria-hidden="true" />{error}</div>}


      {/* A refused booking is the one note worth keeping on the page: it carries the next legal time. */}
      {visibleRefusals.length > 0 && <div id="callback-refusals" className="flex scroll-mt-24 flex-col gap-3">{visibleRefusals.map((refusal) => {
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
      })}</div>}

      {/* The work list, or a flat filtered list; a row opens the person panel beside it. A flat list fills
          the window and pages; the work list grows with its groups and the page scrolls. */}
      <div ref={grouped ? undefined : setFillNode} className={cn("flex flex-col gap-4", grouped ? "xl:flex-row xl:items-start" : "lg:flex-row lg:items-stretch lg:[height:var(--fill-h)]")} style={grouped ? undefined : { "--fill-h": `${fillHeight}px` } as React.CSSProperties}>
        <TableCard
          className={cn("flex min-w-0 flex-1 flex-col", !grouped && "min-h-0 [&>*:nth-child(2)]:min-h-0 [&>*:nth-child(2)]:flex-1 [&>*:nth-child(2)]:overflow-y-auto")}
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
              actions={<>
                {canSpread && <Button type="button" variant="outline" disabled={spreadable(rows.filter((item) => selection.selected.has(item.id))).length === 0} onClick={() => setSpreadIds(spreadable(rows.filter((item) => selection.selected.has(item.id))))}><Shuffle aria-hidden="true" />Spread into open times</Button>}
                {canSpread && !solo && <Button type="button" variant="outline" disabled={handingOver || spreadable(rows.filter((item) => selection.selected.has(item.id))).length === 0} onClick={() => setGiveIds(spreadable(rows.filter((item) => selection.selected.has(item.id))))}><UserRoundPlus aria-hidden="true" />Give to…</Button>}
                {canSpread && !solo && <Button type="button" variant="outline" disabled={handingOver || spreadable(rows.filter((item) => selection.selected.has(item.id) && !item.inbound && !item.releasedAt)).length === 0} onClick={() => void toQueue(spreadable(rows.filter((item) => selection.selected.has(item.id) && !item.inbound && !item.releasedAt)))}><Users aria-hidden="true" />Put in shared queue</Button>}
                <Button type="button" variant="outline" onClick={exportSelected}><Download aria-hidden="true" />Export selected</Button>
              </>}
            />
          </>}
          footer={grouped ? undefined : <Pager page={listCurrent} total={rows.length} pageSize={pageSize} noun="callbacks" suffix={settledView ? "newest first" : "soonest first"} onPage={setListPage} />}
        >
          <div>
            {shownRows.length === 0 ? (
              filtersOn
                ? <NoMatches noun="callbacks" onClear={clearFilters} />
                : mineOnly
                  ? <EmptyState title="You have no open callbacks" hint="Others' callbacks are under All." action={<Button type="button" variant="outline" onClick={() => setScope("all")}>Show all callbacks</Button>} />
                  : <EmptyState title="No open callbacks" hint="Book one here, or from a call outcome." action={canAdd ? <Button type="button" variant="outline" onClick={() => openAdd(null)}><Plus aria-hidden="true" />Add callback</Button> : <Button asChild variant="outline"><Link href="/app/dialer">Open the dialer</Link></Button>} />
            ) : !wide ? (
              <>
                {/* Select the page, as the table's header checkbox does. */}
                <div className="flex items-center border-b border-border px-4 py-1">
                  <label className="inline-flex h-9 cursor-pointer items-center gap-2 text-sm text-[var(--body)]">
                    <SelectAllCheckbox selection={selection} ids={shownRows.map((item) => item.id)} label="Select every callback shown" />
                    Select all
                  </label>
                </div>
                {grouped ? groupedCards : (
                <CardList label="Callbacks">
                  {pageRows.map((callback) => <CallbackCard key={callback.id} {...rowProps(callback)} />)}
                </CardList>
                )}
              </>
            ) : (
              <table className={st.table}>
                <thead>
                  <tr className={st.headRow}>
                    <th scope="col" className={cn(st.th, "w-10")}><SelectAllCheckbox selection={selection} ids={shownRows.map((item) => item.id)} label="Select every callback shown" /></th>
                    <th scope="col" className={cn(st.th, "min-w-[180px]")}>Customer</th>
                    <th scope="col" className={st.th}>Their time</th>
                    <th scope="col" className={st.th}>{grouped ? "Status · source" : "Status"}</th>
                    {!compact && <th scope="col" className={st.th}>Agent</th>}
                    <th scope="col" className={cn(st.th, "text-right")}><span className="sr-only">Actions</span></th>
                  </tr>
                </thead>
                {grouped ? groupedBody : (
                <tbody>
                  {pageRows.map((callback) => <CallbackTableRow key={callback.id} compact={compact} rowHeight={rowHeight} {...rowProps(callback)} />)}
                </tbody>
                )}
              </table>
            )}
          </div>
        </TableCard>
        {panelOpen && personPanel}
      </div>
    </main>
  );
}
