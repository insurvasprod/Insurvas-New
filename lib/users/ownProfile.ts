import { z } from "zod";

/**
 * "Your profile": what the signed-in person may change about themselves — name, phone, their
 * National Producer Number and the licence number for each state they are licensed in.
 *
 * Plain module, no server-only imports, so the form validates with exactly what the API enforces.
 * Which states a person is licensed in is NOT theirs to change here: the owner records that on
 * Team & access, and assignment reads it. The person fills in the numbers for those states.
 */

export const OWN_NAME_MAX = 120;
export const OWN_PHONE_MAX = 32;
export const LICENCE_NUMBER_MAX = 32;

export type OwnProfile = {
  name: string;
  email: string;
  phone: string | null;
  roleLabel: string;
  workspaceName: string;
  /** States the owner has recorded for this person, alphabetical. Null when that list cannot be read yet. */
  licensedStates: string[] | null;
  npn: string | null;
  licenceNumbers: Record<string, string>;
  /** False until migration 20260924200000 is applied: the numbers are then shown as unavailable and not saved. */
  licenceNumbersReady: boolean;
};

const blankToNull = (value: string | null | undefined) => {
  const trimmed = value?.trim() ?? "";
  return trimmed ? trimmed : null;
};

/** Digits, spaces and the punctuation people write phone numbers with; 7 to 15 digits (E.164). */
export function isPlausiblePhone(value: string) {
  if (!/^\+?[0-9 ().-]+$/.test(value)) return false;
  const digits = value.replace(/\D/g, "").length;
  return digits >= 7 && digits <= 15;
}

export const ownProfileInputSchema = z.object({
  name: z.string().transform((value) => value.trim().replace(/\s+/g, " "))
    .refine((value) => value.length > 0, "Enter your name")
    .refine((value) => value.length <= OWN_NAME_MAX, `Keep your name under ${OWN_NAME_MAX} characters`),
  phone: z.string().nullable().optional().transform((value) => blankToNull(value))
    .refine((value) => value === null || value.length <= OWN_PHONE_MAX, "That phone number is too long")
    .refine((value) => value === null || isPlausiblePhone(value), "Enter a phone number with 7 to 15 digits"),
  npn: z.string().nullable().optional().transform((value) => blankToNull(value)?.replace(/\s+/g, "") ?? null)
    .refine((value) => value === null || /^[0-9]{1,10}$/.test(value), "An NPN is up to ten digits"),
  licenceNumbers: z.record(z.string(), z.string()).optional(),
}).strict();

export type OwnProfileInput = z.infer<typeof ownProfileInputSchema>;

/**
 * Keeps only numbers for states the person is licensed in, trimmed, and says which one is wrong
 * when one is. A number for a state the owner has not recorded would be a licence the router never
 * uses and nobody reviews, so it is refused rather than stored.
 */
export function cleanLicenceNumbers(
  input: Record<string, string> | undefined,
  licensedStates: readonly string[],
): { ok: true; value: Record<string, string> } | { ok: false; error: string } {
  const allowed = new Set(licensedStates);
  const value: Record<string, string> = {};
  for (const [rawState, rawNumber] of Object.entries(input ?? {})) {
    const state = rawState.trim().toUpperCase();
    const number = rawNumber.trim();
    if (!number) continue;
    if (!/^[A-Z]{2}$/.test(state)) return { ok: false, error: `“${rawState}” is not a state code` };
    if (!allowed.has(state)) return { ok: false, error: `You are not recorded as licensed in ${state}. Your owner sets your states on Team & access.` };
    if (number.length > LICENCE_NUMBER_MAX || !/^[A-Za-z0-9-]+$/.test(number)) {
      return { ok: false, error: `The ${state} licence number can use letters, digits and dashes, up to ${LICENCE_NUMBER_MAX} characters` };
    }
    value[state] = number;
  }
  return { ok: true, value };
}

/** The stored jsonb, read defensively: only two-letter keys with string values survive. */
export function licenceNumbersFromRow(value: unknown): Record<string, string> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  const out: Record<string, string> = {};
  for (const [state, number] of Object.entries(value as Record<string, unknown>)) {
    if (/^[A-Z]{2}$/.test(state) && typeof number === "string" && number.trim()) out[state] = number.trim();
  }
  return out;
}
