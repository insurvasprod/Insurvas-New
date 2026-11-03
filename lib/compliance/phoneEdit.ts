import { getUsPhone10Digits } from "./scrub.ts";

/**
 * Editing a lead's phone number (audit 2026-10-16).
 *
 * Import and partner intake screen every number before it becomes a lead; the lead edit used to
 * save a new number without asking anyone, so a lead imported clean could be pointed at a litigator
 * or a do-not-call number by hand. The edit now screens the new number through the same
 * screenPartnerPhone path, and refuses the same outcomes the import rejects a row for.
 *
 * Pure (no database), so the rules are tested directly in phoneEdit.test.mjs.
 */

/** The phone a lead's values carry, under the keys import and the dialer read. */
export function leadPhoneValue(values: unknown): unknown {
  if (!values || typeof values !== "object" || Array.isArray(values)) return undefined;
  const record = values as Record<string, unknown>;
  return record.phone ?? record.phone_number;
}

function comparable(value: unknown): string {
  if (value === undefined || value === null) return "";
  try {
    return getUsPhone10Digits(value);
  } catch {
    return typeof value === "string" ? value.trim() : String(value);
  }
}

/**
 * Whether an edit changes the number, so needs screening. A reformat of the same digits does not
 * (no second vendor charge), and a cleared number does not (nothing left to dial).
 */
export function phoneEditNeedsScreening(before: unknown, after: unknown): boolean {
  const next = comparable(leadPhoneValue(after));
  if (!next) return false;
  return next !== comparable(leadPhoneValue(before));
}

/** The outcomes the import rejects a row for. internal_dq (another lead has it) is not a dial block. */
const REFUSED = new Set(["dnc", "tcpa_litigator", "invalid_phone"]);

export type PhoneEditVerdict =
  | { allowed: true }
  | { allowed: false; status: 422 | 503; code: string; message: string };

export function phoneEditVerdict(decision: { outcome: string; message?: string | null }): PhoneEditVerdict {
  if (decision.outcome === "unavailable") {
    // An unknown answer is never treated as clear: the number is not saved until it can be screened.
    return { allowed: false, status: 503, code: "screening_unavailable", message: "The new phone number could not be screened just now, so it was not saved. Try again in a minute." };
  }
  if (REFUSED.has(decision.outcome)) {
    return { allowed: false, status: 422, code: `phone_${decision.outcome}`, message: decision.message || "The new phone number did not pass screening, so it was not saved." };
  }
  return { allowed: true };
}

export class LeadPhoneScreeningError extends Error {
  readonly status: 422 | 503;
  readonly code: string;
  constructor(verdict: Extract<PhoneEditVerdict, { allowed: false }>) {
    super(verdict.message);
    this.name = "LeadPhoneScreeningError";
    this.status = verdict.status;
    this.code = verdict.code;
  }
}
