import "server-only";

import { NextResponse } from "next/server";

import type { AdminContext } from "@/lib/adminAuth/requireAdminRole";
import { canAccessConfigurationSection } from "@/lib/configuration/sections";
import type { EntitledContext } from "@/lib/entitlements/requireFeature";
import type { MapScope } from "./maps";

/**
 * Session-route glue. Each route calls `requireFeatureRole("carrier_extension", …)` itself (so the
 * feature-key checker sees the guard in the route file) and turns the result into an actor here.
 */
export function actorOf(auth: EntitledContext, request: Request) {
  return { tenantId: auth.context.tenantId, userId: auth.context.userId, role: auth.context.role, request };
}

export function tenantScope(auth: EntitledContext, request: Request): MapScope {
  return { plane: "tenant", tenantId: auth.context.tenantId, userId: auth.context.userId, request };
}

/**
 * Staff plane: field maps belong to the carrier library, so they follow its access rule. Each admin
 * route resolves the admin itself (`resolveAdminContext()`, so the route-order guard sees it) and
 * hands the result here.
 */
export function adminScopeFor(admin: AdminContext | null, request: Request): MapScope | NextResponse {
  if (!admin) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  if (!canAccessConfigurationSection(admin.role, "carriers")) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  return { plane: "admin", adminId: admin.sub, request };
}

export const NO_STORE = { "Cache-Control": "no-store" };
