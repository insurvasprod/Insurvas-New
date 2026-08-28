import "server-only";
import { redirect } from "next/navigation";

import { resolveTenantContext } from "@/lib/tenantAuth/requireTenant";
import { getEntitlement } from "./get";
import { hasFeature, type Entitlement } from "./types";

/**
 * Enforcement point 2 of 3: the ROUTE GUARD.
 *
 * Catches someone pasting a URL for a page their plan doesn't include. Without it they'd reach a
 * page that renders half-broken; with it they get an upgrade prompt instead of a dead end.
 *
 * Still not security — the page's data comes from APIs, and those are guarded separately by
 * requireFeature(). This is about not showing someone a broken screen.
 */
export async function guardPage(featureKey: string): Promise<
  { entitled: true; entitlement: Entitlement } | { entitled: false; entitlement: Entitlement }
> {
  const context = await resolveTenantContext();
  if (!context) redirect("/app/login");

  const entitlement = await getEntitlement(context.tenantId);

  return hasFeature(entitlement, featureKey)
    ? { entitled: true, entitlement }
    : { entitled: false, entitlement };
}
