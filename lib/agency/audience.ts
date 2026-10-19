import "server-only";
import { cache } from "react";

import { getSupabaseServiceClient } from "@/lib/supabase/service";
import { audienceForPlanType, type PlanAudience } from "./constants";

type LooseRpc = { rpc<T>(name: string, args: Record<string, unknown>): PromiseLike<{ data: T | null; error: { message: string } | null }> };

/**
 * AG-0.1 · whether this tenant is an agency or a solo agent, from its current plan's plan_type
 * (decision D2: derived, never stored twice). Request-memoised. Null when the tenant has no plan or the
 * read fails — callers treat null as "not an agency", so every agency predicate is a no-op for it.
 */
export const getPlanAudience = cache(async (tenantId: string): Promise<PlanAudience | null> => {
  const supabase = getSupabaseServiceClient();
  const { data: planId, error } = await (supabase as unknown as LooseRpc).rpc<string>("tenant_current_plan", { p_tenant_id: tenantId });
  if (error || !planId) return null;
  const { data } = await supabase.from("plans").select("plan_type").eq("id", planId).maybeSingle<{ plan_type: string | null }>();
  return audienceForPlanType(data?.plan_type);
});

export async function isAgencyTenant(tenantId: string): Promise<boolean> {
  return (await getPlanAudience(tenantId)) === "agency";
}
