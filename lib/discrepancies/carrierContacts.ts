import "server-only";

import { getSupabaseServiceClient } from "@/lib/supabase/service";
import { isSchemaGap } from "@/lib/supabase/schemaGap";

/**
 * LA-4.5 follow-up · where a dispute letter goes: one commissions address (and an optional email)
 * per carrier, per agency (migration 20261007110000). Set from the letter by an owner or bookkeeper
 * and shared by everyone who prints one. Before the migration every read answers `available: false`
 * and the letter falls back to "<Carrier> / Commissions Department".
 */

export type CarrierCommissionContact = { carrierId: string; address: string; email: string | null; updatedAt: string };

type Row = { carrier_id: string; address: string; email: string | null; updated_at: string };
type Loose = {
  from(table: string): {
    select(columns: string): { eq(column: string, value: unknown): { eq(column: string, value: unknown): { maybeSingle(): PromiseLike<{ data: Row | null; error: { message: string; code?: string } | null }> } } };
    upsert(values: unknown, options: { onConflict: string }): PromiseLike<{ error: { message: string; code?: string } | null }>;
  };
};
const db = () => getSupabaseServiceClient() as unknown as Loose;

export const CARRIER_CONTACTS_PENDING_MESSAGE = "Saving a carrier's commissions address needs a database update. Until it is applied, type the address on each letter.";

export class CarrierContactError extends Error {
  constructor(message: string, readonly status: number, readonly code?: string) { super(message); this.name = "CarrierContactError"; }
}

/** The agency's address for one carrier's commissions department, or null when none is saved. */
export async function getCarrierCommissionContact(tenantId: string, carrierId: string): Promise<{ available: boolean; contact: CarrierCommissionContact | null }> {
  const read = await db().from("tenant_carrier_commission_contacts").select("carrier_id, address, email, updated_at").eq("tenant_id", tenantId).eq("carrier_id", carrierId).maybeSingle();
  if (read.error) {
    if (isSchemaGap(read.error)) return { available: false, contact: null };
    throw new Error(`Could not load the carrier's commissions address: ${read.error.message}`);
  }
  return { available: true, contact: read.data ? { carrierId: read.data.carrier_id, address: read.data.address, email: read.data.email, updatedAt: read.data.updated_at } : null };
}

/** Saves (or replaces) the agency's address for one carrier. The caller has checked the role and the write gate. */
export async function saveCarrierCommissionContact(tenantId: string, actorUserId: string, input: { carrierId: string; address: string; email: string | null }) {
  const up = await db().from("tenant_carrier_commission_contacts").upsert({
    tenant_id: tenantId, carrier_id: input.carrierId, address: input.address.trim(), email: input.email?.trim() || null,
    updated_by: actorUserId, updated_at: new Date().toISOString(),
  }, { onConflict: "tenant_id,carrier_id" });
  if (up.error) {
    if (isSchemaGap(up.error)) throw new CarrierContactError(CARRIER_CONTACTS_PENDING_MESSAGE, 503, "schema_pending");
    if (up.error.code === "23503") throw new CarrierContactError("That carrier is not in the carrier library.", 400, "unknown_carrier");
    if (up.error.code === "23514") throw new CarrierContactError("Check the address (up to 600 characters) and the email.", 400, "invalid_contact");
    throw new Error(`Could not save the carrier's commissions address: ${up.error.message}`);
  }
}
