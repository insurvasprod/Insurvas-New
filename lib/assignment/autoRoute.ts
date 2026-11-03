import "server-only";

import { getSupabaseServiceClient } from "@/lib/supabase/service";

type Result = { data: unknown; error: { message: string; code?: string } | null };
type Db = { rpc(name: string, args: Record<string, unknown>): Promise<Result> };

export type AutoRouteOutcome = { routed: boolean; reason?: string; owner_user_id?: string | null };

/**
 * Lead assignment › "Route posted leads on arrival" (assignment_settings.auto_route_posted, off by
 * default). Called by the lead-post ingest path once a posted lead is queued.
 *
 * All of the deciding happens in auto_route_posted_lead (20260925702100): whether the tenant turned
 * it on, the real-time rules, every gate the router applies, the re-check of the licence gate on the
 * owner it picked, and the audit row. This only calls it.
 *
 * Never throws. The vendor's post has already been accepted and queued; a routing failure leaves
 * the lead in the pool, exactly where it would have been with the setting off. Before the migration
 * the function does not exist, which is the same as the setting being off.
 */
export async function autoRoutePostedLead(tenantId: string, leadId: string): Promise<AutoRouteOutcome> {
  try {
    const client = getSupabaseServiceClient() as unknown as Db;
    const result = await client.rpc("auto_route_posted_lead", { p_tenant_id: tenantId, p_lead_id: leadId });
    if (result.error) {
      const missing = ["42883", "PGRST202", "42P01", "42703"].includes(result.error.code ?? "") || /schema cache|does not exist/i.test(result.error.message);
      if (!missing) console.error(`[lead-post] auto-route failed for lead ${leadId}: ${result.error.message.slice(0, 300)}`);
      return { routed: false, reason: missing ? "not_available" : "error" };
    }
    return (result.data ?? { routed: false }) as AutoRouteOutcome;
  } catch (error) {
    console.error(`[lead-post] auto-route failed for lead ${leadId}: ${error instanceof Error ? error.message : "unknown error"}`);
    return { routed: false, reason: "error" };
  }
}
