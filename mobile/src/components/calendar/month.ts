import { clock, dayKey, zoneShort } from "@/components/calls/time";
import type { CallbackView } from "@/lib/types";
import { zonedInstant } from "./slots";

/**
 * Board C13 · the Calendar: callbacks (GET /api/app/callbacks?from&to) and appointments
 * (GET /api/app/calendar?from&to, lib/appointments/calendar.ts) on one month, in the viewer's own days.
 * Gold dots are open bookings, orange is overdue (or waiting to be closed out), green is done.
 */
export type CalendarAppointment = {
  appointmentId: string; leadId: string; customerName: string; agentUserId: string; agentName: string;
  startsAtUtc: string; durationMinutes: number; customerTimezone: string; status: string; notes: string | null;
  bookedByUserId: string | null; bookedByName: string | null; product: string | null; redacted?: boolean;
  /** The booker's role in the agency ("setter"), beside their name (2026-11-26; absent from an older server). */
  bookedByRole?: string | null;
  /** The customer's address from the lead (lib/appointments/calendar.ts), for Directions; null when none. */
  customerAddress?: { street: string | null; city: string | null; state: string | null; zip: string | null } | null;
};

export type ItemTone = "open" | "late" | "done";
export type CalItem = {
  kind: "callback" | "appointment";
  id: string;
  at: Date;
  /** The viewer's day it falls on. */
  day: string;
  customerName: string;
  customerZone: string | null;
  tone: ItemTone;
  /** The one status chip a row may carry ("Overdue", "No-show", "Needs close-out"). */
  chip: string | null;
  callback?: CallbackView;
  appointment?: CalendarAppointment;
};

export type MonthCell = { key: string; num: number; inMonth: boolean };

const pad = (n: number) => String(n).padStart(2, "0");
const keyOf = (y: number, m: number, d: number) => `${y}-${pad(m)}-${pad(d)}`;

/** The month as whole weeks, Monday first (the board's M T W T F S S). */
export function monthGrid(year: number, month: number): MonthCell[] {
  const first = new Date(Date.UTC(year, month - 1, 1, 12));
  const lead = (first.getUTCDay() + 6) % 7;
  const days = new Date(Date.UTC(year, month, 0, 12)).getUTCDate();
  const total = Math.ceil((lead + days) / 7) * 7;
  const cells: MonthCell[] = [];
  for (let i = 0; i < total; i += 1) {
    const d = new Date(Date.UTC(year, month - 1, 1 - lead + i, 12));
    cells.push({ key: keyOf(d.getUTCFullYear(), d.getUTCMonth() + 1, d.getUTCDate()), num: d.getUTCDate(), inMonth: d.getUTCMonth() === month - 1 });
  }
  return cells;
}

/** The month's span in the viewer's zone, as the two ISO instants the APIs take (31 days at most). */
export function monthRange(year: number, month: number, zone: string): { from: string; to: string } {
  const next = month === 12 ? { y: year + 1, m: 1 } : { y: year, m: month + 1 };
  return { from: new Date(zonedInstant(year, month, 1, 0, zone)).toISOString(), to: new Date(zonedInstant(next.y, next.m, 1, 0, zone)).toISOString() };
}

export function monthTitle(year: number, month: number): string {
  return `${new Intl.DateTimeFormat("en-US", { timeZone: "UTC", month: "long" }).format(new Date(Date.UTC(year, month - 1, 1, 12)))} ${year}`;
}

/** "Tuesday 24 November". */
export function longDay(key: string): string {
  const d = new Date(`${key}T12:00:00Z`);
  const f = (o: Intl.DateTimeFormatOptions) => new Intl.DateTimeFormat("en-US", { timeZone: "UTC", ...o }).format(d);
  return `${f({ weekday: "long" })} ${d.getUTCDate()} ${f({ month: "long" })}`;
}

function callbackItem(cb: CallbackView, viewerZone: string): CalItem | null {
  if (cb.status === "cancelled") return null;
  const at = new Date(cb.scheduledAtUtc);
  if (!Number.isFinite(at.getTime())) return null;
  const done = cb.status === "completed";
  const late = !done && (cb.isOverdue || cb.status === "missed");
  return { kind: "callback", id: cb.id, at, day: dayKey(at, viewerZone), customerName: cb.customerName, customerZone: cb.customerTimezone, tone: done ? "done" : late ? "late" : "open", chip: late ? "Overdue" : null, callback: cb };
}

function appointmentItem(a: CalendarAppointment, viewerZone: string, now: number): CalItem | null {
  if (a.status === "cancelled" || a.status === "rescheduled") return null;
  const at = new Date(a.startsAtUtc);
  if (!Number.isFinite(at.getTime())) return null;
  const ended = at.getTime() + a.durationMinutes * 60_000 <= now;
  const open = a.status === "booked" || a.status === "confirmed";
  let tone: ItemTone = "open";
  let chip: string | null = null;
  if (a.status === "showed") tone = "done";
  else if (a.status === "no_show") { tone = "late"; chip = "No-show"; }
  else if (a.status === "pending" || (open && ended)) { tone = "late"; chip = "Needs close-out"; }
  return { kind: "appointment", id: a.appointmentId, at, day: dayKey(at, viewerZone), customerName: a.customerName, customerZone: a.customerTimezone || null, tone, chip, appointment: a };
}

/** Both lists as one, soonest first. Cancelled and moved ones are left off the calendar. */
export function calendarItems(callbacks: CallbackView[], appointments: CalendarAppointment[], viewerZone: string, now: number): CalItem[] {
  const items = [
    ...callbacks.map((cb) => callbackItem(cb, viewerZone)),
    ...appointments.map((a) => appointmentItem(a, viewerZone, now)),
  ].filter((x): x is CalItem => x !== null);
  return items.sort((a, b) => a.at.getTime() - b.at.getTime());
}

/** Up to three dots a day (.month i u), in time order. */
export function dotsByDay(items: CalItem[]): Map<string, ItemTone[]> {
  const out = new Map<string, ItemTone[]>();
  for (const it of items) {
    const list = out.get(it.day) ?? [];
    if (list.length < 3) list.push(it.tone);
    out.set(it.day, list);
  }
  return out;
}

/** "set by you", "set by Lena (setter)" — the booker's first name (or whole name) and role, when sent. */
export function setByWords(a: Pick<CalendarAppointment, "bookedByUserId" | "bookedByName" | "bookedByRole">, viewerId: string | null, first = false): string | null {
  if (!a.bookedByName) return null;
  if (a.bookedByUserId && a.bookedByUserId === viewerId) return "set by you";
  const name = first ? a.bookedByName.trim().split(/\s+/)[0] || a.bookedByName : a.bookedByName;
  return `set by ${name}${a.bookedByRole ? ` (${a.bookedByRole})` : ""}`;
}

/**
 * "Callback · their time 8:30 CT" — the customer's clock beside the row's own (the viewer's).
 * "Appointment · set by Lena (setter)" — whose diary when not the viewer's, and who booked it (board C13).
 */
export function itemMeta(it: CalItem, viewerZone: string, viewerId: string | null): string {
  const theirs = it.customerZone
    ? clock(it.at, it.customerZone) === clock(it.at, viewerZone) ? "same time for them" : `their time ${clock(it.at, it.customerZone, false)} ${zoneShort(it.customerZone, it.at)}`
    : null;
  if (it.kind === "callback") {
    const cb = it.callback;
    const other = cb?.assignedTo && viewerId && cb.assignedTo !== viewerId && cb.assigneeName ? `for ${cb.assigneeName}` : null;
    return ["Callback", theirs, other].filter(Boolean).join(" · ");
  }
  const a = it.appointment;
  const withWhom = a && viewerId && a.agentUserId !== viewerId ? `with ${a.agentName}` : null;
  const setBy = a ? setByWords(a, viewerId, true) : null;
  return ["Appointment", withWhom, setBy].filter(Boolean).join(" · ");
}
