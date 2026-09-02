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
};

export async function signTenantSessionToken(userId: string, tenantId: string): Promise<string> {
  return new SignJWT({ tenantId })
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
