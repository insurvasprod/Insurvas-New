// LA-2.7 · How many times to call, how far apart, and at what time of day.
//
// Three ideas the task keeps deliberately separate, and so does this file:
//
//   window   may I legally dial now?           LA-2.4, lib/callingWindow/engine.ts
//   cadence  how many attempts, how far apart?  here
//   slot     what time of day should this be?   here
//
// SLOT ROTATION IS THE POINT. The existing retry rule says "+4 hours in a different time slot" and
// the dialer's hint says "Retry tomorrow, different slot" — and nothing anywhere implements slot
// diversity. It is described in two places and built in none.
//
// It matters more than the intervals do. Calling the same person at 10am four days running tests
// one hypothesis four times. Morning, lunchtime, evening, Saturday tests four.
//
// Pure: no database, no clock. The caller passes `now`.

/** The legal window divided into parts of the day a person's habits differ across. */
export const SLOTS = [
  "early_morning",
  "late_morning",
  "afternoon",
  "early_evening",
  "late_evening",
  "weekend",
] as const;
export type Slot = (typeof SLOTS)[number];

/**
 * The board's three preferences (20260924230300). Not slots — parts of the day a person thinks in —
 * so the scheduler resolves each one to an instant inside the legal window, then records the slot
 * that instant falls in:
 *
 *   morning        before noon in the customer's zone
 *   evening        from 5pm in the customer's zone
 *   opposite_half  the other half of the day from the previous dial
 */
export const DAY_PARTS = ["opposite_half", "morning", "evening"] as const;
export type DayPart = (typeof DAY_PARTS)[number];

/** Everything a cadence rule may prefer: a part of the day, or one of the six fixed slots. */
export const PREFERRED_TIMES = [...DAY_PARTS, ...SLOTS] as const;
export type PreferredTime = (typeof PREFERRED_TIMES)[number];

export function isDayPart(value: string | null | undefined): value is DayPart {
  return (DAY_PARTS as readonly string[]).includes(value ?? "");
}

/**
 * The local hours [from, to) a day part asks for. `lastLocalHour` is the hour of the previous dial
 * in the customer's zone, which is what "opposite half" is opposite to. Mirrors the SQL exactly.
 */
export function dayPartHours(part: DayPart, lastLocalHour: number): { from: number; to: number } {
  if (part === "morning") return { from: 0, to: 12 };
  if (part === "evening") return { from: 17, to: 24 };
  return lastLocalHour < 12 ? { from: 12, to: 24 } : { from: 0, to: 12 };
}

/**
 * The first quarter-hour at or after `floorMinute` (minutes from the floor's local midnight, may
 * run past 1440 into later days) that is inside the day part AND inside the legal window.
 *
 * Pure stand-in for the SQL walk, over one repeating legal window `[windowStart, windowEnd)` in
 * local minutes. Returns minutes from the same midnight, or null when nothing within `days` fits —
 * the scheduler then falls back to ordinary rotation instead of never calling.
 */
export function firstPreferredMinute(input: {
  part: DayPart;
  lastLocalHour: number;
  floorMinute: number;
  window: { start: number; end: number };
  days?: number;
}): number | null {
  const { from, to } = dayPartHours(input.part, input.lastLocalHour);
  const limit = input.floorMinute + (input.days ?? 8) * 1440;
  let at = input.floorMinute;
  while (at <= limit) {
    const minuteOfDay = ((at % 1440) + 1440) % 1440;
    const hour = Math.floor(minuteOfDay / 60);
    if (hour >= from && hour < to && minuteOfDay >= input.window.start && minuteOfDay < input.window.end) return at;
    at = (Math.floor(at / 15) + 1) * 15;
  }
  return null;
}

/**
 * Which slot an hour falls in, in the customer's local time.
 *
 * Weekend is a slot rather than a flag, because "we have tried this person four times on weekdays
 * and never on a Saturday" is precisely the gap rotation exists to close. It therefore wins over
 * the hour when both apply.
 */
export function slotForLocalTime(hour: number, weekday: number): Slot {
  if (weekday === 0 || weekday === 6) return "weekend";
  if (hour < 10) return "early_morning";
  if (hour < 12) return "late_morning";
  if (hour < 15) return "afternoon";
  if (hour < 18) return "early_evening";
  return "late_evening";
}

/**
 * The next slot to try: one this lead has not failed in yet, if any remain.
 *
 * The criterion is "never retried into a slot it has already failed in **while an unused slot
 * remains**" — so once every slot is used the rotation falls back to the least recently tried,
 * rather than refusing to call. A lead that has been tried everywhere is still worth one more
 * attempt if the cadence has attempts left; it just no longer has a fresh hypothesis to test.
 *
 * `preferred` is the cadence row's suggestion. It wins only if it is actually unused — a stored
 * preference must not override the evidence that it already failed.
 */
export function nextSlot(input: {
  triedSlots: readonly Slot[];
  preferred?: Slot | null;
  /** Slots the legal window actually reaches. A 9-17 window can never produce late_evening. */
  availableSlots?: readonly Slot[];
}): { slot: Slot; reason: "preferred_unused" | "unused" | "least_recent" } {
  const available = input.availableSlots?.length ? input.availableSlots : SLOTS;
  const tried = input.triedSlots;

  if (input.preferred && available.includes(input.preferred) && !tried.includes(input.preferred)) {
    return { slot: input.preferred, reason: "preferred_unused" };
  }

  const unused = available.filter((slot) => !tried.includes(slot));
  if (unused.length > 0) return { slot: unused[0], reason: "unused" };

  // Everything has been tried. The one tried longest ago is the best remaining hypothesis —
  // `triedSlots` is oldest-first, so the earliest entry still present is the least recent.
  const leastRecent = available.find((slot) => slot === tried.find((t) => available.includes(t)));
  return { slot: leastRecent ?? available[0], reason: "least_recent" };
}

export type CadenceRow = {
  attemptNumber: number;
  /** Postgres-style interval, validated by `parseInterval`. */
  delayInterval: string;
  /** A fixed slot, or one of the board's day parts (see `DAY_PARTS`). */
  preferredSlot?: PreferredTime | null;
  /** null applies to every disposition; otherwise only that one. */
  dispositionScope?: string | null;
};

/**
 * The default cadence, front-loaded.
 *
 * The current production defaults are +4h, +1d, +3d with a ceiling of seven, spread over a
 * fortnight. Most contacts happen in the first 72 hours, so the attempts belong there. This is the
 * table from the task, verbatim.
 */
export const DEFAULT_CADENCE: CadenceRow[] = [
  { attemptNumber: 1, delayInterval: "2 hours", preferredSlot: null },
  { attemptNumber: 2, delayInterval: "1 day", preferredSlot: null },
  { attemptNumber: 3, delayInterval: "1 day", preferredSlot: null },
  { attemptNumber: 4, delayInterval: "2 days", preferredSlot: "weekend" },
  { attemptNumber: 5, delayInterval: "3 days", preferredSlot: null },
  { attemptNumber: 6, delayInterval: "5 days", preferredSlot: null },
];

/** After this many attempts the lead is exhausted and moves to nurture. */
export const DEFAULT_CEILING = 7;

const INTERVAL_PATTERN = /^\s*(\d{1,4})\s+(minute|hour|day|week)s?\s*$/i;

/**
 * Parse and validate an interval, returning milliseconds.
 *
 * The current delay field accepts any string and sends it to Postgres as an interval. Typing
 * `banana` sends `banana`. This is the validation the task asks for, and it lives here rather than
 * in a form so that the API, an import and a future admin screen cannot each have their own idea of
 * what a valid delay is.
 *
 * Deliberately narrow: a whole number of minutes, hours, days or weeks. Postgres would accept
 * `1 mon 3 days 04:05:06`, and a cadence nobody can read at a glance is a cadence nobody will
 * notice is wrong.
 */
export function parseInterval(value: unknown): { ok: true; ms: number } | { ok: false; error: string } {
  if (typeof value !== "string" || value.trim() === "") {
    return { ok: false, error: "A delay is required, for example \"2 hours\"." };
  }
  const match = INTERVAL_PATTERN.exec(value);
  if (!match) {
    return { ok: false, error: `"${value}" is not a valid delay. Use a whole number and a unit, for example "2 hours" or "3 days".` };
  }
  const amount = Number(match[1]);
  if (amount <= 0) return { ok: false, error: "A delay must be more than zero." };

  const unit = match[2].toLowerCase();
  const ms = amount * ({ minute: 60_000, hour: 3_600_000, day: 86_400_000, week: 604_800_000 }[unit] as number);
  return { ok: true, ms };
}

export type NextAttempt = {
  /** null when the lead has reached the ceiling. */
  dueAt: Date | null;
  attemptNumber: number;
  slot: Slot | null;
  exhausted: boolean;
  reason: string;
};

/**
 * When, and in which slot, should this lead be tried next?
 *
 * Returns `exhausted` rather than a date once the ceiling is reached. "A lead hitting the ceiling
 * moves to nurture and stops being served" is a criterion, and returning a date far in the future
 * would have been the easy way to express that and the wrong one — it would still be served,
 * eventually, by a queue that only checks whether the timer has elapsed.
 */
export function scheduleNextAttempt(input: {
  attemptsMade: number;
  lastDisposition?: string | null;
  triedSlots: readonly Slot[];
  cadence?: CadenceRow[];
  ceiling?: number;
  availableSlots?: readonly Slot[];
  now: Date;
}): NextAttempt {
  const ceiling = input.ceiling ?? DEFAULT_CEILING;
  const attemptNumber = input.attemptsMade + 1;

  // `attemptsMade` counts the dial just dispositioned, so reaching the ceiling means that many
  // dials have happened: with a ceiling of seven, the seventh is the last (20260924230300; the SQL
  // used to stop at six with `ceiling - 1`).
  if (input.attemptsMade >= ceiling) {
    return {
      dueAt: null,
      attemptNumber,
      slot: null,
      exhausted: true,
      reason: `This lead has been tried ${input.attemptsMade} times, which is the ceiling of ${ceiling}. It moves to nurture.`,
    };
  }

  const rows = input.cadence?.length ? input.cadence : DEFAULT_CADENCE;

  // A disposition-specific row wins over the catch-all: "no-answer and voicemail should not behave
  // identically" is the task's own note, and without this they do.
  const row =
    rows.find((r) => r.attemptNumber === attemptNumber - 0 && r.dispositionScope === input.lastDisposition) ??
    rows.find((r) => r.attemptNumber === attemptNumber && (r.dispositionScope == null)) ??
    rows[rows.length - 1];

  const parsed = parseInterval(row.delayInterval);
  if (!parsed.ok) {
    return { dueAt: null, attemptNumber, slot: null, exhausted: false, reason: `The cadence row is invalid: ${parsed.error}` };
  }

  const { slot, reason } = nextSlot({
    triedSlots: input.triedSlots,
    // A day part is resolved to an instant by the SQL scheduler (it needs the legal window and the
    // customer's zone); here only a fixed slot can be a rotation preference.
    preferred: row.preferredSlot && !isDayPart(row.preferredSlot) ? row.preferredSlot : null,
    availableSlots: input.availableSlots,
  });

  return {
    dueAt: new Date(input.now.getTime() + parsed.ms),
    attemptNumber,
    slot,
    exhausted: false,
    reason: `Attempt ${attemptNumber} in ${row.delayInterval}, ${slot.replace(/_/g, " ")} (${reason.replace(/_/g, " ")}).`,
  };
}

/**
 * How many of a cadence's attempts land inside a window, counting the first dial at t=0.
 *
 * Exists because criterion 6 — "five of seven fall within the first 72 hours on the default" — is a
 * measurable claim, and the default table in the same document does not satisfy it. See the audit.
 */
export function attemptsWithin(hours: number, cadence: CadenceRow[] = DEFAULT_CADENCE): number {
  const limit = hours * 3_600_000;
  let elapsed = 0;
  let count = 1; // the first dial, at t=0
  for (const row of cadence) {
    const parsed = parseInterval(row.delayInterval);
    if (!parsed.ok) break;
    elapsed += parsed.ms;
    if (elapsed <= limit) count += 1;
    else break;
  }
  return count;
}
