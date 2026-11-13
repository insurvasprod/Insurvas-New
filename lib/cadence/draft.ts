// Settings › Dialing cadence (round 8, board A): the editor thinks in CALLS, the table in RULES.
//
// The timeline shows call 1, call 2 … call N on days; the table stores "rule N = the wait before dial
// N" (ladder.ts). This file is the translation, pure so the client and the tests share it:
//
//   * outcomes   the dispositions a rule can be scoped to, in plain words;
//   * materialise  every edit first writes the ladder that is RUNNING into rows (2..last), so a
//                  cadence is never saved with a gap and what is drawn is what is stored;
//   * edits      wait, part of the day, which outcomes follow a call, remove a call;
//   * presets    Gentle · Balanced · Persistent — starting points that fill the same rule model
//                (no schema of their own). Balanced IS the Insurvas default.
//
// Nothing here reaches the database: the route and replace_cadence_rules still validate every save.

import { DEFAULT_CADENCE, DEFAULT_CEILING, parseInterval, type CadenceRow, type PreferredTime } from "./engine.ts";
import { effectiveLadder } from "./ladder.ts";

/** The outcomes a rule may be scoped to — the codes the dialer dispositions with. */
export const OUTCOMES = ["no_answer", "voicemail", "busy", "callback", "not_interested"] as const;
export type Outcome = (typeof OUTCOMES)[number];

export const OUTCOME_LABELS: Record<Outcome, string> = {
  no_answer: "No answer",
  voicemail: "Voicemail",
  busy: "Busy",
  callback: "Callback",
  not_interested: "Not interested",
};

/** "A lead that never answers gets …" — the subject of the live sentence, per outcome tab. */
export const OUTCOME_SUBJECT: Record<Outcome, string> = {
  no_answer: "A lead that never answers",
  voicemail: "A lead that always goes to voicemail",
  busy: "A lead whose line is always busy",
  callback: "A lead marked Callback every time",
  not_interested: "A lead marked Not interested every time",
};

export function outcomeLabel(scope: string | null | undefined): string {
  if (!scope) return "Any outcome";
  if ((OUTCOMES as readonly string[]).includes(scope)) return OUTCOME_LABELS[scope as Outcome];
  const text = scope.replace(/_/g, " ");
  return text[0].toUpperCase() + text.slice(1);
}

const byAttempt = (a: CadenceRow, b: CadenceRow) =>
  a.attemptNumber - b.attemptNumber || Number(Boolean(a.dispositionScope)) - Number(Boolean(b.dispositionScope)) || String(a.dispositionScope ?? "").localeCompare(String(b.dispositionScope ?? ""));

const sameScope = (row: CadenceRow, attempt: number, scope: string | null) =>
  row.attemptNumber === attempt && (row.dispositionScope ?? null) === scope;

/**
 * The rows with a catch-all for every call from 2 to `last`, each missing one copied from the ladder
 * that runs today (this scope's rows, else the tenant default a campaign inherits, else built-in).
 * Disposition rows are kept as they are. A scope with no rows of its own becomes its own cadence here,
 * which is what editing it means: a campaign cadence replaces the agency's, the two never merge.
 */
export function materialize(rows: CadenceRow[], fallback: CadenceRow[], last: number): CadenceRow[] {
  const ladder = effectiveLadder(rows, fallback, { lastAttempt: last });
  const own = rows.length === 0 && fallback.length > 0 ? fallback.map((row) => ({ ...row })) : rows.map((row) => ({ ...row }));
  for (const step of ladder) {
    if (step.attempt < 2 || !step.delayInterval) continue;
    if (own.some((row) => sameScope(row, step.attempt, null))) continue;
    own.push({ attemptNumber: step.attempt, delayInterval: step.delayInterval, preferredSlot: step.preferredSlot ?? null, dispositionScope: null });
  }
  return own.sort(byAttempt);
}

export type RulePatch = Partial<Pick<CadenceRow, "delayInterval" | "preferredSlot">>;

/**
 * Change call `attempt` as seen on the `outcome` tab: that outcome's own row when it has one,
 * otherwise the shared rule every outcome without its own row follows.
 */
export function patchCall(rows: CadenceRow[], attempt: number, outcome: string | null, patch: RulePatch): CadenceRow[] {
  const own = outcome !== null && rows.some((row) => sameScope(row, attempt, outcome));
  const scope = own ? outcome : null;
  return rows.map((row) => (sameScope(row, attempt, scope) ? { ...row, ...patch } : row));
}

/** Give `outcome` its own rule for this call, starting as a copy of the shared one. */
export function splitOutcome(rows: CadenceRow[], attempt: number, outcome: string): CadenceRow[] {
  if (rows.some((row) => sameScope(row, attempt, outcome))) return rows;
  const shared = rows.find((row) => sameScope(row, attempt, null));
  if (!shared) return rows;
  return [...rows, { ...shared, dispositionScope: outcome }].sort(byAttempt);
}

/** `outcome` follows the shared rule for this call again. */
export function joinOutcome(rows: CadenceRow[], attempt: number, outcome: string): CadenceRow[] {
  return rows.filter((row) => !sameScope(row, attempt, outcome));
}

/** True when `outcome` has its own rule for this call. */
export function hasOwnRule(rows: CadenceRow[], attempt: number, outcome: string): boolean {
  return rows.some((row) => sameScope(row, attempt, outcome));
}

/** Calls where `outcome` differs from the shared rule, up to the last call. */
export function differingCalls(rows: CadenceRow[], outcome: string, last: number): number[] {
  return [...new Set(rows.filter((row) => row.dispositionScope === outcome && row.attemptNumber >= 2 && row.attemptNumber <= last).map((row) => row.attemptNumber))].sort((a, b) => a - b);
}

/** Remove call `attempt`: its rules go, and every later call moves up one (keeping its own wait). */
export function removeCall(rows: CadenceRow[], attempt: number): CadenceRow[] {
  return rows
    .filter((row) => row.attemptNumber !== attempt)
    .map((row) => (row.attemptNumber > attempt ? { ...row, attemptNumber: row.attemptNumber - 1 } : row))
    .sort(byAttempt);
}

const HOUR = 3_600_000;
const DAY = 24 * HOUR;

/** "3 hours", "1 day", "2 days" — a whole number and a unit, the only shape parseInterval accepts. */
export function intervalOf(amount: number, unit: "minute" | "hour" | "day"): string {
  const n = Math.max(1, Math.round(amount));
  return `${n} ${unit}${n === 1 ? "" : "s"}`;
}

/** An interval split for the popover's stepper: weeks shown as days, so three units cover everything. */
export function splitInterval(value: string): { amount: number; unit: "minute" | "hour" | "day" } {
  const parsed = parseInterval(value);
  if (!parsed.ok) return { amount: 1, unit: "day" };
  if (parsed.ms % DAY === 0) return { amount: parsed.ms / DAY, unit: "day" };
  if (parsed.ms % HOUR === 0) return { amount: parsed.ms / HOUR, unit: "hour" };
  return { amount: Math.round(parsed.ms / 60_000), unit: "minute" };
}

/**
 * A wait moved by whole days — a dot dragged sideways, or ← → on the timeline. A same-day wait
 * (minutes, hours) dragged forward becomes whole days; a wait dragged back to zero days becomes
 * the built-in same-day retry, two hours. Never zero or negative.
 */
export function shiftWait(value: string, deltaDays: number): string {
  if (deltaDays === 0) return value;
  const parsed = parseInterval(value);
  const ms = parsed.ok ? parsed.ms : DAY;
  const days = ms < DAY ? 0 : Math.round(ms / DAY);
  const next = days + deltaDays;
  if (next <= 0) return ms < DAY && deltaDays < 0 ? value : DEFAULT_CADENCE[0].delayInterval;
  return intervalOf(next, "day");
}

/** "+3h", "+1d", "+30m" — the timeline's wait row. */
export function shortWait(value: string | null): string {
  if (!value) return "now";
  const { amount, unit } = splitInterval(value);
  return `+${amount}${unit === "day" ? "d" : unit === "hour" ? "h" : "m"}`;
}

/** The parts of the day the timeline's rows and the popover offer, and the stored value for each. */
export const BANDS = ["morning", "afternoon", "evening"] as const;
export type Band = (typeof BANDS)[number];

/**
 * The stored preference for a timeline row. Morning and evening are the scheduler's day parts
 * (before noon; from 5pm). There is no afternoon day part: the afternoon row stores the scheduler's
 * fixed `afternoon` slot (noon–3pm), which it honours while that slot is untried for the lead.
 */
export const BAND_PREFERENCE: Record<Band, PreferredTime> = { morning: "morning", afternoon: "afternoon", evening: "evening" };

/** The timeline row a stored preference IS (not where a call lands): only the three above. */
export function bandOfPreference(value: PreferredTime | null | undefined): Band | null {
  return value === "morning" || value === "afternoon" || value === "evening" ? value : null;
}

/** "any time", "in the morning" … the preference in the words the sentence and History use. */
export const PREFERENCE_WORDS: Record<PreferredTime, string> = {
  morning: "in the morning",
  evening: "in the evening",
  opposite_half: "in the other half of the day",
  early_morning: "early morning (before 10am)",
  late_morning: "late morning (10am–noon)",
  afternoon: "in the afternoon (noon–3pm)",
  early_evening: "early evening (3–6pm)",
  late_evening: "late evening (from 6pm)",
  weekend: "at the weekend",
};

export function preferenceWords(value: PreferredTime | null | undefined): string {
  return value ? PREFERENCE_WORDS[value] : "any time";
}

/* ── presets ────────────────────────────────────────────────────────────── */

export type PresetKey = "gentle" | "balanced" | "persistent";
export type Preset = { key: PresetKey; label: string; maxAttempts: number; rows: CadenceRow[]; hint: string };

const row = (attemptNumber: number, delayInterval: string, preferredSlot: PreferredTime | null = null): CadenceRow => ({ attemptNumber, delayInterval, preferredSlot, dispositionScope: null });

/**
 * Starting points, not settings: choosing one writes ordinary rules and max calls into the draft,
 * which then edits like any other. Balanced is the Insurvas default, so "Reset" and "Balanced" agree.
 */
export const PRESETS: Preset[] = [
  {
    key: "gentle",
    label: "Gentle",
    maxAttempts: 5,
    hint: "Fewer calls, a day or more apart.",
    rows: [row(2, "1 day", "opposite_half"), row(3, "2 days"), row(4, "3 days", "evening"), row(5, "5 days")],
  },
  {
    key: "balanced",
    label: "Balanced",
    maxAttempts: DEFAULT_CEILING,
    hint: "The Insurvas default, front-loaded.",
    rows: DEFAULT_CADENCE.map((entry) => ({ ...entry, preferredSlot: entry.preferredSlot ?? null, dispositionScope: null })),
  },
  {
    key: "persistent",
    label: "Persistent",
    maxAttempts: 10,
    hint: "More calls, closer together in the first days.",
    rows: [
      row(2, "2 hours", "opposite_half"),
      row(3, "1 day", "evening"),
      row(4, "1 day", "morning"),
      row(5, "1 day", "opposite_half"),
      row(6, "2 days"),
      row(7, "2 days", "weekend"),
      row(8, "2 days", "evening"),
      row(9, "2 days"),
      row(10, "2 days"),
    ],
  },
];

/**
 * Apply a preset: its shared rules replace the shared ones, and an outcome's own rules are kept for
 * the calls the preset still makes (they are the agency's decisions, not the preset's).
 */
export function applyPreset(rows: CadenceRow[], preset: Preset): CadenceRow[] {
  const kept = rows.filter((entry) => entry.dispositionScope && entry.attemptNumber <= preset.maxAttempts);
  return [...preset.rows.map((entry) => ({ ...entry })), ...kept].sort(byAttempt);
}

const msOf = (value: string) => {
  const parsed = parseInterval(value);
  return parsed.ok ? parsed.ms : NaN;
};

/** The preset these shared rules and max calls are exactly, or null ("Custom"). */
export function matchPreset(rows: CadenceRow[], maxAttempts: number): PresetKey | null {
  const shared = rows.filter((entry) => !entry.dispositionScope && entry.attemptNumber >= 2 && entry.attemptNumber <= maxAttempts);
  for (const preset of PRESETS) {
    if (preset.maxAttempts !== maxAttempts || preset.rows.length !== shared.length) continue;
    const same = preset.rows.every((want) => {
      const have = shared.find((entry) => entry.attemptNumber === want.attemptNumber);
      return have && msOf(have.delayInterval) === msOf(want.delayInterval) && (have.preferredSlot ?? null) === (want.preferredSlot ?? null);
    });
    if (same) return preset.key;
  }
  return null;
}
