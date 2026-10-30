"use client";

import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import Link from "next/link";
import { ArrowUpRight, ChevronDown, ChevronLeft, ChevronRight, Plus } from "lucide-react";

import { Button } from "@/components/ui/button";
import { confirmAction } from "@/components/ui/confirm-dialog";
import { ClearFiltersButton, DataToolbar, RefreshButton, ToolbarSearch, toolbarControl } from "@/components/ui/data-toolbar";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { inputControl } from "@/components/ui/field";
import { PageHeader } from "@/components/ui/page-header";
import { PageLoading } from "@/components/ui/page-loading";
import { EmptyState, ErrorState, NoMatches, SectionLoading } from "@/components/ui/page-states";
import { Pager, paginate } from "@/components/ui/pager";
import { StatusChip, type StatusTone } from "@/components/ui/status-chip";
import { TableCard } from "@/components/ui/table-card";
import { RebookButton } from "@/components/app/appointment-rebook";
import { ViewTabs } from "@/components/ui/view-tabs";
import { MiniMonth, type YearMonth } from "@/components/app/calendar/mini-month";
import { faceLabel } from "@/lib/appointments/appointmentFacts";
import { clockLabel, intervalsFor, openSlots, wallClock, zonedInstant, type BlockRepeat, type PickerContext } from "@/lib/appointments/calendarMath";
import { useFittingPageSize } from "@/components/ui/use-fitting-page-size";

/**
 * LA-2.11's calendar, as the board draws it: the diary as a grid of slots, not a list of bookings.
 *
 * Every cell comes from availability — working hours, minus blocked time, minus what is booked — so
 * a Free cell is a slot the calendar actually offers, and pressing it opens the booking form on that
 * slot. The picker is a convenience: `book_appointment` still refuses anything wrong, and says why.
 *
 * Two clocks, always. The grid runs on the diary owner's time; a card whose customer lives in another
 * zone also says what time it is for them, because one of the two is the one somebody is late for.
 *
 * 2026-10-06 redesign: Week, Day and List are tabs under the strip with "Book an appointment" on the
 * same row; the card reaches the bottom of the window and the grid scrolls inside it; the list's
 * facts are columns and its actions the last one.
 */

type Appointment = {
  appointmentId: string; leadId: string; customerName: string;
  agentUserId: string; agentName: string; startsAtUtc: string; durationMinutes: number;
  customerTimezone: string; status: string; notes: string | null; bookedByName: string | null;
  // LA-2 §11 concept (lib/appointments/calendar.ts): from the lead, and the reminder / rebook state.
  product?: string | null; faceAmountCents?: number | null; reminderSentAt?: string | null; rebookedAs?: string | null;
  // LA-2.12-2: a setter sees another setter's booking as a taken slot, with no lead behind it.
  bookedByUserId?: string | null; redacted?: boolean;
};
type Step = "confirm" | "showed" | "no_show";
type Context = Omit<PickerContext, "blocks"> & {
  agents: Array<{ userId: string; name: string; timezone: string | null }>;
  blocks: Array<{ userId: string; startsAt: string; endsAt: string; reason?: string | null; repeats?: BlockRepeat }>;
};
type Day = { year: number; month: number; day: number; weekday: number; noon: number };
type Cell =
  | { kind: "appointment"; items: Appointment[]; callbacks?: DiaryCallback[] }
  // A callback owed at this time takes the slot (owner 2026-10-29): it is not offered as free.
  | { kind: "callback"; items: DiaryCallback[] }
  | { kind: "blocked"; label: string; sub: string }
  | { kind: "free"; startIso: string; agentUserId: string; past: boolean };
type View = "week" | "day" | "list";

const DAY_MS = 86_400_000;
const WEEKDAY = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const WEEKDAY_LONG = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
const MONTH_LONG = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
const LIVE = new Set(["booked", "confirmed", "showed", "no_show"]);
const STATUS_LABEL: Record<string, string> = { booked: "Booked", confirmed: "Confirmed", pending: "Awaiting close-out", showed: "Showed", no_show: "No-show", cancelled: "Cancelled", rescheduled: "Rescheduled" };
const STATUS_TONE: Record<string, StatusTone> = { booked: "action", confirmed: "good", pending: "warning", showed: "good", no_show: "danger", cancelled: "neutral", rescheduled: "neutral" };
/**
 * The card reaches the bottom of the window from xl, in every view; the slots or the list scroll
 * inside it while the toolbar, the day headings and the footer stay put (owner 2026-10-28: "full
 * height … inner scroll"). Its height is measured from where it starts (useFillHeight).
 */
const FILL = "flex min-h-0 flex-1 flex-col [&>*:nth-child(2)]:min-h-0 [&>*:nth-child(2)]:flex-1 [&>*:nth-child(2)]:overflow-y-auto";
const FILL_H = "xl:[height:var(--fill-h)]";
/** A week day heading: pinned to the top of the scrolling slots, on the card's own ground. */
const WEEK_HEAD = "sticky top-0 z-10 bg-[var(--color-card)] py-2";
/** The space the page keeps under the card (its block gap). */
const FILL_GAP = 24;

/** From the card's top to one block gap above the window's foot, re-measured as the page changes. */
function useFillHeight() {
  const [node, setNode] = useState<HTMLElement | null>(null);
  const [height, setHeight] = useState(640);
  useEffect(() => {
    if (!node) return;
    const fit = () => setHeight(Math.max(420, Math.floor(window.innerHeight - (node.getBoundingClientRect().top + window.scrollY) - FILL_GAP)));
    fit();
    // Again when something above it appears or goes (an error line) or the window changes size.
    const observer = typeof ResizeObserver === "undefined" ? null : new ResizeObserver(fit);
    observer?.observe(document.body);
    window.addEventListener("resize", fit);
    return () => { observer?.disconnect(); window.removeEventListener("resize", fit); };
  }, [node]);
  return { setNode, height };
}
const REPEAT_LABEL: Record<string, string> = { daily: "Blocked every day", weekdays: "Blocked every weekday", weekly: "Blocked every week", yearly: "Blocked every year" };


/** Read outside render, so a paint never moves "now". */
function nowMs() {
  return Date.now();
}

function dayOf(ms: number, zone: string): Day {
  const clock = wallClock(new Date(ms).toISOString(), zone);
  return { year: clock.year, month: clock.month, day: clock.day, weekday: clock.weekday, noon: zonedInstant(clock.year, clock.month, clock.day, 720, zone) };
}
const sameDay = (a: { year: number; month: number; day: number }, b: { year: number; month: number; day: number }) =>
  a.year === b.year && a.month === b.month && a.day === b.day;
const dateKey = (d: { year: number; month: number; day: number }) => d.year * 10000 + d.month * 100 + d.day;

/** Whether a repeating block lands on a local date — the same rule the slot picker uses. */
function recursOn(repeats: BlockRepeat, first: Day | ReturnType<typeof wallClock>, date: Day) {
  if (dateKey(date) < dateKey(first)) return false;
  if (repeats === "daily") return true;
  if (repeats === "weekdays") return date.weekday >= 1 && date.weekday <= 5;
  if (repeats === "weekly") return date.weekday === first.weekday;
  if (repeats === "yearly") return date.month === first.month && date.day === first.day;
  return false;
}

/** "Grace Oyelaran" → "G. Oyelaran", the board's card name. */
function shortName(name: string) {
  const parts = name.trim().split(/\s+/);
  return parts.length > 1 ? `${parts[0][0]}. ${parts.slice(1).join(" ")}` : name;
}

/** "2:30 CT"-style: the customer's own clock and zone, only when it differs from the diary's. */
function theirTime(iso: string, zone: string, diaryZone: string) {
  if (!zone || zone === diaryZone) return null;
  try {
    const clock = wallClock(iso, zone);
    const abbreviation = new Intl.DateTimeFormat("en-US", { timeZone: zone, timeZoneName: "short" })
      .formatToParts(new Date(iso)).find((part) => part.type === "timeZoneName")?.value ?? zone;
    return `their time ${clockLabel(clock.minutes, false)} ${abbreviation.replace(/^[CEMP][SD]T$/, (m) => `${m[0]}T`)}`;
  } catch {
    return null;
  }
}

const TONE: Record<string, string> = {
  booked: "bg-[var(--primary-soft)] border-l-[var(--primary)]",
  confirmed: "bg-[var(--success-surface)] border-l-[var(--success)]",
  showed: "bg-[var(--success-surface)] border-l-[var(--success)]",
  no_show: "bg-[var(--warning-surface)] border-l-[var(--warning)]",
};

// The row label already carries the time, so the grid's cells do not repeat it.
function Slot({ title, sub, tone, children }: { title: ReactNode; sub?: ReactNode; tone: string; children?: ReactNode }) {
  return (
    <div className={`flex min-h-[52px] flex-col justify-center rounded-lg border-l-[3px] px-2.5 py-2 ${tone}`}>
      <span className="truncate text-sm font-semibold leading-normal tracking-[-0.02em] text-foreground">{title}</span>
      {sub && <span className="truncate text-xs leading-normal text-muted-foreground">{sub}</span>}
      {children}
    </div>
  );
}

/** A callback in the diary's day (Calendar B): read from /api/app/callbacks when this person may. */
type DiaryCallback = { id: string; leadId: string; customerName: string; scheduledAtUtc: string; customerTimezone?: string; assignedTo: string; status: string; productName: string | null; note?: string | null; phone?: string | null; isOverdue: boolean; isDemo?: boolean };
/** The callback's own slot card in the week (2026-10-29): the same card as an appointment, an amber bar. */
const CALLBACK_TONE = "bg-[var(--surface-alt)] border-l-[var(--warning)]";
const OPEN_CALLBACK = new Set(["scheduled", "due", "missed"]);

type AgendaRow =
  | { kind: "appointment"; minute: number; item: Appointment }
  | { kind: "free"; minute: number; end: number; startIso: string }
  | { kind: "blocked"; minute: number; label: string; sub: string }
  | { kind: "callback"; minute: number; callback: DiaryCallback };

/** The bar beside a row: amber until it is confirmed, green once it is, red for a no-show. */
const BAR: Record<string, string> = { booked: "bg-[var(--warning)]", confirmed: "bg-[var(--success)]", showed: "bg-[var(--success)]", no_show: "bg-[var(--error)]" };
const AGENDA_STEP_LABEL: Record<Step, string> = { confirm: "Confirm", showed: "Showed", no_show: "No-show" };

/**
 * One line of Calendar B's day: an appointment with what can be done to it, a stretch of free time
 * to book, blocked time, or a callback owed. Time on the left in the diary's clock.
 */
function AgendaLine({ row, zone, slotLength, highlightId, steps, stepping, isFuture, onStep, onBook, onRebooked, onOpen }: {
  row: AgendaRow;
  zone: string;
  slotLength: number;
  highlightId?: string;
  steps: Step[];
  stepping: string | null;
  isFuture: (iso: string) => boolean;
  onStep: (item: Appointment, step: Step) => void;
  onBook: (startIso: string) => void;
  onRebooked: () => void;
  /** Opens the appointment or callback in the calendar's pop-up (owner 2026-10-29). */
  onOpen: (row: AgendaRow) => void;
}) {
  const line = "grid grid-cols-[88px_minmax(0,1fr)_auto] items-center gap-4 border-t border-border px-5 sm:grid-cols-[88px_minmax(0,1fr)_auto_auto]";
  if (row.kind === "free") {
    return (
      <li className={`${line} py-2.5`}>
        <span className="text-xs text-muted-foreground tabular-nums">{clockLabel(row.minute, false)} – {clockLabel(row.end, false)}</span>
        <span className="flex h-9 items-center rounded-lg border border-dashed border-[var(--border-strong)] px-3 text-sm text-muted-foreground">Free time</span>
        <span className="hidden sm:block" />
        <Button type="button" size="sm" variant="outline" onClick={() => onBook(row.startIso)}><Plus aria-hidden="true" />Book</Button>
      </li>
    );
  }
  if (row.kind === "blocked") {
    return (
      <li className={`${line} py-2.5 text-sm text-muted-foreground`}>
        <span className="text-xs tabular-nums">{clockLabel(row.minute, false)}</span>
        <span className="truncate">{row.label} · {row.sub.toLowerCase()}</span>
      </li>
    );
  }
  if (row.kind === "callback") {
    const callback = row.callback;
    return (
      <li className={`${line} py-3.5`}>
        <span><strong className="block text-sm tabular-nums">{clockLabel(row.minute, false)}</strong></span>
        <span className="flex min-w-0 items-center gap-3">
          <span className="w-[3px] self-stretch rounded-full bg-[var(--warning)]" aria-hidden="true" />
          <span className="min-w-0">
            <button type="button" onClick={() => onOpen(row)} className="block max-w-full truncate text-left text-sm font-semibold text-[var(--ink)] hover:underline">{callback.customerName}</button>
            <span className="block truncate text-xs text-muted-foreground">Callback{callback.productName ? ` · ${callback.productName}` : ""}</span>
          </span>
        </span>
        <span className="hidden sm:block"><StatusChip tone={callback.isOverdue ? "danger" : "warning"}>{callback.isOverdue ? "Late callback" : "Callback"}</StatusChip></span>
        <span className="flex justify-end">{!callback.isDemo && <Button asChild size="sm" variant={callback.isOverdue ? "default" : "outline"}><Link href={`/app/dialer?lead=${callback.leadId}`}>Call now</Link></Button>}</span>
      </li>
    );
  }
  const item = row.item;
  const clock = wallClock(item.startsAtUtc, zone);
  const end = clock.minutes + (item.durationMinutes || slotLength);
  const unconfirmed = item.status === "booked" && isFuture(item.startsAtUtc);
  const label = unconfirmed ? "Not confirmed" : STATUS_LABEL[item.status] ?? item.status;
  const tone: StatusTone = unconfirmed ? "warning" : STATUS_TONE[item.status] ?? "neutral";
  const facts = item.redacted ? [STATUS_LABEL[item.status]] : [
    [item.product, faceLabel(item.faceAmountCents ?? null)].filter(Boolean).join(" ") || null,
    item.bookedByName ? `set by ${item.bookedByName}` : null,
    theirTime(item.startsAtUtc, item.customerTimezone, zone),
    item.reminderSentAt && (item.status === "booked" || item.status === "confirmed") ? "reminder sent" : null,
    item.notes,
  ].filter(Boolean);
  const noShow = item.status === "no_show" && !item.redacted;
  return (
    <li className={`${line} py-3.5 ${item.appointmentId === highlightId ? "bg-[var(--primary-soft)] shadow-[inset_3px_0_0_var(--primary)]" : ""}`}>
      <span className="tabular-nums"><strong className="block text-sm">{clockLabel(clock.minutes, false)}</strong><span className="text-xs text-muted-foreground">{clockLabel(end, false)}</span></span>
      <span className="flex min-w-0 items-center gap-3">
        <span className={`w-[3px] self-stretch rounded-full ${BAR[item.status] ?? "bg-[var(--border-strong)]"}`} aria-hidden="true" />
        <span className="min-w-0">
          {item.redacted
            ? <span className="block truncate text-sm font-semibold text-muted-foreground">Booked by another setter</span>
            : <button type="button" onClick={() => onOpen(row)} className="block max-w-full truncate text-left text-sm font-semibold text-[var(--ink)] hover:underline">{item.customerName}</button>}
          <span className="block truncate text-xs text-muted-foreground" title={facts.join(" · ")}>{facts.join(" · ")}</span>
        </span>
      </span>
      <span className="hidden sm:block"><StatusChip tone={tone}>{label}</StatusChip></span>
      <span className="flex flex-wrap justify-end gap-2">
        {steps.map((step) => (
          <Button key={step} type="button" size="sm" variant={step === "no_show" ? "outline" : "default"} disabled={stepping === item.appointmentId} onClick={() => onStep(item, step)}>
            {stepping === item.appointmentId ? "Saving…" : AGENDA_STEP_LABEL[step]}
          </Button>
        ))}
        {noShow && (
          <>
            <Button asChild size="sm" variant="outline"><Link href={`/app/dialer?lead=${item.leadId}`}>Call now</Link></Button>
            {item.rebookedAs
              ? <span className="self-center text-xs text-muted-foreground">Rebooked</span>
              : <RebookButton appointmentId={item.appointmentId} agentUserId={item.agentUserId} customerName={item.customerName} onRebooked={onRebooked} />}
          </>
        )}
        {steps.length === 0 && !noShow && !item.redacted && <Button type="button" size="sm" variant="outline" onClick={() => onOpen(row)}>Open</Button>}
      </span>
    </li>
  );
}

export function AppointmentCalendar({ highlightId }: { highlightId?: string }) {
  // Calendar B (owner pick 2026-10-25): the day agenda first; Week and List stay one click away.
  // Week first (owner 2026-10-28), then Day; List stays.
  const [view, setView] = useState<View>("week");
  const { setNode: setFillNode, height: fillHeight } = useFillHeight();
  const [showCallbacks, setShowCallbacks] = useState(true);
  const [showBlocked, setShowBlocked] = useState(true);
  const [monthShown, setMonthShown] = useState<YearMonth | null>(null);
  const [callbacks, setCallbacks] = useState<DiaryCallback[] | null>(null);
  const [anchor, setAnchor] = useState<number | null>(null);
  const [now, setNow] = useState<number | null>(null);
  const [context, setContext] = useState<Context | null>(null);
  const [me, setMe] = useState<string | null>(null);
  const [role, setRole] = useState<string | null>(null);
  const [stepping, setStepping] = useState<string | null>(null);
  const [agentId, setAgentId] = useState<string>("");
  const [status, setStatus] = useState("");
  const [search, setSearch] = useState("");
  const [appointments, setAppointments] = useState<Appointment[]>([]);
  const [lastWeek, setLastWeek] = useState<Appointment[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadedOnce, setLoadedOnce] = useState(false);
  const [error, setError] = useState("");
  const [booking, setBooking] = useState<{ agentUserId: string; startIso: string | null } | null>(null);
  const [listPage, setListPage] = useState(1);
  const pageSize = useFittingPageSize(480, 45);

  // "Now" is read once mounted, so the server and the browser never disagree about the week.
  useEffect(() => {
    const at = nowMs();
    setNow(at); // eslint-disable-line react-hooks/set-state-in-effect
    setAnchor(at);
  }, []);

  // Who can be booked, their hours, blocks and policy — the same payload the dialer's picker uses.
  const loadContext = useCallback(async () => {
    const [contextResponse, meResponse] = await Promise.all([
      fetch("/api/app/appointments", { cache: "no-store" }),
      fetch("/api/app/me", { cache: "no-store" }),
    ]);
    const body = await contextResponse.json().catch(() => null);
    if (!contextResponse.ok) throw new Error(body?.error ?? "Could not load availability");
    const mine = await meResponse.json().catch(() => null);
    setContext(body as Context);
    setMe(mine?.user?.id ?? null);
    setRole(typeof mine?.role === "string" ? mine.role : null);
  }, []);

  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(() => { void loadContext().catch((cause) => setError(cause instanceof Error ? cause.message : "Could not load availability")); }, [loadContext]);

  // Callbacks sit in the day too, when this person can read them (Callbacks is a feature of its own;
  // without it the "Callbacks" filter is not offered).
  useEffect(() => {
    const controller = new AbortController();
    void fetch("/api/app/callbacks", { cache: "no-store", signal: controller.signal })
      .then((response) => (response.ok ? response.json() : null))
      .then((body) => setCallbacks(Array.isArray(body?.callbacks) ? (body.callbacks as DiaryCallback[]) : null))
      .catch(() => undefined);
    return () => controller.abort();
  }, []);

  const agents = useMemo(() => {
    const known = new Map((context?.agents ?? []).map((agent) => [agent.userId, agent.name]));
    for (const item of appointments) if (!known.has(item.agentUserId)) known.set(item.agentUserId, item.agentName);
    return [...known.entries()];
  }, [context, appointments]);

  // Your own diary first; otherwise the first person with hours.
  const selected = agentId || (me && agents.some(([id]) => id === me) ? me : agents[0]?.[0] ?? "");
  const zone = useMemo(() => {
    const hours = context?.availability.find((row) => row.userId === selected);
    return hours?.timezone || context?.agents.find((agent) => agent.userId === selected)?.timezone || Intl.DateTimeFormat().resolvedOptions().timeZone;
  }, [context, selected]);

  // The visible days, in the diary owner's zone: a working week (weekend only if it is worked).
  const days = useMemo(() => {
    if (anchor == null) return [] as Day[];
    const today = dayOf(anchor, zone);
    if (view === "day") return [today];
    const monday = today.noon - ((today.weekday + 6) % 7) * DAY_MS;
    const week = Array.from({ length: 7 }, (_, i) => dayOf(monday + i * DAY_MS, zone));
    const worked = new Set((context?.availability ?? []).filter((row) => row.userId === selected).map((row) => row.weekday));
    return week.filter((d) => (d.weekday >= 1 && d.weekday <= 5) || worked.has(d.weekday) || appointments.some((a) => a.agentUserId === selected && sameDay(wallClock(a.startsAtUtc, zone), d)));
  }, [anchor, zone, view, context, selected, appointments]);

  const range = useMemo(() => {
    if (anchor == null) return null;
    const today = dayOf(anchor, zone);
    const first = view === "day" ? today : dayOf(today.noon - ((today.weekday + 6) % 7) * DAY_MS, zone);
    const count = view === "day" ? 1 : 7;
    const from = zonedInstant(first.year, first.month, first.day, 0, zone);
    const last = dayOf(first.noon + (count - 1) * DAY_MS, zone);
    const to = zonedInstant(last.year, last.month, last.day, 0, zone) + DAY_MS;
    const monday = dayOf(today.noon - ((today.weekday + 6) % 7) * DAY_MS, zone);
    const weekStart = zonedInstant(monday.year, monday.month, monday.day, 0, zone);
    return { from, to, lastFrom: weekStart - 7 * DAY_MS, lastTo: weekStart, first };
  }, [anchor, zone, view]);

  // The week is first read in the browser's zone and again once the diary's own zone is known; the
  // two reads overlap, so only the newest one may land (an older answer arriving last is dropped).
  const loadSeq = useRef(0);
  const load = useCallback(async () => {
    if (!range) return;
    const seq = ++loadSeq.current;
    setLoading(true);
    const get = async (from: number, to: number) => {
      const response = await fetch(`/api/app/calendar?from=${encodeURIComponent(new Date(from).toISOString())}&to=${encodeURIComponent(new Date(to).toISOString())}`, { cache: "no-store" });
      const body = await response.json().catch(() => null);
      if (!response.ok) throw new Error(body?.error ?? "Could not load the calendar");
      return (body?.appointments ?? []) as Appointment[];
    };
    try {
      const [current, previous] = await Promise.all([get(range.from, range.to), get(range.lastFrom, range.lastTo)]);
      if (seq !== loadSeq.current) return;
      setAppointments(current);
      setLastWeek(previous);
      setError("");
    } catch (cause) {
      if (seq !== loadSeq.current) return;
      setError(cause instanceof Error ? cause.message : "Could not load the calendar");
    } finally {
      if (seq === loadSeq.current) {
        setLoading(false);
        setLoadedOnce(true);
      }
    }
  }, [range]);

  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(() => { void load(); }, [load]);

  const needle = search.trim().toLowerCase();
  const matches = useCallback(
    (item: Appointment) => (!status || item.status === status) && (!needle || item.customerName.toLowerCase().includes(needle)),
    [status, needle],
  );
  const mine = useMemo(() => appointments.filter((item) => item.agentUserId === selected), [appointments, selected]);
  // The open callbacks on this calendar, when the Callbacks filter is on and the search finds them.
  const diaryCallbacks = useMemo(
    () => (showCallbacks && callbacks ? callbacks.filter((row) => row.assignedTo === selected && OPEN_CALLBACK.has(row.status) && (!needle || row.customerName.toLowerCase().includes(needle))) : []),
    [showCallbacks, callbacks, selected, needle],
  );
  // The pop-up an appointment or a callback opens in (owner 2026-10-29: edit in place, not the lead page).
  const [opened, setOpened] = useState<{ kind: "appointment"; item: Appointment } | { kind: "callback"; callback: DiaryCallback } | null>(null);

  /** One agent's cells for one local date, keyed by the local minute each cell starts at. */
  const cellsFor = useCallback((day: Day): Map<number, Cell> => {
    const cells = new Map<number, Cell>();
    if (!context || now == null) return cells;
    const hours = context.availability.filter((row) => row.userId === selected);
    const policy = context.policy.find((row) => row.userId === selected);
    const length = policy?.appointmentMinutes ?? 30;
    const buffer = policy?.bufferMinutes ?? 0;

    for (const [open, close] of intervalsFor(hours, day.weekday)) {
      for (let minute = open; minute + length <= close; minute += length + buffer) {
        const start = zonedInstant(day.year, day.month, day.day, minute, zone);
        cells.set(minute, { kind: "free", startIso: new Date(start).toISOString(), agentUserId: selected, past: start <= now });
      }
    }
    // Blocked time: repeating blocks by their local minutes, one-offs and linked-calendar busy by instant.
    for (const block of context.blocks.filter((row) => row.userId === selected)) {
      const repeats = (block.repeats ?? "none") as BlockRepeat | "none";
      const first = wallClock(block.startsAt, zone);
      const duration = Math.max(0, (Date.parse(block.endsAt) - Date.parse(block.startsAt)) / 60_000);
      const label = block.reason?.trim() || "Blocked";
      const hits: Array<[number, number]> = [];
      if (repeats === "none") {
        const start = Date.parse(block.startsAt);
        const end = Date.parse(block.endsAt);
        const dayStart = zonedInstant(day.year, day.month, day.day, 0, zone);
        if (start < dayStart + DAY_MS && end > dayStart) hits.push([Math.max(0, (start - dayStart) / 60_000), Math.min(1440, (end - dayStart) / 60_000)]);
      } else if (recursOn(repeats, first, day)) {
        hits.push([first.minutes, first.minutes + duration]);
      }
      for (const [from, to] of hits) {
        let placed = false;
        for (const [minute, cell] of cells) {
          if (cell.kind === "free" && minute < to && minute + length > from) { cells.set(minute, { kind: "blocked", label, sub: repeats === "none" ? "Blocked" : REPEAT_LABEL[repeats] ?? "Blocked" }); placed = true; }
        }
        if (!placed) cells.set(Math.round(from), { kind: "blocked", label, sub: repeats === "none" ? "Blocked" : REPEAT_LABEL[repeats] ?? "Blocked" });
      }
    }
    for (const busy of (context.busy ?? []).filter((row) => row.userId === selected)) {
      const start = Date.parse(busy.startsAt);
      const end = Date.parse(busy.endsAt);
      const dayStart = zonedInstant(day.year, day.month, day.day, 0, zone);
      for (const [minute, cell] of cells) {
        const slotStart = dayStart + minute * 60_000;
        if (cell.kind === "free" && slotStart < end && slotStart + length * 60_000 > start) cells.set(minute, { kind: "blocked", label: "Busy", sub: "Linked calendar" });
      }
    }
    // Appointments snap to the slot they start in, or get a row of their own.
    for (const item of mine.filter((a) => LIVE.has(a.status) && sameDay(wallClock(a.startsAtUtc, zone), day))) {
      const minute = wallClock(item.startsAtUtc, zone).minutes;
      const slot = [...cells.keys()].find((key) => key <= minute && minute < key + length) ?? minute;
      const existing = cells.get(slot);
      cells.set(slot, existing?.kind === "appointment" ? { kind: "appointment", items: [...existing.items, item] } : { kind: "appointment", items: [item] });
    }
    // Callbacks owed on this calendar snap the same way and take the slot (owner 2026-10-29); one
    // sharing a slot with an appointment rides on that appointment's card.
    for (const callback of diaryCallbacks.filter((row) => sameDay(wallClock(row.scheduledAtUtc, zone), day))) {
      const minute = wallClock(callback.scheduledAtUtc, zone).minutes;
      const slot = [...cells.keys()].find((key) => key <= minute && minute < key + length) ?? minute;
      const existing = cells.get(slot);
      if (existing?.kind === "appointment") cells.set(slot, { ...existing, callbacks: [...(existing.callbacks ?? []), callback] });
      else cells.set(slot, existing?.kind === "callback" ? { kind: "callback", items: [...existing.items, callback] } : { kind: "callback", items: [callback] });
    }
    return cells;
  }, [context, now, selected, zone, mine, diaryCallbacks]);

  const grid = useMemo(() => {
    const perDay = days.map((day) => cellsFor(day));
    const rows = [...new Set(perDay.flatMap((cells) => [...cells.keys()]))].sort((a, b) => a - b);
    // The first slot still bookable, scanning day by day: the one the grid points out.
    const nextFree = perDay.flatMap((cells, index) => rows.map((minute) => ({ key: `${index}:${minute}`, cell: cells.get(minute) })))
      .find(({ cell }) => cell?.kind === "free" && !cell.past)?.key ?? null;
    return { perDay, rows, nextFree };
  }, [days, cellsFor]);

  // Figures. "This week" is always the week around the anchor, whatever the view.
  const weekLive = mine.filter((item) => LIVE.has(item.status));
  const today = now == null ? null : dayOf(now, zone);
  const settled = lastWeek.filter((item) => item.agentUserId === selected && (item.status === "showed" || item.status === "no_show"));
  const showed = settled.filter((item) => item.status === "showed").length;
  const noShows = settled.length - showed;
  const showRate = settled.length ? Math.round((showed / settled.length) * 100) : null;

  const listRows = appointments.filter((item) => (!agentId || item.agentUserId === agentId) && matches(item));
  const rangeLabel = range
    ? view === "day"
      ? `${WEEKDAY_LONG[range.first.weekday]} ${range.first.day} ${MONTH_LONG[range.first.month - 1]}`
      : `Week of ${range.first.day} ${MONTH_LONG[range.first.month - 1]}`
    : "…";
  // "Not loaded yet" and "no hours set" are different answers; only a loaded context can say the second.
  const hasHours = Boolean(context?.availability.some((row) => row.userId === selected));
  const noHours = context != null && !hasHours;
  const agentName = agents.find(([id]) => id === selected)?.[1] ?? "this person";

  // The first read draws the page skeleton; a later week or a Refresh keeps the page drawn.
  if (!error && (context == null || !loadedOnce)) return <PageLoading />;

  const refresh = () => {
    void loadContext().catch((cause) => setError(cause instanceof Error ? cause.message : "Could not load availability"));
    void load();
  };

  // LA-2.11-5 · the walk from the list: confirm before the slot, showed / no-show after it. Showed and
  // no-show are the agent's (the setter is the one measured by them); a setter confirms their own.
  const holdsCalendar = role === "owner" || role === "producer";
  const stepsFor = (item: Appointment): Step[] => {
    if (item.redacted || now == null) return [];
    const started = Date.parse(item.startsAtUtc) <= now;
    if (!started) return item.status === "booked" && (holdsCalendar || (role === "setter" && item.bookedByUserId === me)) ? ["confirm"] : [];
    return holdsCalendar && ["booked", "confirmed", "pending"].includes(item.status) ? ["showed", "no_show"] : [];
  };
  const STEP_LABEL: Record<Step, string> = { confirm: "Confirm", showed: "Showed", no_show: "No-show" };
  async function takeStep(item: Appointment, step: Step) {
    if (!(await confirmAction({ title: `${STEP_LABEL[step]}: ${item.customerName}?`, description: step === "confirm" ? "The appointment is marked confirmed." : "This closes the appointment with that outcome.", confirmLabel: STEP_LABEL[step], cancelLabel: "Not yet", destructive: step === "no_show" }))) return;
    setStepping(item.appointmentId);
    const response = await fetch(step === "confirm" ? "/api/app/appointments" : "/api/app/appointments/close-out", {
      method: step === "confirm" ? "PATCH" : "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(step === "confirm" ? { action: "confirm", appointment_id: item.appointmentId } : { appointment_id: item.appointmentId, outcome: step }),
    }).catch(() => null);
    const body = await response?.json().catch(() => null);
    setStepping(null);
    if (!response || !response.ok) { setError(body?.error ?? "Could not record that step. Try again."); return; }
    setError("");
    void load();
  }

  const filtered = Boolean(needle || status || agentId);
  const clearFilters = () => { setSearch(""); setStatus(""); setAgentId(""); setListPage(1); };
  const { current: listCurrent, rows: listPageRows } = paginate(listRows, listPage, pageSize);

  // ── Calendar B: the day as an agenda ─────────────────────────────────────────────────────────
  const shownDay = range?.first ?? today;
  const policy = context?.policy.find((row) => row.userId === selected);
  const slotLength = policy?.appointmentMinutes ?? 30;
  const agenda: AgendaRow[] = [];
  if (view === "day" && shownDay) {
    let takenByCallback = false;
    for (const [minute, cell] of [...cellsFor(shownDay).entries()].sort((a, b) => a[0] - b[0])) {
      if (cell.kind === "appointment") {
        for (const item of cell.items.filter(matches)) agenda.push({ kind: "appointment", minute: wallClock(item.startsAtUtc, zone).minutes, item });
      } else if (cell.kind === "blocked") {
        if (showBlocked) agenda.push({ kind: "blocked", minute, label: cell.label, sub: cell.sub });
      } else if (cell.kind === "callback") {
        // Listed from the callbacks below; the slot is not free, so it ends the stretch before it.
        takenByCallback = true;
      } else if (!cell.past) {
        // Back-to-back free slots read as one stretch of free time; "+ Book" offers its first slot.
        const last = agenda[agenda.length - 1];
        if (!takenByCallback && last && last.kind === "free" && last.end + (policy?.bufferMinutes ?? 0) >= minute) last.end = minute + slotLength;
        else agenda.push({ kind: "free", minute, end: minute + slotLength, startIso: cell.startIso });
        takenByCallback = false;
      }
    }
    for (const callback of diaryCallbacks) {
      const clock = wallClock(callback.scheduledAtUtc, zone);
      if (sameDay(clock, shownDay)) agenda.push({ kind: "callback", minute: clock.minutes, callback });
    }
    agenda.sort((a, b) => a.minute - b.minute);
  }

  const needConfirming = weekLive.filter((item) => item.status === "booked" && now != null && Date.parse(item.startsAtUtc) > now).length;
  const freeToday = today ? [...cellsFor(today).values()].filter((cell) => cell.kind === "free" && !cell.past).length : 0;
  const busyDays = new Set(mine.filter((item) => LIVE.has(item.status)).map((item) => { const clock = wallClock(item.startsAtUtc, zone); return `${clock.year}-${clock.month}-${clock.day}`; }));
  const step = (days: number) => { if (anchor != null) { setAnchor(anchor + days * DAY_MS); setListPage(1); } };

  const SIDE = "m-glass rounded-xl border border-border p-4";
  const SIDE_RULE = "border-t border-border pt-3";
  const sideLabel = "block text-xs font-semibold text-muted-foreground";

  return (
    <div className="m-stagger flex flex-col gap-6">
      <PageHeader
        title="Calendar"
        // Owner 2026-10-29: Week / Day / List on the right, just left of "Book an appointment".
        actions={<>
          <ViewTabs
            label="View"
            value={view}
            controls="calendar-panel"
            onChange={(nextView) => { setView(nextView); setListPage(1); }}
            tabs={[
              { key: "week", label: "Week" },
              { key: "day", label: "Day" },
              { key: "list", label: "List", count: listRows.length },
            ]}
          />
          <Button type="button" disabled={!context} onClick={() => setBooking({ agentUserId: selected, startIso: null })}><Plus aria-hidden="true" />Book an appointment</Button>
        </>}
      />

      {error && (
        <div role="alert" className="rounded-lg border border-border border-l-[3px] border-l-[var(--error)] bg-[var(--error-surface)] px-4 py-2.5 text-sm text-[var(--error-ink)]">
          {error}{" "}
          <button type="button" className="font-semibold underline underline-offset-2" onClick={refresh}>Try again</button>
        </div>
      )}

      {/* Calendar B (owner pick 2026-10-25): month and filters on the left, the day on the right. */}
      <div className="flex flex-col gap-4 xl:flex-row xl:items-start">
        {/* One card (2026-10-28): month, filters and figures, ruled apart, so the column is no taller
            than the grid beside it; on a short window it scrolls on its own. */}
        <aside className={`${SIDE} flex w-full shrink-0 flex-col gap-3 xl:max-h-[var(--fill-h)] xl:w-[280px] xl:overflow-y-auto`} style={{ "--fill-h": `${fillHeight}px` } as React.CSSProperties} aria-label="Month and filters">
          <section>
            <MiniMonth
              shown={monthShown ?? (shownDay ? { year: shownDay.year, month: shownDay.month } : { year: 2026, month: 1 })}
              onShown={setMonthShown}
              picked={shownDay ?? null}
              today={today}
              busy={busyDays}
              onPick={(day) => { setAnchor(zonedInstant(day.year, day.month, day.day, 720, zone)); setListPage(1); }}
            />
          </section>
          <section className={`${SIDE_RULE} flex flex-col gap-3`}>
            <label className="flex flex-col gap-1.5">
              <span className={sideLabel}>Calendar of</span>
              <select aria-label="Calendar of" value={agentId} onChange={(event) => { setAgentId(event.target.value); setListPage(1); }} className={toolbarControl}>
                <option value="">{me && agents.some(([id]) => id === me) ? "My calendar" : "First with hours"}</option>
                {agents.map(([id, name]) => <option key={id} value={id}>{name}{id === me ? " (you)" : ""}</option>)}
              </select>
            </label>
            <label className="flex flex-col gap-1.5">
              <span className={sideLabel}>Status</span>
              <select aria-label="Status" value={status} onChange={(event) => { setStatus(event.target.value); setListPage(1); }} className={toolbarControl}>
                <option value="">Every status</option>
                {Object.entries(STATUS_LABEL).map(([key, label]) => <option key={key} value={key}>{label}</option>)}
              </select>
            </label>
            <fieldset className="m-0 flex flex-col gap-2 border-0 p-0">
              <legend className={`${sideLabel} mb-1.5`}>Show</legend>
              <label className="flex items-center gap-2.5 text-sm"><input type="checkbox" checked disabled className="size-4 accent-[var(--primary)]" />Appointments</label>
              {callbacks && <label className="flex items-center gap-2.5 text-sm"><input type="checkbox" checked={showCallbacks} onChange={(event) => setShowCallbacks(event.target.checked)} className="size-4 accent-[var(--primary)]" />Callbacks</label>}
              <label className="flex items-center gap-2.5 text-sm"><input type="checkbox" checked={showBlocked} onChange={(event) => setShowBlocked(event.target.checked)} className="size-4 accent-[var(--primary)]" />Blocked time</label>
            </fieldset>
          </section>
          <section className={`${SIDE_RULE} flex flex-col gap-1.5`} aria-label="Calendar figures">
            <span className={sideLabel}>This week</span>
            {([
              ["Appointments", weekLive.length, ""],
              ["Need confirming", needConfirming, needConfirming ? "text-[var(--warning-ink)]" : ""],
              ["No-shows last week", noShows, noShows ? "text-[var(--error-ink)]" : ""],
              ["Showed last week", showRate == null ? "—" : `${showRate}%`, ""],
              ["Free slots today", noHours ? "—" : freeToday, freeToday ? "text-[var(--accent-ink)]" : ""],
            ] as const).map(([label, value, tone]) => (
              <div key={label} className="flex items-baseline justify-between gap-3 text-sm">
                <span className="text-[var(--body)]">{label}</span>
                <strong className={`tabular-nums ${tone}`}>{value}</strong>
              </div>
            ))}
            {holdsCalendar && <Link href="/app/settings#calendar" className="mt-1 text-sm font-semibold text-[var(--accent-ink)] hover:underline">Hours &amp; blocks</Link>}
          </section>
        </aside>

        <div ref={setFillNode} className={`flex min-h-[420px] min-w-0 flex-1 flex-col ${FILL_H}`} style={{ "--fill-h": `${fillHeight}px` } as React.CSSProperties}>
        <TableCard
          className={FILL}
          toolbar={
            <DataToolbar
              actions={<>
                {filtered && <ClearFiltersButton onClick={clearFilters} />}
                <RefreshButton onClick={refresh} refreshing={loading} />
              </>}
            >
              <span className="inline-flex items-center gap-1.5">
                <Button type="button" size="icon-sm" variant="outline" aria-label={view === "day" ? "Previous day" : "Previous week"} onClick={() => step(view === "day" ? -1 : -7)}><ChevronLeft aria-hidden="true" /></Button>
                <label className={`${toolbarControl} relative inline-flex cursor-pointer items-center gap-2 font-semibold`}>
                  {rangeLabel}<ChevronDown className="size-4 text-muted-foreground" aria-hidden="true" />
                  {/* The native picker sits over the control, so the whole label opens it. */}
                  <input
                    type="date"
                    aria-label={view === "day" ? "Choose a day" : "Choose a week"}
                    className="absolute inset-0 cursor-pointer opacity-0"
                    onChange={(event) => { if (event.target.value) { setAnchor(new Date(`${event.target.value}T12:00:00`).getTime()); setListPage(1); } }}
                  />
                </label>
                <Button type="button" size="icon-sm" variant="outline" aria-label={view === "day" ? "Next day" : "Next week"} onClick={() => step(view === "day" ? 1 : 7)}><ChevronRight aria-hidden="true" /></Button>
                {/* Back to today: today's day, or the week around it. */}
                <Button type="button" size="sm" variant="ghost" onClick={() => { setAnchor(nowMs()); setListPage(1); }}>Today</Button>
              </span>
              <ToolbarSearch value={search} onChange={(value) => { setSearch(value); setListPage(1); }} placeholder="Search by customer" />
            </DataToolbar>
          }
          footer={view === "list"
            ? <Pager page={listCurrent} total={listRows.length} pageSize={pageSize} noun={listRows.length === 1 ? "appointment" : "appointments"} suffix={`this ${range ? "week" : "range"} · times in ${zone}`} onPage={setListPage} />
            : <span>Times in {zone}{context && !noHours ? ` · ${agentName}` : ""}</span>}
        >
        {/* The views fade in on switch, like every tab panel (2026-10-09). */}
        <div key={view} id="calendar-panel" role="tabpanel" aria-labelledby={`calendar-panel-tab-${view}`}>
        {view === "day" && (
          context == null ? (
            <div className="p-4"><ErrorState title="Availability did not load" detail="Try again in a moment." action={<Button type="button" variant="outline" onClick={refresh}>Try again</Button>} /></div>
          ) : noHours ? (
            <div className="p-4"><EmptyState title={`No working hours for ${agentName}`} hint="Set hours to open bookable slots." action={<Button asChild variant="outline"><Link href="/app/settings#calendar">Set calendar &amp; availability</Link></Button>} /></div>
          ) : (
            <>
              {agenda.length === 0
                ? <p className="m-0 px-5 py-6 text-sm text-muted-foreground">Nothing on this day.</p>
                : <ol className="m-0 list-none p-0">{agenda.map((row) => <AgendaLine key={`${row.kind}:${row.minute}:${row.kind === "appointment" ? row.item.appointmentId : row.kind === "callback" ? row.callback.id : ""}`} row={row} zone={zone} slotLength={slotLength} highlightId={highlightId} steps={row.kind === "appointment" ? stepsFor(row.item) : []} stepping={stepping} isFuture={(iso) => now != null && Date.parse(iso) > now} onStep={(item, chosen) => void takeStep(item, chosen)} onBook={(startIso) => setBooking({ agentUserId: selected, startIso })} onRebooked={() => { void load(); }} onOpen={(opening) => { if (opening.kind === "appointment") setOpened({ kind: "appointment", item: opening.item }); else if (opening.kind === "callback") setOpened({ kind: "callback", callback: opening.callback }); }} />)}</ol>}
            </>
          )
        )}
        {view === "week" && (
          <div className="p-4">
            {context == null ? (
              <ErrorState title="Availability did not load" detail="Try again in a moment." action={<Button type="button" variant="outline" onClick={refresh}>Try again</Button>} />
            ) : noHours ? (
              <EmptyState
                title={`No working hours for ${agentName}`}
                hint="Set hours to open bookable slots."
                action={<Button asChild variant="outline"><Link href="/app/settings#calendar">Set calendar &amp; availability</Link></Button>}
              />
            ) : (
              <div className="grid min-w-[720px] gap-2" style={{ gridTemplateColumns: `78px repeat(${days.length}, minmax(0, 1fr))` }}>
                {/* The day headings stay at the top while the slots scroll under them. */}
                <span className={WEEK_HEAD} />
                {days.map((day) => {
                  const isToday = Boolean(today && sameDay(day, today));
                  const isPast = Boolean(today && !isToday && dateKey(day) < dateKey(today));
                  return (
                    <span key={dateKey(day)} className={`${WEEK_HEAD} flex items-center gap-2 text-xs font-semibold uppercase leading-[1.33] tracking-[0.02em] ${isToday ? "text-[var(--accent-ink)]" : isPast ? "text-muted-foreground opacity-70" : "text-foreground"}`}>
                      {WEEKDAY[day.weekday]} {day.day}
                      {isToday && <span className="rounded-full bg-[var(--primary-soft)] px-2 py-px text-xs font-semibold normal-case tracking-normal text-[var(--accent-ink)]">Today</span>}
                    </span>
                  );
                })}
                {grid.rows.map((minute) => (
                  <div key={minute} className="contents">
                    <span className="pt-4 text-xs font-semibold text-muted-foreground tabular-nums">{clockLabel(minute, false)}</span>
                    {grid.perDay.map((cells, index) => {
                      const cell = cells.get(minute);
                      const time = clockLabel(minute, false);
                      if (!cell) return <div key={index} className="min-h-[52px]" aria-hidden="true" />;
                      // Blocked time is a slot too (the board draws it dashed on the alternate surface).
                      if (cell.kind === "blocked" && !showBlocked) return <div key={index} className="min-h-[52px]" aria-hidden="true" />;
                      if (cell.kind === "blocked") return <Slot key={index} title={<span className="text-muted-foreground">{cell.label}</span>} sub={cell.sub} tone="border border-dashed border-[var(--border-strong)] border-l-[1px] bg-[var(--surface-alt)]" />;
                      if (cell.kind === "free") {
                        // A slot that has gone by holds nothing: it stays as a faint cell so the week keeps its
                        // shape, without forty "Past" labels competing with the real appointments.
                        if (cell.past) return <div key={index} className="min-h-[52px] rounded-lg bg-[var(--surface-alt)] opacity-50" aria-label={`${WEEKDAY_LONG[days[index].weekday]} ${time}, past`} />;
                        const isNext = grid.nextFree === `${index}:${minute}`;
                        return (
                          <button key={index} type="button" onClick={() => setBooking({ agentUserId: cell.agentUserId, startIso: cell.startIso })} className="group text-left" aria-label={`Book ${WEEKDAY_LONG[days[index].weekday]} ${time}`}>
                            <span className={`flex min-h-[52px] items-center rounded-lg border border-dashed px-2.5 py-2 text-sm leading-normal transition-colors group-hover:border-solid group-hover:border-[var(--primary)] group-hover:bg-[var(--primary-soft)] ${isNext ? "border-[var(--primary)] font-semibold text-[var(--accent-ink)]" : "border-[var(--border-strong)] text-muted-foreground"}`}>
                              <span className="group-hover:hidden">{isNext ? "Next free" : "Free"}</span>
                              <span className="hidden font-semibold text-[var(--accent-ink)] group-hover:inline">+ Book</span>
                            </span>
                          </button>
                        );
                      }
                      if (cell.kind === "callback") {
                        const [first, ...more] = cell.items;
                        const theirs = first.customerTimezone ? theirTime(first.scheduledAtUtc, first.customerTimezone, zone) : null;
                        return (
                          <button key={index} type="button" onClick={() => setOpened({ kind: "callback", callback: first })} className="block rounded-lg text-left transition-shadow hover:shadow-[0_0_0_1px_var(--border-strong)]" aria-label={`Callback with ${first.customerName}, ${WEEKDAY_LONG[days[index].weekday]} ${time}`}>
                            <Slot title={shortName(first.customerName)} sub={["Callback", theirs].filter(Boolean).join(" · ")} tone={CALLBACK_TONE}>
                              {more.length > 0 && <span className="text-xs font-semibold text-[var(--accent-ink)]">+{more.length} more</span>}
                            </Slot>
                          </button>
                        );
                      }
                      const visible = cell.items.filter(matches);
                      if (visible.length === 0) return <Slot key={index} title={<span className="text-muted-foreground">Booked</span>} tone="bg-card border border-border border-l-[3px] border-l-[var(--border-strong)]" />;
                      const item = visible[0];
                      // Another setter's booking: the slot is taken, and that is all a setter learns.
                      if (item.redacted) return <Slot key={index} title={<span className="text-muted-foreground">Booked</span>} sub={visible.length > 1 ? `+${visible.length - 1} more` : STATUS_LABEL[item.status]} tone="bg-card border border-border border-l-[3px] border-l-[var(--border-strong)]" />;
                      const purpose = [item.notes, item.agentName.split(/\s+/)[0]].filter(Boolean).join(" · ");
                      const theirs = theirTime(item.startsAtUtc, item.customerTimezone, zone);
                      // With double-booking on, a slot holds two — never three — so a slot with one live
                      // booking still offers its second seat. The server counts the same way.
                      const slotStart = zonedInstant(days[index].year, days[index].month, days[index].day, minute, zone);
                      const seated = cell.items.filter((a) => a.status === "booked" || a.status === "confirmed").length;
                      const secondSeat = Boolean(context?.policy.find((row) => row.userId === selected)?.allowDoubleBooking) && seated === 1 && now != null && slotStart > now;
                      return (
                        <div key={index} className="flex flex-col gap-1">
                          {/* Opens the appointment in place (owner 2026-10-29); the lead is one button inside it. */}
                          <button type="button" onClick={() => setOpened({ kind: "appointment", item })} className={`block rounded-lg text-left transition-shadow hover:shadow-[0_0_0_1px_var(--border-strong)] ${item.appointmentId === highlightId ? "ring-2 ring-[var(--ring)]" : ""}`}>
                            <Slot title={shortName(item.customerName)} sub={[purpose, theirs].filter(Boolean).join(" · ") || STATUS_LABEL[item.status]} tone={TONE[item.status] ?? TONE.booked}>
                              {visible.length > 1 && <span className="text-xs font-semibold text-[var(--accent-ink)]">+{visible.length - 1} more</span>}
                            </Slot>
                          </button>
                          {(cell.callbacks ?? []).map((callback) => (
                            <button key={callback.id} type="button" onClick={() => setOpened({ kind: "callback", callback })} className="block rounded-lg text-left">
                              <Slot title={shortName(callback.customerName)} sub="Callback" tone={CALLBACK_TONE} />
                            </button>
                          ))}
                          {secondSeat && (
                            <button type="button" onClick={() => setBooking({ agentUserId: selected, startIso: new Date(slotStart).toISOString() })} className="self-start text-xs font-semibold text-foreground underline underline-offset-2">
                              Book 2nd seat
                            </button>
                          )}
                        </div>
                      );
                    })}
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {view === "list" && (
          loading && appointments.length === 0 ? <SectionLoading rows={4} columns={6} label="Loading appointments" />
          : listRows.length === 0 ? (
            filtered
              ? <NoMatches noun="appointments" onClear={clearFilters} />
              : <EmptyState title="Nothing booked this week" hint="Book one, or pick a free slot in Week." action={<Button type="button" variant="outline" disabled={!context} onClick={() => setBooking({ agentUserId: selected, startIso: null })}>Book an appointment</Button>} />
          ) : (
            <table className="portal-callback-table w-full min-w-[1180px] text-left text-sm">
              <thead><tr><th>When</th><th>Customer</th><th>Product</th><th>Their time</th><th>Agent</th><th>Status</th><th>Reminder</th><th>Notes</th><th className="text-right"><span className="sr-only">Actions</span></th></tr></thead>
              <tbody>
                {listPageRows.map((item) => {
                  const clock = wallClock(item.startsAtUtc, zone);
                  const steps = stepsFor(item);
                  const noShow = item.status === "no_show" && !item.redacted;
                  const product = [item.product, faceLabel(item.faceAmountCents ?? null)].filter(Boolean).join(" · ");
                  return (
                    <tr key={item.appointmentId} className={item.appointmentId === highlightId ? "bg-[var(--primary-soft)]" : ""}>
                      <td className="whitespace-nowrap tabular-nums">{WEEKDAY[clock.weekday]} {clock.day} · {clockLabel(clock.minutes)}</td>
                      <td className="max-w-[200px] truncate">
                        {item.redacted
                          ? <span className="text-muted-foreground">Booked by another setter</span>
                          : <Link href={`/app/leads/${item.leadId}`} className="font-semibold text-foreground hover:underline" title={item.customerName}>{item.customerName}</Link>}
                      </td>
                      <td className="max-w-[180px] truncate text-muted-foreground" title={product || undefined}>{product || "—"}</td>
                      <td className="whitespace-nowrap tabular-nums">{theirTime(item.startsAtUtc, item.customerTimezone, zone)?.replace("their time ", "") ?? "Same as yours"}</td>
                      <td className="max-w-[160px] truncate" title={item.agentName}>{item.agentName}</td>
                      <td className="whitespace-nowrap"><StatusChip tone={STATUS_TONE[item.status] ?? "neutral"}>{STATUS_LABEL[item.status] ?? item.status}</StatusChip></td>
                      <td className="whitespace-nowrap text-muted-foreground">{item.reminderSentAt && (item.status === "booked" || item.status === "confirmed") ? "Sent" : "—"}</td>
                      <td className="max-w-[220px] truncate text-muted-foreground" title={item.notes ?? undefined}>{item.notes ?? "—"}</td>
                      <td className="whitespace-nowrap text-right">
                        <span className="inline-flex items-center justify-end gap-2">
                          {steps.map((step) => (
                            <Button key={step} type="button" size="sm" variant={step === "no_show" ? "outline" : "default"} disabled={stepping === item.appointmentId} onClick={() => void takeStep(item, step)}>
                              {stepping === item.appointmentId ? "Saving…" : STEP_LABEL[step]}
                            </Button>
                          ))}
                          {noShow && (
                            <>
                              {/* Decided 2026-09-25: the dialer opens on this lead and checks the calling window when it dials. */}
                              <Button asChild size="sm"><Link href={`/app/dialer?lead=${item.leadId}`}>Call now</Link></Button>
                              {item.rebookedAs
                                ? <span className="text-xs text-muted-foreground">Rebooked</span>
                                : <RebookButton appointmentId={item.appointmentId} agentUserId={item.agentUserId} customerName={item.customerName} onRebooked={() => { void load(); }} />}
                            </>
                          )}
                        </span>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )
        )}
        </div>
        </TableCard>
        </div>
      </div>

      {booking && context && (
        <BookingDialog
          context={context}
          initial={booking}
          agents={agents}
          nowAt={now ?? 0}
          onClose={() => setBooking(null)}
          callbacks={callbacks ?? []}
          onBooked={() => { setBooking(null); void loadContext().catch(() => {}); void load(); }}
        />
      )}
      {opened && context && (
        <CalendarItemDialog
          key={opened.kind === "appointment" ? opened.item.appointmentId : opened.callback.id}
          opened={opened}
          context={context}
          zone={zone}
          nowAt={now ?? 0}
          callbacks={callbacks ?? []}
          steps={opened.kind === "appointment" ? stepsFor(opened.item) : []}
          canCancel={holdsCalendar}
          onStep={(item, chosen) => { setOpened(null); void takeStep(item, chosen); }}
          onClose={() => setOpened(null)}
          onChanged={() => { setOpened(null); void loadContext().catch(() => {}); void load(); }}
        />
      )}
    </div>
  );
}

type LeadHit = { id: string; title: string; meta: string };

/**
 * Booking from the calendar. Customer from search (the leads this person can open), agent, and one
 * of the slots the calendar offers — the server's `book_appointment` is still the authority, and
 * its refusal is shown word for word.
 */
function BookingDialog({ context, initial, agents, nowAt, callbacks, onClose, onBooked }: {
  context: Context;
  initial: { agentUserId: string; startIso: string | null };
  agents: [string, string][];
  nowAt: number;
  /** Open callbacks: a slot one of them takes is not offered (owner 2026-10-29). */
  callbacks: DiaryCallback[];
  onClose: () => void;
  onBooked: () => void;
}) {
  const [agent, setAgent] = useState(initial.agentUserId);
  const [slot, setSlot] = useState(initial.startIso ?? "");
  const [query, setQuery] = useState("");
  const [hits, setHits] = useState<LeadHit[]>([]);
  const [lead, setLead] = useState<LeadHit | null>(null);
  const [notes, setNotes] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const zone = context.availability.find((row) => row.userId === agent)?.timezone || Intl.DateTimeFormat().resolvedOptions().timeZone;
  const slots = useMemo(() => {
    const offered = slotsFree(context, agent, nowAt, callbacks);
    return initial.startIso && agent === initial.agentUserId && !offered.includes(initial.startIso) ? [initial.startIso, ...offered] : offered;
  }, [context, agent, nowAt, initial, callbacks]);

  useEffect(() => {
    const term = query.trim();
    if (term.length < 2 || lead) { setHits([]); return; } // eslint-disable-line react-hooks/set-state-in-effect
    const controller = new AbortController();
    const timer = window.setTimeout(async () => {
      const response = await fetch(`/api/app/search?q=${encodeURIComponent(term)}&limit=20`, { cache: "no-store", signal: controller.signal }).catch(() => null);
      const body = await response?.json().catch(() => null);
      const leads = ((body?.hits ?? []) as { group: string; title: string; meta: string; href: string }[])
        .filter((hit) => hit.group === "Leads")
        .map((hit) => ({ id: hit.href.split("/").pop() ?? "", title: hit.title, meta: hit.meta }))
        .filter((hit) => hit.id);
      setHits(leads);
    }, 200);
    return () => { controller.abort(); window.clearTimeout(timer); };
  }, [query, lead]);

  const label = (iso: string) => {
    const clock = wallClock(iso, zone);
    return `${WEEKDAY[clock.weekday]} ${clock.day} ${MONTH_LONG[clock.month - 1].slice(0, 3)} · ${clockLabel(clock.minutes)}`;
  };

  async function book() {
    if (!lead || !slot) return;
    setBusy(true);
    setError("");
    const response = await fetch("/api/app/appointments", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ lead_id: lead.id, agent_user_id: agent, starts_at_utc: slot, notes: notes.trim() || null }),
    }).catch(() => null);
    setBusy(false);
    if (!response) { setError("Check your connection and try again."); return; }
    const body = await response.json().catch(() => null);
    if (!response.ok) { setError(body?.error ?? "That slot could not be booked"); return; }
    onBooked();
  }

  const field = "mt-1.5 block h-9 w-full rounded-lg border border-[var(--border-strong)] bg-card px-3 text-sm font-normal normal-case tracking-normal text-foreground";
  const labelClass = "block text-xs font-semibold uppercase leading-[1.33] tracking-[0.02em] text-muted-foreground";

  return (
    <Dialog open onOpenChange={(open) => { if (!open) onClose(); }}>
      <DialogContent className="sm:max-w-[520px]">
        <DialogHeader>
          <DialogTitle>Book an appointment</DialogTitle>
          <DialogDescription>Open slots only. Times are in {zone}.</DialogDescription>
        </DialogHeader>
        <div className="grid gap-4">
          <div className={labelClass}>
            Customer
            {lead ? (
              <div className="mt-1.5 flex items-center justify-between gap-3 rounded-lg border border-border bg-[var(--surface-alt)] px-3 py-2 text-sm normal-case tracking-normal">
                <span><span className="font-semibold text-foreground">{lead.title}</span><span className="block text-xs text-muted-foreground">{lead.meta}</span></span>
                <button type="button" onClick={() => { setLead(null); setQuery(""); }} className="text-xs font-semibold text-foreground underline">Change</button>
              </div>
            ) : (
              <>
                <input type="search" aria-label="Search for a customer" placeholder="Search leads by name or phone" value={query} onChange={(event) => setQuery(event.target.value)} className={field} autoFocus />
                {hits.length > 0 && (
                  <ul className="mt-1 max-h-48 overflow-y-auto rounded-lg border border-border bg-card normal-case tracking-normal">
                    {hits.map((hit) => (
                      <li key={hit.id}>
                        <button type="button" onClick={() => setLead(hit)} className="block w-full px-3 py-2 text-left text-sm hover:bg-[var(--surface-alt)]">
                          <span className="font-semibold text-foreground">{hit.title}</span>
                          <span className="block text-xs text-muted-foreground">{hit.meta}</span>
                        </button>
                      </li>
                    ))}
                  </ul>
                )}
                {query.trim().length >= 2 && hits.length === 0 && <p className="mt-1 text-xs normal-case tracking-normal text-muted-foreground">No matching leads.</p>}
              </>
            )}
          </div>
          <label className={labelClass}>
            With
            <select value={agent} onChange={(event) => { setAgent(event.target.value); setSlot(""); }} className={field}>
              {agents.filter(([id]) => context.availability.some((row) => row.userId === id)).map(([id, name]) => <option key={id} value={id}>{name}</option>)}
            </select>
          </label>
          <label className={labelClass}>
            Slot
            <select value={slot} onChange={(event) => setSlot(event.target.value)} className={field}>
              <option value="">{slots.length ? "Choose a slot" : "No open slots in the next three weeks"}</option>
              {slots.map((iso) => <option key={iso} value={iso}>{label(iso)}</option>)}
            </select>
          </label>
          <label className={labelClass}>
            Purpose <span className="font-normal normal-case tracking-normal">(optional)</span>
            <input value={notes} onChange={(event) => setNotes(event.target.value)} maxLength={2000} placeholder="Quote review, first appointment…" className={field} />
          </label>
          {error && <p role="alert" className="rounded-lg border border-[color-mix(in_srgb,var(--error)_24%,transparent)] bg-[var(--error-surface)] px-3 py-2 text-sm text-[var(--error-ink)]">{error}</p>}
        </div>
        <DialogFooter>
          <Button type="button" variant="outline" onClick={onClose}>Cancel</Button>
          <Button type="button" disabled={!lead || !slot || busy} onClick={book}>{busy ? "Booking…" : "Book appointment"}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

type Opened = { kind: "appointment"; item: Appointment } | { kind: "callback"; callback: DiaryCallback };

/** Open slots for one calendar, less the ones a callback owed on it already takes (owner 2026-10-29). */
function slotsFree(context: Context, agentUserId: string, nowAt: number, callbacks: DiaryCallback[]) {
  const length = (context.policy.find((row) => row.userId === agentUserId)?.appointmentMinutes ?? 30) * 60_000;
  const owed = callbacks.filter((row) => row.assignedTo === agentUserId && OPEN_CALLBACK.has(row.status)).map((row) => Date.parse(row.scheduledAtUtc));
  return openSlots(context, agentUserId, nowAt, { days: 21, limit: 60 }).filter((iso) => {
    const start = Date.parse(iso);
    return !owed.some((at) => at >= start && at < start + length);
  });
}

/**
 * An appointment or a callback, opened from the calendar (owner 2026-10-29): it opens here, the way
 * the booking pop-up does, to be changed in place, and the lead is one button at the end of the
 * Customer field rather than where a click lands. An appointment moves to another open slot (the
 * server's reschedule is the authority), is confirmed or closed out, or cancelled; a callback is
 * called, or moved on the Callbacks page, which owns its calling-window rules.
 */
function CalendarItemDialog({ opened, context, zone, nowAt, callbacks, steps, canCancel, onStep, onClose, onChanged }: {
  opened: Opened;
  context: Context;
  zone: string;
  nowAt: number;
  callbacks: DiaryCallback[];
  steps: Step[];
  canCancel: boolean;
  onStep: (item: Appointment, step: Step) => void;
  onClose: () => void;
  onChanged: () => void;
}) {
  const item = opened.kind === "appointment" ? opened.item : null;
  const callback = opened.kind === "callback" ? opened.callback : null;
  const [slot, setSlot] = useState(item?.startsAtUtc ?? "");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const slots = useMemo(() => {
    if (!item) return [];
    const offered = slotsFree(context, item.agentUserId, nowAt, callbacks);
    return offered.includes(item.startsAtUtc) ? offered : [item.startsAtUtc, ...offered];
  }, [item, context, nowAt, callbacks]);

  const label = (iso: string) => {
    const clock = wallClock(iso, zone);
    return `${WEEKDAY[clock.weekday]} ${clock.day} ${MONTH_LONG[clock.month - 1].slice(0, 3)} · ${clockLabel(clock.minutes)}`;
  };
  const leadId = item?.leadId ?? callback?.leadId ?? "";
  const name = item?.customerName ?? callback?.customerName ?? "";
  const when = item ? item.startsAtUtc : callback?.scheduledAtUtc ?? "";
  const theirs = item ? theirTime(item.startsAtUtc, item.customerTimezone, zone) : callback?.customerTimezone ? theirTime(callback.scheduledAtUtc, callback.customerTimezone, zone) : null;
  const live = item ? ["booked", "confirmed", "pending"].includes(item.status) : false;
  const movable = Boolean(item && live && Date.parse(item.startsAtUtc) > nowAt);
  const changed = Boolean(item && slot && slot !== item.startsAtUtc);
  const facts = item ? [item.product, faceLabel(item.faceAmountCents ?? null)].filter(Boolean).join(" ") : [callback?.productName, callback?.phone].filter(Boolean).join(" · ");

  async function send(url: string, method: string, payload: unknown, failure: string) {
    setBusy(true); setError("");
    const response = await fetch(url, { method, headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload) }).catch(() => null);
    const body = await response?.json().catch(() => null);
    setBusy(false);
    if (!response || !response.ok) { setError(body?.error ?? failure); return false; }
    return true;
  }
  async function move() {
    if (!item || !changed) return;
    if (await send("/api/app/appointments", "PATCH", { appointment_id: item.appointmentId, starts_at_utc: slot }, "That time could not be booked. Your choice is still here.")) onChanged();
  }
  async function cancel() {
    if (!item) return;
    if (!(await confirmAction({ title: `Cancel ${item.customerName}'s appointment?`, description: "The slot opens again. The lead stays as it is.", confirmLabel: "Cancel appointment", cancelLabel: "Keep it", destructive: true }))) return;
    if (await send("/api/app/appointments/close-out", "POST", { appointment_id: item.appointmentId, outcome: "cancelled" }, "The appointment could not be cancelled.")) onChanged();
  }

  const labelClass = "block text-xs font-semibold text-[var(--body)]";
  const fact = (title: string, value: ReactNode) => (
    <div className="min-w-0"><span className={labelClass}>{title}</span><span className="mt-1 block text-sm text-[var(--ink)]">{value}</span></div>
  );

  return (
    <Dialog open onOpenChange={(open) => { if (!open && !busy) onClose(); }}>
      <DialogContent className="max-h-[calc(100dvh-2rem)] overflow-y-auto sm:max-w-[520px]">
        <DialogHeader>
          <DialogTitle>{item ? "Appointment" : "Callback"}</DialogTitle>
          <DialogDescription>Times are in {zone}.</DialogDescription>
        </DialogHeader>
        <div className="grid gap-4">
          <div>
            <span className={labelClass}>Customer</span>
            {/* The lead, as a button at the end of the field. */}
            <div className="mt-1.5 flex items-center justify-between gap-3 rounded-lg border border-border bg-[var(--surface-alt)] px-3 py-2">
              <span className="min-w-0">
                <span className="block truncate text-sm font-semibold text-[var(--ink)]">{name}</span>
                <span className="block truncate text-xs text-[var(--body)]">{facts || (item ? "Appointment" : "Callback")}</span>
              </span>
              {leadId && !callback?.isDemo && <Button asChild size="sm" variant="outline"><Link href={`/app/leads/${leadId}`}>Open lead<ArrowUpRight aria-hidden="true" /></Link></Button>}
            </div>
          </div>
          <div className="grid grid-cols-2 gap-4">
            {fact("When", when ? label(when) : "—")}
            {fact("Their time", theirs?.replace("their time ", "") ?? "Same as yours")}
            {item && fact("With", item.agentName)}
            {item && fact("Status", <StatusChip tone={STATUS_TONE[item.status] ?? "neutral"}>{STATUS_LABEL[item.status] ?? item.status}</StatusChip>)}
            {callback && fact("Status", <StatusChip tone={callback.isOverdue ? "danger" : "warning"}>{callback.isOverdue ? "Late callback" : "Callback"}</StatusChip>)}
          </div>
          {(item?.notes || callback?.note) && fact(item ? "Purpose" : "Note", item?.notes ?? callback?.note)}
          {item && movable && (
            <label className={labelClass}>
              Move to
              <select value={slot} disabled={busy} onChange={(event) => setSlot(event.target.value)} className={`${inputControl} mt-1.5`}>
                {slots.map((iso) => <option key={iso} value={iso}>{label(iso)}{iso === item.startsAtUtc ? " (current)" : ""}</option>)}
              </select>
            </label>
          )}
          {item && (steps.length > 0 || (canCancel && live)) && (
            <div className="flex flex-wrap items-center gap-2">
              {steps.map((step) => (
                <Button key={step} type="button" size="sm" variant="outline" disabled={busy} onClick={() => onStep(item, step)}>{AGENDA_STEP_LABEL[step]}</Button>
              ))}
              {canCancel && live && <Button type="button" size="sm" variant="ghost" disabled={busy} onClick={() => void cancel()}>Cancel appointment</Button>}
            </div>
          )}
          {error && <p role="alert" className="m-0 rounded-lg border border-[color-mix(in_srgb,var(--error)_24%,transparent)] bg-[var(--error-surface)] px-3 py-2 text-sm text-[var(--error-ink)]">{error}</p>}
        </div>
        <DialogFooter>
          <Button type="button" variant="outline" disabled={busy} onClick={onClose}>Close</Button>
          {item && movable && <Button type="button" disabled={!changed || busy} onClick={() => void move()}>{busy ? "Saving…" : "Save new time"}</Button>}
          {callback && !callback.isDemo && <Button asChild variant="outline"><Link href="/app/callbacks">Move in Callbacks</Link></Button>}
          {callback && !callback.isDemo && <Button asChild><Link href={`/app/dialer?lead=${callback.leadId}`}>Call now</Link></Button>}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
