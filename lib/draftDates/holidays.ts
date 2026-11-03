// US federal holidays (5 U.S.C. § 6103), observed dates. Computed from the rules, not a table:
// eleven holidays, fixed-date ones moving to Friday when they fall on Saturday and Monday when they
// fall on Sunday. That is the calendar the Fed, and so Social Security and bank posting, run on.

export type IsoDate = string; // YYYY-MM-DD

export function iso(year: number, month: number, day: number): IsoDate {
  return `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

function utc(year: number, month: number, day: number) {
  return new Date(Date.UTC(year, month - 1, day));
}

/** Day of the month of the nth `weekday` (0 = Sunday) of a month. n = -1 is the last one. */
export function nthWeekday(year: number, month: number, weekday: number, n: number): number {
  if (n === -1) {
    const last = new Date(Date.UTC(year, month, 0));
    const back = (last.getUTCDay() - weekday + 7) % 7;
    return last.getUTCDate() - back;
  }
  const first = utc(year, month, 1).getUTCDay();
  return 1 + ((weekday - first + 7) % 7) + (n - 1) * 7;
}

function observed(year: number, month: number, day: number): IsoDate {
  const d = utc(year, month, day);
  const dow = d.getUTCDay();
  if (dow === 6) d.setUTCDate(d.getUTCDate() - 1);
  if (dow === 0) d.setUTCDate(d.getUTCDate() + 1);
  return d.toISOString().slice(0, 10);
}

const cache = new Map<number, Set<IsoDate>>();

/** Observed federal holidays that fall in `year` (including a New Year's Day observed on Dec 31). */
export function federalHolidays(year: number): Set<IsoDate> {
  const hit = cache.get(year);
  if (hit) return hit;
  const days = [
    observed(year, 1, 1),
    iso(year, 1, nthWeekday(year, 1, 1, 3)), // Martin Luther King Jr. Day
    iso(year, 2, nthWeekday(year, 2, 1, 3)), // Washington's Birthday
    iso(year, 5, nthWeekday(year, 5, 1, -1)), // Memorial Day
    observed(year, 6, 19), // Juneteenth
    observed(year, 7, 4),
    iso(year, 9, nthWeekday(year, 9, 1, 1)), // Labor Day
    iso(year, 10, nthWeekday(year, 10, 1, 2)), // Columbus Day
    observed(year, 11, 11), // Veterans Day
    iso(year, 11, nthWeekday(year, 11, 4, 4)), // Thanksgiving
    observed(year, 12, 25),
    observed(year + 1, 1, 1), // next New Year's Day, observed Dec 31 when it is a Saturday
  ].filter((d) => d.startsWith(String(year)));
  const set = new Set(days);
  cache.set(year, set);
  return set;
}

export function isBusinessDay(date: IsoDate) {
  const d = new Date(`${date}T00:00:00Z`);
  const dow = d.getUTCDay();
  return dow !== 0 && dow !== 6 && !federalHolidays(d.getUTCFullYear()).has(date);
}

/** The date itself when it is a business day, otherwise the business day before it. */
export function previousBusinessDay(date: IsoDate): IsoDate {
  const d = new Date(`${date}T00:00:00Z`);
  while (!isBusinessDay(d.toISOString().slice(0, 10))) d.setUTCDate(d.getUTCDate() - 1);
  return d.toISOString().slice(0, 10);
}
