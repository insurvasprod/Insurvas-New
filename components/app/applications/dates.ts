/**
 * Dates on the LA-3 screens, in the one format the boards print: "2 Oct 2026", "2 Oct 2026, 2:41pm".
 * A plain module (not "use client") so a server page can call it too; parts.tsx re-exports it.
 */

// Month names are built by hand, not by ICU: the server's ICU prints "Sept" where browsers print
// "Sep", which breaks hydration. A bare "YYYY-MM-DD" is a calendar day and is printed as written —
// parsing it as a timestamp would move it to the day before anywhere west of UTC.
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

function calendarParts(iso: string, timeZone?: string): { y: number; m: number; d: number; hour: number; minute: number } | null {
  const bare = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso);
  if (bare) return { y: Number(bare[1]), m: Number(bare[2]), d: Number(bare[3]), hour: 0, minute: 0 };
  const at = new Date(iso);
  if (Number.isNaN(at.getTime())) return null;
  if (!timeZone) return { y: at.getFullYear(), m: at.getMonth() + 1, d: at.getDate(), hour: at.getHours(), minute: at.getMinutes() };
  const parts = new Intl.DateTimeFormat("en-US", { timeZone, year: "numeric", month: "numeric", day: "numeric", hour: "numeric", minute: "numeric", hourCycle: "h23" }).formatToParts(at);
  const n = (type: string) => Number(parts.find((p) => p.type === type)?.value ?? 0);
  return { y: n("year"), m: n("month"), d: n("day"), hour: n("hour") % 24, minute: n("minute") };
}

/** "2 Oct 2026" (or "2 Oct" with `year: false`). */
export function shortDate(iso: string | null | undefined, opts: { timeZone?: string; year?: boolean } = {}) {
  const p = iso ? calendarParts(iso, opts.timeZone) : null;
  if (!p) return "—";
  return `${p.d} ${MONTHS[p.m - 1] ?? p.m}${opts.year === false ? "" : ` ${p.y}`}`;
}

/** "2 Oct 2026, 2:41pm". */
export function dateTime(iso: string | null | undefined, timeZone?: string) {
  const p = iso ? calendarParts(iso, timeZone) : null;
  if (!p) return "—";
  const h = p.hour % 12 || 12;
  return `${shortDate(iso, { timeZone })}, ${h}:${String(p.minute).padStart(2, "0")}${p.hour < 12 ? "am" : "pm"}`;
}
