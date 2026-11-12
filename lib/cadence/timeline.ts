// Settings › Dialing cadence (round 8, board A): one example lead walked through the cadence, so the
// screen can draw WHERE the calls land — and where calling windows push them — instead of a table.
//
// It replays the scheduler as deployed (schedule_next_attempt, 20260929201100, plus the serving
// query's slot gate) for a lead that never connects:
//
//   * the wait is a FLOOR: the next call is due `wait` after the previous one;
//   * a day part (morning, evening, opposite half) is resolved to the first legal quarter hour in
//     those hours, and an untried slot within a day of that wins (the SQL's rotation inside a part);
//   * otherwise a slot is chosen — the stored fixed slot while untried, else the unused slots in
//     order, advancing by attempt number, else the least recently tried — and the lead is served
//     the first legal moment that slot comes round (the serving query's `current_slot = slot`);
//   * "legal" is the calling window the agency set (its hours, no Sundays, no federal holidays,
//     a campaign's narrowing), inside the federal 8am–9pm. State statutes are NOT simulated: they
//     depend on the lead's state, and Calling windows lists them.
//
// Pure: no clock, no database. Time is minutes from the example's first midnight, in the lead's zone.

import { SLOTS, dayPartHours, isDayPart, parseInterval, slotForLocalTime, type PreferredTime, type Slot } from "./engine.ts";
import type { Band } from "./draft.ts";

export type TimelineStep = { attempt: number; delayInterval: string | null; preferredSlot: PreferredTime | null; outcomeRule?: boolean };

export type CallingRules = {
  /** The hours a call may start, minutes of the lead's day, [start, end). Already narrowed. */
  window: { start: number; end: number };
  noSunday: boolean;
  noHolidays: boolean;
  /** ISO date → holiday name ("2026-11-26" → "Thanksgiving Day"). */
  holidays: Record<string, string>;
};

export type SimulatedCall = {
  n: number;
  /** Minutes from the example's first midnight. */
  at: number;
  day: number;
  band: Band;
  /** The rule's due moment (the floor), when calling windows moved the call off that day. */
  wanted: { at: number; day: number; band: Band } | null;
  moved: boolean;
  /** "Sunday", "Thanksgiving Day", "after your calling hours" — why it moved. */
  movedBecause: string | null;
  delayInterval: string | null;
  preferredSlot: PreferredTime | null;
  outcomeRule?: boolean;
};

export type Simulation = {
  calls: SimulatedCall[];
  /** Calls the scheduler could not place within three weeks of being due (a window that never opens). */
  unplaced: number;
};

const DAY_MIN = 1440;
const SEARCH_DAYS = 21;

/** Weekday (0 = Sunday) and ISO date of example day `day`, counted from `startDate` (YYYY-MM-DD). */
export function dayInfo(startDate: string, day: number): { weekday: number; iso: string; date: Date } {
  const base = Date.parse(`${startDate}T00:00:00Z`);
  const date = new Date(base + day * 86_400_000);
  return { weekday: date.getUTCDay(), iso: date.toISOString().slice(0, 10), date };
}

export function bandAt(minuteOfDay: number): Band {
  if (minuteOfDay < 12 * 60) return "morning";
  if (minuteOfDay < 17 * 60) return "afternoon";
  return "evening";
}

/** Why example day `day` takes no calls at all, or null when it does. */
export function closedDay(startDate: string, day: number, rules: CallingRules): string | null {
  const { weekday, iso } = dayInfo(startDate, day);
  if (rules.noHolidays && rules.holidays[iso]) return rules.holidays[iso];
  if (rules.noSunday && weekday === 0) return "Sunday";
  return null;
}

function legal(startDate: string, at: number, rules: CallingRules): boolean {
  const day = Math.floor(at / DAY_MIN);
  const minute = at - day * DAY_MIN;
  if (minute < rules.window.start || minute >= rules.window.end) return false;
  return closedDay(startDate, day, rules) === null;
}

function slotAt(startDate: string, at: number): Slot {
  const day = Math.floor(at / DAY_MIN);
  return slotForLocalTime(Math.floor((at - day * DAY_MIN) / 60), dayInfo(startDate, day).weekday);
}

/** The next quarter hour on the clock after `at` (the SQL's step). */
const nextQuarter = (at: number) => (Math.floor(at / 15) + 1) * 15;

function firstLegal(startDate: string, from: number, rules: CallingRules, accept: (at: number) => boolean = () => true): number | null {
  const limit = from + SEARCH_DAYS * DAY_MIN;
  for (let at = from; at <= limit; at = nextQuarter(at)) if (legal(startDate, at, rules) && accept(at)) return at;
  return null;
}

export function simulateCadence(input: {
  steps: TimelineStep[];
  /** The example's first day, a Monday by convention (YYYY-MM-DD). */
  startDate: string;
  /** When the lead arrives, minutes of the first day. */
  arrival: number;
  rules: CallingRules;
}): Simulation {
  const { startDate, rules } = input;
  const calls: SimulatedCall[] = [];
  const tried: Slot[] = [];
  let unplaced = 0;

  const first = firstLegal(startDate, input.arrival, rules);
  if (first === null) return { calls, unplaced: input.steps.length };
  const push = (n: number, at: number, step: TimelineStep, due: number | null) => {
    const day = Math.floor(at / DAY_MIN);
    let wanted: SimulatedCall["wanted"] = null;
    let movedBecause: string | null = null;
    if (due !== null && !legal(startDate, due, rules)) {
      const dueDay = Math.floor(due / DAY_MIN);
      if (dueDay !== day) {
        wanted = { at: due, day: dueDay, band: bandAt(due - dueDay * DAY_MIN) };
        movedBecause = closedDay(startDate, dueDay, rules) ?? "after your calling hours";
      }
    }
    calls.push({ n, at, day, band: bandAt(at - day * DAY_MIN), wanted, moved: wanted !== null, movedBecause, delayInterval: step.delayInterval, preferredSlot: step.preferredSlot, outcomeRule: step.outcomeRule });
    tried.push(slotAt(startDate, at));
  };

  const ordered = [...input.steps].sort((a, b) => a.attempt - b.attempt);
  push(1, first, ordered[0] ?? { attempt: 1, delayInterval: null, preferredSlot: null }, null);
  let previous = first;

  for (const step of ordered) {
    if (step.attempt < 2) continue;
    const parsed = parseInterval(step.delayInterval ?? "");
    const due = previous + Math.round((parsed.ok ? parsed.ms : 0) / 60_000);
    let at: number | null = null;

    if (isDayPart(step.preferredSlot)) {
      const lastDay = Math.floor(previous / DAY_MIN);
      const { from, to } = dayPartHours(step.preferredSlot, Math.floor((previous - lastDay * DAY_MIN) / 60));
      const inPart = (t: number) => {
        const hour = Math.floor((t - Math.floor(t / DAY_MIN) * DAY_MIN) / 60);
        return hour >= from && hour < to;
      };
      const firstMatch = firstLegal(startDate, due, rules, inPart);
      if (firstMatch !== null && firstMatch - due <= 8 * DAY_MIN) {
        // Rotation inside the part: an untried slot within a day of the first legal match wins.
        const untried = firstLegal(startDate, firstMatch, rules, (t) => inPart(t) && !tried.includes(slotAt(startDate, t)));
        at = untried !== null && untried <= firstMatch + DAY_MIN ? untried : firstMatch;
      }
    }

    if (at === null) {
      const fixed = step.preferredSlot && !isDayPart(step.preferredSlot) ? (step.preferredSlot as Slot) : null;
      let slot: Slot;
      if (fixed && !tried.includes(fixed)) slot = fixed;
      else {
        const unused = SLOTS.filter((s) => !tried.includes(s));
        if (unused.length === 0) {
          // Least recently tried: the earliest last-use.
          const lastUse = new Map<Slot, number>();
          tried.forEach((s, index) => lastUse.set(s, index));
          slot = [...lastUse.entries()].sort((a, b) => a[1] - b[1] || a[0].localeCompare(b[0]))[0][0];
        } else slot = unused[(step.attempt - 1) % unused.length];
      }
      at = firstLegal(startDate, due, rules, (t) => slotAt(startDate, t) === slot) ?? firstLegal(startDate, due, rules);
    }

    if (at === null) {
      unplaced += 1;
      continue;
    }
    push(step.attempt, at, step, due);
    previous = at;
  }
  return { calls, unplaced };
}

/* ── words ──────────────────────────────────────────────────────────────── */

const WEEKDAY = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const MONTH = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/** "Mon 16" */
export function dayLabel(startDate: string, day: number): string {
  const { date } = dayInfo(startDate, day);
  return `${WEEKDAY[date.getUTCDay()]} ${date.getUTCDate()}`;
}

/** "Mon 16 Nov" */
export function longDayLabel(startDate: string, day: number): string {
  const { date } = dayInfo(startDate, day);
  return `${WEEKDAY[date.getUTCDay()]} ${date.getUTCDate()} ${MONTH[date.getUTCMonth()]}`;
}

/** 580 → "9:40am", 720 → "12pm". */
export function clockLabel(minuteOfDay: number): string {
  const m = ((minuteOfDay % DAY_MIN) + DAY_MIN) % DAY_MIN;
  const hour = Math.floor(m / 60);
  const minute = m % 60;
  const h12 = hour % 12 === 0 ? 12 : hour % 12;
  return `${h12}${minute ? `:${String(minute).padStart(2, "0")}` : ""}${hour < 12 ? "am" : "pm"}`;
}

/** "Mon 16 · 9:40am" */
export function callLabel(startDate: string, at: number): string {
  const day = Math.floor(at / DAY_MIN);
  return `${dayLabel(startDate, day)} · ${clockLabel(at - day * DAY_MIN)}`;
}

const NUMBER_WORDS = ["no", "one", "two", "three", "four", "five", "six", "seven", "eight", "nine", "ten"];
const words = (n: number) => NUMBER_WORDS[n] ?? String(n);

/**
 * The live sentence: "8 calls over 13 days, mostly in the afternoon. Half of them come in the first
 * 3 days." Every figure is counted from the simulation, never stated.
 */
export function summarize(sim: Simulation): {
  calls: number;
  days: number;
  /** "8 calls over 13 days" */
  headline: string;
  /** ", mostly in the afternoon" — empty for fewer than three calls. */
  when: string;
  /** "Half of them come in the first 3 days." — empty for a single call. */
  share: string;
} {
  const { calls } = sim;
  if (calls.length === 0) return { calls: 0, days: 0, headline: "no calls", when: "", share: "Your calling windows leave no time to call." };
  const days = calls[calls.length - 1].day + 1;
  const headline = `${calls.length} ${calls.length === 1 ? "call" : "calls"}${calls.length > 1 ? ` over ${days} ${days === 1 ? "day" : "days"}` : ""}`;
  const counts = { morning: 0, afternoon: 0, evening: 0 } as Record<Band, number>;
  calls.forEach((call) => (counts[call.band] += 1));
  const [top, topCount] = (Object.entries(counts) as [Band, number][]).sort((a, b) => b[1] - a[1])[0];
  const when = calls.length < 3 ? "" : topCount * 2 > calls.length ? `, mostly in the ${top}` : ", spread across the day";
  const early = calls.filter((call) => call.day < 3).length;
  const capital = (text: string) => `${text[0].toUpperCase()}${text.slice(1)}`;
  const share =
    calls.length < 2 ? ""
      : early === calls.length ? "All of them come in the first 3 days."
        : early * 2 === calls.length ? "Half of them come in the first 3 days."
          : early * 2 > calls.length ? `Most of them (${early}) come in the first 3 days.`
            : `${capital(words(early))} of them ${early === 1 ? "comes" : "come"} in the first 3 days.`;
  return { calls: calls.length, days, headline, when, share };
}

/** "3 hours later, any time" / "Next day, evening" / "2 days later, morning" — one line per call. */
export function waitWords(call: SimulatedCall, previous: SimulatedCall | undefined): string {
  if (!previous) return "As soon as the lead arrives";
  const gapDays = call.day - previous.day;
  const lead = gapDays === 0 ? `${call.delayInterval ?? "Later"} later` : gapDays === 1 ? "Next day" : `${gapDays} days later`;
  const part = call.preferredSlot === "morning" || call.preferredSlot === "evening" || call.preferredSlot === "afternoon"
    ? call.preferredSlot
    : call.preferredSlot === "opposite_half" ? "other half of the day"
      : call.preferredSlot === "weekend" ? "weekend"
        : call.preferredSlot ? call.preferredSlot.replace(/_/g, " ")
          : "any time";
  return `${lead[0].toUpperCase()}${lead.slice(1)}, ${part}`;
}
