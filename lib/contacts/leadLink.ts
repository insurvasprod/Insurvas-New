import "server-only";

import { getSupabaseServiceClient } from "@/lib/supabase/service";
import { addressHash, addressSearch, nameSearch, normalizePhone } from "./normalization";
import type { ContactInput } from "./types";

/**
 * Sets agent_leads.contact_id on newly arrived leads, and only on a confident match.
 *
 * "Confident" is the auto-merge test from matchPolicy.ts — high confidence, both dates of birth
 * present and equal, and the phone or the address also equal — applied in SQL by
 * link_leads_to_contacts (20260924326100) to the same find_contact_duplicates scoring, with the
 * values normalized here exactly as createContact normalizes a contact. A lead without a date of
 * birth can never be confident, so it is not even sent.
 *
 * Deliberately best effort: it never creates a contact, never overwrites a link, never throws, and
 * before the migration it does nothing. Intake and import call it after their own work is done; a
 * failure here must not fail a lead that has already been accepted.
 */

const DATE = /^\d{4}-\d{2}-\d{2}$/;

function text(values: Record<string, unknown>, keys: string[]) {
  for (const key of keys) {
    const value = values[key];
    if (typeof value === "string" && value.trim() && value.trim().length <= 240) return value.trim();
  }
  return null;
}

type LinkItem = { lead_id: string; name_search: string; dob: string; phone: string | null; address_hash: string | null; address_search: string | null };

export function leadLinkItem(leadId: string, raw: unknown): LinkItem | null {
  const values = raw && typeof raw === "object" && !Array.isArray(raw) ? raw as Record<string, unknown> : {};
  const dob = text(values, ["dob", "date_of_birth"]);
  if (!dob || !DATE.test(dob)) return null;
  let first = text(values, ["first_name"]);
  let last = text(values, ["last_name"]);
  if (!first || !last) {
    const full = text(values, ["full_name", "name"]);
    if (!full) return null;
    const parts = full.split(/\s+/);
    first = first ?? parts[0];
    last = last ?? (parts.slice(1).join(" ") || parts[0]);
  }
  const input: ContactInput = {
    first_name: first,
    last_name: last,
    dob,
    address_line1: text(values, ["address_line1", "address", "street_address"]),
    city: text(values, ["city"]),
    state: text(values, ["state", "state_code"])?.toUpperCase() ?? null,
    postal_code: text(values, ["postal_code", "zip", "zip_code"]),
  };
  const digits = normalizePhone(text(values, ["phone", "phone_number", "primary_phone"]));
  const phone = /^\d{7,15}$/.test(digits) ? digits : null;
  const hash = addressHash(input);
  const name = nameSearch(input);
  if (name.length < 2 || (!phone && !hash)) return null;
  return { lead_id: leadId, name_search: name, dob, phone, address_hash: hash, address_search: addressSearch(input) || null };
}

const MISSING = new Set(["42703", "42P01", "42883", "PGRST202", "PGRST204", "PGRST205"]);

export async function linkLeadsToContacts(tenantId: string, leads: ReadonlyArray<{ id: string; values: unknown }>): Promise<number> {
  try {
    const items = leads.map((lead) => leadLinkItem(lead.id, lead.values)).filter((item): item is LinkItem => item !== null);
    let linked = 0;
    for (let at = 0; at < items.length; at += 500) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any -- link_leads_to_contacts is not in the shared generated types yet
      const { data, error } = await (getSupabaseServiceClient() as any).rpc("link_leads_to_contacts", { p_tenant_id: tenantId, p_items: items.slice(at, at + 500) });
      if (error) {
        if (!MISSING.has(error.code ?? "")) console.error("[contacts] leads could not be linked to contacts", error);
        return linked;
      }
      linked += Number(data) || 0;
    }
    return linked;
  } catch (error) {
    console.error("[contacts] leads could not be linked to contacts", error);
    return 0;
  }
}
