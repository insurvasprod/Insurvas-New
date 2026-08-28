import "server-only";

import { getSupabaseServiceClient } from "@/lib/supabase/service";
import type { Entitlement } from "./types";

/**
 * Reads the cached entitlement, computing it on first access.
 *
 * One indexed primary-key lookup in the common case — that's the point of caching it rather than
 * re-joining plans, add-ons, meters and usage on every request.
 */
export async function getEntitlement(tenantId: string): Promise<Entitlement> {
  const supabase = getSupabaseServiceClient();

  const { data: cached } = await supabase
    .from("tenant_entitlements")
    .select("entitlement")
    .eq("tenant_id", tenantId)
    .maybeSingle<{ entitlement: Entitlement }>();

  if (cached?.entitlement) return cached.entitlement;

  // Nothing cached yet (a brand-new tenant). Compute and store it now rather than returning a
  // misleading empty object.
  const { data, error } = await supabase.rpc("refresh_tenant_entitlement", { p_tenant_id: tenantId });
  if (error) throw new Error(`Could not compute entitlement: ${error.message}`);

  return data as unknown as Entitlement;
}

/** Forces a recompute. Called from every path that changes what a tenant is entitled to. */
export async function refreshEntitlement(tenantId: string): Promise<Entitlement> {
  const supabase = getSupabaseServiceClient();
  const { data, error } = await supabase.rpc("refresh_tenant_entitlement", { p_tenant_id: tenantId });
  if (error) throw new Error(`Could not refresh entitlement: ${error.message}`);
  return data as unknown as Entitlement;
}
