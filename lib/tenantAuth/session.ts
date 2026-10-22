import { SignJWT, jwtVerify } from "jose";

// Deliberately distinct from ADMIN_SESSION_COOKIE — an admin session must never be mistaken for
// a tenant session, even by accident (see the "two planes" split this ticket implements).
export const TENANT_SESSION_COOKIE = "insurvas_tenant_session";

const SESSION_TTL_SECONDS = 60 * 60 * 12; // 12h

function getSecret(): Uint8Array {
  const secret = process.env.TENANT_SESSION_SECRET;
  if (!secret) {
    throw new Error("Missing TENANT_SESSION_SECRET env var.");
  }
  return new TextEncoder().encode(secret);
}

/**
 * Deliberately carries NO role (SA-1.3). A role baked into a 12h token would keep applying after
 * an admin changed it; the live role is read from tenant_users on each request instead.
 */
export type TenantSessionPayload = {
  sub: string; // user id
  tenantId: string;
  sessionVersion?: number;
  /**
   * The tenant_user_session row this cookie belongs to (LA-8.2). Every request checks that row, so
   * ending a session takes effect on its next request. Absent on cookies issued before the session
   * table existed; those still end with "sign out everywhere" (session_version) or at expiry.
   */
  sid?: string;
};

export async function signTenantSessionToken(userId: string, tenantId: string, sessionVersion = 0, sid?: string): Promise<string> {
  return new SignJWT(sid ? { tenantId, sessionVersion, sid } : { tenantId, sessionVersion })
    .setProtectedHeader({ alg: "HS256" })
    .setSubject(userId)
    .setIssuedAt()
    .setExpirationTime(`${SESSION_TTL_SECONDS}s`)
    .sign(getSecret());
}

export async function verifyTenantSessionToken(token: string): Promise<TenantSessionPayload | null> {
  try {
    const { payload } = await jwtVerify(token, getSecret());
    if (typeof payload.sub !== "string" || typeof payload.tenantId !== "string") return null;
    if (payload.sid !== undefined && typeof payload.sid !== "string") return null;
    // A token with an audience is something else signed with this secret — the 5-minute "password
    // passed, code still owed" token (LA-8.2) — and is never a session.
    if (payload.aud !== undefined) return null;
    return payload as unknown as TenantSessionPayload;
  } catch {
    return null;
  }
}

export const tenantSessionCookieOptions = {
  httpOnly: true as const,
  secure: process.env.NODE_ENV === "production",
  sameSite: "lax" as const,
  path: "/",
  // Host-only by default keeps app.insurvas.com isolated from admin.insurvas.com. Set this only
  // when the deployment explicitly uses another agent host; never share the admin cookie domain.
  domain: process.env.AGENT_COOKIE_DOMAIN || undefined,
  maxAge: SESSION_TTL_SECONDS,
};

/**
 * LA-8.2 · between the password and the authenticator code. Five minutes, its own cookie and its own
 * audience, so it can never stand in for a session (verifyTenantSessionToken refuses any audience).
 */
export const TENANT_PENDING_2FA_COOKIE = "insurvas_tenant_2fa";
const PENDING_AUDIENCE = "insurvas:tenant-2fa";
const PENDING_TTL_SECONDS = 5 * 60;

export type TenantPending2fa = { sub: string; tenantId: string; sessionVersion: number; redirectTo: string };

export async function signTenantPending2faToken(input: TenantPending2fa): Promise<string> {
  return new SignJWT({ tenantId: input.tenantId, sessionVersion: input.sessionVersion, redirectTo: input.redirectTo })
    .setProtectedHeader({ alg: "HS256" })
    .setSubject(input.sub)
    .setAudience(PENDING_AUDIENCE)
    .setIssuedAt()
    .setExpirationTime(`${PENDING_TTL_SECONDS}s`)
    .sign(getSecret());
}

export async function verifyTenantPending2faToken(token: string): Promise<TenantPending2fa | null> {
  try {
    const { payload } = await jwtVerify(token, getSecret(), { audience: PENDING_AUDIENCE });
    if (typeof payload.sub !== "string" || typeof payload.tenantId !== "string" || typeof payload.sessionVersion !== "number") return null;
    const redirectTo = typeof payload.redirectTo === "string" && payload.redirectTo.startsWith("/app/") ? payload.redirectTo : "/app/dashboard";
    return { sub: payload.sub, tenantId: payload.tenantId, sessionVersion: payload.sessionVersion, redirectTo };
  } catch {
    return null;
  }
}

export const tenantPending2faCookieOptions = { ...tenantSessionCookieOptions, maxAge: PENDING_TTL_SECONDS };
