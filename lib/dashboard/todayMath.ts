/**
 * The arithmetic behind the dashboard's "Today" hero, kept pure so it is tested without a database:
 * the agency-local day boundaries a count is taken over, the greeting, the contact rate, the
 * day-on-day change, and the countdown to the next callback.
 *
 * Days are the AGENCY's days (its workspace timezone), not the server's or the browser's: "dials
 * today" for an agency in Phoenix starts at midnight in Phoenix.
 */
import { wallClock, zonedInstant } from "../appointments/calendarMath.ts";

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const MONTHS_LONG = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
const WEEKDAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

export type DayWindow = { key: string; label: string; weekday: string; start: string; end: string; isToday: boolean };

/**
 * The last `count` agency-local days, oldest first, each as a [start, end) UTC window. The last is
 * today, ending now rather than at midnight, so a count over it is "so far today".
 */
export function lastDays(nowMs: number, zone: string, count = 14): DayWindow[] {
  const today = wallClock(new Date(nowMs).toISOString(), zone);
  const days: DayWindow[] = [];
  for (let offset = count - 1; offset >= 0; offset -= 1) {
    // Noon of the target day, stepped back whole days, then read in the zone: immune to DST.
    const noon = wallClock(new Date(zonedInstant(today.year, today.month, today.day, 720, zone) - offset * 86_400_000).toISOString(), zone);
    const start = zonedInstant(noon.year, noon.month, noon.day, 0, zone);
    const next = wallClock(new Date(zonedInstant(noon.year, noon.month, noon.day, 720, zone) + 86_400_000).toISOString(), zone);
    const end = offset === 0 ? nowMs : zonedInstant(next.year, next.month, next.day, 0, zone);
    days.push({
      key: `${noon.year}-${String(noon.month).padStart(2, "0")}-${String(noon.day).padStart(2, "0")}`,
      label: `${noon.day} ${MONTHS[noon.month - 1]}`,
      weekday: WEEKDAYS[noon.weekday].slice(0, 3),
      start: new Date(start).toISOString(),
      end: new Date(end).toISOString(),
      isToday: offset === 0,
    });
  }
  return days;
}

/**
 * The agency's next midnight, as a UTC instant. `lastDays` ends today at "now" (a count over it is
 * "so far today"); a diary of today's appointments needs the whole day, the ones still to come too.
 */
export function endOfToday(nowMs: number, zone: string): string {
  const today = wallClock(new Date(nowMs).toISOString(), zone);
  // Noon today plus a day, read in the zone: tomorrow's date whatever DST does overnight.
  const tomorrow = wallClock(new Date(zonedInstant(today.year, today.month, today.day, 720, zone) + 86_400_000).toISOString(), zone);
  return new Date(zonedInstant(tomorrow.year, tomorrow.month, tomorrow.day, 0, zone)).toISOString();
}

/** "Good morning" until noon, "Good afternoon" until six, "Good evening" after — agency time. */
export function greeting(nowMs: number, zone: string) {
  const hour = Math.floor(wallClock(new Date(nowMs).toISOString(), zone).minutes / 60);
  return hour < 12 ? "Good morning" : hour < 18 ? "Good afternoon" : "Good evening";
}

/** "Thursday 24 September" in the agency's zone. */
export function longDate(nowMs: number, zone: string) {
  const at = wallClock(new Date(nowMs).toISOString(), zone);
  return `${WEEKDAYS[at.weekday]} ${at.day} ${MONTHS_LONG[at.month - 1]}`;
}

/** Contacts over dials as a percentage, or null when nothing was dialled — never a fake 0%. */
export function contactRate(dials: number, contacts: number): number | null {
  return dials > 0 ? (Math.min(contacts, dials) / dials) * 100 : null;
}

/**
 * Today against the same point yesterday, as the tile's footnote: "+12 on yesterday", "3 fewer than
 * yesterday", "same as yesterday", or null when yesterday had nothing to compare with.
 */
export function dayOnDay(today: number, yesterday: number | null): { text: string; tone: "good" | "warning" | "neutral" } | null {
  if (yesterday === null) return null;
  if (today === yesterday) return { text: "same as yesterday", tone: "neutral" };
  if (yesterday === 0) return { text: `${today} more than yesterday`, tone: "good" };
  const change = today - yesterday;
  return change > 0 ? { text: `+${change} on yesterday`, tone: "good" } : { text: `${-change} fewer than yesterday`, tone: "warning" };
}

/** "in 12m 04s", "in 2h 05m", "3 min late" — the next callback, from the viewer's clock. */
export function countdown(targetMs: number, nowMs: number): { text: string; late: boolean } {
  const seconds = Math.round((targetMs - nowMs) / 1000);
  if (seconds < 0) {
    const late = Math.max(1, Math.round(-seconds / 60));
    return { text: late < 60 ? `${late} min late` : `${Math.floor(late / 60)}h ${late % 60}m late`, late: true };
  }
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = seconds % 60;
  if (h >= 24) return { text: `in ${Math.floor(h / 24)}d ${h % 24}h`, late: false };
  return { text: h > 0 ? `in ${h}h ${String(m).padStart(2, "0")}m` : `in ${m}m ${String(s).padStart(2, "0")}s`, late: false };
}

/** The dispositions that are not a conversation — mirrors SQL `is_contact_disposition`. */
export const NOT_A_CONTACT = ["no_answer", "voicemail", "busy", "call_dropped", "disconnected", "wrong_number"] as const;
