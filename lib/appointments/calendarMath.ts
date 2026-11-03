/**
 * The arithmetic the Calendar & availability screen shows, kept pure and shared so the numbers on
 * screen are computed the way `book_appointment` enforces them.
 *
 *   - A slot is one appointment plus the buffer after it. The last appointment of a block does not
 *     need its buffer to fit inside the block (the buffer only keeps the NEXT one away), so a block
 *     of M minutes holds floor((M + buffer) / (length + buffer)) appointments.
 *   - A repeating block repeats its wall-clock time in the agent's own zone.
 *
 * No `server-only`: the client component imports this.
 */

export const BLOCK_REPEATS = ["none", "daily", "weekdays", "weekly", "yearly"] as const;
export type BlockRepeat = (typeof BLOCK_REPEATS)[number];

export const REPEAT_LABELS: Record<BlockRepeat, string> = {
  none: "Once",
  daily: "Every day",
  weekdays: "Every weekday",
  weekly: "Weekly",
  yearly: "Yearly",
};

export const WEEKDAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"] as const;

export type Span = { weekday: number; startTime: string; endTime: string };

/** `09:30` → 570. */
export function minutesOf(hhmm: string): number {
  const match = /^(\d{1,2}):(\d{2})/.exec(hhmm);
  return match ? Number(match[1]) * 60 + Number(match[2]) : 0;
}

/** How many appointments fit in `minutes` of working time. */
export function slotsInSpan(minutes: number, length: number, buffer: number): number {
  if (length <= 0 || minutes < length) return 0;
  return Math.floor((minutes + buffer) / (length + buffer));
}

function slotsIn(intervals: Array<[number, number]>, length: number, buffer: number): number {
  return intervals.reduce((total, [start, end]) => total + slotsInSpan(Math.max(0, end - start), length, buffer), 0);
}

/** Every working block on one weekday, as [start, end) minute pairs. */
export function intervalsFor(hours: Span[], weekday: number): Array<[number, number]> {
  return hours
    .filter((span) => span.weekday === weekday)
    .map((span) => [minutesOf(span.startTime), minutesOf(span.endTime)] as [number, number])
    .filter(([start, end]) => end > start)
    .sort((a, b) => a[0] - b[0]);
}

export function slotsForDay(hours: Span[], weekday: number, length: number, buffer: number): number {
  return slotsIn(intervalsFor(hours, weekday), length, buffer);
}

/** The agent's wall clock at an instant. Intl resolves DST for the instant, so no offset maths. */
export function wallClock(iso: string, zone: string | null) {
  const at = new Date(iso);
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat("en-US", {
      timeZone: zone || undefined,
      hour12: false,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      weekday: "short",
    })
      .formatToParts(at)
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

/** Which weekdays a repeating block lands on, or null for a block that is not weekly in shape. */
function weekdaysOf(repeats: BlockRepeat, baseWeekday: number): number[] | null {
  if (repeats === "daily") return [0, 1, 2, 3, 4, 5, 6];
  if (repeats === "weekdays") return [1, 2, 3, 4, 5];
  if (repeats === "weekly") return [baseWeekday];
  return null;
}

/**
 * Slots a repeating block removes from an ordinary week. Null for a one-off or yearly block, which
 * do not recur inside a week — the board's dash, and the honest answer.
 */
export function slotsLostPerWeek(
  block: { startsAt: string; endsAt: string; repeats: BlockRepeat },
  hours: Span[],
  zone: string | null,
  length: number,
  buffer: number,
): number | null {
  const start = wallClock(block.startsAt, zone);
  const days = weekdaysOf(block.repeats, start.weekday);
  if (!days) return null;
  const duration = Math.max(0, (Date.parse(block.endsAt) - Date.parse(block.startsAt)) / 60_000);
  const from = start.minutes;
  const to = Math.min(1440, from + duration);
  let lost = 0;
  for (const weekday of days) {
    const intervals = intervalsFor(hours, weekday);
    const before = slotsIn(intervals, length, buffer);
    const after = slotsIn(
      intervals.flatMap(([s, e]): Array<[number, number]> => {
        if (to <= s || from >= e) return [[s, e]];
        const pieces: Array<[number, number]> = [];
        if (from > s) pieces.push([s, from]);
        if (to < e) pieces.push([to, e]);
        return pieces;
      }),
      length,
      buffer,
    );
    lost += before - after;
  }
  return lost;
}

/** 570 → `9:30 am`. */
export function clockLabel(minutes: number, withMeridiem = true): string {
  const m = ((minutes % 1440) + 1440) % 1440;
  const hour = Math.floor(m / 60);
  const minute = m % 60;
  const h12 = hour % 12 === 0 ? 12 : hour % 12;
  const text = `${h12}:${String(minute).padStart(2, "0")}`;
  return withMeridiem ? `${text} ${hour < 12 ? "am" : "pm"}` : text;
}

/** `12:30 – 1:30 pm`, or `11:00 am – 1:00 pm` when the half of the day changes. */
export function clockRange(from: number, to: number): string {
  const sameHalf = (Math.floor((from % 1440) / 720) === Math.floor((to % 1440) / 720)) && to - from < 720;
  return `${clockLabel(from, !sameHalf)} – ${clockLabel(to)}`;
}

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/** The "When" column: written the way the block repeats, in the agent's own zone. */
export function blockWhen(block: { startsAt: string; endsAt: string; repeats: BlockRepeat }, zone: string | null): string {
  if (!block.startsAt || !block.endsAt || Number.isNaN(Date.parse(block.startsAt)) || Number.isNaN(Date.parse(block.endsAt)))
    return "Not set";
  const start = wallClock(block.startsAt, zone);
  const end = wallClock(block.endsAt, zone);
  const date = (part: { day: number; month: number }) => `${part.day} ${MONTHS[part.month - 1]}`;
  const sameDay = start.year === end.year && start.month === end.month && start.day === end.day;
  const allDay = start.minutes === 0 && end.minutes === 0 && !sameDay;

  if (block.repeats === "daily" || block.repeats === "weekdays") return clockRange(start.minutes, end.minutes || 1440);
  if (block.repeats === "weekly") return `${WEEKDAYS[start.weekday]} ${clockRange(start.minutes, end.minutes || 1440)}`;

  if (allDay) {
    // An all-day block ends at the midnight after its last day, so the last day is the one before.
    const last = wallClock(new Date(Date.parse(block.endsAt) - 60_000).toISOString(), zone);
    const lastIsFirst = last.day === start.day && last.month === start.month;
    if (lastIsFirst) return `${date(start)}, all day`;
    return last.month === start.month
      ? `${start.day} – ${last.day} ${MONTHS[start.month - 1]}, all day`
      : `${date(start)} – ${date(last)}, all day`;
  }
  if (sameDay) return `${date(start)}, ${clockRange(start.minutes, end.minutes)}`;
  return `${date(start)} ${clockLabel(start.minutes)} – ${date(end)} ${clockLabel(end.minutes)}`;
}

// ── the dialer's booking picker ─────────────────────────────────────────────────────────────────
//
// `book_appointment` is the authority; this only proposes times it is likely to accept, so a setter
// is not left guessing with a bare date field. It reads the same rules the function enforces —
// working hours, one-off AND repeating blocks, the same-day switch, the buffer, the agent's own
// appointments (a second seat when double-booking is allowed), linked-calendar busy time and the
// agent's per-day limit — from `bookableContext`. It cannot see the customer's legal window (that
// needs the state rules) or the agency-wide limit's live count, so those are still the server's
// to refuse. A proposal is never a promise.

export type PickerContext = {
  availability: Array<{ userId: string; weekday: number; startTime: string; endTime: string; timezone: string }>;
  blocks: Array<{ userId: string; startsAt: string; endsAt: string; repeats?: BlockRepeat }>;
  policy: Array<{
    userId: string;
    appointmentMinutes: number | null;
    bufferMinutes: number | null;
    maxPerDay: number | null;
    allowSameDay?: boolean;
    allowDoubleBooking?: boolean;
  }>;
  upcoming: Array<{ agentUserId: string; startsAtUtc: string; durationMinutes: number; status: string }>;
  busy?: Array<{ userId: string; startsAt: string; endsAt: string }>;
};

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

/** Whether a repeating block recurs on a local date. `first` is the block's own first local date. */
function recursOn(
  repeats: BlockRepeat,
  first: { year: number; month: number; day: number; weekday: number },
  date: { year: number; month: number; day: number; weekday: number },
): boolean {
  const key = (d: { year: number; month: number; day: number }) => d.year * 10000 + d.month * 100 + d.day;
  if (key(date) < key(first)) return false;
  if (repeats === "daily") return true;
  if (repeats === "weekdays") return date.weekday >= 1 && date.weekday <= 5;
  if (repeats === "weekly") return date.weekday === first.weekday;
  if (repeats === "yearly") return date.month === first.month && date.day === first.day;
  return false;
}

const overlaps = (aStart: number, aEnd: number, bStart: number, bEnd: number) => aStart < bEnd && bStart < aEnd;

/**
 * Start instants (ISO) the agent can probably be booked at, soonest first.
 * `days` counts the agent's local days from today; `limit` caps the list.
 */
export function openSlots(
  context: PickerContext,
  userId: string,
  nowMs: number,
  options: { days?: number; limit?: number } = {},
): string[] {
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
    // Noon on the local date avoids landing on the wrong day across a DST change.
    const date = wallClock(new Date(zonedInstant(today.year, today.month, today.day, 720, zone) + offset * 86_400_000).toISOString(), zone);
    const sameDate = (d: { year: number; month: number; day: number }) => d.year === date.year && d.month === date.month && d.day === date.day;
    if (perDay !== null && booked.filter((row) => sameDate(row.local)).length >= perDay) continue;

    // Repeating blocks as local minutes of this date, including one that spills over from yesterday.
    const yesterday = wallClock(new Date(zonedInstant(date.year, date.month, date.day, 720, zone) - 86_400_000).toISOString(), zone);
    const blockedMinutes: Array<[number, number]> = [];
    for (const block of repeating) {
      if (recursOn(block.repeats, block.first, date)) blockedMinutes.push([block.minutes, block.minutes + block.duration]);
      if (block.minutes + block.duration > 1440 && recursOn(block.repeats, block.first, yesterday))
        blockedMinutes.push([0, block.minutes + block.duration - 1440]);
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
