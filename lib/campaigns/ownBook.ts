/**
 * "Your own book (no vendor)" (Leads in · Import, board LirI1, 2026-10-29).
 *
 * Every campaign has a vendor: tenant_campaigns.vendor_id is NOT NULL and a trigger copies the
 * vendor's lead type. A list the agency already owns (its own clients, old leads, referrals) has no
 * vendor, so it is filed under one stand-in vendor per tenant, recognised by this exact name, with
 * one campaign of the same name under it. tenant_lead_vendors has no kind column; its `notes` and
 * `category` are free text people edit, so the name is the mark. Vendor names are unique per tenant.
 *
 * Pure and client-safe: the Source page reads `isOwnBookVendor` to say "No vendor · your own book".
 * The find-or-create lives in ownBookStore.ts (server only).
 */
export const OWN_BOOK_VENDOR_NAME = "Your own book";
export const OWN_BOOK_CAMPAIGN_NAME = "Your own book";

/** Whether a vendor is the own-book stand-in. Exact name, as stored (names are trimmed on write). */
export function isOwnBookVendor(name: string | null | undefined): boolean {
  return typeof name === "string" && name.trim() === OWN_BOOK_VENDOR_NAME;
}
