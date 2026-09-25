import "server-only";
import { cache } from "react";

import { getSupabaseServiceClient } from "@/lib/supabase/service";
import type { Entitlement } from "./types";

/**
 * Reads the cached entitlement, computing it on first access.
 *
 * One indexed primary-key lookup in the common case — that's the point of caching it rather than
 * re-joining plans, add-ons, meters and usage on every request.
 */
export async function getEntitlement(tenantId: string): Promise<Entitlement> {
  return readEntitlement(tenantId);
}

// One read per tenant per request. The shell builds the menu from it and the page's guard checks it
// again; both now share one lookup. Request-scoped only (React `cache`), so a plan change is seen on
// the next request exactly as before. Route handlers are not memoised by React, so a handler that
// calls refreshEntitlement() and then reads still sees the fresh value.
const readEntitlement = cache(async (tenantId: string): Promise<Entitlement> => {
  const supabase = getSupabaseServiceClient();

  const { data: cached } = await supabase
    .from("tenant_entitlements")
    .select("entitlement")
    .eq("tenant_id", tenantId)
    .maybeSingle<{ entitlement: Entitlement }>();

  if (cached?.entitlement && cached.entitlement.limits.max_setter_seats !== undefined && cached.entitlement.limits.max_active_campaigns !== undefined) return cached.entitlement;

  // LA-2.22 adds outbound capacities to the entitlement contract. Rebuild an older cached
  // snapshot once so every caller still reads limits from the entitlement object, never from a
  // plan row. The RPC owns the compatibility read and persists the normalized snapshot.
  if (cached?.entitlement) {
    const { data: normalized, error: normalizeError } = await (supabase as unknown as { rpc(name: string, args: Record<string, string>): Promise<{ data: unknown; error: { message: string } | null }> }).rpc("ensure_outbound_entitlement", { p_tenant_id: tenantId });
    if (!normalizeError && normalized) return normalized as unknown as Entitlement;

    // Older shared projects may have the cached entitlement table but not yet have the additive
    // outbound-normalization RPC. Do not discard a valid cached snapshot and recompute it from a
    // different legacy subscription in that case: doing so changes the feature set seen by the
    // tenant and makes compatibility fixtures (and grandfathered tenants) appear to lose access.
    // The next successful refresh or the migration that adds the RPC will supply the newer fields.
    if (normalizeError && /does not exist|could not find|schema cache/i.test(normalizeError.message)) return cached.entitlement;
  }

  // Nothing cached yet (a brand-new tenant). Compute and store it now rather than returning a
  // misleading empty object.
  const { data, error } = await supabase.rpc("refresh_tenant_entitlement", { p_tenant_id: tenantId });
  if (error) throw new Error(`Could not compute entitlement: ${error.message}`);

  return data as unknown as Entitlement;
});

/** Forces a recompute. Called from every path that changes what a tenant is entitled to. */
export async function refreshEntitlement(tenantId: string): Promise<Entitlement> {
  const supabase = getSupabaseServiceClient();
  const { data: previousCache } = await supabase
    .from("tenant_entitlements")
    .select("entitlement")
    .eq("tenant_id", tenantId)
    .maybeSingle<{ entitlement: Entitlement }>();
  const { data, error } = await supabase.rpc("refresh_tenant_entitlement", { p_tenant_id: tenantId });
  if (error) throw new Error(`Could not refresh entitlement: ${error.message}`);
  const entitlement = data as unknown as Entitlement;

  // Compatibility with shared projects where the refresh RPC predates credit-grant support.
  // Grants are append-only source data; merge the current period into the returned snapshot and
  // persist it so the tenant surface does not disagree with meter enforcement.
  // The 20260924344000 engine already adds the period's grants and says so; merging again here
  // would count every grant twice.
  const periodStart = entitlement.period_start;
  if (periodStart && entitlement.meters && !entitlement.credit_grants_included) {
    const { data: grants, error: grantsError } = await supabase
      .from("credit_grants")
      .select("meter_key, quantity, granted_at")
      .eq("tenant_id", tenantId)
      .gte("granted_at", periodStart);
    if (grantsError) throw new Error(`Could not merge credit grants: ${grantsError.message}`);
    const quantities = new Map<string, number>();
    for (const grant of grants ?? []) quantities.set(grant.meter_key, (quantities.get(grant.meter_key) ?? 0) + grant.quantity);
    if (quantities.size > 0) {
      const mergedMeters = { ...entitlement.meters };
      for (const [meterKey, quantity] of quantities) {
        const meter = mergedMeters[meterKey];
        if (!meter || meter.included === null) continue;
        const previousIncluded = previousCache?.entitlement?.meters?.[meterKey]?.included ?? meter.included;
        const alreadyReflected = Math.max(0, meter.included - previousIncluded);
        const missing = Math.max(0, quantity - alreadyReflected);
        if (missing > 0) mergedMeters[meterKey] = { ...meter, included: meter.included + missing };
      }
      const merged = { ...entitlement, meters: mergedMeters };
      if (JSON.stringify(mergedMeters) === JSON.stringify(entitlement.meters)) return entitlement;
      const { error: cacheError } = await supabase
        .from("tenant_entitlements")
        .update({ entitlement: merged, computed_at: new Date().toISOString() })
        .eq("tenant_id", tenantId);
      if (cacheError) throw new Error(`Could not persist credit-aware entitlement: ${cacheError.message}`);
      return merged;
    }
  }
  return entitlement;
}
