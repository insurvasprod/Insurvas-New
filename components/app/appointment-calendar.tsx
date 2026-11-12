"use client";

import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { ArrowUpRight, ChevronLeft, ChevronRight, Clock, Phone, Plus, X } from "lucide-react";

import { Button } from "@/components/ui/button";
import { confirmAction } from "@/components/ui/confirm-dialog";
import { RefreshButton, ToolbarSearch, toolbarControl } from "@/components/ui/data-toolbar";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { inputControl } from "@/components/ui/field";
import { PageHeader } from "@/components/ui/page-header";
import { PageLoading } from "@/components/ui/page-loading";
import { EmptyState, ErrorState, NoMatches, SectionLoading } from "@/components/ui/page-states";
import { Pager, paginate } from "@/components/ui/pager";
import { Popover, PopoverAnchor, PopoverContent } from "@/components/ui/popover";
import { StatusChip, type StatusTone } from "@/components/ui/status-chip";
import { TableCard } from "@/components/ui/table-card";
import { ViewTabs } from "@/components/ui/view-tabs";
import { RebookButton } from "@/components/app/appointment-rebook";
import { MiniMonth, type YearMonth } from "@/components/app/calendar/mini-month";
import { faceLabel } from "@/lib/appointments/appointmentFacts";
import { clockLabel, intervalsFor, openSlots, wallClock, zonedInstant, type BlockRepeat, type PickerContext } from "@/lib/appointments/calendarMath";
import { useFittingPageSize } from "@/components/ui/use-fitting-page-size";
import { load as loadResource, peek, readResource, seed } from "@/lib/client/resource-cache";
import { cn } from "@/lib/utils";

/**
 * LA-2.11's calendar, laid out the way people already know a calendar (owner 2026-11-09: "very close
 * to Google Calendar"): Today and the arrows beside the date range, Day / Week / Month / List, a left
 * column with the month, whose calendar it is and what to show, and a time grid where every booking
 * is a block as long as it lasts, with a red line at "now".
 *
 * Every bookable gap still comes from availability — working hours, minus blocked time, minus what is
 * booked — so pressing an empty slot opens the booking form on a slot the calendar really offers, and
 * `book_appointment` still refuses anything wrong, and says why. A callback owed at a time takes the
 * slot (owner 2026-10-29). Pressing a booking opens its details beside it, where it is confirmed,
 * closed out, moved, cancelled or rebooked.
 *
 * Two clocks, always: the grid runs on the diary owner's time; a booking whose customer lives in
 * another zone also says what time it is for them.
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
  | { kind: "appointment"; items: Appointment[] }
  | { kind: "callback"; items: DiaryCallback[] }
  | { kind: "blocked"; label: string; sub: string }
  | { kind: "free"; startIso: string; agentUserId: string; past: boolean };
type View = "day" | "week" | "month" | "list";

/** A callback in the diary's day: read from /api/app/callbacks when this person may. */
type DiaryCallback = { id: string; leadId: string; customerName: string; scheduledAtUtc: string; customerTimezone?: string; assignedTo: string; status: string; productName: string | null; note?: string | null; phone?: string | null; isOverdue: boolean; isDemo?: boolean };
type Opened = { kind: "appointment"; item: Appointment } | { kind: "callback"; callback: DiaryCallback };

const DAY_MS = 86_400_000;
const WEEKDAY = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const WEEKDAY_LONG = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
const MONTH_LONG = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
const MONTH_SHORT = MONTH_LONG.map((name) => name.slice(0, 3));
const LIVE = new Set(["booked", "confirmed", "showed", "no_show"]);
const OPEN_CALLBACK = new Set(["scheduled", "due", "missed"]);
const STATUS_LABEL: Record<string, string> = { booked: "Booked", confirmed: "Confirmed", pending: "Awaiting close-out", showed: "Showed", no_show: "No-show", cancelled: "Cancelled", rescheduled: "Rescheduled" };
const STATUS_TONE: Record<string, StatusTone> = { booked: "action", confirmed: "good", pending: "warning", showed: "good", no_show: "danger", cancelled: "neutral", rescheduled: "neutral" };
const STEP_LABEL: Record<Step, string> = { confirm: "Confirm", showed: "Showed", no_show: "No-show" };
const REPEAT_LABEL: Record<string, string> = { daily: "Every day", weekdays: "Every weekday", weekly: "Every week", yearly: "Every year" };

/** One hour of the grid, in pixels; the grid is the whole day and scrolls to the working hours. */
const HOUR_PX = 72; // owner 2026-11-10: taller hour rows (was 48)
const MINUTE_PX = HOUR_PX / 60;
/** The time gutter on the left of the grid. */
const GUTTER = 56;
/** A block's ground by status: soft fill, a 3px bar of the status colour on its left (§12 colours). */
const HELD = "bg-[var(--success-surface)] border-l-[var(--success)]";
const WAITING = "bg-[var(--warning-surface)] border-l-[var(--warning)]";
const EVENT_TONE: Record<string, string> = {
  booked: "bg-[var(--primary-soft)] border-l-[var(--primary)]",
  confirmed: HELD,
  showed: HELD,
  pending: WAITING,
  no_show: "bg-[var(--error-surface)] border-l-[var(--error)]",
  callback: WAITING,
  taken: "bg-[var(--surface-alt)] border-l-[var(--border-strong)]",
};
/** The card reaches the window's foot from xl; the grid scrolls inside it under its sticky day headings. */
const FILL = "flex min-h-0 flex-1 flex-col [&>*:nth-child(2)]:min-h-0 [&>*:nth-child(2)]:flex-1 [&>*:nth-child(2)]:overflow-y-auto";
/**
 * From the card's top down to the page's own bottom padding, so the calendar reaches the foot of the window
 * (owner 2026-11-10: full height). The top is the layout position (offsetTop), not getBoundingClientRect: the
 * page's entrance animation slides it up from below, and measuring mid-slide left the card short. It is
 * measured again when an animation or transition ends and whenever anything above it changes size.
 */
function useFillHeight() {
  const [node, setNode] = useState<HTMLElement | null>(null);
  const [height, setHeight] = useState(640);
  useEffect(() => {
    if (!node) return;
    const fit = () => {
      let top = 0;
      for (let el: HTMLElement | null = node; el; el = el.offsetParent as HTMLElement | null) top += el.offsetTop;
      let below = 0;
      for (let el = node.parentElement; el && el !== document.body; el = el.parentElement) {
        const style = window.getComputedStyle(el);
        below += (parseFloat(style.paddingBottom) || 0) + (parseFloat(style.borderBottomWidth) || 0);
      }
      setHeight(Math.max(480, Math.floor(window.innerHeight - top - below)));
    };
    fit();
    const observer = typeof ResizeObserver === "undefined" ? null : new ResizeObserver(fit);
    observer?.observe(document.body);
    if (node.parentElement) observer?.observe(node.parentElement);
    window.addEventListener("resize", fit);
    document.addEventListener("animationend", fit, true);
    document.addEventListener("transitionend", fit, true);
    return () => {
      observer?.disconnect();
      window.removeEventListener("resize", fit);
      document.removeEventListener("animationend", fit, true);
      document.removeEventListener("transitionend", fit, true);
    };
  }, [node]);
  return { setNode, height };
}

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
const mondayOf = (day: Day, zone: string) => dayOf(day.noon - ((day.weekday + 6) % 7) * DAY_MS, zone);

/** Whether a repeating block lands on a local date — the same rule the slot picker uses. */
function recursOn(repeats: BlockRepeat, first: Day | ReturnType<typeof wallClock>, date: Day) {
  if (dateKey(date) < dateKey(first)) return false;
  if (repeats === "daily") return true;
  if (repeats === "weekdays") return date.weekday >= 1 && date.weekday <= 5;
  if (repeats === "weekly") return date.weekday === first.weekday;
  if (repeats === "yearly") return date.month === first.month && date.day === first.day;
  return false;
}

/** "Grace Oyelaran" → "G. Oyelaran", for a narrow block. */
function shortName(name: string) {
  const parts = name.trim().split(/\s+/);
  return parts.length > 1 ? `${parts[0][0]}. ${parts.slice(1).join(" ")}` : name;
}

/** "10 AM": the gutter's hour. */
function hourLabel(hour: number) {
  return `${hour % 12 === 0 ? 12 : hour % 12} ${hour < 12 ? "AM" : "PM"}`;
}

/** "their time 2:30 CT": the customer's own clock and zone, only when it differs from the diary's. */
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

/** Side by side when they overlap: each block gets a column inside its cluster, as a calendar draws it. */
function sideBySide<T extends { start: number; end: number }>(items: T[]): Array<T & { col: number; cols: number }> {
  const sorted = [...items].sort((a, b) => a.start - b.start || b.end - a.end);
  const placed: Array<T & { col: number; cols: number }> = [];
  let cluster: Array<T & { col: number; cols: number }> = [];
  let clusterEnd = -1;
  const close = () => { const cols = Math.max(1, ...cluster.map((entry) => entry.col + 1)); for (const entry of cluster) entry.cols = cols; cluster = []; };
  for (const item of sorted) {
    if (item.start >= clusterEnd) { close(); clusterEnd = -1; }
    const taken = new Set(cluster.filter((entry) => entry.end > item.start).map((entry) => entry.col));
    let col = 0;
    while (taken.has(col)) col += 1;
    const entry = { ...item, col, cols: 1 };
    cluster.push(entry);
    placed.push(entry);
    clusterEnd = Math.max(clusterEnd, item.end);
  }
  close();
  return placed;
}

/** The page's reads, as the app's cache keys them (lib/client/resource-cache.ts): a repeat visit draws the last answer at once. */
const APPOINTMENTS_KEY = "/api/app/appointments";
const ME_KEY = "/api/app/me";
const CALLBACKS_KEY = "/api/app/callbacks";
const calendarKey = (from: number, to: number) => `/api/app/calendar?from=${encodeURIComponent(new Date(from).toISOString())}&to=${encodeURIComponent(new Date(to).toISOString())}`;
type MeBody = { user?: { id?: string } | null; role?: unknown } | null;
type CallbacksBody = { callbacks?: unknown } | null;
type CalendarBody = { appointments?: Appointment[] } | null;
const callbacksOf = (body: CallbacksBody | undefined) => (Array.isArray(body?.callbacks) ? (body.callbacks as DiaryCallback[]) : null);

/** A block on the grid: an appointment, a callback, or blocked time, placed by its local minutes. */
type Block =
  | { key: string; kind: "appointment"; start: number; end: number; item: Appointment; second: boolean }
  | { key: string; kind: "callback"; start: number; end: number; callback: DiaryCallback }
  | { key: string; kind: "blocked"; start: number; end: number; label: string; sub: string };

export function AppointmentCalendar({ highlightId, embedded = false }: { highlightId?: string; embedded?: boolean }) {
  // Week first (owner 2026-10-28); Day, Month and List are one click away.
  const [view, setView] = useState<View>("week");
  const { setNode: setFillNode, height: fillHeight } = useFillHeight();
  const [showCallbacks, setShowCallbacks] = useState(true);
  const [showBlocked, setShowBlocked] = useState(true);
  const [callbacks, setCallbacks] = useState<DiaryCallback[] | null>(() => callbacksOf(seed<CallbacksBody>(CALLBACKS_KEY, true)?.data));
  const [anchor, setAnchor] = useState<number | null>(null);
  // Which way the last move went (§ Motion, Wave 2); set by moveTo below.
  const [turn, setTurn] = useState<{ to: number | null; enter: "forward" | "back" } | null>(null);
  const [now, setNow] = useState<number | null>(null);
  const [context, setContext] = useState<Context | null>(() => seed<Context>(APPOINTMENTS_KEY)?.data ?? null);
  const [me, setMe] = useState<string | null>(() => seed<MeBody>(ME_KEY)?.data?.user?.id ?? null);
  const [role, setRole] = useState<string | null>(() => { const role = seed<MeBody>(ME_KEY)?.data?.role; return typeof role === "string" ? role : null; });
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
  const [shownMonth, setShownMonth] = useState<YearMonth | null>(null);
  // The booking or callback whose details are open, and where on screen it was pressed.
  const [opened, setOpened] = useState<{ what: Opened; rect: { left: number; top: number; width: number; height: number } } | null>(null);
  const pageSize = useFittingPageSize(480, 45);
  const scroller = useRef<HTMLDivElement | null>(null);

  // "Now" is read once mounted, so the server and the browser never disagree about the week; the
  // red line moves every minute after that.
  useEffect(() => {
    const at = nowMs();
    setNow(at); // eslint-disable-line react-hooks/set-state-in-effect
    setAnchor(at);
    const tick = window.setInterval(() => setNow(nowMs()), 60_000);
    return () => window.clearInterval(tick);
  }, []);

  // Who can be booked, their hours, blocks and policy — the same payload the dialer's picker uses.
  const loadContext = useCallback(async (fresh = false) => {
    const read = <T,>(key: string) => (fresh ? loadResource<T>(key) : readResource<T>(key));
    const [body, mine] = await Promise.all([
      read<Context>(APPOINTMENTS_KEY).catch((cause: unknown) => { throw new Error(cause instanceof Error ? cause.message : "Could not load availability"); }),
      read<MeBody>(ME_KEY).catch(() => null),
    ]);
    setContext(body);
    setMe(mine?.user?.id ?? null);
    setRole(typeof mine?.role === "string" ? mine.role : null);
  }, []);

  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(() => { void loadContext().catch((cause) => setError(cause instanceof Error ? cause.message : "Could not load availability")); }, [loadContext]);

  // Callbacks sit in the day too, when this person can read them (without the feature the toggle is not offered).
  useEffect(() => {
    let live = true;
    const kept = callbacksOf(peek<CallbacksBody>(CALLBACKS_KEY, true)?.data);
    // eslint-disable-next-line react-hooks/set-state-in-effect -- the kept answer, read from storage after hydration
    if (kept) setCallbacks((current) => current ?? kept);
    void readResource<CallbacksBody>(CALLBACKS_KEY, { persist: true })
      .then((body) => { if (live) setCallbacks(callbacksOf(body)); })
      .catch(() => undefined);
    return () => { live = false; };
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

  const anchorDay = anchor == null ? null : dayOf(anchor, zone);
  const today = now == null ? null : dayOf(now, zone);

  // The days on the grid, in the diary owner's zone: a working week (a weekend day only if it is worked or booked).
  const days = useMemo(() => {
    if (!anchorDay) return [] as Day[];
    if (view === "day") return [anchorDay];
    const monday = mondayOf(anchorDay, zone);
    const week = Array.from({ length: 7 }, (_, i) => dayOf(monday.noon + i * DAY_MS, zone));
    const worked = new Set((context?.availability ?? []).filter((row) => row.userId === selected).map((row) => row.weekday));
    return week.filter((d) => (d.weekday >= 1 && d.weekday <= 5) || worked.has(d.weekday) || appointments.some((a) => a.agentUserId === selected && sameDay(wallClock(a.startsAtUtc, zone), d)));
  }, [anchorDay?.year, anchorDay?.month, anchorDay?.day, zone, view, context, selected, appointments]); // eslint-disable-line react-hooks/exhaustive-deps

  // Month: six weeks from the Monday on or before the 1st.
  const monthDays = useMemo(() => {
    if (!anchorDay || view !== "month") return [] as Day[];
    const first = dayOf(zonedInstant(anchorDay.year, anchorDay.month, 1, 720, zone), zone);
    const start = mondayOf(first, zone);
    return Array.from({ length: 42 }, (_, i) => dayOf(start.noon + i * DAY_MS, zone));
  }, [anchorDay?.year, anchorDay?.month, anchorDay?.day, zone, view]); // eslint-disable-line react-hooks/exhaustive-deps

  // What is read: the view's days, and always the whole week around the anchor (its figures), plus the week before it.
  const range = useMemo(() => {
    if (!anchorDay) return null;
    const monday = mondayOf(anchorDay, zone);
    const weekStart = zonedInstant(monday.year, monday.month, monday.day, 0, zone);
    const weekEnd = weekStart + 7 * DAY_MS;
    let from = weekStart;
    let to = weekEnd;
    if (view === "month") {
      const first = dayOf(zonedInstant(anchorDay.year, anchorDay.month, 1, 720, zone), zone);
      const start = mondayOf(first, zone);
      from = Math.min(from, zonedInstant(start.year, start.month, start.day, 0, zone));
      to = Math.max(to, from + 42 * DAY_MS);
    }
    return { from, to, weekStart, weekEnd, lastFrom: weekStart - 7 * DAY_MS, lastTo: weekStart };
  }, [anchorDay?.year, anchorDay?.month, anchorDay?.day, zone, view]); // eslint-disable-line react-hooks/exhaustive-deps

  // The week is first read in the browser's zone and again once the diary's own zone is known; the
  // two reads overlap, so only the newest one may land (an older answer arriving last is dropped).
  const loadSeq = useRef(0);
  const load = useCallback(async (fresh = false) => {
    if (!range) return;
    const seq = ++loadSeq.current;
    // A range read before (this visit or the last) draws at once from the app's cache; the answer below replaces it.
    const keptCurrent = fresh || range.to - range.from > 31 * DAY_MS ? undefined : peek<CalendarBody>(calendarKey(range.from, range.to))?.data;
    const keptPrevious = fresh ? undefined : peek<CalendarBody>(calendarKey(range.lastFrom, range.lastTo))?.data;
    if (keptCurrent && keptPrevious) {
      setAppointments(keptCurrent.appointments ?? []);
      setLastWeek(keptPrevious.appointments ?? []);
      setLoadedOnce(true);
    }
    setLoading(true);
    const getOne = async (from: number, to: number) => {
      const key = calendarKey(from, to);
      const body = await (fresh ? loadResource<CalendarBody>(key) : readResource<CalendarBody>(key)).catch((cause: unknown) => { throw new Error(cause instanceof Error ? cause.message : "Could not load the calendar"); });
      return (body?.appointments ?? []) as Appointment[];
    };
    // The API answers at most 31 days at a time; Month's six weeks are read as two halves and joined.
    const get = async (from: number, to: number) => {
      if (to - from <= 31 * DAY_MS) return getOne(from, to);
      const middle = from + Math.ceil((to - from) / DAY_MS / 2) * DAY_MS;
      const [first, second] = await Promise.all([getOne(from, middle), getOne(middle, to)]);
      const seen = new Set(first.map((item) => item.appointmentId));
      return [...first, ...second.filter((item) => !seen.has(item.appointmentId))];
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
  const diaryCallbacks = useMemo(
    () => (showCallbacks && callbacks ? callbacks.filter((row) => row.assignedTo === selected && OPEN_CALLBACK.has(row.status) && (!needle || row.customerName.toLowerCase().includes(needle))) : []),
    [showCallbacks, callbacks, selected, needle],
  );
  const policy = context?.policy.find((row) => row.userId === selected);
  const slotLength = policy?.appointmentMinutes ?? 30;

  /** One agent's slots for one local date, keyed by the local minute each starts at: free, blocked or taken. */
  const cellsFor = useCallback((day: Day): Map<number, Cell> => {
    const cells = new Map<number, Cell>();
    if (!context || now == null) return cells;
    const hours = context.availability.filter((row) => row.userId === selected);
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
        for (const [minute, cell] of cells) {
          if (cell.kind === "free" && minute < to && minute + length > from) cells.set(minute, { kind: "blocked", label, sub: repeats === "none" ? "Blocked" : REPEAT_LABEL[repeats] ?? "Blocked" });
        }
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
    // A booking or a callback owed takes the slot it starts in.
    for (const item of mine.filter((a) => LIVE.has(a.status) && sameDay(wallClock(a.startsAtUtc, zone), day))) {
      const minute = wallClock(item.startsAtUtc, zone).minutes;
      const slot = [...cells.keys()].find((key) => key <= minute && minute < key + length) ?? minute;
      const existing = cells.get(slot);
      cells.set(slot, existing?.kind === "appointment" ? { kind: "appointment", items: [...existing.items, item] } : { kind: "appointment", items: [item] });
    }
    for (const callback of diaryCallbacks.filter((row) => sameDay(wallClock(row.scheduledAtUtc, zone), day))) {
      const minute = wallClock(callback.scheduledAtUtc, zone).minutes;
      const slot = [...cells.keys()].find((key) => key <= minute && minute < key + length) ?? minute;
      const existing = cells.get(slot);
      if (existing?.kind !== "appointment") cells.set(slot, existing?.kind === "callback" ? { kind: "callback", items: [...existing.items, callback] } : { kind: "callback", items: [callback] });
    }
    return cells;
  }, [context, now, selected, zone, mine, diaryCallbacks, policy]);

  /** What one day draws: free slots to press, the blocks laid side by side, and time off for the all-day row. */
  const dayPlan = useCallback((day: Day) => {
    const cells = cellsFor(day);
    const free: Array<{ minute: number; startIso: string }> = [];
    const blocks: Block[] = [];
    const length = slotLength;
    for (const [minute, cell] of [...cells.entries()].sort((a, b) => a[0] - b[0])) {
      if (cell.kind === "free" && !cell.past) free.push({ minute, startIso: cell.startIso });
      if (cell.kind === "blocked" && showBlocked) {
        // Back-to-back slots of the same block draw as one stretch.
        const last = blocks[blocks.length - 1];
        if (last && last.kind === "blocked" && last.label === cell.label && last.end + (policy?.bufferMinutes ?? 0) >= minute) last.end = minute + length;
        else blocks.push({ key: `b${minute}`, kind: "blocked", start: minute, end: minute + length, label: cell.label, sub: cell.sub });
      }
    }
    const dayStart = zonedInstant(day.year, day.month, day.day, 0, zone);
    for (const item of mine.filter((a) => LIVE.has(a.status) && matches(a) && sameDay(wallClock(a.startsAtUtc, zone), day))) {
      const start = wallClock(item.startsAtUtc, zone).minutes;
      const seated = cells.get([...cells.keys()].find((key) => key <= start && start < key + length) ?? start);
      const secondSeat = Boolean(policy?.allowDoubleBooking) && seated?.kind === "appointment" && seated.items.filter((a) => a.status === "booked" || a.status === "confirmed").length === 1 && now != null && dayStart + start * 60_000 > now;
      blocks.push({ key: item.appointmentId, kind: "appointment", start, end: start + Math.max(15, item.durationMinutes || length), item, second: secondSeat });
    }
    for (const callback of diaryCallbacks.filter((row) => sameDay(wallClock(row.scheduledAtUtc, zone), day))) {
      const start = wallClock(callback.scheduledAtUtc, zone).minutes;
      blocks.push({ key: `c${callback.id}`, kind: "callback", start, end: start + 30, callback });
    }
    // Time off: a block of twelve hours or more that day sits in the all-day row (repeating ones too).
    const allDay = showBlocked && context ? context.blocks.filter((row) => row.userId === selected).filter((block) => {
      const span = Date.parse(block.endsAt) - Date.parse(block.startsAt);
      if (span < 12 * 3_600_000) return false;
      const repeats = (block.repeats ?? "none") as BlockRepeat | "none";
      if (repeats !== "none") return recursOn(repeats, wallClock(block.startsAt, zone), day);
      return Date.parse(block.startsAt) < dayStart + DAY_MS && Date.parse(block.endsAt) > dayStart;
    }).map((block) => block.reason?.trim() || "Time off") : [];
    return { free, blocks: sideBySide(blocks), allDay };
  }, [cellsFor, slotLength, showBlocked, policy, zone, mine, matches, now, diaryCallbacks, context, selected]);

  // Figures for the week around the anchor, whatever the view.
  const weekLive = range ? mine.filter((item) => LIVE.has(item.status) && Date.parse(item.startsAtUtc) >= range.weekStart && Date.parse(item.startsAtUtc) < range.weekEnd) : [];
  const settled = lastWeek.filter((item) => item.agentUserId === selected && (item.status === "showed" || item.status === "no_show"));
  const showed = settled.filter((item) => item.status === "showed").length;
  const noShows = settled.length - showed;
  const showRate = settled.length ? Math.round((showed / settled.length) * 100) : null;
  const needConfirming = weekLive.filter((item) => item.status === "booked" && now != null && Date.parse(item.startsAtUtc) > now).length;
  const freeToday = today ? [...cellsFor(today).values()].filter((cell) => cell.kind === "free" && !cell.past).length : 0;

  const listRows = range ? appointments.filter((item) => (!agentId || item.agentUserId === agentId) && matches(item) && Date.parse(item.startsAtUtc) >= range.weekStart && Date.parse(item.startsAtUtc) < range.weekEnd) : [];
  const hasHours = Boolean(context?.availability.some((row) => row.userId === selected));
  const noHours = context != null && !hasHours;
  const agentName = agents.find(([id]) => id === selected)?.[1] ?? "this person";
  const holdsCalendar = role === "owner" || role === "producer";

  // The grid opens on the working day: an hour before the first open hour, or two hours before now.
  const firstOpen = useMemo(() => {
    const hours = context?.availability.filter((row) => row.userId === selected) ?? [];
    const opens = [1, 2, 3, 4, 5, 0, 6].flatMap((weekday) => intervalsFor(hours, weekday).map(([open]) => open));
    return opens.length ? Math.min(...opens) : 8 * 60;
  }, [context, selected]);
  const scrolledFor = useRef("");
  const scrolledBox = useRef<HTMLElement | null>(null);
  useLayoutEffect(() => {
    // The card's body is what scrolls: the nearest ancestor that scrolls on its own.
    let node = scroller.current?.parentElement ?? null;
    while (node && !/(auto|scroll)/.test(getComputedStyle(node).overflowY)) node = node.parentElement;
    if (!node || (view !== "week" && view !== "day") || noHours) return;
    const key = `${view}:${selected}`;
    if (scrolledFor.current === key && scrolledBox.current === node) return;
    scrolledFor.current = key;
    scrolledBox.current = node;
    const nowMinute = today && days.some((day) => sameDay(day, today)) && now != null ? wallClock(new Date(now).toISOString(), zone).minutes : null;
    const target = nowMinute != null && nowMinute > firstOpen + 180 ? nowMinute - 120 : firstOpen - 60;
    const top = Math.max(0, target * MINUTE_PX);
    node.scrollTop = top;
    // Set again once the card has its full height: a box that was still short clamps the first try to the top.
    const box = node;
    window.requestAnimationFrame(() => { if (box.scrollTop < top) box.scrollTop = top; });
  });

  // ?appointment= points at one booking: it is ringed and scrolled into view once it is on screen.
  const highlighted = useRef(false);
  useEffect(() => {
    if (!highlightId || highlighted.current || !loadedOnce) return;
    const node = document.querySelector<HTMLElement>(`[data-appointment="${CSS.escape(highlightId)}"]`);
    if (node) { highlighted.current = true; node.scrollIntoView({ block: "center" }); }
  });

  // The first read draws the page skeleton; a later week or a Refresh keeps the page drawn.
  if (!error && (context == null || !loadedOnce)) return <PageLoading />;

  const refresh = () => {
    void loadContext(true).catch((cause) => setError(cause instanceof Error ? cause.message : "Could not load availability"));
    void load(true);
  };

  // LA-2.11-5: confirm before the slot, showed / no-show after it. Showed and no-show are the agent's
  // (the setter is the one measured by them); a setter confirms their own.
  const stepsFor = (item: Appointment): Step[] => {
    if (item.redacted || now == null) return [];
    const started = Date.parse(item.startsAtUtc) <= now;
    if (!started) return item.status === "booked" && (holdsCalendar || (role === "setter" && item.bookedByUserId === me)) ? ["confirm"] : [];
    return holdsCalendar && ["booked", "confirmed", "pending"].includes(item.status) ? ["showed", "no_show"] : [];
  };
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
    void load(true);
  }

  const { current: listCurrent, rows: listPageRows } = paginate(listRows, listPage, pageSize);
  const clearFilters = () => { setSearch(""); setStatus(""); setListPage(1); };

  // Moving through time: a later range slides in from the right, an earlier one from the left.
  const moveTo = (to: number) => { if (anchor != null && to !== anchor) setTurn({ to, enter: to > anchor ? "forward" : "back" }); setAnchor(to); setListPage(1); setOpened(null); };
  const step = (direction: 1 | -1) => {
    if (anchor == null || !anchorDay) return;
    if (view === "month") {
      const at = new Date(Date.UTC(anchorDay.year, anchorDay.month - 1 + direction, 1));
      moveTo(zonedInstant(at.getUTCFullYear(), at.getUTCMonth() + 1, 1, 720, zone));
    } else moveTo(anchor + direction * (view === "day" ? 1 : 7) * DAY_MS);
  };
  const goToDay = (day: { year: number; month: number; day: number }, nextView: View = view) => {
    setView(nextView);
    moveTo(zonedInstant(day.year, day.month, day.day, 720, zone));
  };

  // The title beside the arrows: "November 2026", "Nov 9 – 13, 2026", "Monday, November 9, 2026".
  const title = (() => {
    if (!anchorDay) return "…";
    if (view === "day") return `${WEEKDAY_LONG[anchorDay.weekday].slice(0, 3)}, ${MONTH_SHORT[anchorDay.month - 1]} ${anchorDay.day}, ${anchorDay.year}`;
    if (view === "month") return `${MONTH_LONG[anchorDay.month - 1]} ${anchorDay.year}`;
    const first = days[0] ?? mondayOf(anchorDay, zone);
    const last = days[days.length - 1] ?? first;
    return first.month === last.month
      ? `${MONTH_SHORT[first.month - 1]} ${first.day} – ${last.day}, ${last.year}`
      : `${MONTH_SHORT[first.month - 1]} ${first.day} – ${MONTH_SHORT[last.month - 1]} ${last.day}, ${last.year}`;
  })();
  const stepLabel = view === "day" ? "day" : view === "month" ? "month" : "week";

  const open = (what: Opened, element: HTMLElement) => {
    const box = element.getBoundingClientRect();
    setOpened({ what, rect: { left: box.left, top: box.top, width: box.width, height: box.height } });
  };
  const book = (startIso: string | null) => { setOpened(null); setBooking({ agentUserId: selected, startIso }); };
  const bookButton = <Button type="button" disabled={!context} onClick={() => book(null)} aria-label="Book an appointment"><Plus aria-hidden="true" /><span className="2xl:hidden">Book</span><span className="hidden 2xl:inline">Book an appointment</span></Button>;

  // Days with bookings, for the dots in the mini month.
  const busyDays = new Set(mine.filter((item) => LIVE.has(item.status)).map((item) => { const c = wallClock(item.startsAtUtc, zone); return `${c.year}-${c.month}-${c.day}`; }));
  const monthShown = shownMonth ?? (anchorDay ? { year: anchorDay.year, month: anchorDay.month } : { year: 2026, month: 1 });
  const sectionTitle = "m-0 text-xs font-semibold text-muted-foreground";

  // ── The left column: the month, whose calendar, what to show, this week ─────────────────────────
  const side = (
    <aside aria-label="Calendar options" className="m-glass flex w-full shrink-0 flex-col gap-4 overflow-y-auto rounded-2xl border border-border p-4 xl:min-h-0 xl:flex-1">
      <MiniMonth
        shown={monthShown}
        onShown={setShownMonth}
        picked={anchorDay}
        today={today}
        busy={busyDays}
        onPick={(day) => { setShownMonth(null); goToDay(day, view === "list" ? "day" : view); }}
      />
      <section className="flex flex-col gap-1.5" aria-label="Whose calendar">
        <h2 className={sectionTitle}>Calendars</h2>
        <ul className="m-0 flex list-none flex-col gap-0.5 p-0">
          {agents.map(([id, name]) => {
            const on = id === selected;
            return (
              <li key={id}>
                <button type="button" aria-pressed={on} onClick={() => { setAgentId(id); setListPage(1); setOpened(null); }} className={cn("flex h-8 w-full items-center gap-2.5 rounded-md px-2 text-left text-sm transition-colors duration-[var(--t-micro)]", on ? "bg-[var(--primary-soft)] font-semibold text-[var(--ink)]" : "text-[var(--body)] hover:bg-[var(--surface-alt)]")}>
                  <span className={cn("size-3 shrink-0 rounded-[4px] border-2", on ? "border-[var(--primary)] bg-[var(--primary)]" : "border-[var(--border-strong)]")} aria-hidden="true" />
                  <span className="min-w-0 flex-1 truncate">{name}{id === me ? " (you)" : ""}</span>
                </button>
              </li>
            );
          })}
        </ul>
      </section>
      <section className="flex flex-col gap-2" aria-label="Show">
        <h2 className={sectionTitle}>Show</h2>
        <label className="flex items-center gap-2.5 text-sm"><input type="checkbox" checked disabled className="size-4 accent-[var(--primary)]" /><span className="size-2.5 rounded-sm bg-[var(--primary)]" aria-hidden="true" />Appointments</label>
        {callbacks && <label className="flex items-center gap-2.5 text-sm"><input type="checkbox" checked={showCallbacks} onChange={(event) => setShowCallbacks(event.target.checked)} className="size-4 accent-[var(--primary)]" /><span className="size-2.5 rounded-sm bg-[var(--warning)]" aria-hidden="true" />Callbacks</label>}
        <label className="flex items-center gap-2.5 text-sm"><input type="checkbox" checked={showBlocked} onChange={(event) => setShowBlocked(event.target.checked)} className="size-4 accent-[var(--primary)]" /><span className="size-2.5 rounded-sm border border-dashed border-[var(--border-strong)] bg-[var(--surface-alt)]" aria-hidden="true" />Blocked time</label>
        <label className="mt-1 flex flex-col gap-1 text-xs font-medium text-muted-foreground">
          Status
          <select value={status} onChange={(event) => { setStatus(event.target.value); setListPage(1); }} className={cn(toolbarControl, "w-full min-w-0")}>
            <option value="">Every status</option>
            {Object.entries(STATUS_LABEL).map(([key, label]) => <option key={key} value={key}>{label}</option>)}
          </select>
        </label>
      </section>
      <section className="flex flex-col gap-1.5" aria-label="This week">
        <h2 className={sectionTitle}>This week</h2>
        <dl className="m-0 grid grid-cols-2 gap-2">
          {([
            ["Booked", weekLive.length, noHours ? "No hours set" : `${freeToday} free today`, ""],
            ["To confirm", needConfirming, "Not confirmed yet", needConfirming ? "text-[var(--warning-ink)]" : ""],
            ["No-shows", noShows, "Last week", noShows ? "text-[var(--error-ink)]" : ""],
            ["Showed", showRate == null ? "—" : `${showRate}%`, "Last week", ""],
          ] as const).map(([label, value, note, tone]) => (
            <div key={label} className="min-w-0 rounded-lg bg-[var(--surface-alt)] px-2.5 py-2">
              <dt className="text-xs text-muted-foreground">{label}</dt>
              <dd className={cn("m-0 text-base font-semibold tabular-nums text-[var(--ink)]", tone)}>{value}</dd>
              <dd className="m-0 truncate text-xs text-muted-foreground">{note}</dd>
            </div>
          ))}
        </dl>
      </section>
    </aside>
  );

  // ── The time grid (Day and Week) ────────────────────────────────────────────────────────────────
  const plans = (view === "week" || view === "day") ? days.map((day) => ({ day, ...dayPlan(day) })) : [];
  const hasAllDay = plans.some((plan) => plan.allDay.length > 0);
  const nowMinute = now != null ? wallClock(new Date(now).toISOString(), zone).minutes : 0;
  const columns = `${GUTTER}px repeat(${days.length}, minmax(${view === "day" ? 0 : 96}px, 1fr))`;
  const timeGrid = (
    <div ref={scroller} className={cn("relative", view === "week" && "min-w-[640px]")}>
      {/* The day headings stay at the top while the hours scroll under them. */}
      <div className="sticky top-0 z-30 grid border-b border-border bg-[var(--color-card)]" style={{ gridTemplateColumns: columns }}>
        <span className="flex items-end justify-end pb-1.5 pr-2 text-xs text-muted-foreground" title={`Times in ${zone}`}>{zone.split("/").pop()?.replace(/_/g, " ")}</span>
        {plans.map(({ day }) => {
          const isToday = Boolean(today && sameDay(day, today));
          const isPast = Boolean(today && dateKey(day) < dateKey(today));
          return (
            <button key={dateKey(day)} type="button" onClick={() => goToDay(day, "day")} className="flex flex-col items-center gap-0.5 border-l border-border py-2 hover:bg-[var(--surface-alt)]" aria-label={`Open ${WEEKDAY_LONG[day.weekday]} ${day.day} ${MONTH_LONG[day.month - 1]}`}>
              <span className={cn("text-xs font-medium", isToday ? "text-[var(--accent-ink)]" : "text-muted-foreground")}>{WEEKDAY[day.weekday]}</span>
              <span className={cn("grid size-9 place-items-center rounded-full text-lg font-semibold tabular-nums", isToday ? "bg-primary text-primary-foreground" : isPast ? "text-muted-foreground" : "text-[var(--ink)]")}>{day.day}</span>
            </button>
          );
        })}
        {hasAllDay && (
          <>
            <span className="flex items-center justify-end border-t border-border pr-2 text-xs text-muted-foreground">All day</span>
            {plans.map(({ day, allDay }) => (
              <span key={dateKey(day)} className="flex min-h-7 flex-col gap-0.5 border-t border-l border-border p-0.5">
                {allDay.map((label, index) => <span key={index} className="truncate rounded-md border border-dashed border-[var(--border-strong)] bg-[var(--surface-alt)] px-2 py-0.5 text-xs font-medium text-[var(--body)]" title={label}>{label}</span>)}
              </span>
            ))}
          </>
        )}
      </div>
      <div className="grid" style={{ gridTemplateColumns: columns, height: 24 * HOUR_PX }}>
        {/* The time gutter: one label per hour, level with its line. */}
        <div className="relative" aria-hidden="true">
          {Array.from({ length: 23 }, (_, index) => index + 1).map((hour) => (
            <span key={hour} className="absolute right-2 -translate-y-1/2 text-xs text-muted-foreground tabular-nums" style={{ top: hour * HOUR_PX }}>{hourLabel(hour)}</span>
          ))}
        </div>
        {plans.map(({ day, free, blocks }) => {
          const isToday = Boolean(today && sameDay(day, today));
          const hours = context?.availability.filter((row) => row.userId === selected) ?? [];
          return (
            <div key={dateKey(day)} className="relative border-l border-border bg-[var(--surface-alt)]" role="group" aria-label={`${WEEKDAY_LONG[day.weekday]} ${day.day} ${MONTH_LONG[day.month - 1]}`}>
              {/* Working hours are the card's own ground; the rest of the day is shaded. */}
              {intervalsFor(hours, day.weekday).map(([from, to]) => <span key={from} className="absolute inset-x-0 bg-[var(--color-card)]" style={{ top: from * MINUTE_PX, height: (to - from) * MINUTE_PX }} aria-hidden="true" />)}
              {Array.from({ length: 24 }, (_, hour) => <span key={hour} className="pointer-events-none absolute inset-x-0 border-t border-border" style={{ top: hour * HOUR_PX }} aria-hidden="true" />)}
              {/* An empty bookable slot: pressing it opens the booking form on that time. */}
              {free.map((slot) => (
                <button key={slot.minute} type="button" onClick={() => book(slot.startIso)} aria-label={`Book ${WEEKDAY_LONG[day.weekday]} ${clockLabel(slot.minute, false)}`} className="group absolute inset-x-1 z-0 rounded-md text-left transition-colors duration-[var(--t-micro)] hover:bg-[var(--primary-soft)] focus-visible:bg-[var(--primary-soft)]" style={{ top: slot.minute * MINUTE_PX + 1, height: slotLength * MINUTE_PX - 2 }}>
                  <span className="hidden px-2 text-xs font-semibold text-[var(--accent-ink)] group-hover:inline group-focus-visible:inline">+ {clockLabel(slot.minute, false)}</span>
                </button>
              ))}
              {blocks.map((block) => {
                const style = { top: block.start * MINUTE_PX + 1, height: Math.max(20, (block.end - block.start) * MINUTE_PX - 2), left: `calc(${(block.col / block.cols) * 100}% + 2px)`, width: `calc(${100 / block.cols}% - 4px)` };
                const short = (block.end - block.start) * MINUTE_PX < 40;
                if (block.kind === "blocked") {
                  return (
                    <div key={block.key} className="absolute z-[5] overflow-hidden rounded-md border border-dashed border-[var(--border-strong)] bg-[var(--surface-alt)] px-2 py-1 text-xs text-muted-foreground" style={style} title={`${block.label} · ${block.sub}`}>
                      <span className="block truncate font-semibold">{block.label}</span>
                      {!short && <span className="block truncate">{block.sub}</span>}
                    </div>
                  );
                }
                if (block.kind === "callback") {
                  const callback = block.callback;
                  return (
                    <button key={block.key} type="button" onClick={(event) => open({ kind: "callback", callback }, event.currentTarget)} className={cn("absolute z-10 overflow-hidden rounded-md border-l-[3px] px-2 py-0.5 text-left text-xs text-[var(--ink)] transition-shadow hover:shadow-[0_0_0_1px_var(--border-strong)]", EVENT_TONE.callback)} style={style} aria-label={`Callback with ${callback.customerName}, ${clockLabel(block.start, false)}`}>
                      <span className="block truncate font-semibold">{short ? `${clockLabel(block.start, false)} ${shortName(callback.customerName)}` : shortName(callback.customerName)}</span>
                      {!short && <span className="block truncate text-[var(--body)]">Callback · {clockLabel(block.start, false)}{callback.isOverdue ? " · late" : ""}</span>}
                    </button>
                  );
                }
                const item = block.item;
                const tone = item.redacted ? EVENT_TONE.taken : EVENT_TONE[item.status] ?? EVENT_TONE.booked;
                const name = item.redacted ? "Booked" : shortName(item.customerName);
                const when = `${clockLabel(block.start, false)} – ${clockLabel(block.end, false)}`;
                return (
                  <button key={block.key} type="button" data-appointment={item.appointmentId} onClick={(event) => { if (!item.redacted) open({ kind: "appointment", item }, event.currentTarget); }} className={cn("absolute z-10 overflow-hidden rounded-md border-l-[3px] px-2 py-0.5 text-left text-xs text-[var(--ink)] transition-shadow hover:shadow-[0_0_0_1px_var(--border-strong)]", tone, item.redacted && "cursor-default text-muted-foreground", item.appointmentId === highlightId && "ring-2 ring-[var(--ring)]", item.status === "showed" || item.status === "no_show" ? "opacity-80" : "")} style={style} aria-label={item.redacted ? `Booked by another setter, ${when}` : `${item.customerName}, ${when}, ${STATUS_LABEL[item.status] ?? item.status}`}>
                    <span className="block truncate font-semibold">{short ? `${clockLabel(block.start, false)} ${name}` : name}</span>
                    {!short && <span className="block truncate text-[var(--body)]">{when}</span>}
                    {!short && !item.redacted && (block.end - block.start) * MINUTE_PX >= 56 && <span className="block truncate text-[var(--body)]">{[item.notes, STATUS_LABEL[item.status]].filter(Boolean).join(" · ")}</span>}
                  </button>
                );
              })}
              {/* Now: a red line across today, a dot at its start. */}
              {isToday && (
                <span className="pointer-events-none absolute inset-x-0 z-20 h-0.5 bg-[var(--error)]" style={{ top: nowMinute * MINUTE_PX }} aria-label={`Now, ${clockLabel(nowMinute, false)}`} role="img">
                  <span className="absolute -top-[5px] -left-[6px] size-3 rounded-full bg-[var(--error)]" />
                </span>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );

  // ── Month ───────────────────────────────────────────────────────────────────────────────────────
  const monthGrid = (
    <div className="grid h-full min-h-[480px] grid-rows-[auto_repeat(6,minmax(0,1fr))]">
      <div className="grid grid-cols-7 border-b border-border">
        {["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"].map((name) => <span key={name} className="py-2 text-center text-xs font-medium text-muted-foreground">{name}</span>)}
      </div>
      {Array.from({ length: 6 }, (_, week) => (
        <div key={week} className="grid grid-cols-7">
          {monthDays.slice(week * 7, week * 7 + 7).map((day) => {
            const isToday = Boolean(today && sameDay(day, today));
            const inMonth = anchorDay ? day.month === anchorDay.month : true;
            const items = [
              ...mine.filter((a) => LIVE.has(a.status) && matches(a) && sameDay(wallClock(a.startsAtUtc, zone), day)).map((item) => ({ key: item.appointmentId, minute: wallClock(item.startsAtUtc, zone).minutes, what: { kind: "appointment", item } as Opened, label: item.redacted ? "Booked" : shortName(item.customerName), dot: item.redacted ? "bg-[var(--border-strong)]" : item.status === "no_show" ? "bg-[var(--error)]" : item.status === "booked" ? "bg-[var(--primary)]" : "bg-[var(--success)]", redacted: Boolean(item.redacted) })),
              ...diaryCallbacks.filter((row) => sameDay(wallClock(row.scheduledAtUtc, zone), day)).map((callback) => ({ key: `c${callback.id}`, minute: wallClock(callback.scheduledAtUtc, zone).minutes, what: { kind: "callback", callback } as Opened, label: shortName(callback.customerName), dot: "bg-[var(--warning)]", redacted: false })),
            ].sort((a, b) => a.minute - b.minute);
            const shown = items.slice(0, 3);
            return (
              <div key={dateKey(day)} className={cn("flex min-w-0 flex-col gap-0.5 border-r border-b border-border p-1", !inMonth && "bg-[var(--surface-alt)]")} onClick={(event) => { if (event.target === event.currentTarget) goToDay(day, "day"); }}>
                <button type="button" onClick={() => goToDay(day, "day")} className={cn("grid size-7 place-items-center self-center rounded-full text-xs font-semibold tabular-nums hover:bg-[var(--surface-alt)]", isToday ? "bg-primary text-primary-foreground hover:bg-primary" : inMonth ? "text-[var(--ink)]" : "text-muted-foreground")} aria-label={`Open ${WEEKDAY_LONG[day.weekday]} ${day.day} ${MONTH_LONG[day.month - 1]}`}>{day.day}</button>
                {shown.map((entry) => (
                  <button key={entry.key} type="button" disabled={entry.redacted} onClick={(event) => open(entry.what, event.currentTarget)} className="flex min-w-0 items-center gap-1.5 rounded px-1 text-left text-xs text-[var(--ink)] hover:bg-[var(--surface-alt)] disabled:cursor-default disabled:text-muted-foreground">
                    <span className={cn("size-2 shrink-0 rounded-full", entry.dot)} aria-hidden="true" />
                    <span className="shrink-0 text-muted-foreground tabular-nums">{clockLabel(entry.minute, false).replace(":00", "").replace(" ", "").toLowerCase()}</span>
                    <span className="min-w-0 truncate">{entry.label}</span>
                  </button>
                ))}
                {items.length > 3 && <button type="button" onClick={() => goToDay(day, "day")} className="px-1 text-left text-xs font-semibold text-[var(--accent-ink)] hover:underline">{items.length - 3} more</button>}
              </div>
            );
          })}
        </div>
      ))}
    </div>
  );

  // ── List (the week as rows) ─────────────────────────────────────────────────────────────────────
  const list = loading && appointments.length === 0 ? <SectionLoading rows={4} columns={6} label="Loading appointments" />
    : listRows.length === 0 ? (
      needle || status
        ? <NoMatches noun="appointments" onClear={clearFilters} />
        : <EmptyState title="Nothing booked this week" hint="Book one, or press an empty slot in Week." action={<Button type="button" variant="outline" disabled={!context} onClick={() => book(null)}>Book an appointment</Button>} />
    ) : (
      <table className="portal-callback-table w-full min-w-[1080px] text-left text-sm">
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
                    {steps.map((chosen) => (
                      <Button key={chosen} type="button" size="sm" variant={chosen === "no_show" ? "outline" : "default"} disabled={stepping === item.appointmentId} onClick={() => void takeStep(item, chosen)}>
                        {stepping === item.appointmentId ? "Saving…" : STEP_LABEL[chosen]}
                      </Button>
                    ))}
                    {noShow && (
                      <>
                        {/* Decided 2026-09-25: the dialer opens on this lead and checks the calling window when it dials. */}
                        <Button asChild size="sm"><Link href={`/app/dialer?lead=${item.leadId}`}>Call now</Link></Button>
                        {item.rebookedAs
                          ? <span className="text-xs text-muted-foreground">Rebooked</span>
                          : <RebookButton appointmentId={item.appointmentId} agentUserId={item.agentUserId} customerName={item.customerName} onRebooked={() => { void load(true); }} />}
                      </>
                    )}
                  </span>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    );

  const openedAppointment = opened?.what.kind === "appointment" ? opened.what.item : null;
  const openedSecondSeat = openedAppointment ? plans.flatMap((plan) => plan.blocks).some((block) => block.kind === "appointment" && block.item.appointmentId === openedAppointment.appointmentId && block.second) : false;

  return (
    <div className="m-stagger flex flex-col gap-6">
      {/* From xl the calendar card runs from the top of the page to its foot (owner 2026-11-10); the title and the
          options column stack to its left. */}
      <div ref={setFillNode} className="flex flex-col gap-4 xl:flex-row xl:items-stretch xl:[height:var(--fill-h)]" style={{ "--fill-h": `${fillHeight}px` } as React.CSSProperties}>
        <div className="flex w-full shrink-0 flex-col gap-6 xl:min-h-0 xl:w-[248px]">
          {!embedded && <PageHeader title="Calendar" />}
          {side}
        </div>
        <div className="flex min-h-0 min-w-0 flex-1 flex-col gap-4">
        {error && (
          <div role="alert" className="rounded-lg border border-border border-l-[3px] border-l-[var(--error)] bg-[var(--error-surface)] px-4 py-2.5 text-sm text-[var(--error-ink)]">
            {error}{" "}
            <button type="button" className="font-semibold underline underline-offset-2" onClick={refresh}>Try again</button>
          </div>
        )}
        <TableCard
          className={cn(FILL, "min-h-[480px] min-w-0")}
          toolbar={
            <div className="flex w-full flex-wrap items-center gap-x-3 gap-y-2">
              <div className="flex items-center gap-1.5">
                {/* Back to today: today's day, week or month. */}
                <Button type="button" variant="outline" onClick={() => moveTo(nowMs())}>Today</Button>
                <Button type="button" size="icon" variant="ghost" aria-label={`Previous ${stepLabel}`} onClick={() => step(-1)}><ChevronLeft aria-hidden="true" /></Button>
                <Button type="button" size="icon" variant="ghost" aria-label={`Next ${stepLabel}`} onClick={() => step(1)}><ChevronRight aria-hidden="true" /></Button>
              </div>
              <h2 className="m-0 shrink-0 whitespace-nowrap text-lg font-semibold tracking-[-0.02em] text-[var(--ink)]" aria-live="polite" title={`Times in ${zone}${context && !noHours ? ` · ${agentName}` : ""}`}>{title}</h2>
              {/* Search, the view switch and Hours follow the title; Refresh and Book sit at the far right (owner 2026-11-09).
                  The two groups wrap as one unit, so on a narrow card they move to a second line together and Book stays right. */}
              <div className="flex flex-1 basis-[480px] items-center justify-between gap-3">
              <div className="flex items-center gap-3">
                <ToolbarSearch className="sm:w-44" value={search} onChange={(value) => { setSearch(value); setListPage(1); }} placeholder="Search customer" />
                <ViewTabs
                  label="View"
                  value={view}
                  controls="calendar-panel"
                  onChange={(nextView) => { setView(nextView); setListPage(1); setOpened(null); scrolledFor.current = ""; }}
                  tabs={[
                    { key: "day", label: "Day" },
                    { key: "week", label: "Week" },
                    { key: "month", label: "Month" },
                    { key: "list", label: "List", count: listRows.length },
                  ]}
                />
                {holdsCalendar && <Button asChild variant="outline" size="icon"><Link href="/app/setters?tab=setup" aria-label="Hours and blocks" title="Hours and blocks"><Clock aria-hidden="true" /></Link></Button>}
              </div>
              {/* Below 2xl Refresh shows its icon and Book its short word, so the line fits; the full names stay on the controls. */}
              <div className="flex shrink-0 items-center gap-2">
                <RefreshButton onClick={refresh} refreshing={loading} labelClassName="sr-only 2xl:not-sr-only" />
                {bookButton}
              </div>
              </div>
            </div>
          }
          footer={view === "list"
            ? <Pager page={listCurrent} total={listRows.length} pageSize={pageSize} noun={listRows.length === 1 ? "appointment" : "appointments"} suffix={`this week · times in ${zone}`} onPage={setListPage} />
            : undefined}
        >
          <div key={`${view}:${view === "list" ? "" : anchor}`} data-enter={turn && turn.to === anchor && view !== "list" ? turn.enter : undefined} id="calendar-panel" role="tabpanel" aria-labelledby={`calendar-panel-tab-${view}`} className={view === "month" ? "h-full" : undefined} onScroll={() => setOpened(null)}>
            {view !== "list" && context == null ? (
              <div className="p-4"><ErrorState title="Availability did not load" detail="Try again in a moment." action={<Button type="button" variant="outline" onClick={refresh}>Try again</Button>} /></div>
            ) : (view === "week" || view === "day") && noHours ? (
              <div className="p-4"><EmptyState title={`No working hours for ${agentName}`} hint="Set hours to open bookable slots." action={<Button asChild variant="outline"><Link href={holdsCalendar ? "/app/setters?tab=setup" : "/app/settings#calendar"}>Set calendar &amp; availability</Link></Button>} /></div>
            ) : view === "month" ? monthGrid : view === "list" ? list : timeGrid}
          </div>
        </TableCard>
        </div>
      </div>

      {opened && context && (
        <Popover open onOpenChange={(next) => { if (!next) setOpened(null); }}>
          <PopoverAnchor asChild>
            <span aria-hidden="true" className="pointer-events-none fixed" style={{ left: opened.rect.left, top: opened.rect.top, width: opened.rect.width, height: opened.rect.height }} />
          </PopoverAnchor>
          <PopoverContent side="right" align="start" collisionPadding={16} className="w-[360px] max-w-[calc(100vw-32px)] p-0">
            <CalendarItemDetails
              key={opened.what.kind === "appointment" ? opened.what.item.appointmentId : opened.what.callback.id}
              opened={opened.what}
              context={context}
              zone={zone}
              nowAt={now ?? 0}
              callbacks={callbacks ?? []}
              steps={opened.what.kind === "appointment" ? stepsFor(opened.what.item) : []}
              canCancel={holdsCalendar}
              secondSeat={openedSecondSeat}
              onSecondSeat={(startIso) => book(startIso)}
              onStep={(item, chosen) => { setOpened(null); void takeStep(item, chosen); }}
              onClose={() => setOpened(null)}
              onChanged={() => { setOpened(null); void loadContext(true).catch(() => {}); void load(true); }}
            />
          </PopoverContent>
        </Popover>
      )}
      {booking && context && (
        <BookingDialog
          context={context}
          initial={booking}
          agents={agents}
          nowAt={now ?? 0}
          onClose={() => setBooking(null)}
          callbacks={callbacks ?? []}
          onBooked={() => { setBooking(null); void loadContext(true).catch(() => {}); void load(true); }}
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
    return `${WEEKDAY[clock.weekday]} ${clock.day} ${MONTH_SHORT[clock.month - 1]} · ${clockLabel(clock.minutes)}`;
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
  const labelClass = "block text-xs font-semibold leading-[1.33] text-muted-foreground";

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
 * The details of a booking or a callback, in a pop-over beside the block that was pressed (owner
 * 2026-11-09, the way a calendar opens an event). An appointment is confirmed or closed out, moved to
 * another open slot (the server's reschedule is the authority), cancelled, or — after a no-show —
 * called and rebooked; a callback is called, or moved on the Callbacks page, which owns its
 * calling-window rules. The lead is one button.
 */
function CalendarItemDetails({ opened, context, zone, nowAt, callbacks, steps, canCancel, secondSeat, onSecondSeat, onStep, onClose, onChanged }: {
  opened: Opened;
  context: Context;
  zone: string;
  nowAt: number;
  callbacks: DiaryCallback[];
  steps: Step[];
  canCancel: boolean;
  secondSeat: boolean;
  onSecondSeat: (startIso: string) => void;
  onStep: (item: Appointment, step: Step) => void;
  onClose: () => void;
  onChanged: () => void;
}) {
  const item = opened.kind === "appointment" ? opened.item : null;
  const callback = opened.kind === "callback" ? opened.callback : null;
  const [slot, setSlot] = useState(item?.startsAtUtc ?? "");
  const [moving, setMoving] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const slots = useMemo(() => {
    if (!item) return [];
    const offered = slotsFree(context, item.agentUserId, nowAt, callbacks);
    return offered.includes(item.startsAtUtc) ? offered : [item.startsAtUtc, ...offered];
  }, [item, context, nowAt, callbacks]);

  const label = (iso: string) => {
    const clock = wallClock(iso, zone);
    return `${WEEKDAY[clock.weekday]} ${clock.day} ${MONTH_SHORT[clock.month - 1]} · ${clockLabel(clock.minutes)}`;
  };
  const name = item?.customerName ?? callback?.customerName ?? "";
  const leadId = item?.leadId ?? callback?.leadId ?? "";
  const startIso = item ? item.startsAtUtc : callback?.scheduledAtUtc ?? "";
  const clock = startIso ? wallClock(startIso, zone) : null;
  const end = clock ? clock.minutes + (item ? item.durationMinutes || 30 : 0) : 0;
  const when = clock ? `${WEEKDAY_LONG[clock.weekday]}, ${MONTH_LONG[clock.month - 1]} ${clock.day} · ${clockLabel(clock.minutes, false)}${item ? ` – ${clockLabel(end, false)}` : ""}` : "—";
  const theirs = item ? theirTime(item.startsAtUtc, item.customerTimezone, zone) : callback?.customerTimezone ? theirTime(callback.scheduledAtUtc, callback.customerTimezone, zone) : null;
  const live = item ? ["booked", "confirmed", "pending"].includes(item.status) : false;
  const movable = Boolean(item && live && Date.parse(item.startsAtUtc) > nowAt);
  const changed = Boolean(item && slot && slot !== item.startsAtUtc);
  const noShow = item?.status === "no_show";
  const facts = item
    ? [[item.product, faceLabel(item.faceAmountCents ?? null)].filter(Boolean).join(" "), item.bookedByName ? `Set by ${item.bookedByName}` : null, item.reminderSentAt && (item.status === "booked" || item.status === "confirmed") ? "Reminder sent" : null].filter(Boolean)
    : [callback?.productName, callback?.phone].filter(Boolean);

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

  const bar = item ? EVENT_TONE[item.status] ?? EVENT_TONE.booked : EVENT_TONE.callback;
  return (
    <div className="flex max-h-[min(560px,calc(100dvh-32px))] flex-col overflow-y-auto">
      <div className="flex items-start gap-3 px-4 pt-3">
        <span className={cn("mt-1.5 size-3.5 shrink-0 rounded-[4px] border-l-[3px]", bar)} aria-hidden="true" />
        <div className="min-w-0 flex-1">
          <h3 className="m-0 truncate text-base font-semibold text-[var(--ink)]">{name}</h3>
          <p className="m-0 text-sm text-[var(--body)]">{when}</p>
          {theirs && <p className="m-0 text-xs text-muted-foreground">{theirs.replace("their time", "Their time")}</p>}
        </div>
        <Button type="button" size="icon-sm" variant="ghost" aria-label="Close" onClick={onClose}><X aria-hidden="true" /></Button>
      </div>
      <div className="flex flex-col gap-3 px-4 py-3">
        <div className="flex flex-wrap items-center gap-2">
          {item && <StatusChip tone={STATUS_TONE[item.status] ?? "neutral"}>{STATUS_LABEL[item.status] ?? item.status}</StatusChip>}
          {callback && <StatusChip tone={callback.isOverdue ? "danger" : "warning"}>{callback.isOverdue ? "Late callback" : "Callback"}</StatusChip>}
          {item && <span className="text-xs text-muted-foreground">With {item.agentName}</span>}
        </div>
        {facts.length > 0 && <p className="m-0 text-sm text-[var(--body)]">{facts.join(" · ")}</p>}
        {(item?.notes || callback?.note) && <p className="m-0 rounded-lg bg-[var(--surface-alt)] px-3 py-2 text-sm text-[var(--body)]">{item?.notes ?? callback?.note}</p>}
        {item && movable && moving && (
          <label className="block text-xs font-semibold text-[var(--body)]">
            Move to
            <select value={slot} disabled={busy} onChange={(event) => setSlot(event.target.value)} className={`${inputControl} mt-1.5`}>
              {slots.map((iso) => <option key={iso} value={iso}>{label(iso)}{iso === item.startsAtUtc ? " (current)" : ""}</option>)}
            </select>
          </label>
        )}
        {error && <p role="alert" className="m-0 rounded-lg border border-[color-mix(in_srgb,var(--error)_24%,transparent)] bg-[var(--error-surface)] px-3 py-2 text-sm text-[var(--error-ink)]">{error}</p>}
      </div>
      <div className="flex flex-wrap items-center gap-2 border-t border-border px-4 py-3">
        {item && steps.map((chosen) => (
          <Button key={chosen} type="button" size="sm" variant={chosen === "no_show" ? "outline" : "default"} disabled={busy} onClick={() => onStep(item, chosen)}>{STEP_LABEL[chosen]}</Button>
        ))}
        {item && movable && (moving
          ? <Button type="button" size="sm" disabled={!changed || busy} onClick={() => void move()}>{busy ? "Saving…" : "Save new time"}</Button>
          : <Button type="button" size="sm" variant="outline" onClick={() => setMoving(true)}>Move</Button>)}
        {item && secondSeat && <Button type="button" size="sm" variant="outline" onClick={() => onSecondSeat(item.startsAtUtc)}><Plus aria-hidden="true" />Book 2nd seat</Button>}
        {noShow && item && (
          <>
            {/* Decided 2026-09-25: the dialer opens on this lead and checks the calling window when it dials. */}
            <Button asChild size="sm"><Link href={`/app/dialer?lead=${item.leadId}`}><Phone aria-hidden="true" />Call now</Link></Button>
            {item.rebookedAs ? <span className="text-xs text-muted-foreground">Rebooked</span> : <RebookButton appointmentId={item.appointmentId} agentUserId={item.agentUserId} customerName={item.customerName} onRebooked={onChanged} />}
          </>
        )}
        {callback && !callback.isDemo && <Button asChild size="sm"><Link href={`/app/dialer?lead=${callback.leadId}`}><Phone aria-hidden="true" />Call now</Link></Button>}
        {callback && !callback.isDemo && <Button asChild size="sm" variant="outline"><Link href="/app/callbacks">Move in Callbacks</Link></Button>}
        {canCancel && live && <Button type="button" size="sm" variant="ghost" disabled={busy} onClick={() => void cancel()}>Cancel appointment</Button>}
        {leadId && !callback?.isDemo && <Button asChild size="sm" variant="ghost" className="ml-auto"><Link href={`/app/leads/${leadId}`}>Open lead<ArrowUpRight aria-hidden="true" /></Link></Button>}
      </div>
    </div>
  );
}

