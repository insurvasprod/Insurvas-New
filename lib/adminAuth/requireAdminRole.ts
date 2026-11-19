import "server-only";
import { cookies } from "next/headers";
import { NextResponse } from "next/server";

import { isAdminRole, type AdminRole } from "./roles";
import { ADMIN_SESSION_COOKIE, verifyAdminSessionToken, type AdminSessionPayload } from "./session";
import {
  adminSessionIsCurrent,
  readAdminWithSessionVersion,
  tokenSessionVersion,
  type SessionVersionClient,
} from "./sessionVersion";
import { getSupabaseServiceClient } from "@/lib/supabase/service";

/** The verified cookie only. Prefer resolveAdminContext — the token's role may be stale. */
export async function getAdminSession(): Promise<AdminSessionPayload | null> {
  const store = await cookies();
  const token = store.get(ADMIN_SESSION_COOKIE)?.value;
  if (!token) return null;
  return verifyAdminSessionToken(token);
}

export type AdminContext = {
  sub: string;
  role: AdminRole;
};

/**
 * Resolves the caller's current role and active state from the database rather than trusting the
 * 12h session token (SA-1.3).
 *
 * Without this, deactivating an admin — or demoting them — did not take effect until their token
 * expired, leaving them with working API access in the meantime.
 */
export async function resolveAdminContext(): Promise<AdminContext | null> {
  const session = await getAdminSession();
  if (!session) return null;

  const { row: admin, version } = await readAdminWithSessionVersion<{ id: string; role: string; is_active: boolean }>(
    getSupabaseServiceClient() as unknown as SessionVersionClient,
    session.sub,
    "id, role, is_active",
  );

  if (!admin || !admin.is_active || !isAdminRole(admin.role)) return null;
  // Security review 2026-11, M-2: a session ended from the server (sign-out, "Sign out everywhere",
  // deactivation) is refused here even though its cookie is still signed and unexpired.
  if (!adminSessionIsCurrent(tokenSessionVersion(session), version)) return null;

  return { sub: admin.id, role: admin.role };
}

/**
 * Server-side gate for every /api/admin route. Pass the roles allowed to call this route;
 * omit it to require any authenticated, still-active admin.
 *
 * Usage:
 *   const auth = await requireAdminRole(["super_admin"]);
 *   if (auth instanceof NextResponse) return auth;
 *   const { session } = auth;
 */
export async function requireAdminRole(
  allowedRoles?: readonly AdminRole[],
): Promise<{ session: AdminContext } | NextResponse> {
  const session = await resolveAdminContext();

  if (!session) {
    return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  }

  if (allowedRoles && !allowedRoles.includes(session.role)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  return { session };
}
