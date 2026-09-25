/**
 * Settings › Agency profile — the shapes and rules the client and the API share. Plain module (no
 * server-only imports), so the form can validate with exactly what the route enforces.
 */
import { z } from "zod";

/** What GET /api/app/agency-profile returns. Owners only. */
export type AgencyProfileView = {
  legalName: string;
  dba: string | null;
  npn: string | null;
  /** Set only by a real NIPR check (lib/agencyProfile/nipr.ts). No NIPR client is connected yet, so today it stays null. */
  npnVerifiedAt: string | null;
  /** What the last NIPR lookup said, and when (migration 20260924220000). Null when none has run. */
  npnCheckStatus: NpnCheckStatus | null;
  npnCheckedAt: string | null;
  /** The full tax ID, decrypted for the owner. null when none is stored or it cannot be decrypted. */
  taxId: string | null;
  taxIdLast4: string | null;
  /** false when a tax ID is stored but this server has no key to decrypt it. */
  taxIdReadable: boolean;
  principalAddress: string | null;
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

/** "884410932" or "88-4410932" → "88-4410932". */
export function normalizeTaxId(value: string) {
  const digits = value.replace(/\D/g, "");
  return digits.length === 9 ? `${digits.slice(0, 2)}-${digits.slice(2)}` : value.trim();
}

const optionalText = (max: number, label: string) =>
  z.string().trim().max(max, `${label} is too long`).nullable().optional().transform((value) => (value ? value : null));

export const agencyProfileInputSchema = z.object({
  legalName: z.string().trim().min(1, "Enter the legal entity name").max(200, "Legal entity name is too long"),
  dba: optionalText(200, "Doing business as"),
  npn: z.string().trim().nullable().optional().transform((value) => (value ? value : null)).refine((value) => value === null || /^[0-9]{1,10}$/.test(value), "A National Producer Number is up to ten digits"),
  /** undefined: keep what is stored. "" or null: clear it. Otherwise the new tax ID. */
  taxId: z.string().nullable().optional().refine((value) => value === undefined || value === null || value.trim() === "" || /^\d{2}-?\d{7}$/.test(value.trim()), "A federal tax ID is nine digits, as 12-3456789"),
  principalAddress: optionalText(300, "Principal address"),
  timezone: z.string().trim().nullable().optional().transform((value) => (value ? value : null)).refine((value) => value === null || isIanaZone(value), "Choose a valid timezone"),
});

export type AgencyProfileInput = z.infer<typeof agencyProfileInputSchema>;
