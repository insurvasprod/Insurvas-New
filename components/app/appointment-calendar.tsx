"use client";

import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import Link from "next/link";
import { ChevronDown, Plus } from "lucide-react";

import { Button } from "@/components/ui/button";
import { ClearFiltersButton, DataToolbar, RefreshButton, ToolbarSearch, toolbarControl } from "@/components/ui/data-toolbar";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { PageHeader } from "@/components/ui/page-header";
import { PageLoading } from "@/components/ui/page-loading";
import { EmptyState, ErrorState, NoMatches, SectionLoading } from "@/components/ui/page-states";
import { Pager, paginate } from "@/components/ui/pager";
import { StatStrip, StatTile } from "@/components/ui/stat";
import { StatusChip, type StatusTone } from "@/components/ui/status-chip";
import { TableCard } from "@/components/ui/table-card";
import { RebookButton } from "@/components/app/appointment-rebook";
import { ViewTabs } from "@/components/app/view-tabs";
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
  | { kind: "appointment"; items: Appointment[] }
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
/** The card reaches the bottom of the window; the grid or list scrolls inside it. */
const FILL = "flex h-[calc(100dvh-var(--top-bar-h)-330px)] min-h-[420px] flex-col [&>*:nth-child(2)]:min-h-0 [&>*:nth-child(2)]:flex-1 [&>*:nth-child(2)]:overflow-y-auto";
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

export function AppointmentCalendar({ highlightId }: { highlightId?: string }) {
  const [view, setView] = useState<View>("week");
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
    return cells;
  }, [context, now, selected, zone, mine]);

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
  const slotTotal = grid.perDay.reduce((n, cells) => n + [...cells.values()].filter((cell) => cell.kind !== "blocked").length, 0);
  const today = now == null ? null : dayOf(now, zone);
  const todays = today ? weekLive.filter((item) => sameDay(wallClock(item.startsAtUtc, zone), today)) : [];
  const next = now == null ? null : todays.filter((item) => Date.parse(item.startsAtUtc) >= now).sort((a, b) => a.startsAtUtc.localeCompare(b.startsAtUtc))[0] ?? null;
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
    if (!window.confirm(`${STEP_LABEL[step]}: ${item.customerName}?`)) return;
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

  return (
    <div className="m-stagger flex flex-col gap-6">
      <PageHeader title="Calendar" />

      <StatStrip label="Calendar figures">
        <StatTile label="This week" value={weekLive.length} footnote={noHours ? "no working hours set" : context ? `of ${slotTotal} slots` : "—"} />
        <StatTile label="Today" value={todays.length} footnote={next ? `next at ${clockLabel(wallClock(next.startsAtUtc, zone).minutes)}` : "nothing left today"} />
        <StatTile label="Showed last week" value={showRate == null ? "—" : showRate} unit={showRate == null ? undefined : "%"} valueTone={showRate == null ? undefined : showRate >= 70 ? "good" : "warning"} footnote={settled.length ? `${showed} of ${settled.length}` : "nothing settled last week"} />
        <StatTile label="No-shows" value={noShows} valueTone={noShows > 0 ? "warning" : undefined} footnote="last week" />
      </StatStrip>

      {error && (
        <div role="alert" className="rounded-lg border border-border border-l-[3px] border-l-[var(--error)] bg-[var(--error-surface)] px-4 py-2.5 text-sm text-[var(--error-ink)]">
          {error}{" "}
          <button type="button" className="font-semibold underline underline-offset-2" onClick={refresh}>Try again</button>
        </div>
      )}

      {/* The views on the left; booking — the page's one action — on the right. */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <ViewTabs
          label="View"
          value={view}
          controls="calendar-panel"
          onChange={(next) => { setView(next); setListPage(1); }}
          tabs={[
            { key: "week", label: "Week" },
            { key: "day", label: "Day" },
            { key: "list", label: "List", count: listRows.length },
          ]}
        />
        <Button type="button" disabled={!context} onClick={() => setBooking({ agentUserId: selected, startIso: null })}>
          <Plus aria-hidden="true" />
          Book an appointment
        </Button>
      </div>

      <TableCard
        className={FILL}
        toolbar={
          <DataToolbar
            actions={<>
              {filtered && <ClearFiltersButton onClick={clearFilters} />}
              <RefreshButton onClick={refresh} refreshing={loading} />
            </>}
          >
            <ToolbarSearch value={search} onChange={(value) => { setSearch(value); setListPage(1); }} placeholder="Search by customer" />
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
            {/* Back to today (the header's old "Day" button): today's day, or the week around it. */}
            <Button type="button" variant="outline" onClick={() => { setAnchor(nowMs()); setListPage(1); }}>Today</Button>
            <select aria-label="Calendar of" value={agentId} onChange={(event) => { setAgentId(event.target.value); setListPage(1); }} className={toolbarControl}>
              <option value="">{me && agents.some(([id]) => id === me) ? "My calendar" : "First with hours"}</option>
              {agents.map(([id, name]) => <option key={id} value={id}>{name}{id === me ? " (you)" : ""}</option>)}
            </select>
            <select aria-label="Status" value={status} onChange={(event) => { setStatus(event.target.value); setListPage(1); }} className={toolbarControl}>
              <option value="">Every status</option>
              {Object.entries(STATUS_LABEL).map(([key, label]) => <option key={key} value={key}>{label}</option>)}
            </select>
          </DataToolbar>
        }
        footer={view === "list"
          ? <Pager page={listCurrent} total={listRows.length} pageSize={pageSize} noun={listRows.length === 1 ? "appointment" : "appointments"} suffix={`this ${range ? "week" : "range"} · times in ${zone}`} onPage={setListPage} />
          : <span>Times in {zone}{context && !noHours ? ` · ${agentName}` : ""}</span>}
      >
        {/* The views fade in on switch, like every tab panel (2026-10-09). */}
        <div key={view} id="calendar-panel" role="tabpanel" aria-labelledby={`calendar-panel-tab-${view}`}>
        {view !== "list" && (
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
                <span />
                {days.map((day) => {
                  const isToday = Boolean(today && sameDay(day, today));
                  const isPast = Boolean(today && !isToday && dateKey(day) < dateKey(today));
                  return (
                    <span key={dateKey(day)} className={`flex items-center gap-2 pb-1 text-xs font-semibold uppercase leading-[1.33] tracking-[0.02em] ${isToday ? "text-[var(--accent-ink)]" : isPast ? "text-muted-foreground opacity-70" : "text-foreground"}`}>
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
                          <Link href={`/app/leads/${item.leadId}`} className={`block rounded-lg ${item.appointmentId === highlightId ? "ring-2 ring-[var(--ring)]" : ""}`}>
                            <Slot title={shortName(item.customerName)} sub={[purpose, theirs].filter(Boolean).join(" · ") || STATUS_LABEL[item.status]} tone={TONE[item.status] ?? TONE.booked}>
                              {visible.length > 1 && <span className="text-xs font-semibold text-[var(--accent-ink)]">+{visible.length - 1} more</span>}
                            </Slot>
                          </Link>
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

      {booking && context && (
        <BookingDialog
          context={context}
          initial={booking}
          agents={agents}
          nowAt={now ?? 0}
          onClose={() => setBooking(null)}
          onBooked={() => { setBooking(null); void loadContext().catch(() => {}); void load(); }}
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
function BookingDialog({ context, initial, agents, nowAt, onClose, onBooked }: {
  context: Context;
  initial: { agentUserId: string; startIso: string | null };
  agents: [string, string][];
  nowAt: number;
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
    const offered = openSlots(context, agent, nowAt, { days: 21, limit: 60 });
    return initial.startIso && agent === initial.agentUserId && !offered.includes(initial.startIso) ? [initial.startIso, ...offered] : offered;
  }, [context, agent, nowAt, initial]);

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
