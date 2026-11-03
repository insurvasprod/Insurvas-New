/**
 * Queue & SLA · the ladder as the screen draws and types it. Pure, no `server-only`: the client
 * component imports it.
 */

export type LadderValues = { warn: number; escalate: number; partner: number; expire: number };

const UNITS: Array<{ pattern: RegExp; seconds: number }> = [
  { pattern: /^(s|secs?|seconds?)$/, seconds: 1 },
  { pattern: /^(m|mins?|minutes?)$/, seconds: 60 },
  { pattern: /^(h|hrs?|hours?)$/, seconds: 3600 },
  { pattern: /^(d|days?)$/, seconds: 86400 },
];

/**
 * "45 seconds", "45s", "2 minutes", "2m", "4 hours", "1 day", or a bare number of seconds → whole
 * seconds. Null when it is not a duration, so the field can say so instead of saving a guess.
 */
export function parseDuration(value: string): number | null {
  const match = /^\s*(\d+(?:\.\d+)?)\s*([a-z]*)\s*$/i.exec(value);
  if (!match) return null;
  const amount = Number(match[1]);
  const unitText = match[2].toLowerCase();
  const unit = unitText === "" ? 1 : UNITS.find((candidate) => candidate.pattern.test(unitText))?.seconds;
  if (!unit || !Number.isFinite(amount)) return null;
  const seconds = Math.round(amount * unit);
  return seconds > 0 ? seconds : null;
}

/** The board's own wording: whole days or hours when exact, otherwise seconds — "120 seconds", "4 hours". */
export function formatDuration(seconds: number): string {
  const plural = (n: number, one: string) => `${n} ${one}${n === 1 ? "" : "s"}`;
  if (seconds >= 86400 && seconds % 86400 === 0) return plural(seconds / 86400, "day");
  if (seconds >= 3600 && seconds % 3600 === 0) return plural(seconds / 3600, "hour");
  return plural(seconds, "second");
}

export type StepState = "done" | "current" | "upcoming";

/**
 * Each rung's state for the longest-waiting transfer right now: the rungs it has passed are done,
 * the next is current. With nothing waiting, "Claimable" is current and nothing is done.
 */
export function ladderStepStates(values: LadderValues, oldestWaitingSeconds: number | null): StepState[] {
  const thresholds = [0, values.warn, values.escalate, values.partner, values.expire];
  if (oldestWaitingSeconds === null) return thresholds.map((_, index) => (index === 0 ? "current" : "upcoming"));
  const next = thresholds.findIndex((threshold) => threshold > oldestWaitingSeconds);
  return thresholds.map((_, index) => (next === -1 || index < next ? "done" : index === next ? "current" : "upcoming"));
}
