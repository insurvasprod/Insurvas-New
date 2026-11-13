/**
 * Insurvas meetings in the agent's own Google Calendar (owner, 2026-11-13): the plain parts, with no
 * server imports, so they are unit-tested. The server half is lib/appointments/calendarMirror.ts.
 *
 * No column records which Google event belongs to which appointment. The event id IS the appointment:
 * Google lets the caller choose an id (base32hex: 0-9 and a-v, 5–1024 characters), and "insurvas" plus
 * the appointment's uuid without dashes is exactly that. So a booking, a move and a cancellation each
 * find the same event again, a retry never makes a second one, and our own events are told apart from
 * the agent's when busy time is read back (isOurEvent), so a meeting never blocks its own slot.
 */

export const GOOGLE_FREEBUSY_SCOPE = "https://www.googleapis.com/auth/calendar.freebusy";
export const GOOGLE_EVENTS_SCOPE = "https://www.googleapis.com/auth/calendar.events";
const FULL_CALENDAR_SCOPE = "https://www.googleapis.com/auth/calendar";

const EVENT_PREFIX = "insurvas";

/** A connection may write meetings only when the agent granted events (or the whole calendar). */
export function canWriteEvents(scopes: readonly string[] | null | undefined): boolean {
  return (scopes ?? []).some((scope) => scope === GOOGLE_EVENTS_SCOPE || scope === FULL_CALENDAR_SCOPE);
}

export function eventIdFor(appointmentId: string): string {
  const hex = appointmentId.toLowerCase().replace(/-/g, "");
  if (!/^[0-9a-f]{32}$/.test(hex)) throw new Error(`Not an appointment id: ${appointmentId}`);
  return `${EVENT_PREFIX}${hex}`;
}

export function isOurEvent(id: string | null | undefined): boolean {
  return typeof id === "string" && id.startsWith(EVENT_PREFIX);
}

/** The appointment an event of ours belongs to, or null for anybody else's event. */
export function appointmentIdOf(eventId: string | null | undefined): string | null {
  if (!isOurEvent(eventId)) return null;
  const hex = (eventId as string).slice(EVENT_PREFIX.length);
  if (!/^[0-9a-f]{32}$/.test(hex)) return null;
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

/**
 * The length the agent gave one of our meetings in Google (owner, 2026-11-13: "I changed it from 30
 * minutes to 1 hour"). Null when nothing should change: the event is gone, all-day, or moved to a
 * different start (a move is a reschedule, with every booking rule, so it is not taken from Google),
 * or its length is already what Insurvas has. Bounded like a booking, 5 minutes to 8 hours.
 */
export function lengthChange(
  event: { status?: string; start?: { dateTime?: string }; end?: { dateTime?: string } },
  appointment: { startsAtUtc: string; durationMinutes: number },
): number | null {
  if (event.status === "cancelled" || !event.start?.dateTime || !event.end?.dateTime) return null;
  const start = Date.parse(event.start.dateTime);
  const end = Date.parse(event.end.dateTime);
  if (!Number.isFinite(start) || !Number.isFinite(end) || start !== Date.parse(appointment.startsAtUtc)) return null;
  const minutes = Math.round((end - start) / 60_000);
  if (minutes < 5 || minutes > 480 || minutes === appointment.durationMinutes) return null;
  return minutes;
}

/**
 * What the agent's calendar should hold for an appointment in this status.
 *  - booked / confirmed: the meeting, at its current time.
 *  - cancelled / rescheduled: nothing. A move books a new appointment (rescheduled_from), whose own
 *    event takes the new time, so the old one goes.
 *  - pending / showed / no_show and anything newer: left as it is. The meeting happened (or was
 *    due), and the agent's calendar is a record of their day, not of how the call went.
 */
export type MirrorAction = "upsert" | "remove" | "keep";
export function mirrorAction(status: string): MirrorAction {
  if (status === "booked" || status === "confirmed") return "upsert";
  if (status === "cancelled" || status === "rescheduled") return "remove";
  return "keep";
}

export type MirroredAppointment = {
  appointmentId: string;
  leadId: string;
  customerName: string;
  startsAtUtc: string;
  endsAtUtc: string | null;
  durationMinutes: number;
  notes: string | null;
};

export function endOf(appointment: Pick<MirroredAppointment, "startsAtUtc" | "endsAtUtc" | "durationMinutes">): string {
  if (appointment.endsAtUtc) return new Date(appointment.endsAtUtc).toISOString();
  const minutes = appointment.durationMinutes > 0 ? appointment.durationMinutes : 30;
  return new Date(Date.parse(appointment.startsAtUtc) + minutes * 60_000).toISOString();
}

/** The Google event for one appointment. Name and a link back only: the lead stays in Insurvas. */
export function eventBody(appointment: MirroredAppointment, appUrl: string): Record<string, unknown> {
  const base = appUrl.replace(/\/+$/, "");
  const leadUrl = `${base}/app/leads/${appointment.leadId}`;
  const notes = appointment.notes?.trim();
  return {
    id: eventIdFor(appointment.appointmentId),
    status: "confirmed",
    summary: `Call with ${appointment.customerName}`,
    description: [`Booked in Insurvas. Open the lead: ${leadUrl}`, notes ? `\nNotes: ${notes}` : ""].join(""),
    start: { dateTime: new Date(appointment.startsAtUtc).toISOString(), timeZone: "UTC" },
    end: { dateTime: endOf(appointment), timeZone: "UTC" },
    source: { title: "Insurvas", url: leadUrl },
    extendedProperties: { private: { insurvasAppointmentId: appointment.appointmentId } },
  };
}

/** The lead's name from its stored values, as the close-out strip reads it. */
export function leadName(values: unknown): string {
  const record = (values && typeof values === "object" ? values : {}) as Record<string, unknown>;
  const text = (value: unknown) => (typeof value === "string" ? value.trim() : "");
  return text(record.full_name) || [text(record.first_name), text(record.last_name)].filter(Boolean).join(" ") || "a lead";
}

type GoogleEvent = {
  id?: string;
  status?: string;
  transparency?: string;
  start?: { dateTime?: string; date?: string };
  end?: { dateTime?: string; date?: string };
  attendees?: Array<{ self?: boolean; responseStatus?: string }>;
};

/**
 * Busy time from the agent's own events, the same as Google's free/busy would give, minus the
 * meetings Insurvas put there: those are already in Insurvas, and reading them back would make every
 * booked slot block itself (a move to an overlapping time would be refused).
 * All-day events count only when marked busy, from midnight to midnight in the calendar's zone.
 */
export function busyFromEvents(events: readonly GoogleEvent[], calendarZone: string): Array<{ startsAt: string; endsAt: string }> {
  const busy: Array<{ startsAt: string; endsAt: string }> = [];
  for (const event of events) {
    if (isOurEvent(event.id) || event.status === "cancelled" || event.transparency === "transparent") continue;
    if (event.attendees?.some((attendee) => attendee.self && attendee.responseStatus === "declined")) continue;
    if (event.start?.dateTime && event.end?.dateTime) {
      busy.push({ startsAt: new Date(event.start.dateTime).toISOString(), endsAt: new Date(event.end.dateTime).toISOString() });
    } else if (event.start?.date && event.end?.date) {
      busy.push({ startsAt: zonedMidnightUtc(event.start.date, calendarZone), endsAt: zonedMidnightUtc(event.end.date, calendarZone) });
    }
  }
  return busy;
}

/** Midnight of a calendar date in a time zone, as a UTC instant. */
export function zonedMidnightUtc(date: string, timeZone: string): string {
  const guess = Date.parse(`${date}T00:00:00Z`);
  const offset = (instant: number) => {
    try {
      const parts = new Intl.DateTimeFormat("en-US", { timeZone, hourCycle: "h23", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit" }).formatToParts(new Date(instant));
      const get = (type: string) => Number(parts.find((part) => part.type === type)?.value ?? 0);
      return Date.UTC(get("year"), get("month") - 1, get("day"), get("hour"), get("minute"), get("second")) - instant;
    } catch {
      return 0;
    }
  };
  // Two passes settle the offset either side of a daylight-saving change.
  let instant = guess - offset(guess);
  instant = guess - offset(instant);
  return new Date(instant).toISOString();
}
