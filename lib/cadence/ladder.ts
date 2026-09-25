// The attempt ladder as the dialer actually walks it — read from the SQL, not from the task page.
//
// `schedule_next_attempt` (20260924230300) runs after a dial is dispositioned, with
// `attempts_made` ALREADY incremented, and looks up the rule for `attempt_number = attempts_made + 1`.
// So the rule stored as attempt N is the wait before the Nth dial, counted from dial N-1:
//
//   attempt 1   the first dial. No rule is ever read for it — a fresh lead is served at once.
//   attempt N   waits the attempt-N rule after attempt N-1; with no rule for N, the built-in delay.
//
// Which rules: a campaign that has ANY rule of its own runs only its own rules — "a campaign
// cadence replaces this one entirely; the two are never merged". A campaign with no rules runs
// the tenant default.
//
// And the ceiling: it refuses to schedule once `attempts_made >= 7`, so the seventh dial is the
// last. A rule for attempt 8 or later is stored and never read.
//
// Pure and dependency-free so the client can import it (no `server-only`).

import { DEFAULT_CEILING, parseInterval, type CadenceRow, type PreferredTime, type Slot } from "./engine";

/** The last attempt the dialer will make: the scheduler exhausts the lead after this dial. */
export const LAST_DIALLED_ATTEMPT = DEFAULT_CEILING;

/** `schedule_next_attempt`'s own fallback, by attempt number. Attempt 1 has none: it is t=0. */
export function builtInRule(attempt: number): { delayInterval: string; preferredSlot: Slot | null } {
  const delay = ({ 2: "1 day", 3: "1 day", 4: "2 days", 5: "3 days" } as Record<number, string>)[attempt] ?? "5 days";
  return { delayInterval: delay, preferredSlot: attempt === 4 ? "weekend" : null };
}

export type LadderStep = {
  attempt: number;
  /** "rule" = this scope's rule, "tenant" = the tenant default a campaign without rules runs. */
  source: "first" | "rule" | "tenant" | "builtin";
  delayInterval: string | null;
  preferredSlot: PreferredTime | null;
  /** Milliseconds from the first dial. The delay is a floor, so this is the earliest it can be. */
  offsetMs: number;
};

const catchAll = (rows: CadenceRow[], attempt: number) =>
  rows.find((row) => row.attemptNumber === attempt && (row.dispositionScope ?? null) === null);

/**
 * The steps the dialer takes for a lead that never answers, using each attempt's catch-all rule.
 * A disposition-specific rule replaces the catch-all only after that outcome, so it is not part of
 * the "no answer, ever" path this describes unless its disposition is the one that happened.
 *
 * `fallback` is the tenant default, read only when `rows` is empty — the scheduler never merges a
 * campaign's rules with the tenant's.
 */
export function effectiveLadder(
  rows: CadenceRow[],
  fallback: CadenceRow[] = [],
  /**
   * The scheduler as deployed. Until 20260924230300 is applied it stops after the sixth dial and
   * merges a campaign's rules with the tenant default attempt by attempt; the screen passes that
   * so it describes the dialer that is actually running.
   */
  options: { lastAttempt?: number; merge?: boolean } = {},
): LadderStep[] {
  const last = options.lastAttempt ?? LAST_DIALLED_ATTEMPT;
  const inherited = rows.length === 0 && fallback.length > 0;
  const steps: LadderStep[] = [{ attempt: 1, source: "first", delayInterval: null, preferredSlot: null, offsetMs: 0 }];
  let offset = 0;
  for (let attempt = 2; attempt <= last; attempt += 1) {
    const own = catchAll(inherited ? [] : rows, attempt);
    const tenant = own ? undefined : inherited || options.merge ? catchAll(fallback, attempt) : undefined;
    const rule = own ?? tenant;
    const delayInterval = rule ? rule.delayInterval : builtInRule(attempt).delayInterval;
    const parsed = parseInterval(delayInterval);
    offset += parsed.ok ? parsed.ms : 0;
    steps.push({
      attempt,
      source: own ? "rule" : tenant ? "tenant" : "builtin",
      delayInterval,
      preferredSlot: rule ? rule.preferredSlot ?? null : builtInRule(attempt).preferredSlot,
      offsetMs: offset,
    });
  }
  return steps;
}

const HOUR = 3_600_000;
const DAY = 24 * HOUR;

export function ladderSummary(steps: LadderStep[]) {
  const total = steps.length;
  const last = steps[steps.length - 1]?.offsetMs ?? 0;
  const first72 = steps.filter((step) => step.offsetMs <= 72 * HOUR).length;
  const week = steps.filter((step) => step.offsetMs > 72 * HOUR && step.offsetMs <= 7 * DAY).length;
  const later = steps.filter((step) => step.offsetMs > 7 * DAY).length;
  const gaps = steps.slice(1).map((step, index) => step.offsetMs - steps[index].offsetMs);
  const insideGaps = gaps.slice(0, Math.max(0, first72 - 1));
  const outsideGaps = gaps.slice(Math.max(0, first72 - 1));
  // "After that the gaps widen" is said only when every later gap is longer than every earlier one.
  const widens =
    insideGaps.length > 0 && outsideGaps.length > 0 && Math.min(...outsideGaps) > Math.max(...insideGaps);
  return { total, first72, week, later, days: Math.ceil(last / DAY), lastDay: Math.ceil(last / DAY), widens };
}

const WORDS = ["Zero", "One", "Two", "Three", "Four", "Five", "Six", "Seven", "Eight", "Nine", "Ten"];
export const countWord = (value: number) => WORDS[value] ?? String(value);
