/**
 * Settings › Calling windows, round 8 — the agency's week, pure (no `server-only`: the screen imports it).
 *
 * The screen draws the hours as one block per weekday on a 7 am–10 pm grid. Storage is the agency's
 * base window (`tenant_calling_windows`, every reader already knows it) plus, once 20261112300000 is
 * applied, a row per weekday that differs from it (`tenant_calling_window_days`). The base window is
 * always the ENVELOPE of the open days, so narrowing it by a day's own row gives exactly that day:
 * every layer may only narrow (lib/callingWindow/engine.ts), and the per-day row is one more layer.
 *
 * Index 0 is Sunday, as `extract(dow ...)` and Date#getDay count.
 */

import { FEDERAL_MINUTES, minuteLabel, stateRuleMinutes, type MinuteWindow, type StateRuleInForce } from "../callingWindow/engine.ts";

export type Week = Array<MinuteWindow | null>;

/** One of the agency's own days off: the whole day, or from a time onwards (an afternoon). */
export type DayOff = { date: string; fromMinute: number | null; label: string };

export const WEEKDAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"] as const;
export const WEEKDAY_SHORT = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"] as const;
/** The board draws Monday first and Sunday last. */
export const GRID_ORDER = [1, 2, 3, 4, 5, 6, 0] as const;
/** The grid's own range: an hour either side of the federal 8 am–9 pm. */
export const GRID = { start: 7 * 60, end: 22 * 60 } as const;
/** Dragging moves an edge in quarter hours. */
export const STEP_MINUTES = 15;
/** The shortest day a drag may leave. */
export const MIN_DAY_MINUTES = 30;

export const snap = (minute: number, step = STEP_MINUTES) => Math.round(minute / step) * step;

/** A minute of the day as a fraction of the grid's height, 0–1. */
export const gridFraction = (minute: number) => (minute - GRID.start) / (GRID.end - GRID.start);

/** The week the screen starts from: per-day rows where stored, the base window everywhere else. */
export function weekFrom(base: MinuteWindow | null, rows: Array<{ weekday: number; closed: boolean; start: number | null; end: number | null }>): Week {
  const fallback = base ?? { ...FEDERAL_MINUTES };
  const week: Week = Array.from({ length: 7 }, () => ({ ...fallback }));
  for (const row of rows) {
    if (row.weekday < 0 || row.weekday > 6) continue;
    if (row.closed) week[row.weekday] = null;
    else if (row.start != null && row.end != null) week[row.weekday] = { start: row.start, end: row.end };
  }
  return week;
}

/** The earliest start and latest end over the open days; null when every day is off. */
export function envelope(week: Week): MinuteWindow | null {
  const open = week.filter((day): day is MinuteWindow => day !== null);
  if (open.length === 0) return null;
  return { start: Math.min(...open.map((day) => day.start)), end: Math.max(...open.map((day) => day.end)) };
}

/** The per-day rows to store under a base window: a closed day, or a day narrower than the base. */
export function dayRows(week: Week, base: MinuteWindow): Array<{ weekday: number; closed: boolean; start: number | null; end: number | null }> {
  const rows: Array<{ weekday: number; closed: boolean; start: number | null; end: number | null }> = [];
  week.forEach((day, weekday) => {
    if (day === null) rows.push({ weekday, closed: true, start: null, end: null });
    else if (day.start !== base.start || day.end !== base.end) rows.push({ weekday, closed: false, start: day.start, end: day.end });
  });
  return rows;
}

/** True when the week can be stored without per-day rows: every open day the same, only Sunday off (and then by the switch). */
export function fitsWithoutDays(week: Week, noSunday: boolean): boolean {
  const base = envelope(week);
  if (!base) return false;
  return week.every((day, weekday) => (day === null ? weekday === 0 && noSunday : day.start === base.start && day.end === base.end));
}

/** The one problem with a day, in the board's words, or null. */
export function dayProblem(day: MinuteWindow | null, weekday: number): string | null {
  if (!day) return null;
  const name = WEEKDAYS[weekday];
  if (day.start >= day.end) return `${name} ends before it starts. Drag the end below the start.`;
  if (day.start < FEDERAL_MINUTES.start || day.end > FEDERAL_MINUTES.end)
    return `${name} is wider than federal law allows (${minuteLabel(FEDERAL_MINUTES.start)}–${minuteLabel(FEDERAL_MINUTES.end)}).`;
  return null;
}

/** Move one edge of a day, in quarter hours, inside the federal hours, never closer than half an hour to the other edge. */
export function moveEdge(day: MinuteWindow, edge: "start" | "end", minute: number): MinuteWindow {
  const at = snap(minute);
  if (edge === "start") return { start: Math.max(FEDERAL_MINUTES.start, Math.min(at, day.end - MIN_DAY_MINUTES)), end: day.end };
  return { start: day.start, end: Math.min(FEDERAL_MINUTES.end, Math.max(at, day.start + MIN_DAY_MINUTES)) };
}

/** A new block drawn across an empty day, from where the pointer went down to where it is. */
export function drawnDay(from: number, to: number): MinuteWindow {
  const a = snap(Math.min(from, to));
  const b = snap(Math.max(from, to));
  const start = Math.max(FEDERAL_MINUTES.start, Math.min(a, FEDERAL_MINUTES.end - MIN_DAY_MINUTES));
  return { start, end: Math.min(FEDERAL_MINUTES.end, Math.max(b, start + MIN_DAY_MINUTES)) };
}

/** `9:00 am`, or `9 am` when `compact`. */
export function clock(minute: number, compact = false): string {
  const label = minuteLabel(minute);
  return compact ? label.replace(":00", "") : label;
}

/** `9–5`, `4–8 pm`, `9 am – 5 pm`: the campaign list's short ranges. */
export function rangeLabel(window: MinuteWindow, style: "short" | "long" = "short"): string {
  if (style === "long") return `${clock(window.start, true)} – ${clock(window.end, true)}`;
  const startPm = window.start >= 12 * 60;
  const endPm = window.end >= 12 * 60 && window.end < 24 * 60;
  const bare = (minute: number) => minuteLabel(minute, true).replace(":00", "");
  return startPm === endPm ? `${bare(window.start)}–${bare(window.end)} ${endPm ? "pm" : "am"}` : `${clock(window.start, true)} – ${clock(window.end, true)}`;
}

/** `Mon–Fri`, `Mon–Sat`, `Mon, Wed, Fri`, `Every day`: the open days, Monday first. */
export function daysLabel(open: boolean[]): string {
  const order = GRID_ORDER.filter((weekday) => open[weekday]);
  if (order.length === 7) return "Every day";
  if (order.length === 0) return "No days";
  const positions = order.map((weekday) => GRID_ORDER.indexOf(weekday as (typeof GRID_ORDER)[number]));
  const consecutive = positions.every((position, index) => index === 0 || position === positions[index - 1] + 1);
  if (consecutive && order.length > 2) return `${WEEKDAY_SHORT[order[0]]}–${WEEKDAY_SHORT[order[order.length - 1]]}`;
  return order.map((weekday) => WEEKDAY_SHORT[weekday]).join(", ");
}

/** The open days a dial can actually happen on: Sunday is off while the switch is on. */
export function openDays(week: Week, noSunday: boolean): boolean[] {
  return week.map((day, weekday) => day !== null && !(weekday === 0 && noSunday));
}

/** What a state's rule does to one day of the agency's hours: the parts it cuts, or the whole day. */
export type StateCut = { before: number | null; after: number | null; closed: boolean; minutes: number };

export function stateCut(day: MinuteWindow | null, rule: StateRuleInForce | undefined, weekday: number): StateCut {
  const none = { before: null, after: null, closed: false, minutes: 0 };
  if (!day || !rule) return none;
  if (rule.noSunday && weekday === 0) return { before: null, after: null, closed: true, minutes: day.end - day.start };
  const law = stateRuleMinutes(rule, weekday);
  const before = law.start > day.start ? Math.min(law.start, day.end) : null;
  const after = law.end < day.end ? Math.max(law.end, day.start) : null;
  if (law.start >= day.end || law.end <= day.start || law.start >= law.end) return { before: null, after: null, closed: true, minutes: day.end - day.start };
  return { before, after, closed: false, minutes: (before === null ? 0 : before - day.start) + (after === null ? 0 : day.end - after) };
}

/** The most a state's rule takes from any one open day of the week, in minutes. */
export function weekCut(week: Week, noSunday: boolean, rule: StateRuleInForce | undefined): number {
  const open = openDays(week, noSunday);
  return Math.max(0, ...week.map((day, weekday) => (open[weekday] ? stateCut(day, rule, weekday).minutes : 0)));
}

/** `1 h`, `30 min`, `1 h 30 min`. */
export function minutesLabel(minutes: number): string {
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return [h ? `${h} h` : "", m ? `${m} min` : ""].filter(Boolean).join(" ") || "0 min";
}

/** A state's rule in one short line: `8 am – 8 pm`, `No Sundays`, `Sundays from noon`. */
export function ruleLine(rule: StateRuleInForce): string {
  const weekday = stateRuleMinutes(rule);
  const parts: string[] = [];
  if (weekday.start !== FEDERAL_MINUTES.start || weekday.end !== FEDERAL_MINUTES.end) parts.push(rangeLabel(weekday, "long"));
  if (rule.noSunday) parts.push("No Sundays");
  else if (rule.sundayStartMinute != null && rule.sundayEndMinute != null) {
    const sunday = stateRuleMinutes(rule, 0);
    parts.push(sunday.start === 12 * 60 && sunday.end >= FEDERAL_MINUTES.end ? "Sundays from noon" : `Sundays ${rangeLabel(sunday, "long")}`);
  }
  return parts.join(" · ") || "Federal hours";
}

/** The status line's account of an unsaved week: one phrase per change, in the board's words. */
export function weekChanges(
  before: { week: Week; noSunday: boolean; noFederalHolidays: boolean; campaignOverrides: boolean; daysOff: DayOff[]; allowed: string[] },
  after: { week: Week; noSunday: boolean; noFederalHolidays: boolean; campaignOverrides: boolean; daysOff: DayOff[]; allowed: string[] },
): string[] {
  const changes: string[] = [];
  // Per day first, then one phrase for three or more days that changed the same way ("Mon–Fri end earlier").
  const byPhrase = new Map<string, number[]>();
  const note = (phrase: string, weekday: number) => byPhrase.set(phrase, [...(byPhrase.get(phrase) ?? []), weekday]);
  for (const weekday of GRID_ORDER) {
    // A Sunday kept off by the switch: its hours are not dialled, so a change to them is not news.
    if (weekday === 0 && before.noSunday && after.noSunday) continue;
    const a = before.week[weekday];
    const b = after.week[weekday];
    if (a === null && b === null) continue;
    if (a === null) note("opens", weekday);
    else if (b === null) note("is a day off", weekday);
    else {
      if (b.start !== a.start) note(`starts ${b.start < a.start ? "earlier" : "later"}`, weekday);
      if (b.end !== a.end) note(`ends ${b.end > a.end ? "later" : "earlier"}`, weekday);
    }
  }
  const plural: Record<string, string> = { opens: "open", "is a day off": "are days off" };
  for (const [phrase, days] of byPhrase) {
    if (days.length < 3) for (const weekday of days) changes.push(`${WEEKDAYS[weekday]} ${phrase}`);
    else {
      const open = Array.from({ length: 7 }, (_, weekday) => days.includes(weekday));
      const many = plural[phrase] ?? phrase.replace(/^(starts|ends) /, (verb) => `${verb.trim().slice(0, -1)} `);
      changes.push(`${daysLabel(open)} ${many}`);
    }
  }
  const toggle = (was: boolean, now: boolean, label: string) => { if (was !== now) changes.push(`${label} turned ${now ? "on" : "off"}`); };
  toggle(before.noSunday, after.noSunday, "No Sundays");
  toggle(before.noFederalHolidays, after.noFederalHolidays, "No federal holidays");
  toggle(before.campaignOverrides, after.campaignOverrides, "Campaigns may call less");
  const key = (day: DayOff) => `${day.date}|${day.fromMinute ?? ""}|${day.label}`;
  const was = new Set(before.daysOff.map(key));
  const now = new Set(after.daysOff.map(key));
  const added = after.daysOff.filter((day) => !was.has(key(day))).length;
  const removed = before.daysOff.filter((day) => !now.has(key(day))).length;
  if (added) changes.push(`${added} ${added === 1 ? "day off" : "days off"} added`);
  if (removed) changes.push(`${removed} ${removed === 1 ? "day off" : "days off"} removed`);
  const allowedBefore = new Set(before.allowed);
  const allowedAfter = new Set(after.allowed);
  const nowAllowed = after.allowed.filter((date) => !allowedBefore.has(date)).length;
  const nowKept = before.allowed.filter((date) => !allowedAfter.has(date)).length;
  if (nowAllowed) changes.push(`${nowAllowed} ${nowAllowed === 1 ? "holiday" : "holidays"} now called`);
  if (nowKept) changes.push(`${nowKept} ${nowKept === 1 ? "holiday" : "holidays"} off again`);
  return changes;
}

/** `Thu Nov 26, 2026` for an ISO date, read as a calendar date (no timezone shift). */
export function longDate(iso: string): string {
  const [y, m, d] = iso.split("-").map(Number);
  const date = new Date(Date.UTC(y, (m ?? 1) - 1, d ?? 1));
  return date.toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric", year: "numeric", timeZone: "UTC" }).replace(/,(?= \w{3} )/, "");
}
