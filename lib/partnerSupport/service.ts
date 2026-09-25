import "server-only";

import { getSupabaseServiceClient } from "@/lib/supabase/service";
import { isPendingSchema, SchemaPendingError } from "@/lib/carriers/schemaGap";
import type { SupportContact, SupportContactInput } from "./contact";

type SupportRow = { support_email: string | null; support_phone: string | null };

// eslint-disable-next-line @typescript-eslint/no-explicit-any -- tenants.support_* are not in database.types.ts yet (shared; not ours to regenerate)
const untyped = () => getSupabaseServiceClient() as any;

/**
 * The agency's support contact, for its own tenant only — callers pass the tenant from a verified
 * session, never from the request. Before migration 20260924210000 the columns are missing: that is
 * reported as schemaReady=false, not as a failure.
 */
export async function getSupportContact(tenantId: string): Promise<SupportContact> {
  const { data, error } = await untyped().from("tenants").select("support_email, support_phone").eq("id", tenantId).maybeSingle();
  if (error && isPendingSchema(error)) return { email: null, phone: null, schemaReady: false };
  if (error) throw new Error(`Could not load the support contact: ${error.message}`);
  const row = data as SupportRow | null;
  return { email: row?.support_email ?? null, phone: row?.support_phone ?? null, schemaReady: true };
}

export async function saveSupportContact(tenantId: string, input: SupportContactInput): Promise<SupportContact> {
  const { data, error } = await untyped()
    .from("tenants")
    .update({ support_email: input.email, support_phone: input.phone })
    .eq("id", tenantId)
    .select("support_email, support_phone")
    .maybeSingle();
  if (error && isPendingSchema(error)) throw new SchemaPendingError();
  if (error) throw new Error(error.message);
  if (!data) throw new Error("Could not find this agency");
  const row = data as SupportRow;
  return { email: row.support_email, phone: row.support_phone, schemaReady: true };
}
