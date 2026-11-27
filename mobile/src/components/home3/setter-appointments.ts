import { clock, dayKey, weekday, zoneShort } from "@/components/calls/time";
import type { CalendarAppointment } from "@/components/calendar/month";
import type { Tone } from "@/theme/tokens";

/**
 * Board B3 · "Appointments you set": the appointments this setter booked, from GET /api/app/calendar
 * (lib/appointments/calendar.ts; a setter sees their own bookings in full, anyone else's redacted).
 * Upcoming ones first, soonest first, chip "Scheduled"; then ones already closed out, latest first,
 * "Showed" or "No-show". Pure, so it is tested.
 */
export type SetterAppointment = { id: string; leadId: string; startsAtUtc: string; title: string; meta: string; chip: { tone: Tone; label: string }; upcoming: boolean };

/** The calendar window the home reads: the past week (closed-out ones) and the next two weeks. */
export function setterRange(now: number): { from: string; to: string } {
  return { from: new Date(now - 7 * 86_400_000).toISOString(), to: new Date(now + 14 * 86_400_000).toISOString() };
}

const SCHEDULED = new Set(["booked", "confirmed", "pending"]);

/** "With Ava Kim · Thu 2:00 pm ET" (upcoming, in the customer's zone); "With Marcus Ortiz · Tue 11:00 am" (past). */
function when(a: CalendarAppointment, upcoming: boolean): string {
  const at = new Date(a.startsAtUtc);
  const zone = a.customerTimezone || "UTC";
  const day = weekday(dayKey(at, zone));
  return `With ${a.agentName} · ${day} ${clock(at, zone)}${upcoming ? ` ${zoneShort(zone, at)}` : ""}`;
}

export function setterAppointments(rows: CalendarAppointment[], viewerId: string | null | undefined, now: number, limit = 5): SetterAppointment[] {
  if (!viewerId) return [];
  const mine = rows.filter((a) => a.bookedByUserId === viewerId && !a.redacted);
  const upcoming = mine
    .filter((a) => SCHEDULED.has(a.status) && Date.parse(a.startsAtUtc) + (a.durationMinutes || 0) * 60_000 > now)
    .sort((x, y) => Date.parse(x.startsAtUtc) - Date.parse(y.startsAtUtc));
  const closed = mine
    .filter((a) => (a.status === "showed" || a.status === "no_show") && Date.parse(a.startsAtUtc) <= now)
    .sort((x, y) => Date.parse(y.startsAtUtc) - Date.parse(x.startsAtUtc));
  const row = (a: CalendarAppointment, isUpcoming: boolean): SetterAppointment => ({
    id: a.appointmentId,
    leadId: a.leadId,
    startsAtUtc: a.startsAtUtc,
    title: a.customerName,
    meta: when(a, isUpcoming),
    chip: isUpcoming ? { tone: "info", label: "Scheduled" } : a.status === "showed" ? { tone: "ok", label: "Showed" } : { tone: "warn", label: "No-show" },
    upcoming: isUpcoming,
  });
  return [...upcoming.map((a) => row(a, true)), ...closed.map((a) => row(a, false))].slice(0, limit);
}
