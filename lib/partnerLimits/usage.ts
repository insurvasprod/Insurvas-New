import "server-only";

import { getSupabaseServiceClient } from "@/lib/supabase/service";
import type { PartnerType } from "@/lib/partners/constants";

/**
 * Active partners of one type — the one count LA-1.19 uses for create, activate, resume and the
 * usage figure. A draft, a paused or an offboarded partner holds no slot. `excludeId` leaves one
 * partner out (a type change counts the others already in the new type).
 */
export async function countActivePartners(tenantId: string, type: PartnerType, excludeId?: string): Promise<number> {
  let query = getSupabaseServiceClient()
    .from("partners")
    .select("id", { count: "exact", head: true })
    .eq("tenant_id", tenantId)
    .eq("partner_type", type)
    .eq("status", "active");
  if (excludeId) query = query.neq("id", excludeId);
  const { count, error } = await query;
  if (error) throw new Error(`Could not count active partners: ${error.message}`);
  return count ?? 0;
}
