import "server-only";

import { NextResponse } from "next/server";
import { requireFeature, type EntitledContext } from "@/lib/entitlements/requireFeature";
import type { TenantRole } from "./roles";
import { actAs } from "./requireTenant";

/** Entitlement first, then the current database-resolved tenant role. */
export async function requireFeatureRole(
  featureKey: string,
  allowedRoles: readonly TenantRole[],
  options: { write?: boolean; prefetchScope?: boolean } = {},
): Promise<EntitledContext | NextResponse> {
  const auth = await requireFeature(featureKey, options);
  if (auth instanceof NextResponse) return auth;

  // Any role the member holds may open it (custom team access); the route then runs as that role.
  const acting = actAs(auth.context, allowedRoles);
  if (!acting) {
    return NextResponse.json(
      {
        error: "Your role does not have access to this action",
        code: "role_not_allowed",
        role: auth.context.role,
      },
      { status: 403 },
    );
  }

  return acting === auth.context ? auth : { ...auth, context: { ...auth.context, ...acting } };
}
