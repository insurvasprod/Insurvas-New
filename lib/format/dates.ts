/**
 * Dates as the boards write them: "24 Sep", "24 Sep 2026", "Thu 24 Sep, 14:05". Plain module: server
 * pages, client islands and route handlers share it.
 *
 * Month and weekday names are spelled out here, not left to Intl: en-GB's short September is "Sept"
 * in current ICU builds and "Sep" in older ones, so a server and a browser with different ICU data
 * printed different text and the client island failed to hydrate. Intl is only asked for the numeric
 * parts of a moment in a named zone, which every build agrees on.
 *
 * Every formatter takes the zone explicitly: "UTC", an agency's IANA zone, or the viewer's zone
 * (viewerTimeZone()) — the last only after mount, never in a server render.
 */

export const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"] as const;
export const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"] as const;

export type DateInput = string | number | Date | null | undefined;

export type ZonedParts = {
  year: number;
  /** 1–12. */
  month: number;
  day: number;
  hour: number;
  minute: number;
  second: number;
  /** 0 = Sunday. */
  weekday: number;
};

const DATE_ONLY = /^(\d{4})-(\d{2})-(\d{2})$/;
const pad = (n: number) => String(n).padStart(2, "0");
const weekdayOf = (year: number, month: number, day: number) => new Date(Date.UTC(year, month - 1, day)).getUTCDay();

const partFormatters = new Map<string, Intl.DateTimeFormat>();
function partFormatter(zone: string): Intl.DateTimeFormat | null {
  let format = partFormatters.get(zone);
  if (!format) {
    try {
      format = new Intl.DateTimeFormat("en-US", {
        timeZone: zone,
        hourCycle: "h23",
        year: "numeric",
        month: "numeric",
        day: "numeric",
        hour: "numeric",
        minute: "numeric",
        second: "numeric",
      });
    } catch {
      return null; // not a zone this runtime knows
    }
    partFormatters.set(zone, format);
  }
  return format;
}

function utcParts(date: Date): ZonedParts {
  return {
    year: date.getUTCFullYear(),
    month: date.getUTCMonth() + 1,
    day: date.getUTCDate(),
    hour: date.getUTCHours(),
    minute: date.getUTCMinutes(),
    second: date.getUTCSeconds(),
    weekday: date.getUTCDay(),
  };
}

/**
 * The wall-clock parts of a moment in `zone`. A bare "YYYY-MM-DD" is a calendar day, not a moment,
 * so it reads as that day in every zone. Null when the value is missing or unparseable; an unknown
 * zone falls back to UTC rather than throwing mid-render.
 */
export function zonedParts(value: DateInput, zone: string): ZonedParts | null {
  if (value === null || value === undefined || value === "") return null;
  if (typeof value === "string") {
    const calendar = DATE_ONLY.exec(value);
    if (calendar) {
      const [year, month, day] = [Number(calendar[1]), Number(calendar[2]), Number(calendar[3])];
      if (month < 1 || month > 12 || day < 1 || day > 31) return null;
      return { year, month, day, hour: 0, minute: 0, second: 0, weekday: weekdayOf(year, month, day) };
    }
  }
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  if (zone === "UTC") return utcParts(date);
  const format = partFormatter(zone);
  if (!format) return utcParts(date);
  const read: Record<string, number> = {};
  for (const part of format.formatToParts(date)) if (part.type !== "literal") read[part.type] = Number(part.value);
  const { year, month, day } = read;
  return { year, month, day, hour: read.hour % 24, minute: read.minute, second: read.second, weekday: weekdayOf(year, month, day) };
}

/** "24 Sep". "—" when there is no date. */
export function dayMonth(value: DateInput, zone = "UTC"): string {
  const p = zonedParts(value, zone);
  return p ? `${p.day} ${MONTHS[p.month - 1]}` : "—";
}

/** "24 Sep 2026". "—" when there is no date. */
export function dayMonthYear(value: DateInput, zone = "UTC"): string {
  const p = zonedParts(value, zone);
  return p ? `${p.day} ${MONTHS[p.month - 1]} ${p.year}` : "—";
}

/** "Thu 24 Sep". "—" when there is no date. */
export function weekdayDayMonth(value: DateInput, zone = "UTC"): string {
  const p = zonedParts(value, zone);
  return p ? `${WEEKDAYS[p.weekday]} ${p.day} ${MONTHS[p.month - 1]}` : "—";
}

export type Clock = "24h" | "12h";

const clockOf = (p: ZonedParts, clock: Clock) =>
  clock === "24h" ? `${pad(p.hour)}:${pad(p.minute)}` : `${p.hour % 12 === 0 ? 12 : p.hour % 12}:${pad(p.minute)} ${p.hour < 12 ? "AM" : "PM"}`;

/** "14:05", or "2:05 PM" on the 12-hour clock. "—" when there is no date. */
export function clockTime(value: DateInput, zone: string, clock: Clock = "24h"): string {
  const p = zonedParts(value, zone);
  return p ? clockOf(p, clock) : "—";
}

export type DateTimeOptions = {
  /** Lead with the weekday: "Thu 24 Sep, 14:05". */
  weekday?: boolean;
  /** Include the year: "24 Sep 2026, 14:05". */
  year?: boolean;
  clock?: Clock;
  /** Trail the zone's short name: "24 Sep, 14:05 UTC", "24 Sep, 10:05 EDT". */
  zoneLabel?: boolean;
};

/** "24 Sep, 14:05", with the weekday, year, 12-hour clock or zone as asked. "—" when there is no date. */
export function dateTime(value: DateInput, zone: string, options: DateTimeOptions = {}): string {
  const p = zonedParts(value, zone);
  if (!p) return "—";
  const day = `${options.weekday ? `${WEEKDAYS[p.weekday]} ` : ""}${p.day} ${MONTHS[p.month - 1]}${options.year ? ` ${p.year}` : ""}`;
  const time = clockOf(p, options.clock ?? "24h");
  return `${day}, ${time}${options.zoneLabel ? ` ${zoneAbbreviation(value, zone)}` : ""}`;
}

const nameFormatters = new Map<string, Intl.DateTimeFormat>();
/** "UTC", "EDT", "CST" — the zone's US short name at that moment ("GMT+1" where it has none, as for London). */
export function zoneAbbreviation(value: DateInput, zone: string): string {
  if (zone === "UTC") return "UTC";
  const date = value instanceof Date ? value : new Date(value ?? Number.NaN);
  if (Number.isNaN(date.getTime())) return zone;
  let format = nameFormatters.get(zone);
  if (!format) {
    try {
      format = new Intl.DateTimeFormat("en-US", { timeZone: zone, timeZoneName: "short" });
    } catch {
      return zone;
    }
    nameFormatters.set(zone, format);
  }
  return format.formatToParts(date).find((part) => part.type === "timeZoneName")?.value ?? zone;
}

/** The viewer's own zone. Only meaningful in a browser after mount: on a server it is the server's zone. */
export function viewerTimeZone(): string {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
  } catch {
    return "UTC";
  }
}
