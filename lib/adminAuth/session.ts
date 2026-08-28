import { SignJWT, jwtVerify } from "jose";
import type { AdminRole } from "./roles";

// Deliberately distinct from any tenant-facing cookie so an admin session can
// never be confused with (or ride along with) a tenant Supabase Auth session.
export const ADMIN_SESSION_COOKIE = "insurvas_admin_session";
export const ADMIN_PENDING_2FA_COOKIE = "insurvas_admin_pending_2fa";

const SESSION_TTL_SECONDS = 60 * 60 * 12; // 12h
const PENDING_2FA_TTL_SECONDS = 60 * 5; // 5m

function getSecret(): Uint8Array {
  const secret = process.env.ADMIN_SESSION_SECRET;
  if (!secret) {
    throw new Error("Missing ADMIN_SESSION_SECRET env var.");
  }
  return new TextEncoder().encode(secret);
}

export type AdminSessionPayload = {
  sub: string;
  role: AdminRole;
  stage: "authenticated";
};

export type AdminPending2faPayload = {
  sub: string;
  stage: "pending_2fa";
};

export async function signAdminSessionToken(adminId: string, role: AdminRole): Promise<string> {
  return new SignJWT({ role, stage: "authenticated" } satisfies Omit<AdminSessionPayload, "sub">)
    .setProtectedHeader({ alg: "HS256" })
    .setSubject(adminId)
    .setIssuedAt()
    .setExpirationTime(`${SESSION_TTL_SECONDS}s`)
    .sign(getSecret());
}

export async function signPending2faToken(adminId: string): Promise<string> {
  return new SignJWT({ stage: "pending_2fa" } satisfies Omit<AdminPending2faPayload, "sub">)
    .setProtectedHeader({ alg: "HS256" })
    .setSubject(adminId)
    .setIssuedAt()
    .setExpirationTime(`${PENDING_2FA_TTL_SECONDS}s`)
    .sign(getSecret());
}

export async function verifyAdminSessionToken(token: string): Promise<AdminSessionPayload | null> {
  try {
    const { payload } = await jwtVerify(token, getSecret());
    if (payload.stage !== "authenticated" || typeof payload.sub !== "string") return null;
    return payload as unknown as AdminSessionPayload;
  } catch {
    return null;
  }
}

export async function verifyPending2faToken(token: string): Promise<AdminPending2faPayload | null> {
  try {
    const { payload } = await jwtVerify(token, getSecret());
    if (payload.stage !== "pending_2fa" || typeof payload.sub !== "string") return null;
    return payload as unknown as AdminPending2faPayload;
  } catch {
    return null;
  }
}

export const sessionCookieOptions = {
  httpOnly: true as const,
  secure: process.env.NODE_ENV === "production",
  sameSite: "lax" as const,
  path: "/",
  domain: process.env.ADMIN_COOKIE_DOMAIN || undefined,
  maxAge: SESSION_TTL_SECONDS,
};

export const pending2faCookieOptions = {
  ...sessionCookieOptions,
  maxAge: PENDING_2FA_TTL_SECONDS,
};
