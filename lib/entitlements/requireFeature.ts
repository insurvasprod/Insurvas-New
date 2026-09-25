import "server-only";
import { NextResponse } from "next/server";

import { getTenantSession, requireTenant, type TenantContext } from "@/lib/tenantAuth/requireTenant";
import { getEntitlement } from "./get";
import { DISABLED_FOR_TENANT_MESSAGE, canWrite, hasFeature, isDisabledForTenant, type Entitlement } from "./types";
import { featureKillState } from "@/lib/features/killSwitch";
import { getMaintenanceStatus } from "@/lib/system/service";

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
  // ── Four reads, one round trip ──────────────────────────────────────────────
  //
  // These four used to run one after another, and each is a separate trip to a remote database.
  // Measured against the live project: membership 219ms, maintenance 183ms, entitlement 171ms, kill
  // switch ~170ms — about 740ms of preamble before any route did its own work. The transfer inbox
  // measured 903ms end to end against a 1,000ms budget, and 722ms of that was this function.
  //
  // None of them depends on another's result. `tenantId` comes from the session JWT, which is
  // signed by us and verified before any of this, so the entitlement and kill-switch reads never
  // needed to wait for the membership lookup to come back.
  //
  // DECISION ORDER IS UNCHANGED. Only the fetching is concurrent; every branch below still runs in
  // the same sequence, so maintenance is still evaluated before entitlement and the kill switch is
  // still evaluated before entitlement. Reordering those would change what a caller learns about a
  // tenant, which is the one thing this function may not do.
  const session = await getTenantSession();
  if (!session) {
    // No session: let requireTenant produce the canonical 401. It returns before any IO, so this
    // costs nothing, and the unauthenticated path does no speculative work at all.
    const unauthenticated = await requireTenant();
    return unauthenticated instanceof NextResponse
      ? unauthenticated
      : NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  }

  // The speculative three are captured rather than awaited directly: if authorisation fails, their
  // rejections must not surface instead of the 401/403 the caller should see.
  const settle = <T,>(promise: Promise<T>) =>
    promise.then(
      (value) => ({ ok: true as const, value }),
      (error: unknown) => ({ ok: false as const, error }),
    );

  const [auth, maintenance, entitlementSettled, killSettled] = await Promise.all([
    requireTenant(),
    getMaintenanceStatus(),
    settle(getEntitlement(session.tenantId)),
    settle(featureKillState(featureKey, session.tenantId)),
  ]);

  if (auth instanceof NextResponse) return auth;
  if (maintenance.level === "locked" || (options.write && maintenance.level === "read_only")) {
    return NextResponse.json(
      {
        error:
          maintenance.message ??
          (maintenance.level === "locked"
            ? "The platform is temporarily unavailable while maintenance is underway."
            : "The platform is read-only while maintenance is underway."),
        code: maintenance.level === "locked" ? "maintenance_locked" : "maintenance_read_only",
        level: maintenance.level,
      },
      { status: 503 },
    );
  }

  // Past the maintenance gate, so a failure in either speculative read is now the caller's problem
  // and is raised exactly as it would have been when these ran one after another.
  if (!entitlementSettled.ok) throw entitlementSettled.error;
  if (!killSettled.ok) throw killSettled.error;
  const entitlement = entitlementSettled.value;

  // KILL SWITCH FIRST, THEN ENTITLEMENT (SA-4.10).
  //
  // The order matters and is not interchangeable. A killed feature is off for everyone, including
  // a tenant whose plan grants it — so telling them their plan doesn't include it would be a lie,
  // and would send a paying customer to an upgrade page for something they already bought.
  const kill = killSettled.value;
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
    // Switched off for this tenant alone by staff (a per-tenant override). Their plan includes it,
    // so "your plan doesn't include this" would be false and an upgrade prompt would sell them what
    // they already pay for. Its own code, so the agent app shows neutral copy instead.
    if (isDisabledForTenant(entitlement, featureKey)) {
      return NextResponse.json(
        { error: DISABLED_FOR_TENANT_MESSAGE, code: "feature_disabled_for_tenant", feature: featureKey },
        { status: 403 },
      );
    }

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
  // Same three-round-trip preamble as requireFeature, fetched concurrently for the same reason and
  // with the same ordering guarantee: maintenance is still decided before entitlement. Every write
  // route in the application goes through here, so the ~350ms is not specific to one screen.
  const session = await getTenantSession();
  if (!session) {
    const unauthenticated = await requireTenant();
    return unauthenticated instanceof NextResponse
      ? unauthenticated
      : NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  }

  const [auth, maintenance, entitlementSettled] = await Promise.all([
    requireTenant(),
    getMaintenanceStatus(),
    getEntitlement(session.tenantId).then(
      (value) => ({ ok: true as const, value }),
      (error: unknown) => ({ ok: false as const, error }),
    ),
  ]);

  if (auth instanceof NextResponse) return auth;
  if (maintenance.level === "locked" || maintenance.level === "read_only") {
    return NextResponse.json(
      {
        error: maintenance.message ?? "The platform is read-only while maintenance is underway.",
        code: maintenance.level === "locked" ? "maintenance_locked" : "maintenance_read_only",
        level: maintenance.level,
      },
      { status: 503 },
    );
  }

  if (!entitlementSettled.ok) throw entitlementSettled.error;
  const entitlement = entitlementSettled.value;

  if (!canWrite(entitlement)) {
    return NextResponse.json(
      { error: "Your account is read-only right now.", code: "read_only", status: entitlement.status },
      { status: 403 },
    );
  }

  return { context: auth.context, entitlement };
}
