/**
 * The booking picker's proposals (board C8b), ported line for line from the web's
 * lib/appointments/calendarMath.ts `openSlots`, so the phone proposes exactly the times the web
 * dialer does. `book_appointment` is the authority: a proposal is never a promise, and every refusal
 * (the customer's legal window, the agency-wide cap, a slot taken meanwhile) comes back from the server.
 */
export type BlockRepeat = "none" | "daily" | "weekdays" | "weekly" | "yearly";

export type BookableContext = {
  agents: { userId: string; name: string; timezone: string | null }[];
  availability: { userId: string; weekday: number; startTime: string; endTime: string; timezone: string }[];
  blocks: { userId: string; startsAt: string; endsAt: string; reason?: string | null; repeats?: BlockRepeat }[];
  policy: { userId: string; appointmentMinutes: number | null; bufferMinutes: number | null; maxPerDay: number | null; allowSameDay?: boolean; allowDoubleBooking?: boolean }[];
  upcoming: { agentUserId: string; startsAtUtc: string; durationMinutes: number; status: string }[];
  busy?: { userId: string; startsAt: string; endsAt: string }[];
  /** Each bookable person's licensed states (2026-11-26; null when unreadable). */
  licensedStates?: Record<string, string[]> | null;
  /** With ?lead_id=, the lead's two-letter state (null when it has none). */
  leadState?: string | null;
};

/**
 * C8b's "With": the licensed producers who can take this customer — those licensed in the lead's
 * state. When the agency has recorded no licences at all, or the lead has no state, everyone the
 * server lists (the server decides who holds a calendar). `licensed` names the state for the line.
 */
export function bookableAgents<A extends { userId: string }>(agents: A[], licensed: Record<string, string[]> | null | undefined, state: string | null | undefined): { agents: A[]; licensedIn: string | null } {
  const code = (state ?? "").trim().toUpperCase();
  const anyRecorded = Boolean(licensed && Object.values(licensed).some((list) => list.length));
  if (!licensed || !anyRecorded || !/^[A-Z]{2}$/.test(code)) return { agents, licensedIn: null };
  return { agents: agents.filter((a) => (licensed[a.userId] ?? []).includes(code)), licensedIn: code };
}

/** `09:30` → 570. */
export function minutesOf(hhmm: string): number {
  const match = /^(\d{1,2}):(\d{2})/.exec(hhmm);
  return match ? Number(match[1]) * 60 + Number(match[2]) : 0;
}

/** The wall clock at an instant in a zone. Intl resolves DST for the instant. */
export function wallClock(iso: string, zone: string | null) {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat("en-US", { timeZone: zone || undefined, hour12: false, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", weekday: "short" })
      .formatToParts(new Date(iso))
      .map((part) => [part.type, part.value]),
  ) as Record<string, string>;
  const hour = Number(parts.hour) % 24;
  return {
    year: Number(parts.year),
    month: Number(parts.month),
    day: Number(parts.day),
    weekday: ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].indexOf(parts.weekday),
    minutes: hour * 60 + Number(parts.minute),
  };
}

/** The UTC instant of a wall-clock time in `zone`. Two passes settle a DST boundary. */
export function zonedInstant(year: number, month: number, day: number, minutes: number, zone: string): number {
  const naive = Date.UTC(year, month - 1, day, Math.floor(minutes / 60), minutes % 60);
  let guess = naive;
  for (let pass = 0; pass < 2; pass += 1) {
    const seen = wallClock(new Date(guess).toISOString(), zone);
    const seenUtc = Date.UTC(seen.year, seen.month - 1, seen.day, Math.floor(seen.minutes / 60), seen.minutes % 60);
    guess += naive - seenUtc;
  }
  return guess;
}

function intervalsFor(hours: { weekday: number; startTime: string; endTime: string }[], weekday: number): [number, number][] {
  return hours
    .filter((span) => span.weekday === weekday)
    .map((span) => [minutesOf(span.startTime), minutesOf(span.endTime)] as [number, number])
    .filter(([start, end]) => end > start)
    .sort((a, b) => a[0] - b[0]);
}

function recursOn(repeats: BlockRepeat, first: { year: number; month: number; day: number; weekday: number }, date: { year: number; month: number; day: number; weekday: number }): boolean {
  const key = (d: { year: number; month: number; day: number }) => d.year * 10000 + d.month * 100 + d.day;
  if (key(date) < key(first)) return false;
  if (repeats === "daily") return true;
  if (repeats === "weekdays") return date.weekday >= 1 && date.weekday <= 5;
  if (repeats === "weekly") return date.weekday === first.weekday;
  if (repeats === "yearly") return date.month === first.month && date.day === first.day;
  return false;
}

const overlaps = (aStart: number, aEnd: number, bStart: number, bEnd: number) => aStart < bEnd && bStart < aEnd;

/** Start instants (ISO) the agent can probably be booked at, soonest first. */
export function openSlots(context: BookableContext, userId: string, nowMs: number, options: { days?: number; limit?: number } = {}): string[] {
  const hours = context.availability.filter((row) => row.userId === userId);
  const zone = hours[0]?.timezone;
  if (!zone) return [];
  const policy = context.policy.find((row) => row.userId === userId);
  const length = policy?.appointmentMinutes ?? 30;
  const buffer = policy?.bufferMinutes ?? 0;
  const perDay = policy?.maxPerDay ?? null;
  const sameDay = policy?.allowSameDay !== false;
  const seats = policy?.allowDoubleBooking ? 2 : 1;
  const days = options.days ?? 7;
  const limit = options.limit ?? 12;

  const booked = context.upcoming
    .filter((row) => row.agentUserId === userId && (row.status === "booked" || row.status === "confirmed"))
    .map((row) => {
      const start = Date.parse(row.startsAtUtc);
      return { start, end: start + (row.durationMinutes + buffer) * 60_000, local: wallClock(row.startsAtUtc, zone) };
    })
    .filter((row) => Number.isFinite(row.start));
  const oneOff = context.blocks
    .filter((row) => row.userId === userId && (row.repeats ?? "none") === "none")
    .map((row) => ({ start: Date.parse(row.startsAt), end: Date.parse(row.endsAt) }));
  const repeating = context.blocks
    .filter((row) => row.userId === userId && (row.repeats ?? "none") !== "none")
    .map((row) => {
      const first = wallClock(row.startsAt, zone);
      return { repeats: row.repeats as BlockRepeat, first, minutes: first.minutes, duration: Math.max(0, (Date.parse(row.endsAt) - Date.parse(row.startsAt)) / 60_000) };
    });
  const busy = (context.busy ?? [])
    .filter((row) => row.userId === userId)
    .map((row) => ({ start: Date.parse(row.startsAt), end: Date.parse(row.endsAt) }));

  const today = wallClock(new Date(nowMs).toISOString(), zone);
  const found: string[] = [];
  for (let offset = 0; offset <= days && found.length < limit; offset += 1) {
    if (offset === 0 && !sameDay) continue;
    const date = wallClock(new Date(zonedInstant(today.year, today.month, today.day, 720, zone) + offset * 86_400_000).toISOString(), zone);
    const sameDate = (d: { year: number; month: number; day: number }) => d.year === date.year && d.month === date.month && d.day === date.day;
    if (perDay !== null && booked.filter((row) => sameDate(row.local)).length >= perDay) continue;

    const yesterday = wallClock(new Date(zonedInstant(date.year, date.month, date.day, 720, zone) - 86_400_000).toISOString(), zone);
    const blockedMinutes: [number, number][] = [];
    for (const block of repeating) {
      if (recursOn(block.repeats, block.first, date)) blockedMinutes.push([block.minutes, block.minutes + block.duration]);
      if (block.minutes + block.duration > 1440 && recursOn(block.repeats, block.first, yesterday)) blockedMinutes.push([0, block.minutes + block.duration - 1440]);
    }

    let dayCount = booked.filter((row) => sameDate(row.local)).length;
    for (const [open, close] of intervalsFor(hours, date.weekday)) {
      for (let minute = open; minute + length <= close && found.length < limit; minute += length + buffer) {
        if (perDay !== null && dayCount >= perDay) break;
        if (blockedMinutes.some(([from, to]) => overlaps(minute, minute + length, from, to))) continue;
        const start = zonedInstant(date.year, date.month, date.day, minute, zone);
        const end = start + length * 60_000;
        if (start <= nowMs) continue;
        if (oneOff.some((block) => overlaps(start, end, block.start, block.end))) continue;
        if (busy.some((block) => overlaps(start, end, block.start, block.end))) continue;
        if (booked.filter((row) => overlaps(start, end + buffer * 60_000, row.start, row.end)).length >= seats) continue;
        found.push(new Date(start).toISOString());
        dayCount += 1;
      }
    }
  }
  return found;
}

/** Whole hours between two zones at an instant: positive when `viewer` is ahead of `customer`. */
export function hoursAhead(customer: string, viewer: string, at: Date): number {
  const a = wallClock(at.toISOString(), customer);
  const b = wallClock(at.toISOString(), viewer);
  const ms = Date.UTC(b.year, b.month - 1, b.day, 0, b.minutes) - Date.UTC(a.year, a.month - 1, a.day, 0, a.minutes);
  return Math.round(ms / 3_600_000);
}
