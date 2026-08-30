import "server-only";
import { NextResponse } from "next/server";

import { requireTenant, type TenantContext } from "@/lib/tenantAuth/requireTenant";
import { getEntitlement } from "./get";
import { canWrite, hasFeature, type Entitlement } from "./types";
import { featureKillState } from "@/lib/features/killSwitch";

export type EntitledContext = {
  context: TenantContext;
  entitlement: Entitlement;
};

/**
 * THE real enforcement point.
 *
 * The Basic Idea doc puts it bluntly: hiding a menu item is not security. The menu and the route
 * guard are courtesy; this is the check that actually stops a hand-crafted request.
 *
 *   const auth = await requireFeature("chargeback_radar");
 *   if (auth instanceof NextResponse) return auth;
 *   const { context, entitlement } = auth;
 *
 * `write: true` additionally refuses when the subscription is suspended or paused — those keep
 * READ access to the book of business but must not permit new work.
 */
export async function requireFeature(
  featureKey: string,
  options: { write?: boolean } = {},
): Promise<EntitledContext | NextResponse> {
  const auth = await requireTenant();
  if (auth instanceof NextResponse) return auth;

  const entitlement = await getEntitlement(auth.context.tenantId);

  // KILL SWITCH FIRST, THEN ENTITLEMENT (SA-4.10).
  //
  // The order matters and is not interchangeable. A killed feature is off for everyone, including
  // a tenant whose plan grants it — so telling them their plan doesn't include it would be a lie,
  // and would send a paying customer to an upgrade page for something they already bought.
  const kill = await featureKillState(featureKey, auth.context.tenantId);
  if (kill.killed) {
    return NextResponse.json(
      {
        // A distinct code from feature_not_entitled, so the agent app shows a maintenance notice
        // rather than an upgrade prompt.
        error: kill.notice ?? "This feature is temporarily unavailable.",
        code: "feature_unavailable",
        feature: featureKey,
      },
      { status: 503 },
    );
  }

  if (!hasFeature(entitlement, featureKey)) {
    // 403 with a machine-readable reason, so the agent app can show an upgrade prompt rather
    // than a dead end.
    return NextResponse.json(
      {
        error: "Your plan doesn't include this feature",
        code: "feature_not_entitled",
        feature: featureKey,
        plan: entitlement.plan_code,
      },
      { status: 403 },
    );
  }

  if (options.write && !canWrite(entitlement)) {
    return NextResponse.json(
      {
        error:
          entitlement.status === "suspended"
            ? "Your account is suspended. You can still view your book of business, but not make changes."
            : "Your account is paused. You can still view your book of business, but not make changes.",
        code: "read_only",
        status: entitlement.status,
      },
      { status: 403 },
    );
  }

  return { context: auth.context, entitlement };
}

/** For routes that need a session and write access but aren't gated on a specific feature. */
export async function requireWriteAccess(): Promise<EntitledContext | NextResponse> {
  const auth = await requireTenant();
  if (auth instanceof NextResponse) return auth;

  const entitlement = await getEntitlement(auth.context.tenantId);

  if (!canWrite(entitlement)) {
    return NextResponse.json(
      { error: "Your account is read-only right now.", code: "read_only", status: entitlement.status },
      { status: 403 },
    );
  }

  return { context: auth.context, entitlement };
}
