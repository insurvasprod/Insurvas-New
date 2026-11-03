/**
 * The rows of the "Check a number before dialing" dialog, and the sentences built from them.
 *
 * Plain module (no `server-only`): the preflight route builds the rows with it and the dialog
 * words the refusal from the same rows, so the screen can never say something the server did not
 * find. Every row is a real check that ran for this request; none is decorative.
 */

export type PreflightTone = "success" | "error" | "warning" | "neutral";
export type PreflightCheckKey = "suppression" | "dnc" | "litigator" | "window" | "consent";

export type PreflightCheck = {
  key: PreflightCheckKey;
  label: string;
  /** The pill text: Clear, Listed, Unavailable, Inside, Outside… */
  result: string;
  tone: PreflightTone;
  source: string;
  /** "live", or how old the answer is ("4h", "10d"). */
  age: string;
  /** Whether this row, on its own, refuses the dial. A missing answer refuses (fail closed). */
  refuses: boolean;
  /** One sentence for the refusal callout when this row refuses. */
  refusal?: string;
};

/** Minute of the day as the board's compact clock: 480 → "8am", 1290 → "9:30pm". */
export function compactClock(minute: number): string {
  const m = ((Math.round(minute) % 1440) + 1440) % 1440;
  const h24 = Math.floor(m / 60);
  const h12 = h24 % 12 === 0 ? 12 : h24 % 12;
  const mm = m % 60;
  return `${h12}${mm ? `:${String(mm).padStart(2, "0")}` : ""}${h24 < 12 ? "am" : "pm"}`;
}

/** "8am–9pm CT". `zoneLabel` is already short (see lib/dialerScripts/display.ts zoneShort). */
export function windowHoursLabel(startMinute: number | null, endMinute: number | null, zoneLabel: string): string | null {
  if (startMinute === null || endMinute === null || !Number.isFinite(startMinute) || !Number.isFinite(endMinute)) return null;
  return `${compactClock(startMinute)}–${compactClock(endMinute)}${zoneLabel ? ` ${zoneLabel}` : ""}`;
}

/** How old an answer is, the way the board's Age column prints it. Under a minute is "live". */
export function answerAge(at: string | null | undefined, now: number = Date.now()): string {
  const t = Date.parse(String(at ?? ""));
  if (!Number.isFinite(t)) return "live";
  const minutes = Math.max(0, Math.floor((now - t) / 60_000));
  if (minutes < 1) return "live";
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h`;
  return `${Math.floor(hours / 24)}d`;
}

/** Whole days since an instant, as "10d"; "0d" today. Empty when unknown. */
export function daysAge(at: string | null | undefined, now: number = Date.now()): string {
  const t = Date.parse(String(at ?? ""));
  if (!Number.isFinite(t)) return "—";
  return `${Math.max(0, Math.floor((now - t) / 86_400_000))}d`;
}

/**
 * The refusal callout's body, built only from rows that refused. "Every other check passed" is
 * written only when it is true — every other row is green — never as a flourish.
 */
export function refusalBody(checks: PreflightCheck[]): string | null {
  const failing = checks.filter((check) => check.refuses);
  if (failing.length === 0) return null;
  const sentences = failing.map((check) => check.refusal ?? `${check.label}: ${check.result.toLowerCase()}.`);
  const others = checks.filter((check) => !check.refuses);
  const allOthersPassed = others.length > 0 && others.every((check) => check.tone === "success");
  const tail = failing.length > 1
    ? "Each of these refuses the dial on its own."
    : allOthersPassed
      ? "Every other check passed, and it makes no difference — one failure is a refusal."
      : "One failure is a refusal.";
  return `${sentences.join(" ")} ${tail}`;
}

/** "2 August" (with the year when it is not this one), UTC so it reads the same everywhere. */
export function longDate(value: string | null | undefined, now: Date = new Date()): string {
  const at = new Date(String(value ?? ""));
  if (Number.isNaN(at.getTime())) return "";
  const day = new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "long", timeZone: "UTC" }).format(at);
  return at.getUTCFullYear() === now.getUTCFullYear() ? day : `${day} ${at.getUTCFullYear()}`;
}
