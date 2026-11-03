/**
 * The checks a vendor post must pass beyond phone, state and name — the four the Lead posting board
 * counts as rejections: "No consent text", "Missing consent IP", "Unparseable date of birth" and
 * "State not licensed" (the last is a database read, done in service.ts; its code lives here).
 *
 * Plain module — no `server-only`, no path aliases — so the post path and a `node --test` file read
 * the same rules.
 *
 * Consent text and the consent IP are the consent itself: what the person agreed to and where they
 * agreed to it. A consent CERTIFICATE (TrustedForm, Jornaya) is evidence about that consent, and its
 * absence is still flagged rather than refused — LA-2.6: "flag, do not block".
 */

export const VALIDATION_REASON_CODES = [
  "missing_consent_text",
  "missing_consent_ip",
  "invalid_date_of_birth",
  "state_not_licensed",
] as const;
export type ValidationReasonCode = (typeof VALIDATION_REASON_CODES)[number];

/**
 * The older code each new one is logged under until migration 20260924240000 teaches the log's
 * check constraint the new vocabulary. The vendor is answered with the precise code either way; only
 * the log row falls back, because losing the row would lose the billing record.
 */
export const LEGACY_LOG_CODE: Record<ValidationReasonCode, "missing_required_field" | "unknown_state"> = {
  missing_consent_text: "missing_required_field",
  missing_consent_ip: "missing_required_field",
  invalid_date_of_birth: "missing_required_field",
  state_not_licensed: "unknown_state",
};

/** Longer than any real TCPA disclosure, short enough that a runaway payload is not stored. */
const CONSENT_TEXT_MAX = 10_000;

/** The consent language the person saw, verbatim — trimmed of surrounding whitespace only. */
export function consentTextOf(values: Record<string, unknown>): string | null {
  const raw = values.consent_text;
  if (typeof raw !== "string") return null;
  const text = raw.trim();
  return text.length > 0 && text.length <= CONSENT_TEXT_MAX ? raw : null;
}

const IPV4 = /^(25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)(\.(25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)){3}$/;

function isIpv6(value: string): boolean {
  // An embedded IPv4 tail (::ffff:203.0.113.9) stands for the last two groups.
  let text = value;
  if (text.includes(".")) {
    const at = text.lastIndexOf(":");
    if (at < 0 || !IPV4.test(text.slice(at + 1))) return false;
    text = `${text.slice(0, at + 1)}0:0`;
  }
  if (!/^[0-9a-f:]+$/i.test(text)) return false;
  const halves = text.split("::");
  if (halves.length > 2) return false;
  const groups = halves.flatMap((part) => (part === "" ? [] : part.split(":")));
  if (groups.some((group) => group.length === 0 || group.length > 4)) return false;
  return halves.length === 2 ? groups.length < 8 : groups.length === 8;
}

/** A syntactically valid IPv4 or IPv6 address, or null. */
export function normaliseIp(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const text = value.trim();
  if (!text || text.length > 45) return null;
  if (IPV4.test(text)) return text;
  return isIpv6(text) ? text.toLowerCase() : null;
}

/** Our `consent_ip`, or the older `ip` the field map has always offered. */
export function consentIpOf(values: Record<string, unknown>): string | null {
  return normaliseIp(values.consent_ip) ?? (values.consent_ip == null ? normaliseIp(values.ip) : null);
}

export type DateOfBirthReading = { status: "absent" } | { status: "invalid" } | { status: "ok"; iso: string };

function realDate(year: number, month: number, day: number): boolean {
  if (month < 1 || month > 12 || day < 1) return false;
  const last = new Date(Date.UTC(year, month, 0)).getUTCDate();
  return day <= last;
}

/**
 * A date of birth, parsed as US month-first.
 *
 *   MM/DD/YYYY, M/D/YYYY, MM-DD-YYYY, MM.DD.YYYY, MMDDYYYY   month first
 *   YYYY-MM-DD (optionally with a time)                      ISO, unambiguous
 *
 * Absent is not a rejection — the field map says what a vendor sends. Sent and unreadable is: a
 * wrong date of birth is a wrong quote and, for an age-banded product, a lead nobody can write. A
 * two-digit year is refused rather than guessed at, and so is a date in the future or before 1900.
 */
export function parseUsDateOfBirth(value: unknown, today: Date = new Date()): DateOfBirthReading {
  if (value === undefined || value === null) return { status: "absent" };
  if (typeof value !== "string" && typeof value !== "number") return { status: "invalid" };
  const text = String(value).trim();
  if (!text) return { status: "absent" };

  let year: number;
  let month: number;
  let day: number;
  let match: RegExpExecArray | null;
  if ((match = /^(\d{4})-(\d{1,2})-(\d{1,2})(?:[T ].*)?$/.exec(text))) {
    [year, month, day] = [Number(match[1]), Number(match[2]), Number(match[3])];
  } else if ((match = /^(\d{1,2})[/.-](\d{1,2})[/.-](\d{4})$/.exec(text))) {
    [month, day, year] = [Number(match[1]), Number(match[2]), Number(match[3])];
  } else if ((match = /^(\d{2})(\d{2})(\d{4})$/.exec(text))) {
    [month, day, year] = [Number(match[1]), Number(match[2]), Number(match[3])];
  } else {
    return { status: "invalid" };
  }

  if (!realDate(year, month, day) || year < 1900) return { status: "invalid" };
  const iso = `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
  const todayIso = today.toISOString().slice(0, 10);
  if (iso > todayIso) return { status: "invalid" };
  return { status: "ok", iso };
}
