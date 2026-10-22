/**
 * Settings › Agency profile — the shapes and rules the client and the API share. Plain module (no
 * server-only imports), so the form can validate with exactly what the route enforces.
 */
import { z } from "zod";

export type EntityType = "individual" | "sole_prop" | "llc" | "corp";
export type TaxIdType = "ein" | "ssn";

export const ENTITY_TYPE_LABELS: Record<EntityType, string> = {
  individual: "Individual",
  sole_prop: "Sole proprietor",
  llc: "LLC",
  corp: "Corporation",
};

/**
 * What GET /api/app/agency-profile returns: Settings › Business identity (LA-8.3). Owners only.
 *
 * The tax ID is never in it. It is masked to its last four; the full number comes only from
 * POST /api/app/agency-profile/tax-id, one reveal at a time, each one audited — for a sole
 * proprietor the business tax ID is their SSN.
 */
export type AgencyProfileView = {
  /** The name on a tax form ("Masood Insurance Services LLC"). */
  legalName: string;
  /** The trading name clients see ("Power Policies"); the column is still `dba`. */
  dba: string | null;
  npn: string | null;
  /** Set only by a real NIPR check (lib/agencyProfile/nipr.ts). No NIPR client is connected yet, so today it stays null. */
  npnVerifiedAt: string | null;
  /** What the last NIPR lookup said, and when (migration 20260924220000). Null when none has run. */
  npnCheckStatus: NpnCheckStatus | null;
  npnCheckedAt: string | null;
  entityType: EntityType | null;
  taxIdType: TaxIdType | null;
  /** Whether a tax ID is stored; its value is never sent with the profile. */
  hasTaxId: boolean;
  taxIdLast4: string | null;
  /** false when a tax ID is stored but this server has no key to decrypt it. */
  taxIdReadable: boolean;
  addressLine1: string | null;
  addressLine2: string | null;
  city: string | null;
  state: string | null;
  postalCode: string | null;
  country: string;
  /** The one-line address older readers print, composed from the parts on save. */
  principalAddress: string | null;
  phone: string | null;
  email: string | null;
  website: string | null;
  /** A short-lived signed URL for the logo, or null — documents then print the trading name as text. */
  logoUrl: string | null;
  timezone: string | null;
  updatedAt: string | null;
};

export type AgencyProfileResponse = {
  profile: AgencyProfileView;
  /** false until migration 20260924100000 is applied: the form shows, saving returns 503. */
  schemaReady: boolean;
  /** True once a NIPR client is connected (lib/agencyProfile/nipr.ts); a save then checks the NPN. */
  niprConfigured?: boolean;
};

export type NpnCheckStatus = "verified" | "not_found" | "name_mismatch" | "error";

/**
 * The NPN field's hint. Only a check of the number now on screen counts; a number being edited has
 * not been checked by anyone.
 */
export function npnHint(profile: Pick<AgencyProfileView, "npn" | "npnVerifiedAt" | "npnCheckStatus" | "npnCheckedAt">, draftNpn: string, niprConfigured: boolean, formatDay: (iso: string) => string): string {
  const unchanged = draftNpn.trim() === (profile.npn ?? "");
  if (unchanged && profile.npnVerifiedAt) return `Verified against NIPR ${formatDay(profile.npnVerifiedAt)}.`;
  if (unchanged && profile.npnCheckedAt && profile.npnCheckStatus === "not_found") return `NIPR has no producer with this number (checked ${formatDay(profile.npnCheckedAt)}).`;
  if (unchanged && profile.npnCheckedAt && profile.npnCheckStatus === "name_mismatch") return `NIPR lists this number under a different name (checked ${formatDay(profile.npnCheckedAt)}).`;
  if (unchanged && profile.npnCheckedAt && profile.npnCheckStatus === "error") return `NIPR could not be reached on ${formatDay(profile.npnCheckedAt)}; it is checked again on the next save.`;
  return niprConfigured ? "Checked against NIPR when you save." : "Not verified against NIPR yet.";
}

/** US zones an agency is realistically headquartered in, in the order people look for them. */
export const WORKSPACE_TIMEZONES = [
  "America/New_York",
  "America/Chicago",
  "America/Denver",
  "America/Phoenix",
  "America/Los_Angeles",
  "America/Anchorage",
  "Pacific/Honolulu",
  "America/Puerto_Rico",
] as const;

function isIanaZone(value: string) {
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: value });
    return true;
  } catch {
    return false;
  }
}

/** "884410932" → "88-4410932" (EIN) or "123-45-6789" (SSN). Anything else is left as typed, to fail validation. */
export function normalizeTaxId(value: string, type: TaxIdType = "ein") {
  const digits = value.replace(/\D/g, "");
  if (digits.length !== 9) return value.trim();
  return type === "ssn" ? `${digits.slice(0, 3)}-${digits.slice(3, 5)}-${digits.slice(5)}` : `${digits.slice(0, 2)}-${digits.slice(2)}`;
}

/** The masked form a tax ID is shown in until someone reveals it. */
export function maskTaxId(type: TaxIdType | null, last4: string | null) {
  if (!last4) return "";
  return type === "ssn" ? `•••-••-${last4}` : `••-•••${last4}`;
}

const optionalText = (max: number, label: string) =>
  z.string().trim().max(max, `${label} is too long`).nullable().optional().transform((value) => (value ? value : null));

export const agencyProfileInputSchema = z.object({
  legalName: z.string().trim().min(1, "Enter the legal name").max(200, "The legal name is too long"),
  /** The trading name. */
  dba: optionalText(200, "The trading name"),
  npn: z.string().trim().nullable().optional().transform((value) => (value ? value : null)).refine((value) => value === null || /^[0-9]{1,10}$/.test(value), "A National Producer Number is up to ten digits"),
  entityType: z.enum(["individual", "sole_prop", "llc", "corp"]).nullable().optional().transform((value) => value ?? null),
  taxIdType: z.enum(["ein", "ssn"]).nullable().optional().transform((value) => value ?? null),
  /** undefined: keep what is stored. "" or null: clear it. Otherwise the new tax ID, in the format of taxIdType. */
  taxId: z.string().nullable().optional(),
  addressLine1: optionalText(200, "Address line 1"),
  addressLine2: optionalText(200, "Address line 2"),
  city: optionalText(100, "City"),
  state: z.string().trim().toUpperCase().nullable().optional().transform((value) => (value ? value : null)).refine((value) => value === null || /^[A-Z]{2}$/.test(value), "Choose a state"),
  postalCode: z.string().trim().nullable().optional().transform((value) => (value ? value : null)).refine((value) => value === null || /^[0-9]{5}(-[0-9]{4})?$/.test(value), "A ZIP code is five digits, or ZIP+4"),
  phone: optionalText(40, "Phone").refine((value) => value === null || value.replace(/\D/g, "").length >= 10, "Enter a phone number with its area code"),
  email: optionalText(254, "Email").refine((value) => value === null || /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value), "Enter a valid email address"),
  website: optionalText(300, "Website"),
  timezone: z.string().trim().nullable().optional().transform((value) => (value ? value : null)).refine((value) => value === null || isIanaZone(value), "Choose a valid timezone"),
}).superRefine((input, ctx) => {
  if (input.taxId === undefined || input.taxId === null || input.taxId.trim() === "") return;
  const type = input.taxIdType ?? "ein";
  const ok = type === "ssn" ? /^\d{3}-?\d{2}-?\d{4}$/.test(input.taxId.trim()) : /^\d{2}-?\d{7}$/.test(input.taxId.trim());
  if (!ok) ctx.addIssue({ code: "custom", path: ["taxId"], message: type === "ssn" ? "A Social Security number is nine digits, as 123-45-6789" : "An EIN is nine digits, as 12-3456789" });
});

export type AgencyProfileInput = z.infer<typeof agencyProfileInputSchema>;
