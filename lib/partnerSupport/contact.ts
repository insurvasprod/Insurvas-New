/**
 * The support contact an agency shows its partners (partner portal › Messages › Details: "Support"
 * and "Phone"). Plain module — no server-only imports — so the owner's form validates with exactly
 * what the API enforces, and the partner panel formats with the same rules.
 *
 * Stored on public.tenants (support_email, support_phone) by migration
 * 20260924210000_agency_partner_support_contact.sql. Until that is applied the columns do not exist:
 * reads report schemaReady=false and the partner panel hides the two rows.
 */
import { z } from "zod";

export type SupportContact = {
  email: string | null;
  phone: string | null;
  /** false until migration 20260924210000 is applied. */
  schemaReady: boolean;
};

export const SUPPORT_EMAIL_MAX = 254;
export const SUPPORT_PHONE_MAX = 32;

/** Digits, spaces, and the punctuation people write phone numbers with; 7–15 digits (E.164). */
export function isPlausiblePhone(value: string) {
  if (!/^\+?[0-9 ().\-–]+$/.test(value)) return false;
  const digits = value.replace(/\D/g, "").length;
  return digits >= 7 && digits <= 15;
}

const blankToNull = (value: string | null | undefined) => {
  const trimmed = value?.trim() ?? "";
  return trimmed ? trimmed : null;
};

export const supportContactInputSchema = z.object({
  email: z
    .string()
    .nullable()
    .optional()
    .transform((value) => blankToNull(value)?.toLowerCase() ?? null)
    .refine((value) => value === null || value.length <= SUPPORT_EMAIL_MAX, "The support email is too long")
    .refine((value) => value === null || /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value), "Enter a valid support email"),
  phone: z
    .string()
    .nullable()
    .optional()
    .transform((value) => blankToNull(value))
    .refine((value) => value === null || value.length <= SUPPORT_PHONE_MAX, "The support phone is too long")
    .refine((value) => value === null || isPlausiblePhone(value), "Enter a phone number with 7 to 15 digits"),
}).strict();

export type SupportContactInput = z.infer<typeof supportContactInputSchema>;

/**
 * A North American number as the board writes it — "(312) 555–0100" — whether it was stored as
 * 3125550100, +1 312 555 0100 or 312-555-0100. Anything else is shown exactly as the agency typed it.
 */
export function formatSupportPhone(value: string | null | undefined): string | null {
  const trimmed = value?.trim();
  if (!trimmed) return null;
  let digits = trimmed.replace(/\D/g, "");
  if (digits.length === 11 && digits.startsWith("1")) digits = digits.slice(1);
  if (digits.length !== 10 || (trimmed.startsWith("+") && !trimmed.startsWith("+1"))) return trimmed;
  return `(${digits.slice(0, 3)}) ${digits.slice(3, 6)}–${digits.slice(6)}`;
}
