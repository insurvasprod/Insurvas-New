// Client-safe value formats shared by the partner form, the settings preview and server intake
// (LA-1.4-6): bank routing and account numbers, and the age a date of birth implies.

import type { TemplateField } from "./constants";

/** Field types stored as a string of digits, entered through a numeric keypad. */
export const DIGIT_STRING_FIELD_TYPES = ["ssn", "bank_routing", "bank_account"] as const;

export const BANK_ACCOUNT_MIN_DIGITS = 4;
export const BANK_ACCOUNT_MAX_DIGITS = 17;

export function digitsOnly(value: string) {
  return value.replace(/\D/g, "");
}

/**
 * An ABA routing transit number: nine digits whose weighted sum 3·7·1 repeating is a multiple of
 * ten. "021000021" passes; "021000022" does not. Spaces and dashes are tolerated on the way in.
 */
export function isValidAbaRouting(value: string) {
  const digits = digitsOnly(value);
  if (digits.length !== 9 || digits.length !== value.replace(/[\s-]/g, "").length) return false;
  const d = [...digits].map(Number);
  const sum = 3 * (d[0] + d[3] + d[6]) + 7 * (d[1] + d[4] + d[7]) + (d[2] + d[5] + d[8]);
  return sum % 10 === 0 && digits !== "000000000";
}

/** A US bank account number: 4 to 17 digits, nothing else but spaces or dashes between them. */
export function isValidBankAccount(value: string) {
  const digits = digitsOnly(value);
  return digits.length === value.replace(/[\s-]/g, "").length && digits.length >= BANK_ACCOUNT_MIN_DIGITS && digits.length <= BANK_ACCOUNT_MAX_DIGITS;
}

/**
 * The format error for a value of a digit-string or bank type, in the words both the partner form
 * and intake use, or null when it is fine (or not one of these types).
 */
export function bankFormatError(field: Pick<TemplateField, "type" | "label">, value: string) {
  if (field.type === "bank_routing" && !isValidAbaRouting(value)) return `${field.label} must be a valid 9-digit routing number`;
  if (field.type === "bank_account" && !isValidBankAccount(value)) return `${field.label} must be ${BANK_ACCOUNT_MIN_DIGITS}–${BANK_ACCOUNT_MAX_DIGITS} digits`;
  return null;
}

/** The date-of-birth field of a form: a date field named for a birth date, else one with age limits. */
export function dobFieldKey(fields: Pick<TemplateField, "field_key" | "type" | "validation">[]) {
  const dates = fields.filter((field) => field.type === "date");
  return (
    dates.find((field) => /(^|_)(dob|birth|birthdate|date_of_birth)(_|$)/.test(field.field_key) || /birth/.test(field.field_key))?.field_key ??
    dates.find((field) => field.validation?.age_min !== undefined || field.validation?.age_max !== undefined)?.field_key ??
    null
  );
}

/** Whole years from a YYYY-MM-DD birth date to `today` (UTC), or null for anything that is not one. */
export function ageFromDob(value: unknown, today = new Date()): number | null {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
  const birth = new Date(`${value}T00:00:00Z`);
  if (Number.isNaN(birth.getTime()) || birth.toISOString().slice(0, 10) !== value) return null;
  let age = today.getUTCFullYear() - birth.getUTCFullYear();
  if (today.getUTCMonth() < birth.getUTCMonth() || (today.getUTCMonth() === birth.getUTCMonth() && today.getUTCDate() < birth.getUTCDate())) age--;
  return age >= 0 && age <= 130 ? age : null;
}

/** The key the derived age is stored under in lead values, for every reader (inbox, scripts, export). */
export const DERIVED_AGE_KEY = "age";

/**
 * Lead values with `age` set from the date of birth when one is given (LA-1.4-6). A form's own
 * `age` field is overwritten too: age is derived, never typed. Without a readable birth date the
 * values come back unchanged, except that a stale derived age with no field behind it is dropped.
 */
export function withDerivedAge(values: Record<string, unknown>, fields: Pick<TemplateField, "field_key" | "type" | "validation">[], today = new Date()) {
  const key = dobFieldKey(fields);
  const age = key ? ageFromDob(values[key], today) : null;
  if (age !== null) return { ...values, [DERIVED_AGE_KEY]: age };
  if (DERIVED_AGE_KEY in values && !fields.some((field) => field.field_key === DERIVED_AGE_KEY)) {
    const next = { ...values };
    delete next[DERIVED_AGE_KEY];
    return next;
  }
  return values;
}
