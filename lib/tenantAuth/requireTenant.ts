import "server-only";
import { cache } from "react";
import { cookies } from "next/headers";
import { NextResponse } from "next/server";

import { isTenantRole, type TenantRole } from "./roles";
import { TENANT_SESSION_COOKIE, verifyTenantSessionToken, type TenantSessionPayload } from "./session";
import { getSupabaseServiceClient } from "@/lib/supabase/service";
import { holdsPartnerMembership } from "@/lib/auth/planeSeparation";
import { isTenantSuspended, TENANT_SUSPENDED_CODE, TENANT_SUSPENDED_MESSAGE } from "@/lib/tenants/suspension";
import { checkTenantSession, type SessionCheck } from "./sessionStore";

/** The verified cookie only — identity, no authorisation. Use resolveTenantContext for the role. */
export async function getTenantSession(): Promise<TenantSessionPayload | null> {
  return readTenantSession();
}

// Request-scoped memoisation (React `cache`). The shell layout, the page's guardPage and any nested
// server component all ask for the same session and membership during one render; without this
// each asked the database again. Scoped to one request only — a role change or deactivation still
// takes effect on the very next request, which is the property SA-1.3 depends on.
const readTenantSession = cache(async (): Promise<TenantSessionPayload | null> => {
  const store = await cookies();
  const token = store.get(TENANT_SESSION_COOKIE)?.value;
  if (!token) return null;
  return verifyTenantSessionToken(token);
});

export type TenantContext = {
  userId: string;
  tenantId: string;
  role: TenantRole;
  /** The tenant_user_session row of this request's cookie (LA-8.2); null on a cookie issued before sessions were rows. */
  sessionId?: string | null;
  /** When this session passed the second factor; null when it did not. */
  twoFactorAt?: string | null;
};

/**
 * Resolves the caller's *current* role and account state from the database rather than from the
 * session token (SA-1.3). This is what makes a role change take effect on the user's next
 * request instead of their next login, and it also drops a user whose account was deactivated
 * mid-session.
 */
export async function resolveTenantContext(): Promise<TenantContext | null> {
  return (await readTenantAccess()).context;
}

/**
 * Whether the signed-in session belongs to a suspended agency (decision 4). Read from the same
 * memoised lookup as resolveTenantContext, so asking costs nothing extra. Lets a page send the
 * person to the "this agency is suspended" screen instead of a sign-in form that would refuse them.
 */
export async function resolveTenantSuspended(): Promise<boolean> {
  return (await readTenantAccess()).suspended;
}

const readTenantAccess = cache(async (): Promise<{ context: TenantContext | null; suspended: boolean }> => {
  const none = { context: null, suspended: false };
  const session = await getTenantSession();
  if (!session) return none;

  const supabase = getSupabaseServiceClient();

  // The agency's own state is read on every request with the person's, in the same round trip:
  // suspending an agency ends every session in it on the next request, not at token expiry.
  // …and whether the account belongs to a partner organisation, in the same round trip: a partner
  // account never opens the agent app, whatever tenant_users says (lib/auth/planeSeparation.ts).
  // …and, for a cookie that names its session (LA-8.2), whether that session is still live — read
  // from the store on every request, so ending a session takes effect on its next one. A failed
  // check closes the session rather than opening it.
  const sessionCheck: Promise<SessionCheck> = session.sid
    ? checkTenantSession(session.sid, session.sub).catch(() => ({ live: false, twoFactorAt: null }))
    : Promise.resolve({ live: true, twoFactorAt: null });
  const [{ data: membership }, { data: user }, { data: tenant }, isPartnerAccount, live] = await Promise.all([
    supabase
      .from("tenant_users")
      .select("role")
      .eq("user_id", session.sub)
      .eq("tenant_id", session.tenantId)
      .maybeSingle<{ role: string }>(),
    supabase.from("users").select("status, session_version").eq("id", session.sub).maybeSingle<{ status: string; session_version: number }>(),
    supabase.from("tenants").select("status").eq("id", session.tenantId).maybeSingle<{ status: string }>(),
    holdsPartnerMembership(session.sub),
    sessionCheck,
  ]);

  if (isPartnerAccount) return none;
  // Membership revoked, account no longer active, or an unrecognised role — all mean "no session".
  if (!membership || !isTenantRole(membership.role)) return none;
  if (!user || user.status !== "active") return none;
  if (session.sessionVersion !== undefined && session.sessionVersion !== user.session_version) return none;
  if (!live.live) return none;
  // A missing tenant row (or a failed read) closes the session rather than opening it.
  if (!tenant) return none;
  // Only a person who would otherwise be let in learns that the agency is suspended.
  if (isTenantSuspended(tenant.status)) return { context: null, suspended: true };

  return { context: { userId: session.sub, tenantId: session.tenantId, role: membership.role, sessionId: session.sid ?? null, twoFactorAt: live.twoFactorAt }, suspended: false };
});

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
  const { context, suspended } = await readTenantAccess();

  if (suspended) {
    return NextResponse.json({ error: TENANT_SUSPENDED_MESSAGE, code: TENANT_SUSPENDED_CODE }, { status: 403 });
  }

  if (!context) {
    return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  }

  if (allowedRoles && !allowedRoles.includes(context.role)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  return { context };
}
