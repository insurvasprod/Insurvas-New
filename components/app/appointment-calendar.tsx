"use client";

import { useCallback, useEffect, useMemo, useState, type ReactNode } from "react";
import Link from "next/link";
import { ChevronDown, Search, SlidersHorizontal } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { PageHeader } from "@/components/ui/page-header";
import { StatTile } from "@/components/ui/stat";
import { TableCard } from "@/components/ui/table-card";
import { RebookButton } from "@/components/app/appointment-rebook";
import { faceLabel } from "@/lib/appointments/appointmentFacts";
import { clockLabel, intervalsFor, openSlots, wallClock, zonedInstant, type BlockRepeat, type PickerContext } from "@/lib/appointments/calendarMath";

/**
 * LA-2.11's calendar, as the board draws it: the diary as a grid of slots, not a list of bookings.
 *
 * Every cell comes from availability — working hours, minus blocked time, minus what is booked — so
 * a Free cell is a slot the calendar actually offers, and pressing it opens the booking form on that
 * slot. The picker is a convenience: `book_appointment` still refuses anything wrong, and says why.
 *
 * Two clocks, always. The grid runs on the diary owner's time; a card whose customer lives in another
 * zone also says what time it is for them, because one of the two is the one somebody is late for.
 */

type Appointment = {
  appointmentId: string; leadId: string; customerName: string;
  agentUserId: string; agentName: string; startsAtUtc: string; durationMinutes: number;
  customerTimezone: string; status: string; notes: string | null; bookedByName: string | null;
  // LA-2 §11 concept (lib/appointments/calendar.ts): from the lead, and the reminder / rebook state.
  product?: string | null; faceAmountCents?: number | null; reminderSentAt?: string | null; rebookedAs?: string | null;
};
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
  booked: "bg-[var(--soft-orange-surface)] border-l-[var(--primary)]",
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

export function AppointmentCalendar({ highlightId, eyebrow }: { highlightId?: string; eyebrow?: string }) {
  const [view, setView] = useState<View>("week");
  const [anchor, setAnchor] = useState<number | null>(null);
  const [now, setNow] = useState<number | null>(null);
  const [context, setContext] = useState<Context | null>(null);
  const [me, setMe] = useState<string | null>(null);
  const [agentId, setAgentId] = useState<string>("");
  const [status, setStatus] = useState("");
  const [search, setSearch] = useState("");
  const [showFilters, setShowFilters] = useState(false);
  const [appointments, setAppointments] = useState<Appointment[]>([]);
  const [lastWeek, setLastWeek] = useState<Appointment[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [booking, setBooking] = useState<{ agentUserId: string; startIso: string | null } | null>(null);

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

  const load = useCallback(async () => {
    if (!range) return;
    setLoading(true);
    const get = async (from: number, to: number) => {
      const response = await fetch(`/api/app/calendar?from=${encodeURIComponent(new Date(from).toISOString())}&to=${encodeURIComponent(new Date(to).toISOString())}`, { cache: "no-store" });
      const body = await response.json().catch(() => null);
      if (!response.ok) throw new Error(body?.error ?? "Could not load the calendar");
      return (body?.appointments ?? []) as Appointment[];
    };
    try {
      const [current, previous] = await Promise.all([get(range.from, range.to), get(range.lastFrom, range.lastTo)]);
      setAppointments(current);
      setLastWeek(previous);
      setError("");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not load the calendar");
    } finally {
      setLoading(false);
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
  const activeFilters = (agentId ? 1 : 0) + (status ? 1 : 0);
  const rangeLabel = range
    ? view === "day"
      ? `${WEEKDAY_LONG[range.first.weekday]} ${range.first.day} ${MONTH_LONG[range.first.month - 1]}`
      : `Week of ${range.first.day} ${MONTH_LONG[range.first.month - 1]}`
    : "…";
  // "Not loaded yet" and "no hours set" are different answers; only a loaded context can say the second.
  const hasHours = Boolean(context?.availability.some((row) => row.userId === selected));
  const noHours = context != null && !hasHours;
  const agentName = agents.find(([id]) => id === selected)?.[1] ?? "this person";

  return (
    <div className="m-stagger flex flex-col gap-6">
      <PageHeader
        eyebrow={eyebrow}
        title="Calendar"
        description="The appointments booked onto your calendar, by day or by week, each in the customer’s own local time."
        actions={
          <>
            <Button type="button" variant="outline" className="h-11 border-[var(--border-strong)] px-4" onClick={() => { setView("day"); setAnchor(nowMs()); }}>Day</Button>
            <Button type="button" className="h-11 px-4" disabled={!context} onClick={() => setBooking({ agentUserId: selected, startIso: null })}>Book an appointment</Button>
          </>
        }
      />

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <StatTile label="This week" value={loading ? "…" : weekLive.length} footnote={noHours ? "no working hours set" : context ? `of ${slotTotal} slots` : "…"} />
        <StatTile label="Today" value={loading ? "…" : todays.length} footnote={next ? `next at ${clockLabel(wallClock(next.startsAtUtc, zone).minutes)}` : "nothing left today"} />
        <StatTile label="Showed last week" value={showRate == null ? "—" : showRate} unit={showRate == null ? undefined : "%"} valueTone={showRate == null ? undefined : showRate >= 70 ? "good" : "warning"} footnote={settled.length ? `${showed} of ${settled.length}` : "nothing settled last week"} />
        <StatTile label="No-shows" value={loading ? "…" : noShows} valueTone={noShows > 0 ? "warning" : undefined} footnote="last week" />
      </div>

      {/* The shared control bar, drawn with its own values rather than the callbacks page's class,
          whose label rule would uppercase the week picker and the search field. */}
      <div className="portal-calendar-filters flex flex-wrap items-center gap-2.5 rounded-lg border border-border bg-card px-3 py-2.5 shadow-[0_1px_2px_rgba(16,20,26,.05)]">
        <label className="relative inline-flex items-center">
          <span className="inline-flex h-[2.125rem] items-center gap-2 rounded-lg border border-[var(--border-strong)] bg-card px-3.5 text-sm font-semibold text-foreground">
            {rangeLabel}<ChevronDown className="size-4 text-muted-foreground" aria-hidden="true" />
          </span>
          {/* The native picker sits over the button, so the whole label opens it. */}
          <input
            type="date"
            aria-label={view === "day" ? "Choose a day" : "Choose a week"}
            className="absolute inset-0 cursor-pointer opacity-0"
            onChange={(event) => { if (event.target.value) setAnchor(new Date(`${event.target.value}T12:00:00`).getTime()); }}
          />
        </label>
        <label className="relative flex w-full items-center sm:w-[248px]">
          <Search className="pointer-events-none absolute left-3 size-4 text-muted-foreground" aria-hidden="true" />
          <input type="search" aria-label="Search by customer" placeholder="Search by customer" value={search} onChange={(event) => setSearch(event.target.value)} className="h-[2.125rem] w-full rounded-lg text-sm border border-[var(--border-strong)] bg-card pl-9 pr-3 text-foreground placeholder:text-muted-foreground" />
        </label>
        <Button type="button" variant="outline" aria-expanded={showFilters} onClick={() => setShowFilters((open) => !open)} className="h-[2.125rem] border-[var(--border-strong)] px-3.5">
          <SlidersHorizontal aria-hidden="true" />Filters
          {activeFilters > 0 && <span className="inline-flex h-5 min-w-5 items-center justify-center rounded-full bg-[var(--surface-alt)] px-1.5 text-xs font-semibold">{activeFilters}</span>}
        </Button>
        <span className="flex-1" />
        <span role="group" aria-label="View" className="inline-flex gap-[3px] rounded-lg bg-[var(--surface-alt)] p-[3px]">
          {([["week", "Week"], ["day", "Day"], ["list", "List"]] as const).map(([key, label]) => (
            <button key={key} type="button" aria-pressed={view === key} onClick={() => setView(key)} className={`!h-8 !min-h-8 rounded-lg px-3.5 text-sm font-semibold ${view === key ? "bg-card text-foreground shadow-[0_1px_2px_rgba(16,20,26,.08)]" : "bg-transparent text-muted-foreground"}`}>{label}</button>
          ))}
        </span>
        <span className="text-sm text-muted-foreground">{zone}</span>
      </div>

      {showFilters && (
        <div className="grid gap-3 rounded-lg border border-border bg-card p-4 sm:grid-cols-2 lg:grid-cols-4">
          <label className="text-xs font-semibold uppercase leading-[1.33] tracking-[0.02em] text-muted-foreground">
            Calendar of
            <select value={agentId} onChange={(event) => setAgentId(event.target.value)} className="mt-1.5 block h-10 w-full rounded-lg border border-[var(--border-strong)] bg-card px-3 text-sm font-normal normal-case tracking-normal text-foreground">
              <option value="">{me && agents.some(([id]) => id === me) ? "Me" : "First with hours"}</option>
              {agents.map(([id, name]) => <option key={id} value={id}>{name}{id === me ? " (you)" : ""}</option>)}
            </select>
          </label>
          <label className="text-xs font-semibold uppercase leading-[1.33] tracking-[0.02em] text-muted-foreground">
            Status
            <select value={status} onChange={(event) => setStatus(event.target.value)} className="mt-1.5 block h-10 w-full rounded-lg border border-[var(--border-strong)] bg-card px-3 text-sm font-normal normal-case tracking-normal text-foreground">
              <option value="">Every status</option>
              {Object.entries(STATUS_LABEL).map(([key, label]) => <option key={key} value={key}>{label}</option>)}
            </select>
          </label>
        </div>
      )}

      {error && (
        <div role="alert" className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-[color-mix(in_srgb,var(--error)_24%,transparent)] bg-[var(--error-surface)] px-4 py-3 text-sm text-[var(--error-ink)]">
          {error}
          <Button type="button" variant="outline" size="sm" onClick={() => { void load(); }}>Try again</Button>
        </div>
      )}

      {view !== "list" && (
        <div className="overflow-x-auto rounded-lg border border-border bg-card p-5">
          {context == null ? (
            <p className="py-8 text-center text-sm text-muted-foreground" role="status">{error ? "Availability could not be loaded." : "Loading availability…"}</p>
          ) : noHours ? (
            <p className="py-8 text-center text-sm text-muted-foreground">
              No working hours are set for {agentName}, so there are no slots to show.{" "}
              <Link href="/app/settings#calendar" className="font-semibold text-foreground underline underline-offset-2">Set them under Settings → Calendar &amp; availability</Link>.
            </p>
          ) : (
            <div className="grid min-w-[720px] gap-2" style={{ gridTemplateColumns: `78px repeat(${days.length}, minmax(0, 1fr))` }}>
              <span />
              {days.map((day) => {
                const isToday = Boolean(today && sameDay(day, today));
                const isPast = Boolean(today && !isToday && dateKey(day) < dateKey(today));
                return (
                  <span key={dateKey(day)} className={`flex items-center gap-2 pb-1 text-xs font-semibold uppercase leading-[1.33] tracking-[0.02em] ${isToday ? "text-[var(--accent-ink)]" : isPast ? "text-muted-foreground opacity-70" : "text-foreground"}`}>
                    {WEEKDAY[day.weekday]} {day.day}
                    {isToday && <span className="rounded-full bg-[var(--soft-orange-surface)] px-2 py-px text-xs font-semibold normal-case tracking-normal text-[var(--accent-ink)]">Today</span>}
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
                          <span className={`flex min-h-[52px] items-center rounded-lg border border-dashed px-2.5 py-2 text-sm leading-normal transition-colors group-hover:border-solid group-hover:border-[var(--primary)] group-hover:bg-[var(--soft-orange-surface)] ${isNext ? "border-[var(--primary)] font-semibold text-[var(--accent-ink)]" : "border-[var(--border-strong)] text-muted-foreground"}`}>
                            <span className="group-hover:hidden">{isNext ? "Next free" : "Free"}</span>
                            <span className="hidden font-semibold text-[var(--accent-ink)] group-hover:inline">+ Book</span>
                          </span>
                        </button>
                      );
                    }
                    const visible = cell.items.filter(matches);
                    if (visible.length === 0) return <Slot key={index} title={<span className="text-muted-foreground">Booked</span>} tone="bg-card border border-border border-l-[3px] border-l-[var(--border-strong)]" />;
                    const item = visible[0];
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
        <TableCard footer={<span>{listRows.length} appointment{listRows.length === 1 ? "" : "s"} in this {range ? "week" : "range"} · times in {zone}</span>}>
          <table className="portal-callback-table w-full min-w-[860px] text-left text-sm">
            <thead><tr><th className="w-[150px]">When</th><th>Customer</th><th className="w-[170px]">Their time</th><th className="w-[140px]">Agent</th><th className="w-[120px]">Status</th><th>Notes</th></tr></thead>
            <tbody>
              {listRows.map((item) => {
                const clock = wallClock(item.startsAtUtc, zone);
                return (
                  <tr key={item.appointmentId} className={item.appointmentId === highlightId ? "bg-[var(--soft-orange-surface)]" : ""}>
                    <td className="whitespace-nowrap tabular-nums">{WEEKDAY[clock.weekday]} {clock.day} · {clockLabel(clock.minutes)}</td>
                    <td>
                      <Link href={`/app/leads/${item.leadId}`} className="font-semibold text-foreground hover:underline">{item.customerName}</Link>
                      {(item.product || item.faceAmountCents) && <span className="block text-xs text-muted-foreground">{[item.product, faceLabel(item.faceAmountCents ?? null)].filter(Boolean).join(" · ")}</span>}
                    </td>
                    <td className="whitespace-nowrap tabular-nums">{theirTime(item.startsAtUtc, item.customerTimezone, zone)?.replace("their time ", "") ?? "Same as yours"}</td>
                    <td>{item.agentName}</td>
                    <td>
                      {STATUS_LABEL[item.status] ?? item.status}
                      {item.reminderSentAt && (item.status === "booked" || item.status === "confirmed") && <span className="block text-xs text-muted-foreground">Reminder sent</span>}
                      {item.status === "no_show" && (
                        <span className="mt-1 flex flex-wrap items-center gap-2">
                          {/* Decided 2026-09-25: the dialer opens on this lead and checks the calling window when it dials. */}
                          <Button asChild size="sm"><Link href={`/app/dialer?lead=${item.leadId}`}>Call now</Link></Button>
                          {item.rebookedAs
                            ? <span className="text-xs text-muted-foreground">Rebooked</span>
                            : <RebookButton appointmentId={item.appointmentId} agentUserId={item.agentUserId} customerName={item.customerName} onRebooked={() => { void load(); }} />}
                        </span>
                      )}
                    </td>
                    <td className="max-w-[260px] truncate text-muted-foreground" title={item.notes ?? undefined}>{item.notes ?? "—"}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          {!loading && listRows.length === 0 && <p className="px-4 py-8 text-center text-sm text-muted-foreground">Nothing booked in this week{needle || status ? " matches" : ""}.</p>}
        </TableCard>
      )}

      <div className="grid gap-5 md:grid-cols-2">
        <div className="rounded-lg border border-border border-l-[3px] border-l-[var(--info)] bg-[var(--info-surface)] px-4 py-3.5 text-sm leading-normal tracking-[-0.02em]">
          <p className="font-semibold text-[var(--info-ink)]">Every slot here came from availability, not from typing</p>
          <p className="mt-1.5 text-[var(--body)]">The grid is availability minus blocked time minus what is already booked. An appointment cannot be created in a slot the calendar did not offer, which is why double-booking is a setting rather than an accident.</p>
        </div>
        <div className="rounded-lg border border-border border-l-[3px] border-l-[var(--success)] bg-[var(--success-surface)] px-4 py-3.5 text-sm leading-normal tracking-[-0.02em]">
          <p className="font-semibold text-[var(--success-ink)]">Two clocks, always</p>
          <p className="mt-1.5 text-[var(--body)]">A row shows your time; the appointment carries the customer’s. When they live in another zone the card says what time it is for them too, so neither of you has to do the arithmetic.</p>
        </div>
      </div>

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
    if (!response) { setError("Could not reach Insurvas. Check your connection and try again."); return; }
    const body = await response.json().catch(() => null);
    if (!response.ok) { setError(body?.error ?? "That slot could not be booked"); return; }
    onBooked();
  }

  const field = "mt-1.5 block h-10 w-full rounded-lg border border-[var(--border-strong)] bg-card px-3 text-sm font-normal normal-case tracking-normal text-foreground";
  const labelClass = "block text-xs font-semibold uppercase leading-[1.33] tracking-[0.02em] text-muted-foreground";

  return (
    <Dialog open onOpenChange={(open) => { if (!open) onClose(); }}>
      <DialogContent className="sm:max-w-[520px]">
        <DialogHeader>
          <DialogTitle>Book an appointment</DialogTitle>
          <DialogDescription>Only slots the calendar offers are listed. Times are in {zone}.</DialogDescription>
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
                {query.trim().length >= 2 && hits.length === 0 && <p className="mt-1 text-xs normal-case tracking-normal text-muted-foreground">No lead you can open matches that.</p>}
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
