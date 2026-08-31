import "server-only";
import { redirect } from "next/navigation";

import { resolveTenantContext } from "@/lib/tenantAuth/requireTenant";
import { getEntitlement } from "./get";
import { hasFeature, type Entitlement } from "./types";
import { featureKillState } from "@/lib/features/killSwitch";

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
  | { entitled: true; killed: false; notice: null; entitlement: Entitlement }
  // Killed and unentitled are kept apart so the page can show a maintenance notice rather than an
  // upgrade prompt. Selling someone an upgrade for something that is switched off platform-wide
  // is the specific mistake SA-4.10 exists to prevent.
  | { entitled: false; killed: boolean; notice: string | null; entitlement: Entitlement };

export async function guardPage(featureKey: string): Promise<PageGuardResult> {
  const context = await resolveTenantContext();
  if (!context) redirect("/app/login");

  const entitlement = await getEntitlement(context.tenantId);

  // Kill switch first, then entitlement — the same order as requireFeature (SA-4.10).
  const kill = await featureKillState(featureKey, context.tenantId);
  if (kill.killed) {
    return { entitled: false, killed: true, notice: kill.notice, entitlement };
  }

  return hasFeature(entitlement, featureKey)
    ? { entitled: true, killed: false, notice: null, entitlement }
    : { entitled: false, killed: false, notice: null, entitlement };
}
