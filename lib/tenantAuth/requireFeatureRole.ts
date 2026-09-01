import "server-only";

import { NextResponse } from "next/server";
import { requireFeature, type EntitledContext } from "@/lib/entitlements/requireFeature";
import type { TenantRole } from "./roles";

/** Entitlement first, then the current database-resolved tenant role. */
export async function requireFeatureRole(
  featureKey: string,
  allowedRoles: readonly TenantRole[],
  options: { write?: boolean } = {},
): Promise<EntitledContext | NextResponse> {
  const auth = await requireFeature(featureKey, options);
  if (auth instanceof NextResponse) return auth;

  if (!allowedRoles.includes(auth.context.role)) {
    return NextResponse.json(
      {
        error: "Your role does not have access to this action",
        code: "role_not_allowed",
        role: auth.context.role,
      },
      { status: 403 },
    );
  }

  return auth;
}
