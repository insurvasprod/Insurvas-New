import "server-only";
import { redirect } from "next/navigation";

import { getTenantSession, resolveTenantContext } from "@/lib/tenantAuth/requireTenant";
import { getEntitlement } from "./get";
import { hasFeature, isDisabledForTenant, type Entitlement } from "./types";
import { featureKillState } from "@/lib/features/killSwitch";
import type { TenantRole } from "@/lib/tenantAuth/roles";
import type { TenantContext } from "@/lib/tenantAuth/requireTenant";

/**
 * Enforcement point 2 of 3: the ROUTE GUARD.
 *
 * Catches someone pasting a URL for a page their plan doesn't include. Without it they'd reach a
 * page that renders half-broken; with it they get an upgrade prompt instead of a dead end.
 *
 * Still not security — the page's data comes from APIs, and those are guarded separately by
 * requireFeature(). This is about not showing someone a broken screen.
 */
export type PageGuardResult =
  | { entitled: true; killed: false; disabled: false; notice: null; entitlement: Entitlement; role: TenantRole; context: TenantContext; feature: string }
  // Killed and unentitled are kept apart so the page can show a maintenance notice rather than an
  // upgrade prompt. Selling someone an upgrade for something that is switched off platform-wide
  // is the specific mistake SA-4.10 exists to prevent. `disabled` is the same mistake one tenant
  // wide: staff switched a feature their plan includes off for them alone, so the page says "not
  // available on your account" instead of offering an upgrade.
  | { entitled: false; killed: boolean; disabled: boolean; notice: string | null; entitlement: Entitlement; role: TenantRole; context: TenantContext; feature: string };

export async function guardPage(featureKey: string): Promise<PageGuardResult> {
  // Fetched together, decided in order — the same shape as requireFeature. The entitlement and
  // kill-switch reads are keyed by the tenant id in the verified session JWT, so they never needed
  // to wait for the membership lookup. All three are memoised for the request, so when the shell
  // layout has already asked (a full page load) this costs nothing at all.
  const session = await getTenantSession();
  if (!session) redirect("/app/login");

  const settle = <T,>(promise: Promise<T>) =>
    promise.then(
      (value) => ({ ok: true as const, value }),
      (error: unknown) => ({ ok: false as const, error }),
    );
  const [context, entitlementSettled, killSettled] = await Promise.all([
    resolveTenantContext(),
    settle(getEntitlement(session.tenantId)),
    settle(featureKillState(featureKey, session.tenantId)),
  ]);
  if (!context) redirect("/app/login");
  if (!entitlementSettled.ok) throw entitlementSettled.error;
  if (!killSettled.ok) throw killSettled.error;
  const entitlement = entitlementSettled.value;

  // Kill switch first, then entitlement — the same order as requireFeature (SA-4.10).
  const kill = killSettled.value;
  if (kill.killed) {
    return { entitled: false, killed: true, disabled: false, notice: kill.notice, entitlement, role: context.role, context, feature: featureKey };
  }

  return hasFeature(entitlement, featureKey)
    ? { entitled: true, killed: false, disabled: false, notice: null, entitlement, role: context.role, context, feature: featureKey }
    : { entitled: false, killed: false, disabled: isDisabledForTenant(entitlement, featureKey), notice: null, entitlement, role: context.role, context, feature: featureKey };
}
