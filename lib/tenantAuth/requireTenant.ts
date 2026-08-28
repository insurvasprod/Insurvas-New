import "server-only";
import { cookies } from "next/headers";
import { NextResponse } from "next/server";

import { isTenantRole, type TenantRole } from "./roles";
import { TENANT_SESSION_COOKIE, verifyTenantSessionToken, type TenantSessionPayload } from "./session";
import { getSupabaseServiceClient } from "@/lib/supabase/service";

/** The verified cookie only — identity, no authorisation. Use resolveTenantContext for the role. */
export async function getTenantSession(): Promise<TenantSessionPayload | null> {
  const store = await cookies();
  const token = store.get(TENANT_SESSION_COOKIE)?.value;
  if (!token) return null;
  return verifyTenantSessionToken(token);
}

export type TenantContext = {
  userId: string;
  tenantId: string;
  role: TenantRole;
};

/**
 * Resolves the caller's *current* role and account state from the database rather than from the
 * session token (SA-1.3). This is what makes a role change take effect on the user's next
 * request instead of their next login, and it also drops a user whose account was deactivated
 * mid-session.
 */
export async function resolveTenantContext(): Promise<TenantContext | null> {
  const session = await getTenantSession();
  if (!session) return null;

  const supabase = getSupabaseServiceClient();

  const [{ data: membership }, { data: user }] = await Promise.all([
    supabase
      .from("tenant_users")
      .select("role")
      .eq("user_id", session.sub)
      .eq("tenant_id", session.tenantId)
      .maybeSingle<{ role: string }>(),
    supabase.from("users").select("status").eq("id", session.sub).maybeSingle<{ status: string }>(),
  ]);

  // Membership revoked, account no longer active, or an unrecognised role — all mean "no session".
  if (!membership || !isTenantRole(membership.role)) return null;
  if (!user || user.status !== "active") return null;

  return { userId: session.sub, tenantId: session.tenantId, role: membership.role };
}

/**
 * Server-side gate for every /api/app route. Tenant scope comes ONLY from the verified session
 * cookie — never from a client-supplied tenant_id — and the role comes from the database.
 *
 * Usage:
 *   const auth = await requireTenant(["owner"]);
 *   if (auth instanceof NextResponse) return auth;
 *   const { context } = auth; // { userId, tenantId, role }
 */
export async function requireTenant(
  allowedRoles?: readonly TenantRole[],
): Promise<{ context: TenantContext } | NextResponse> {
  const context = await resolveTenantContext();

  if (!context) {
    return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  }

  if (allowedRoles && !allowedRoles.includes(context.role)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  return { context };
}
