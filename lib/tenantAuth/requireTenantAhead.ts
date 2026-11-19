import "server-only";

import { NextResponse } from "next/server";

import { rememberScope, visibleProducerUserIds, type ProducerScope } from "@/lib/agency/visibility";
import { getEntitlement } from "@/lib/entitlements/get";
import type { Entitlement } from "@/lib/entitlements/types";
import { loadFeatureSwitches } from "@/lib/features/killSwitch";
import { applyKillSwitches } from "@/lib/features/killSwitchRules";
import { isSoloWorkspace } from "@/lib/tenantTeam/solo";
import { getTenantSession, requireTenant, type TenantContext } from "./requireTenant";

/**
 * requireTenant, with the reads nearly every count route makes next already done (speed pass 2026-11-18).
 *
 * The rail-count routes read the membership, then the plan, then the kill switches, then the scope, then
 * counted: three or four trips one after another before the first count. Every one of those reads is keyed
 * by the signed session's two ids, so they start beside the membership read, the way requireFeature's do.
 * Nothing read early is returned, and no failure among them surfaces, until the membership holds; the
 * context's ids are the session's own (readTenantAccess), so the early reads are this person's.
 *
 *   const auth = await requireTenantAhead({ scope: true, solo: true });
 *   if (auth instanceof NextResponse) return auth;
 *   auth.available   // the plan's features after kill switches (effectiveFeatures)
 *   scopeFor(auth.context)  // answered from the early read, no trip
 */
export type TenantAhead = {
  context: TenantContext;
  entitlement: Entitlement;
  available: string[];
  /** Read only when asked for (`solo: true`); null otherwise. */
  solo: boolean | null;
};

const settle = <T,>(promise: Promise<T>) =>
  promise.then((value) => ({ ok: true as const, value }), (error: unknown) => ({ ok: false as const, error }));

export async function requireTenantAhead(options: { scope?: boolean; solo?: boolean } = {}): Promise<TenantAhead | NextResponse> {
  const session = await getTenantSession();
  if (!session) {
    const unauthenticated = await requireTenant();
    return unauthenticated instanceof NextResponse ? unauthenticated : NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  }
  const [auth, entitlementRead, switchesRead, scopeRead, soloRead] = await Promise.all([
    requireTenant(),
    settle(getEntitlement(session.tenantId)),
    settle(loadFeatureSwitches()),
    options.scope ? settle<ProducerScope>(visibleProducerUserIds(session.tenantId, session.sub)) : null,
    options.solo ? settle(isSoloWorkspace(session.tenantId)) : null,
  ]);
  if (auth instanceof NextResponse) return auth;
  if (!entitlementRead.ok) throw entitlementRead.error;
  if (!switchesRead.ok) throw switchesRead.error;
  // A failed scope read is not raised here: scopeFor reads it again, as it would have without this.
  if (scopeRead?.ok) rememberScope(auth.context, scopeRead.value);
  if (soloRead && !soloRead.ok) throw soloRead.error;
  return {
    context: auth.context,
    entitlement: entitlementRead.value,
    available: applyKillSwitches(entitlementRead.value.features, switchesRead.value, session.tenantId),
    solo: soloRead ? soloRead.value : null,
  };
}
