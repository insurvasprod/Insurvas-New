/**
 * Clock helpers for the Calls screens (boards C9, C11, C12): a time is always shown in the customer's
 * zone with the agent's underneath. Pure Intl, no library; every value comes from a stored UTC time
 * and a stored IANA zone, never a guess.
 */

export function deviceZone(): string {
  try { return Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC"; } catch { return "UTC"; }
}

function parts(date: Date, zone: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const p of new Intl.DateTimeFormat("en-US", { timeZone: zone, hourCycle: "h23", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit" }).formatToParts(date)) out[p.type] = p.value;
  return out;
}

function offsetMs(date: Date, zone: string): number {
  const p = parts(date, zone);
  const asUtc = Date.UTC(Number(p.year), Number(p.month) - 1, Number(p.day), Number(p.hour) % 24, Number(p.minute), Number(p.second));
  return asUtc - (date.getTime() - date.getUTCMilliseconds());
}

/** "2026-11-25T13:00" read as a wall clock in `zone` → the UTC instant. */
export function zonedLocalToUtc(local: string, zone: string): Date {
  const [d, t] = local.split("T");
  const [y, m, day] = d.split("-").map(Number);
  const [h, mi] = t.split(":").map(Number);
  const guess = Date.UTC(y, m - 1, day, h, mi);
  const first = guess - offsetMs(new Date(guess), zone);
  return new Date(guess - offsetMs(new Date(first), zone));
}

/** "9:30 am" (or "9:30" without the meridiem) in `zone`. */
export function clock(date: Date, zone: string, meridiem = true): string {
  const s = new Intl.DateTimeFormat("en-US", { timeZone: zone, hour: "numeric", minute: "2-digit" }).format(date).replace(/ | /g, " ");
  return meridiem ? s.replace(/AM$/, "am").replace(/PM$/, "pm") : s.replace(/\s?(AM|PM)$/, "");
}

/** "CT", "ET", "PT" for US zones (standard or daylight); otherwise the platform's short name. */
export function zoneShort(zone: string, date = new Date()): string {
  const name = new Intl.DateTimeFormat("en-US", { timeZone: zone, timeZoneName: "short" }).formatToParts(date).find((p) => p.type === "timeZoneName")?.value ?? zone;
  const us = /^(E|C|M|P|AK|H)[SD]T$/.exec(name);
  return us ? `${us[1]}T` : name;
}

const LONG: [RegExp, string][] = [
  [/^America\/(New_York|Detroit|Indiana|Kentucky|Toronto)/, "Eastern"],
  [/^America\/(Chicago|Menominee|North_Dakota|Winnipeg)/, "Central"],
  [/^America\/Phoenix$/, "Arizona"],
  [/^America\/(Denver|Boise|Edmonton)/, "Mountain"],
  [/^America\/(Los_Angeles|Vancouver)/, "Pacific"],
  [/^America\/(Anchorage|Juneau|Sitka|Nome|Yakutat|Metlakatla)/, "Alaska"],
  [/^Pacific\/Honolulu$/, "Hawaii"],
];
/** "Central" for America/Chicago; any other zone by its city. */
export function zoneLong(zone: string): string {
  for (const [re, label] of LONG) if (re.test(zone)) return label;
  return (zone.split("/").pop() ?? zone).replace(/_/g, " ");
}

/** "YYYY-MM-DD" of `date` in `zone`. */
export function dayKey(date: Date, zone: string): string {
  const p = parts(date, zone);
  return `${p.year}-${p.month}-${p.day}`;
}

export function addDays(key: string, n: number): string {
  const d = new Date(`${key}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

const atNoon = (key: string) => new Date(`${key}T12:00:00Z`);
/** "Tue" (or "T" with `letter`) for a day key. */
export function weekday(key: string, letter = false): string {
  const w = new Intl.DateTimeFormat("en-US", { timeZone: "UTC", weekday: "short" }).format(atNoon(key));
  return letter ? w[0] : w;
}
export function dayOfMonth(key: string): string {
  return String(Number(key.slice(8, 10)));
}
/** "Wed 25 Nov". */
export function dayLabel(key: string): string {
  const d = atNoon(key);
  const month = new Intl.DateTimeFormat("en-US", { timeZone: "UTC", month: "short" }).format(d);
  return `${weekday(key)} ${dayOfMonth(key)} ${month}`;
}

/** How late a callback is: "25 min late", "2 h late", "3 d late". */
export function lateLabel(ms: number): string {
  const m = Math.max(1, Math.floor(ms / 60_000));
  if (m < 60) return `${m} min late`;
  const h = Math.floor(m / 60);
  return h < 24 ? `${h} h late` : `${Math.floor(h / 24)} d late`;
}

export const STATE_NAMES: Record<string, string> = {
  AL: "Alabama", AK: "Alaska", AZ: "Arizona", AR: "Arkansas", CA: "California", CO: "Colorado", CT: "Connecticut", DE: "Delaware", DC: "District of Columbia",
  FL: "Florida", GA: "Georgia", HI: "Hawaii", ID: "Idaho", IL: "Illinois", IN: "Indiana", IA: "Iowa", KS: "Kansas", KY: "Kentucky", LA: "Louisiana", ME: "Maine",
  MD: "Maryland", MA: "Massachusetts", MI: "Michigan", MN: "Minnesota", MS: "Mississippi", MO: "Missouri", MT: "Montana", NE: "Nebraska", NV: "Nevada",
  NH: "New Hampshire", NJ: "New Jersey", NM: "New Mexico", NY: "New York", NC: "North Carolina", ND: "North Dakota", OH: "Ohio", OK: "Oklahoma", OR: "Oregon",
  PA: "Pennsylvania", RI: "Rhode Island", SC: "South Carolina", SD: "South Dakota", TN: "Tennessee", TX: "Texas", UT: "Utah", VT: "Vermont", VA: "Virginia",
  WA: "Washington", WV: "West Virginia", WI: "Wisconsin", WY: "Wyoming", PR: "Puerto Rico",
};
export function stateName(code: string | null | undefined): string | null {
  if (!code) return null;
  return STATE_NAMES[code.toUpperCase()] ?? code;
}

/** Board M2 · "Thursday, 10:00 am" (or "tomorrow, 10:00 am") for when the person is next busy, in their zone. */
export function clearUntil(at: Date, zone: string, todayKey: string): string {
  const key = dayKey(at, zone);
  const day = key === addDays(todayKey, 1) ? "tomorrow" : new Intl.DateTimeFormat("en-US", { timeZone: zone, weekday: "long" }).format(at);
  return `${day}, ${clock(at, zone)}`;
}
