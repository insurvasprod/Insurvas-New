import type { BlockRepeat, Span } from "@/lib/appointments/calendarMath";

const minutesOf = (hhmm: string) => { const m = /^(\d{1,2}):(\d{2})/.exec(hhmm); return m ? Number(m[1]) * 60 + Number(m[2]) : 0; };
/** The working spans of one weekday as [start, end) minutes — calendarMath.intervalsFor, kept local so this stays importable by node:test. */
function intervalsFor(hours: Span[], weekday: number): Array<[number, number]> {
  return hours.filter((span) => span.weekday === weekday).map((span) => [minutesOf(span.startTime), minutesOf(span.endTime)] as [number, number]).filter(([a, b]) => b > a).sort((a, b) => a[0] - b[0]);
}

/**
 * Appointments & setters (p-app-setters): one agent's day as the board lists it — each slot of
 * their working hours as Open, Booked, Blocked or on their linked calendar, a Buffer row after each
 * appointment, and Past for a slot already gone. Pure and client-safe; the page reads the facts.
 *
 * Minutes are the agent's own local minutes of the day (0-1439). The same stepping as openSlots:
 * appointment length plus buffer, from the start of each working span.
 */
export type DayRowKind = "booked" | "open" | "blocked" | "busy" | "buffer" | "past";

/**
 * LA-2 §11 concept: what a booked row says beside the name — its status, the customer's own clock, a
 * countdown, the setter's note, product and face amount, whether the reminder went, and what can be
 * done about a no-show. Built by the page's reader; dayView only carries it to the row.
 */
export type AppointmentDetail = {
  appointmentId: string;
  leadId: string;
  agentUserId: string;
  customerName: string;
  status: string;
  customerTime: string | null;
  startsIn: string | null;
  note: string | null;
  product: string | null;
  face: string | null;
  reminderSent: boolean;
  /** A no-show with no live rebooking. */
  rebookable: boolean;
  /** A no-show already rebooked. */
  rebooked: boolean;
  /** For a no-show: whether the customer's calling window is open now (null when it could not be read). */
  callable: boolean | null;
};

export type DayRow = { minute: number; kind: DayRowKind; label: string; setter: string | null; appointmentId?: string; detail?: AppointmentDetail };

export type DayAppointment = { id: string; minute: number; duration: number; label: string; setter: string | null; detail?: AppointmentDetail };

export type DayBlock = { from: number; to: number; reason: string | null };

export function dayView(input: {
  hours: Span[];
  weekday: number;
  length: number;
  buffer: number;
  blocks: DayBlock[];
  busy: Array<{ from: number; to: number }>;
  appointments: DayAppointment[];
  /** Minutes into today now, or null when the day shown is not today. */
  nowMinute: number | null;
}): DayRow[] {
  const rows: DayRow[] = [];
  const overlaps = (a: number, b: number, c: number, d: number) => a < d && c < b;
  const taken = input.appointments.map((item) => [item.minute, item.minute + item.duration + input.buffer] as const);

  for (const [open, close] of intervalsFor(input.hours, input.weekday)) {
    for (let minute = open; minute + input.length <= close; minute += input.length + input.buffer) {
      const end = minute + input.length;
      if (taken.some(([from, to]) => overlaps(minute, end, from, to))) continue;
      const block = input.blocks.find((item) => overlaps(minute, end, item.from, item.to));
      if (block) { rows.push({ minute, kind: "blocked", label: block.reason ? `Blocked — ${block.reason}` : "Blocked", setter: null }); continue; }
      if (input.busy.some((item) => overlaps(minute, end, item.from, item.to))) { rows.push({ minute, kind: "busy", label: "On your linked calendar", setter: null }); continue; }
      if (input.nowMinute !== null && minute < input.nowMinute) { rows.push({ minute, kind: "past", label: "Past", setter: null }); continue; }
      rows.push({ minute, kind: "open", label: "Open", setter: null });
    }
  }
  for (const item of input.appointments) {
    rows.push({ minute: item.minute, kind: "booked", label: item.label, setter: item.setter, appointmentId: item.id, ...(item.detail ? { detail: item.detail } : {}) });
    if (input.buffer > 0) rows.push({ minute: item.minute + item.duration, kind: "buffer", label: `Buffer — ${input.buffer} min after every appointment`, setter: null });
  }
  // Only the first buffer row carries the explanation; the rest just say Buffer, as the board does.
  let explained = false;
  return rows
    .sort((a, b) => a.minute - b.minute || (a.kind === "buffer" ? 1 : 0) - (b.kind === "buffer" ? 1 : 0))
    .map((row) => {
      if (row.kind !== "buffer") return row;
      if (explained) return { ...row, label: "Buffer" };
      explained = true;
      return row;
    });
}

/** Whether a repeating block recurs on a weekday (none = one-off, handled by date). */
export function repeatsOn(repeats: BlockRepeat, firstWeekday: number, weekday: number): boolean {
  if (repeats === "daily") return true;
  if (repeats === "weekdays") return weekday >= 1 && weekday <= 5;
  if (repeats === "weekly") return weekday === firstWeekday;
  return false;
}

/**
 * The board's verdict on a setter: "Solid" or "Booking noise". Booking noise is appointments that
 * do not turn up — a setter paid per booking can book people who never meant to take the call.
 * Judged only on enough closed-out appointments to mean something, and never on pending ones.
 */
export const VERDICT_MIN_CLOSED = 10;
export const NOISE_BELOW_PCT = 50;
export const SOLID_FROM_PCT = 70;

export type SetterVerdict = "solid" | "noise" | "watch" | "too_few";

export function setterVerdict(showed: number, noShow: number): SetterVerdict {
  const closed = showed + noShow;
  if (closed < VERDICT_MIN_CLOSED) return "too_few";
  const rate = (showed / closed) * 100;
  if (rate < NOISE_BELOW_PCT) return "noise";
  if (rate >= SOLID_FROM_PCT) return "solid";
  return "watch";
}

export const VERDICT_LABEL: Record<SetterVerdict, string> = { solid: "Solid", noise: "Booking noise", watch: "Watch", too_few: "Too few to judge" };
