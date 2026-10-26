/**
 * Clock helpers for the Callbacks page: a callback is promised in the customer's own time and shown
 * in the agent's too. Moved out of callback-calendar.tsx (2026-10-25 redesign) so the day plan and the
 * person panel read times the same way.
 */
export function localParts(utc: string | Date, timezone: string) {
  const parts = new Intl.DateTimeFormat("en-US", { timeZone: timezone, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hour12: false }).formatToParts(new Date(utc));
  const values = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return { date: `${values.year}-${values.month}-${values.day}`, time: `${values.hour === "24" ? "00" : values.hour}:${values.minute}` };
}

/** "11:00 am EDT" — the time as a person says it, with the zone it is in. */
export function shortTime(utc: string | Date, timezone: string, withZone = true) {
  const text = new Intl.DateTimeFormat("en-US", { timeZone: timezone, hour: "numeric", minute: "2-digit", ...(withZone ? { timeZoneName: "short" } : {}) }).format(new Date(utc));
  return text.replace(" AM", " am").replace(" PM", " pm");
}

export const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
export const WEEKDAYS_LONG = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
// A fixed month list: some browsers' locale data spells September "Sept", and the boards say "Sep".
export const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
export const MONTHS_LONG = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];

/** "Thu 25 Sep · 2:30 pm MST" */
export function longTime(utc: string | Date, timezone: string) {
  const { date } = localParts(utc, timezone);
  const [y, m, d] = date.split("-").map(Number);
  const weekday = WEEKDAYS[new Date(Date.UTC(y, m - 1, d)).getUTCDay()];
  return `${weekday} ${d} ${MONTHS[m - 1]} · ${shortTime(utc, timezone)}`;
}

/** "Monday 26 October" for a "YYYY-MM-DD" day. */
export function dayTitle(day: string) {
  const [y, m, d] = day.split("-").map(Number);
  return `${WEEKDAYS_LONG[new Date(Date.UTC(y, m - 1, d)).getUTCDay()]} ${d} ${MONTHS_LONG[m - 1]}`;
}

/** The "YYYY-MM-DD" day `delta` days from `day`. */
export function shiftDay(day: string, delta: number) {
  const [y, m, d] = day.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d + delta)).toISOString().slice(0, 10);
}

export function zoneAbbreviation(timezone: string, at: Date = new Date()) {
  return new Intl.DateTimeFormat("en-US", { timeZone: timezone, timeZoneName: "short" }).formatToParts(at).find((part) => part.type === "timeZoneName")?.value ?? timezone;
}

/** The instant a customer-local "YYYY-MM-DDTHH:mm" names in `timezone` (DST-safe to the minute). */
export function zonedToUtc(local: string, timezone: string): Date | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/.exec(local);
  if (!match) return null;
  const [, y, mo, d, h, mi] = match.map(Number);
  let guess = Date.UTC(y, mo - 1, d, h, mi);
  for (let i = 0; i < 2; i += 1) {
    const seen = localParts(new Date(guess), timezone);
    const [sy, smo, sd] = seen.date.split("-").map(Number);
    const [sh, smi] = seen.time.split(":").map(Number);
    guess -= Date.UTC(sy, smo - 1, sd, sh, smi) - Date.UTC(y, mo - 1, d, h, mi);
  }
  return new Date(guess);
}

export function durationShort(minutes: number) {
  if (minutes < 60) return `${minutes} min`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ${minutes % 60}m`;
  const days = Math.floor(hours / 24);
  return days === 1 ? "1 day" : `${days} days`;
}
