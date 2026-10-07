import "server-only";

import { getSupabaseServiceClient } from "@/lib/supabase/service";
import { isSchemaGap } from "@/lib/supabase/schemaGap";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Loose = any;
const db = (): Loose => getSupabaseServiceClient();

/**
 * LA-4.7 (Notion sprint) · recompute Layer 3 for a scope through refresh_policy_current — after a
 * file's snapshots (the policies it touched), or after a carrier rule changes (that carrier, for one
 * agency or, with no agency, every agency). The daily job covers the calendar.
 *
 * Returns the rows written, or null while the migration (20261008160000) is not applied — the
 * layers below it keep working without it.
 */
export async function refreshPolicyCurrent(scope: { tenantId: string | null; carrierId: string; policies?: string[] }): Promise<number | null> {
  const { data, error } = await db().rpc("refresh_policy_current", {
    p_tenant_id: scope.tenantId,
    p_carrier_id: scope.carrierId,
    p_policy_numbers: scope.policies ?? null,
  });
  if (error) {
    if (isSchemaGap(error)) return null;
    throw new Error(`The current policy rows could not be refreshed: ${error.message}`);
  }
  return Number(data ?? 0);
}
