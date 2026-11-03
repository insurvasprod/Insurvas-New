import "server-only";

import { NextResponse } from "next/server";

import { getMaintenanceStatus } from "./service";
import { isMaintenanceGatedPath, maintenanceGateDecision, maintenanceGateMessage } from "./maintenanceGateRules";

/**
 * The maintenance gate proxy.ts runs in front of /api/app and /api/partner (SA-4.9). Reads the
 * stored window through the service's short in-process cache, so it costs one database read per
 * few seconds per instance, not one per request. A failed read lets the request through: the
 * gate must not turn a database hiccup into a platform-wide outage.
 */
export async function maintenanceGateResponse(pathname: string, method: string): Promise<NextResponse | null> {
  if (!isMaintenanceGatedPath(pathname)) return null;

  let status: Awaited<ReturnType<typeof getMaintenanceStatus>>;
  try {
    status = await getMaintenanceStatus();
  } catch (error) {
    console.error("[maintenance-gate] could not read maintenance state; letting the request through", error);
    return null;
  }

  const block = maintenanceGateDecision(pathname, method, status.level);
  if (!block) return null;
  return NextResponse.json(
    { error: maintenanceGateMessage(block, status.message), code: block.code, level: block.level },
    { status: block.status, headers: { "Cache-Control": "no-store", "Retry-After": "300" } },
  );
}
