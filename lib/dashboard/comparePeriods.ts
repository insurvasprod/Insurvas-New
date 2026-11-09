/**
 * Compare's periods (owner 2026-11-07): the pair of ranges for a preset, the custom pop-up's rules, the labels.
 * Pure and alias-free, so the client controls can import it and lib/dashboard/compare.test.mjs runs it under node.
 */

export type Range = { from: string; to: string };
export type Preset = "day" | "week" | "month" | "quarter" | "ytd" | "custom";
export type PeriodPair = { preset: Preset; a: Range; b: Range; aLabel: string; bLabel: string };

export const PRESETS: ReadonlyArray<{ key: Preset; label: string }> = [
  // Short names (critique #9): the dates beside the chips say what each is set against.
  { key: "day", label: "Today" },
  { key: "week", label: "This week" },
  { key: "month", label: "This month" },
  { key: "quarter", label: "This quarter" },
  { key: "ytd", label: "Year to date" },
];

const DAY = 86_400_000;
const utc = (day: string) => Date.parse(`${day}T00:00:00Z`);
export const addDays = (day: string, n: number) => new Date(utc(day) + n * DAY).toISOString().slice(0, 10);
const ymd = (y: number, m: number, d: number) => new Date(Date.UTC(y, m, d)).toISOString().slice(0, 10);
/** Day `n` of a month, never past its last day (Mar 31 → Feb 28). */
const clampDay = (y: number, m: number, d: number) => ymd(y, m, Math.min(d, new Date(Date.UTC(y, m + 1, 0)).getUTCDate()));
export const daysIn = (range: Range) => Math.round((utc(range.to) - utc(range.from)) / DAY) + 1;
const ISO = /^\d{4}-\d{2}-\d{2}$/;

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
/** "Nov 1–6, 2026", "Oct 26 – Nov 1, 2026", "Nov 6, 2026". */
export function rangeLabel(range: Range): string {
  const [fy, fm, fd] = range.from.split("-").map(Number);
  const [ty, tm, td] = range.to.split("-").map(Number);
  if (range.from === range.to) return `${MONTHS[fm - 1]} ${fd}, ${fy}`;
  if (fy === ty && fm === tm) return `${MONTHS[fm - 1]} ${fd}–${td}, ${ty}`;
  if (fy === ty) return `${MONTHS[fm - 1]} ${fd} – ${MONTHS[tm - 1]} ${td}, ${ty}`;
  return `${MONTHS[fm - 1]} ${fd}, ${fy} – ${MONTHS[tm - 1]} ${td}, ${ty}`;
}

/**
 * The two periods for a preset, each "so far" against the same stretch of the one before it, so the pair is like for
 * like: this month to today against last month to the same day, this week (from Monday) against last week to the same
 * weekday, and so on. A custom pair is taken as given when both ranges are real dates, else this month.
 */
export function periodPair(preset: Preset, today: string, custom?: { a?: Partial<Range>; b?: Partial<Range> }): PeriodPair {
  const [y, m, d] = today.split("-").map(Number);
  const mi = m - 1;
  let a: Range;
  let b: Range;
  switch (preset) {
    case "day":
      a = { from: today, to: today };
      b = { from: addDays(today, -1), to: addDays(today, -1) };
      break;
    case "week": {
      const weekday = (new Date(utc(today)).getUTCDay() + 6) % 7; // Monday 0
      const start = addDays(today, -weekday);
      a = { from: start, to: today };
      b = { from: addDays(start, -7), to: addDays(today, -7) };
      break;
    }
    case "quarter": {
      const q = Math.floor(mi / 3) * 3;
      const offset = Math.round((utc(today) - utc(ymd(y, q, 1))) / DAY);
      const prevStart = ymd(y, q - 3, 1);
      a = { from: ymd(y, q, 1), to: today };
      b = { from: prevStart, to: [addDays(prevStart, offset), addDays(ymd(y, q, 1), -1)].sort()[0] };
      break;
    }
    case "ytd":
      a = { from: ymd(y, 0, 1), to: today };
      b = { from: ymd(y - 1, 0, 1), to: clampDay(y - 1, mi, d) };
      break;
    case "custom": {
      const ok = (r?: Partial<Range>) => Boolean(r?.from && r?.to && ISO.test(r.from) && ISO.test(r.to) && r.from <= r.to);
      if (ok(custom?.a) && ok(custom?.b)) {
        a = { from: custom!.a!.from!, to: custom!.a!.to! };
        b = { from: custom!.b!.from!, to: custom!.b!.to! };
        break;
      }
      return periodPair("month", today);
    }
    default:
      a = { from: ymd(y, mi, 1), to: today };
      b = { from: ymd(y, mi - 1, 1), to: clampDay(y, mi - 1, d) };
  }
  return { preset, a, b, aLabel: rangeLabel(a), bLabel: rangeLabel(b) };
}

/** "Same days last month" etc. for the custom pop-up: the B range that follows A by a rule. */
export function followingB(a: Range, rule: "month" | "year" | "before"): Range {
  if (rule === "before") {
    const n = daysIn(a);
    return { from: addDays(a.from, -n), to: addDays(a.from, -1) };
  }
  const shift = (day: string) => {
    const [y, m, d] = day.split("-").map(Number);
    return rule === "year" ? clampDay(y - 1, m - 1, d) : clampDay(y, m - 2, d);
  };
  return { from: shift(a.from), to: shift(a.to) };
}

