/**
 * LA-2.10-1 · the dialer's callback quick options: later today, tomorrow morning, tomorrow afternoon,
 * next week. Each is a wall-clock time in the CUSTOMER's zone ("YYYY-MM-DDTHH:MM", the value the
 * datetime field and the disposition route take), placed inside the customer's calling window and
 * off a Sunday when the state bars Sunday calls. Advisory, like the field: the server re-checks the
 * window when it books.
 *
 * Pure and free of `server-only`, so the workspace and the tests share it.
 */

export type QuickCallbackWindow = { startHour: number; endHour: number; noSunday: boolean };
export type QuickCallbackOption = { key: "later_today" | "tomorrow_am" | "tomorrow_pm" | "next_week"; label: string; local: string };

const WEEKDAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

function localNow(now: number, zone: string) {
  const parts = new Intl.DateTimeFormat("en-US", { timeZone: zone, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).formatToParts(new Date(now));
  const get = (type: string) => Number(parts.find((part) => part.type === type)?.value ?? NaN);
  return { year: get("year"), month: get("month"), day: get("day"), minutes: (get("hour") % 24) * 60 + get("minute") };
}

const pad = (n: number) => String(n).padStart(2, "0");

/** A calendar day `offset` days from (year, month, day), as a UTC date used only for its fields. */
function dayAfter(year: number, month: number, day: number, offset: number) {
  return new Date(Date.UTC(year, month - 1, day + offset));
}

function local(date: Date, minutes: number): string {
  return `${date.getUTCFullYear()}-${pad(date.getUTCMonth() + 1)}-${pad(date.getUTCDate())}T${pad(Math.floor(minutes / 60))}:${pad(minutes % 60)}`;
}

/** Clamp a minute of the day into [open, last start], where the last start is 30 minutes before close. */
function clamp(minutes: number, window: QuickCallbackWindow): number | null {
  const open = window.startHour * 60;
  const last = window.endHour * 60 - 30;
  if (last < open) return null;
  return Math.min(Math.max(minutes, open), last);
}

export function callbackQuickOptions(now: number, zone: string, window: QuickCallbackWindow | null): QuickCallbackOption[] {
  const w = window ?? { startHour: 8, endHour: 21, noSunday: false };
  const today = localNow(now, zone);
  const options: QuickCallbackOption[] = [];

  // Later today: two hours from now, on the next half hour, if that is still inside today's window.
  const later = Math.ceil((today.minutes + 120) / 30) * 30;
  const todayDate = dayAfter(today.year, today.month, today.day, 0);
  const todayBarred = w.noSunday && todayDate.getUTCDay() === 0;
  const laterClamped = clamp(later, w);
  if (!todayBarred && laterClamped !== null && laterClamped >= later && later < 24 * 60) options.push({ key: "later_today", label: "Later today", local: local(todayDate, laterClamped) });

  // A day that may fall on a barred Sunday moves to Monday, and says so.
  const onDay = (offset: number, minutes: number, key: QuickCallbackOption["key"], label: string, part: string) => {
    let date = dayAfter(today.year, today.month, today.day, offset);
    let shifted = false;
    if (w.noSunday && date.getUTCDay() === 0) { date = dayAfter(today.year, today.month, today.day, offset + 1); shifted = true; }
    const at = clamp(minutes, w);
    if (at === null) return;
    options.push({ key, label: shifted ? `${WEEKDAYS[date.getUTCDay()]} ${part}` : label, local: local(date, at) });
  };
  onDay(1, 10 * 60, "tomorrow_am", "Tomorrow morning", "morning");
  onDay(1, 14 * 60, "tomorrow_pm", "Tomorrow afternoon", "afternoon");
  onDay(7, 10 * 60, "next_week", "Next week", "morning");
  return options;
}
