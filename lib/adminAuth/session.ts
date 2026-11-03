import { SignJWT, jwtVerify } from "jose";
import type { AdminRole } from "./roles";

// Deliberately distinct from any tenant-facing cookie so an admin session can
// never be confused with (or ride along with) a tenant Supabase Auth session.
export const ADMIN_SESSION_COOKIE = "insurvas_admin_session";
export const ADMIN_PENDING_2FA_COOKIE = "insurvas_admin_pending_2fa";
/**
 * First-login authenticator enrolment. Holds the not-yet-confirmed TOTP secret the new admin is
 * scanning. It is written to admin_users only when a code from it verifies, so the account never
 * has a second factor that its owner has not proved they hold — and nobody else ever sees it: the
 * super_admin who created the account gets no secret and no QR code (POST /api/admin/admins).
 */
export const ADMIN_TOTP_ENROL_COOKIE = "insurvas_admin_totp_enrol";

const SESSION_TTL_SECONDS = 60 * 60 * 12; // 12h
const PENDING_2FA_TTL_SECONDS = 60 * 5; // 5m
const TOTP_ENROL_TTL_SECONDS = 60 * 5; // 5m, the same as the pending-2FA step it belongs to

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

export type AdminTotpEnrolPayload = {
  sub: string;
  stage: "totp_enrol";
  /** Base32 TOTP secret being enrolled. Same browser that is shown it as a QR code. */
  secret: string;
};

export async function signTotpEnrolToken(adminId: string, secret: string): Promise<string> {
  return new SignJWT({ stage: "totp_enrol", secret } satisfies Omit<AdminTotpEnrolPayload, "sub">)
    .setProtectedHeader({ alg: "HS256" })
    .setSubject(adminId)
    .setIssuedAt()
    .setExpirationTime(`${TOTP_ENROL_TTL_SECONDS}s`)
    .sign(getSecret());
}

export async function verifyTotpEnrolToken(token: string): Promise<AdminTotpEnrolPayload | null> {
  try {
    const { payload } = await jwtVerify(token, getSecret());
    if (payload.stage !== "totp_enrol" || typeof payload.sub !== "string") return null;
    if (typeof payload.secret !== "string" || !/^[A-Z2-7]{16,}$/.test(payload.secret)) return null;
    return payload as unknown as AdminTotpEnrolPayload;
  } catch {
    return null;
  }
}

/**
 * An admin with no stored TOTP secret has not enrolled yet. `admin_users.totp_secret` is NOT NULL
 * with default '' (20260910133000), so "not enrolled" is the empty string. Such an account must
 * enrol before its first sign-in completes; it can never pass verify-2fa against the empty secret.
 */
export function isTotpEnrolled(secret: string | null | undefined): boolean {
  return typeof secret === "string" && secret.trim().length > 0;
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

/**
 * The admin session cookie has no maxAge/expires, so it is a browser-session cookie and ends when
 * the browser closes (user decision). The 12h limit is the token's own `exp`, which
 * verifyAdminSessionToken enforces on every request whether or not the browser keeps the cookie.
 * (A browser set to restore the previous session can bring session cookies back; the 12h limit
 * holds regardless.)
 */
/**
 * ADMIN_COOKIE_DOMAIN MUST be set in production (e.g. `admin.insurvas.com`).
 *
 * Left unset, the cookie is host-only on whichever host served /admin/login. That is safe only while
 * the admin plane has a host of its own. If the agent app and the admin plane share a parent domain
 * and AGENT_COOKIE_DOMAIN is set to that parent (`.insurvas.com`), the two planes' cookies must not
 * overlap: pin this one to the admin host, never to the shared parent. See also ADMIN_HOST in
 * proxy.ts, which keeps /admin off the agent host altogether, and .env.example.
 */
export const sessionCookieOptions = {
  httpOnly: true as const,
  secure: process.env.NODE_ENV === "production",
  sameSite: "lax" as const,
  path: "/",
  domain: process.env.ADMIN_COOKIE_DOMAIN || undefined,
};

export const pending2faCookieOptions = {
  ...sessionCookieOptions,
  maxAge: PENDING_2FA_TTL_SECONDS,
};

export const totpEnrolCookieOptions = {
  ...sessionCookieOptions,
  maxAge: TOTP_ENROL_TTL_SECONDS,
};

/** Options that remove either admin cookie. Carries the same domain/path, or a domain cookie survives. */
export const clearedAdminCookieOptions = {
  ...sessionCookieOptions,
  maxAge: 0,
};
