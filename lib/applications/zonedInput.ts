// A datetime-local input read and written in the agency's time zone (QA 2026-11-03): the Submit step's
// "Submitted at" showed the browser's clock while the recorded card printed the agency's, and neither
// said which. Pure and client-safe; with no zone it falls back to the browser's own clock, as before.

type Parts = { y: number; m: number; d: number; h: number; mi: number };

function partsIn(at: Date, zone: string): Parts {
  const parts = new Intl.DateTimeFormat("en-US", { timeZone: zone, year: "numeric", month: "numeric", day: "numeric", hour: "numeric", minute: "numeric", hourCycle: "h23" }).formatToParts(at);
  const n = (type: string) => Number(parts.find((p) => p.type === type)?.value ?? 0);
  return { y: n("year"), m: n("month"), d: n("day"), h: n("hour") % 24, mi: n("minute") };
}

const pad = (n: number) => String(n).padStart(2, "0");

/** `YYYY-MM-DDTHH:mm` for a datetime-local input, on the agency's clock (the browser's with no zone). */
export function toZonedInput(at: Date, zone?: string): string {
  const p = zone ? partsIn(at, zone) : { y: at.getFullYear(), m: at.getMonth() + 1, d: at.getDate(), h: at.getHours(), mi: at.getMinutes() };
  return `${p.y}-${pad(p.m)}-${pad(p.d)}T${pad(p.h)}:${pad(p.mi)}`;
}

/** How far the zone's wall clock is ahead of UTC at an instant, in ms. */
function offsetAt(ms: number, zone: string) {
  const p = partsIn(new Date(ms), zone);
  return Date.UTC(p.y, p.m - 1, p.d, p.h, p.mi) - Math.floor(ms / 60_000) * 60_000;
}

/**
 * A datetime-local value read as the agency's wall clock → an ISO instant. Null when it is not a
 * date and time. A time that does not exist on that day (the spring-forward hour) lands an hour on.
 */
export function zonedInputToIso(text: string, zone?: string): string | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})/.exec(text.trim());
  if (!m) return null;
  const [y, mo, d, h, mi] = m.slice(1).map(Number);
  if (!zone) {
    const local = new Date(y, mo - 1, d, h, mi);
    return Number.isNaN(local.getTime()) ? null : local.toISOString();
  }
  const wall = Date.UTC(y, mo - 1, d, h, mi);
  if (Number.isNaN(wall)) return null;
  let t = wall - offsetAt(wall, zone);
  t = wall - offsetAt(t, zone);
  return new Date(t).toISOString();
}

/**
 * "CST", "CDT", "GMT+2": the zone's short name at that instant, to print beside a time. "" with no
 * zone: the server and the browser would name different ones (a hydration mismatch).
 */
export function zoneShortName(at: Date, zone?: string): string {
  if (!zone) return "";
  try {
    const parts = new Intl.DateTimeFormat("en-US", { timeZone: zone, timeZoneName: "short" }).formatToParts(at);
    return parts.find((p) => p.type === "timeZoneName")?.value ?? zone ?? "";
  } catch {
    return zone ?? "";
  }
}
