import "server-only";

import { getWorkspaceTimezone } from "@/lib/agencyProfile/timezone";
import { getSupabaseServiceClient } from "@/lib/supabase/service";
import { dealDayZone } from "./localDate";

/**
 * The zone of the Daily deal flow's day for this agency (lib/dealFlow/localDate.ts `dealDayZone`): the agency's
 * timezone, else its partners' one shared zone, else null. The partners are read only when the agency has no zone.
 */
export async function getDealDayZone(tenantId: string): Promise<string | null> {
  const workspace = await getWorkspaceTimezone(tenantId).catch(() => null);
  if (workspace) return workspace;
  const { data, error } = await getSupabaseServiceClient().from("partners").select("timezone").eq("tenant_id", tenantId).limit(200);
  if (error) return null;
  return dealDayZone(null, (data ?? []).map((row) => (row as { timezone: string | null }).timezone));
}
