// LA-2.4-2 / LA-2.4-3 · the state calling rules board, as data.
//
// Pure: no database, no clock (the caller passes `today`), no `server-only`, so the admin editor and
// its tests import the same rules the API enforces. The platform writes no legal data itself: every
// rule on this board is published by a super admin, with the statute it comes from.

import { z } from "zod";

export type StateRuleVersion = {
  id: string;
  state: string;
  /** YYYY-MM-DD. The first day the rule applies. */
  effectiveFrom: string;
  /** YYYY-MM-DD, exclusive: the first day it no longer applies. Null = open-ended. */
  effectiveTo: string | null;
  /** HH:MM, customer's local time. */
  startLocal: string;
  endLocal: string;
  /** 0 = Sunday … 6 = Saturday. */
  allowedWeekdays: number[];
  sundayStartLocal: string | null;
  sundayEndLocal: string | null;
  /** The state's holidays AND the federal calendar refuse the dial. */
  blockHolidays: boolean;
  source: string;
  notes: string | null;
  createdAt: string | null;
};

export type CallingHoliday = {
  id: string;
  /** Null = every state (the federal calendar). */
  state: string | null;
  date: string;
  name: string;
  source: string | null;
  blocked: boolean;
};

export type CallingRulesBoard = {
  states: { state: string; timezone: string | null }[];
  versions: StateRuleVersion[];
  holidays: CallingHoliday[];
  feed: { lastRefreshedAt: string; source: string; staleAfterDays: number; stale: boolean } | null;
  /** False until 20260929201000 is applied: the board reads, nothing saves. */
  schemaReady: boolean;
};

export type StateBoardRow = {
  state: string;
  timezone: string | null;
  inForce: StateRuleVersion | null;
  /** Versions that start after today, soonest first. */
  scheduled: StateRuleVersion[];
  /** False when nothing but the federal window applies (no row, or the seeded federal placeholder). */
  hasStateRule: boolean;
};

export const FEDERAL_START = "08:00";
export const FEDERAL_END = "21:00";
export const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"] as const;

/** The seed's name for a row that is only the federal window wearing a state code. */
const PLACEHOLDER_SOURCES = new Set(["platform_federal_default", "platform_conservative_default"]);

export const hhmm = (value: string | null | undefined) => (value ? value.slice(0, 5) : null);

/** A row that restates the federal window and says so in its source is not a state rule. */
export function isFederalPlaceholder(rule: StateRuleVersion): boolean {
  return (
    PLACEHOLDER_SOURCES.has(rule.source) &&
    hhmm(rule.startLocal) === FEDERAL_START &&
    hhmm(rule.endLocal) === FEDERAL_END &&
    rule.allowedWeekdays.length === 7 &&
    rule.sundayStartLocal === null
  );
}

/** The version in force on `today`: the latest that has started and not ended. Mirrors the SQL. */
export function versionOn(versions: StateRuleVersion[], today: string): StateRuleVersion | null {
  return (
    versions
      .filter((v) => v.effectiveFrom <= today && (v.effectiveTo === null || v.effectiveTo > today))
      .sort((a, b) => b.effectiveFrom.localeCompare(a.effectiveFrom))[0] ?? null
  );
}

/** One row per state the platform knows, whether or not it has a rule. */
export function buildStateBoard(
  states: { state: string; timezone: string | null }[],
  versions: StateRuleVersion[],
  today: string,
): StateBoardRow[] {
  const byState = new Map<string, StateRuleVersion[]>();
  for (const version of versions) byState.set(version.state, [...(byState.get(version.state) ?? []), version]);
  return states
    .map(({ state, timezone }) => {
      const own = byState.get(state) ?? [];
      const inForce = versionOn(own, today);
      const scheduled = own.filter((v) => v.effectiveFrom > today).sort((a, b) => a.effectiveFrom.localeCompare(b.effectiveFrom));
      return { state, timezone, inForce, scheduled, hasStateRule: inForce !== null && !isFederalPlaceholder(inForce) };
    })
    .sort((a, b) => a.state.localeCompare(b.state));
}

export function boardSummary(rows: StateBoardRow[], holidays: CallingHoliday[], today: string) {
  return {
    states: rows.length,
    withRule: rows.filter((row) => row.hasStateRule).length,
    withoutRule: rows.filter((row) => !row.hasStateRule).length,
    scheduled: rows.reduce((sum, row) => sum + row.scheduled.length, 0),
    upcomingHolidays: holidays.filter((h) => h.date >= today && h.blocked).length,
  };
}

/** "8:00 am – 8:00 pm" from "08:00" / "20:00". */
export function hoursLabel(start: string | null, end: string | null): string {
  if (!start || !end) return "—";
  const one = (value: string) => {
    const [h, m] = value.split(":").map(Number);
    const h12 = h % 12 === 0 ? 12 : h % 12;
    return `${h12}:${String(m).padStart(2, "0")} ${h < 12 ? "am" : "pm"}`;
  };
  return `${one(start)} – ${one(end)}`;
}

/** "Mon–Sat" for 1..6, "Every day" for all seven, else the list. */
export function daysLabel(days: number[]): string {
  const sorted = [...new Set(days)].sort((a, b) => a - b);
  if (sorted.length === 7) return "Every day";
  if (sorted.length > 1 && sorted.every((day, index) => index === 0 || day === sorted[index - 1] + 1))
    return `${WEEKDAYS[sorted[0]]}–${WEEKDAYS[sorted[sorted.length - 1]]}`;
  return sorted.map((day) => WEEKDAYS[day]).join(", ");
}

const TIME = /^([01]\d|2[0-4]):([0-5]\d)$/;
const DATE = /^\d{4}-\d{2}-\d{2}$/;
const within = (value: string) => value >= FEDERAL_START && value <= FEDERAL_END;

/** What a super admin submits to publish a state rule version. Checked in the browser and the route. */
export const publishRuleSchema = z
  .object({
    state: z.string().trim().toUpperCase().regex(/^[A-Z]{2}$/, "Choose a state"),
    effectiveFrom: z.string().regex(DATE, "Choose the date the rule takes effect"),
    startLocal: z.string().regex(TIME, "Enter a start time"),
    endLocal: z.string().regex(TIME, "Enter an end time"),
    allowedWeekdays: z.array(z.number().int().min(0).max(6)).min(1, "Allow at least one day").max(7),
    sundayStartLocal: z.string().regex(TIME).nullable(),
    sundayEndLocal: z.string().regex(TIME).nullable(),
    blockHolidays: z.boolean(),
    source: z.string().trim().min(3, "Name the statute or source this rule comes from").max(300),
    notes: z.string().trim().max(1000).nullable().optional(),
  })
  .strict()
  .superRefine((value, ctx) => {
    // Tighter only: a state rule can narrow the federal 8am–9pm window, never widen it.
    if (!within(value.startLocal) || !within(value.endLocal))
      ctx.addIssue({ code: "custom", path: ["startLocal"], message: "State hours must sit inside the federal 8:00 am – 9:00 pm." });
    if (value.startLocal >= value.endLocal) ctx.addIssue({ code: "custom", path: ["endLocal"], message: "The window has to end after it starts." });
    const sunday = [value.sundayStartLocal, value.sundayEndLocal];
    if ((sunday[0] === null) !== (sunday[1] === null))
      ctx.addIssue({ code: "custom", path: ["sundayEndLocal"], message: "Give Sunday both a start and an end, or neither." });
    if (sunday[0] && sunday[1]) {
      if (!value.allowedWeekdays.includes(0))
        ctx.addIssue({ code: "custom", path: ["sundayStartLocal"], message: "Sunday hours only apply when Sunday calls are allowed." });
      if (!within(sunday[0]) || !within(sunday[1]))
        ctx.addIssue({ code: "custom", path: ["sundayStartLocal"], message: "Sunday hours must sit inside the federal 8:00 am – 9:00 pm." });
      if (sunday[0] >= sunday[1]) ctx.addIssue({ code: "custom", path: ["sundayEndLocal"], message: "Sunday's window has to end after it starts." });
    }
  });

export type PublishRuleInput = z.infer<typeof publishRuleSchema>;

export const addHolidaySchema = z
  .object({
    state: z.string().trim().toUpperCase().regex(/^[A-Z]{2}$/).nullable(),
    date: z.string().regex(DATE, "Choose the holiday's date"),
    name: z.string().trim().min(2, "Name the holiday").max(120),
    source: z.string().trim().max(300).nullable().optional(),
  })
  .strict();

export type AddHolidayInput = z.infer<typeof addHolidaySchema>;

/** A rule may take effect today or later. Backdating would rewrite which calls were legal. */
export function effectiveDateProblem(effectiveFrom: string, today: string): string | null {
  return effectiveFrom < today ? "A rule cannot take effect in the past. Choose today or a later date." : null;
}

/** The database's refusal codes, as sentences. */
export function callingRuleErrorMessage(raw: string): string {
  const known: Record<string, string> = {
    CALLING_RULE_UNKNOWN_STATE: "That state is not one the platform has a timezone for.",
    CALLING_RULE_BACKDATED: "A rule cannot take effect in the past. Choose today or a later date.",
    CALLING_RULE_SOURCE_REQUIRED: "Name the statute or source this rule comes from.",
    CALLING_RULE_NO_DAYS: "Allow at least one day.",
    CALLING_RULE_DATE_TAKEN: "That state already has a rule starting on that date. Withdraw it first, or choose another date.",
    CALLING_RULE_NOT_FOUND: "That rule no longer exists.",
    CALLING_RULE_IN_FORCE: "A rule in force cannot be withdrawn. Publish a new version from a later date instead.",
    CALLING_HOLIDAY_PAST: "A holiday in the past cannot be added or removed.",
    CALLING_HOLIDAY_NAME_REQUIRED: "Name the holiday.",
    CALLING_HOLIDAY_EXISTS: "That date is already a holiday there.",
    CALLING_HOLIDAY_NOT_FOUND: "That holiday no longer exists.",
  };
  const code = Object.keys(known).find((key) => raw.includes(key));
  if (code) return known[code];
  if (/check constraint|violates check/i.test(raw)) return "State hours must sit inside the federal 8:00 am – 9:00 pm and end after they start.";
  return raw;
}
