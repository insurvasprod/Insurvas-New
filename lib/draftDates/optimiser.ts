// The draft-date optimiser (LA-3.9). Client-safe and pure: the Payment step, the standalone
// calculator and the policy re-run all call `recommendDraftDay`, so the reason Ray reads aloud is the
// same sentence everywhere.
//
// The rule: land the draft 2–4 days after the money arrives, never after the 28th, and safe in
// EVERY month of the next twelve — the 3rd Wednesday moves between the 15th and the 21st, so a day
// that is safe this month can be early next month.

import { federalHolidays, iso, isBusinessDay, nthWeekday, previousBusinessDay, type IsoDate } from "./holidays.ts";
import type { IncomeType } from "../applications/constants.ts";

export type PayFrequency = "weekly" | "biweekly" | "semimonthly" | "monthly";

export type DraftDateInput = {
  incomeType: IncomeType;
  /** Day of the month the beneficiary was born (SSA schedule). */
  birthDay?: number | null;
  /** Receiving Social Security since before May 1997 (paid on the 3rd). */
  before1997?: boolean;
  /** Pension: the day of the month it is paid. */
  pensionDay?: number | null;
  payFrequency?: PayFrequency | null;
  /** Payroll: a known payday, YYYY-MM-DD. */
  payAnchor?: IsoDate | null;
  /** Days after arrival to aim for — tenant setting, 2–4, default 3. */
  buffer?: number;
  /** First month drafted; defaults to next month. */
  from?: Date;
};

export type DraftOption = { day: number; minGapDays: number; reason: string };

export type DraftRecommendation =
  | { kind: "recommended"; recommended: DraftOption; alternates: DraftOption[]; schedule: string; arrivals: { month: string; date: IsoDate }[] }
  | { kind: "neutral"; recommended: DraftOption; alternates: DraftOption[]; schedule: string; arrivals: [] ; why: string }
  | { kind: "not_applicable"; why: string };

export const MAX_DRAFT_DAY = 28;
const MONTHS = 12;
const NEUTRAL_DAY = 15;

function ordinal(n: number) {
  const s = n % 100 >= 11 && n % 100 <= 13 ? "th" : ({ 1: "st", 2: "nd", 3: "rd" } as Record<number, string>)[n % 10] ?? "th";
  return `${n}${s}`;
}

const WEEK_NAME = { 2: "second", 3: "third", 4: "fourth" } as const;

function ssaWeek(birthDay: number): 2 | 3 | 4 {
  return birthDay <= 10 ? 2 : birthDay <= 20 ? 3 : 4;
}

function addDays(date: IsoDate, days: number): IsoDate {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

function dayDiff(a: IsoDate, b: IsoDate) {
  return Math.round((Date.parse(`${a}T00:00:00Z`) - Date.parse(`${b}T00:00:00Z`)) / 86_400_000);
}

/** Every date money lands in the window, one month either side of the drafted months. */
function paydays(input: DraftDateInput, months: { year: number; month: number }[]): IsoDate[] {
  const out: IsoDate[] = [];
  const window = [
    (() => { const f = months[0]; return f.month === 1 ? { year: f.year - 1, month: 12 } : { year: f.year, month: f.month - 1 }; })(),
    ...months,
  ];
  const t = input.incomeType;
  for (const { year, month } of window) {
    if (t === "ssa" && !input.before1997) out.push(previousBusinessDay(iso(year, month, nthWeekday(year, month, 3, ssaWeek(input.birthDay ?? 1)))));
    if ((t === "ssa" && input.before1997) || t === "ssa_ssi") out.push(previousBusinessDay(iso(year, month, 3)));
    if (t === "ssi" || t === "va") out.push(previousBusinessDay(iso(year, month, 1)));
    if (t === "pension" && input.pensionDay) {
      const last = new Date(Date.UTC(year, month, 0)).getUTCDate();
      out.push(previousBusinessDay(iso(year, month, Math.min(input.pensionDay, last))));
    }
    if (t === "payroll" && input.payFrequency === "semimonthly") {
      out.push(previousBusinessDay(iso(year, month, 1)), previousBusinessDay(iso(year, month, 15)));
    }
    if (t === "payroll" && input.payFrequency === "monthly" && input.payAnchor) {
      const day = Number(input.payAnchor.slice(8, 10));
      const last = new Date(Date.UTC(year, month, 0)).getUTCDate();
      out.push(previousBusinessDay(iso(year, month, Math.min(day, last))));
    }
  }
  if (t === "payroll" && (input.payFrequency === "weekly" || input.payFrequency === "biweekly") && input.payAnchor) {
    const step = input.payFrequency === "weekly" ? 7 : 14;
    const start = iso(window[0].year, window[0].month, 1);
    const end = iso(months[months.length - 1].year, months[months.length - 1].month, 28);
    let d = input.payAnchor;
    while (d > start) d = addDays(d, -step);
    for (; d <= end; d = addDays(d, step)) if (d >= start) out.push(previousBusinessDay(d));
  }
  return out.sort();
}

function describe(input: DraftDateInput): string {
  switch (input.incomeType) {
    case "ssa": return input.before1997 ? "Your Social Security lands on the 3rd" : `Your Social Security lands on the ${WEEK_NAME[ssaWeek(input.birthDay ?? 1)]} Wednesday`;
    case "ssa_ssi": return "Your Social Security lands on the 3rd";
    case "ssi": return "Your SSI lands on the 1st";
    case "va": return "Your VA benefit lands on the 1st";
    case "pension": return `Your pension lands on the ${ordinal(input.pensionDay ?? 1)}`;
    // Said out loud, so it names when: "Your paycheck lands." read as a sentence cut short.
    case "payroll":
      if (input.payFrequency === "semimonthly") return "Your paycheck lands on the 1st and the 15th";
      if (input.payFrequency === "monthly" && input.payAnchor) return `Your paycheck lands on the ${ordinal(Number(input.payAnchor.slice(8, 10)))}`;
      if (input.payFrequency === "weekly") return "You are paid every week";
      if (input.payFrequency === "biweekly") return "You are paid every two weeks";
      return "Your paycheck lands";
    default: return "";
  }
}

function monthsFrom(from: Date) {
  const out: { year: number; month: number }[] = [];
  let y = from.getUTCFullYear();
  let m = from.getUTCMonth() + 2; // next month
  for (let i = 0; i < MONTHS; i++) {
    if (m > 12) { m = 1; y++; }
    out.push({ year: y, month: m });
    m++;
  }
  return out;
}

/**
 * Recommend a draft day. For each candidate day 1–28 it finds, in every drafted month, the gap
 * between the draft and the last deposit before it; the recommendation is the day whose smallest
 * gap is the buffer (default 3), and the alternates are the nearest days whose smallest gap is still
 * 2–4. Direct bill is not drafted, and says so.
 */
export function recommendDraftDay(input: DraftDateInput): DraftRecommendation {
  if (input.incomeType === "none") {
    const neutral = { day: NEUTRAL_DAY, minGapDays: 0, reason: `We will draft on the ${ordinal(NEUTRAL_DAY)}. Without knowing when money arrives, the middle of the month is the safest guess — ask when their income lands and run this again.` };
    return { kind: "neutral", recommended: neutral, alternates: [], schedule: "No income schedule", arrivals: [], why: "Income timing is unknown." };
  }
  if (input.incomeType === "ssa" && !input.before1997 && !(input.birthDay && input.birthDay >= 1 && input.birthDay <= 31)) {
    return { kind: "not_applicable", why: "The Social Security schedule needs the day of the month they were born." };
  }
  if (input.incomeType === "pension" && !(input.pensionDay && input.pensionDay >= 1 && input.pensionDay <= 31)) {
    return { kind: "not_applicable", why: "Enter the day of the month the pension is paid." };
  }
  if (input.incomeType === "payroll" && (!input.payFrequency || (input.payFrequency !== "semimonthly" && !input.payAnchor))) {
    return { kind: "not_applicable", why: "Enter how often they are paid and one recent payday." };
  }

  const buffer = Math.min(4, Math.max(2, input.buffer ?? 3));
  const months = monthsFrom(input.from ?? new Date());
  const pays = paydays(input, months);
  const scored: { day: number; minGap: number; maxGap: number }[] = [];
  for (let day = 1; day <= MAX_DRAFT_DAY; day++) {
    let minGap = Infinity;
    let maxGap = -Infinity;
    for (const { year, month } of months) {
      const draft = iso(year, month, day);
      const before = pays.filter((p) => p <= draft);
      const last = before[before.length - 1];
      const gap = last ? dayDiff(draft, last) : Infinity;
      minGap = Math.min(minGap, gap);
      maxGap = Math.max(maxGap, gap);
    }
    scored.push({ day, minGap, maxGap });
  }
  const safe = scored.filter((s) => s.minGap >= 2 && Number.isFinite(s.minGap));
  const pick = (target: number) => safe.filter((s) => s.minGap >= target).sort((a, b) => a.minGap - b.minGap || a.maxGap - b.maxGap || a.day - b.day)[0];
  const best = pick(buffer) ?? pick(2) ?? scored.sort((a, b) => b.minGap - a.minGap)[0];
  const lead = describe(input);
  const option = (s: { day: number; minGap: number }): DraftOption => ({
    day: s.day,
    minGapDays: s.minGap,
    reason: `${lead}. We will draft on the ${ordinal(s.day)}, so the money is always in the account first.`,
  });
  const alternates = safe
    .filter((s) => s.day !== best.day && s.minGap >= 2 && s.minGap <= 4)
    .sort((a, b) => Math.abs(a.day - best.day) - Math.abs(b.day - best.day) || a.day - b.day)
    .slice(0, 2)
    .sort((a, b) => a.day - b.day)
    .map(option);

  const firstPerMonth = months.map(({ year, month }) => {
    const prefix = iso(year, month, 1).slice(0, 7);
    const inMonth = pays.filter((p) => p.startsWith(prefix));
    return { month: prefix, date: inMonth[inMonth.length - 1] ?? pays.filter((p) => p < `${prefix}-01`).pop() ?? `${prefix}-01` };
  });
  return { kind: "recommended", recommended: option(best), alternates, schedule: lead, arrivals: firstPerMonth };
}

/** Is `day` safe — at least two days after every deposit in the next twelve months? */
export function isSafeDraftDay(input: DraftDateInput, day: number) {
  const rec = recommendDraftDay({ ...input });
  if (rec.kind !== "recommended") return rec.kind === "neutral";
  const months = monthsFrom(input.from ?? new Date());
  const pays = paydays(input, months);
  return months.every(({ year, month }) => {
    const draft = iso(year, month, day);
    const last = pays.filter((p) => p <= draft).pop();
    return last ? dayDiff(draft, last) >= 2 : false;
  });
}

export { federalHolidays, isBusinessDay };
