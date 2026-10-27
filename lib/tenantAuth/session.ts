import { SignJWT, jwtVerify } from "jose";

import { SIGN_IN_LINK_MINUTES, TRUSTED_DEVICE_DAYS } from "./signInConstants.ts";

export { SIGN_IN_LINK_MINUTES, TRUSTED_DEVICE_DAYS };

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
  /**
   * The "Keep me signed in on this device" choice made at sign-in (2026-10-24), so a cookie re-issued
   * later (switch workspace, password change, end other sessions) keeps the kind of cookie chosen.
   * Absent on older cookies, which were always persistent: they are treated as remembered.
   */
  remember?: boolean;
  exp?: number;
};

export type TenantSessionTokenOptions = {
  /** The "Keep me signed in" choice this session was started with. Default: remembered. */
  remember?: boolean;
  /** Epoch seconds. A re-issued token keeps its session's original expiry rather than restarting it. */
  expiresAt?: number;
};

export async function signTenantSessionToken(userId: string, tenantId: string, sessionVersion = 0, sid?: string, options: TenantSessionTokenOptions = {}): Promise<string> {
  const remember = options.remember !== false;
  return new SignJWT(sid ? { tenantId, sessionVersion, sid, remember } : { tenantId, sessionVersion, remember })
    .setProtectedHeader({ alg: "HS256" })
    .setSubject(userId)
    .setIssuedAt()
    .setExpirationTime(options.expiresAt ?? `${SESSION_TTL_SECONDS}s`)
    .sign(getSecret());
}

/**
 * What a cookie re-issued for the current session must carry: the same "Keep me signed in" choice
 * and the same expiry, so re-issuing neither turns a browser-session sign-in into a persistent cookie
 * nor lengthens the session. `maxAge` is the time the session has left.
 */
export function continuedTenantSession(current: Pick<TenantSessionPayload, "remember" | "exp"> | null | undefined, nowSeconds = Math.floor(Date.now() / 1000)) {
  const remember = current?.remember !== false;
  const expiresAt = typeof current?.exp === "number" && current.exp > nowSeconds ? current.exp : nowSeconds + SESSION_TTL_SECONDS;
  return { remember, expiresAt, maxAge: Math.max(1, Math.min(SESSION_TTL_SECONDS, expiresAt - nowSeconds)) };
}

/**
 * The session cookie for one sign-in. "Keep me signed in on this device" keeps the 12-hour cookie
 * across a browser restart; unticked, the cookie has no max-age and ends when the browser closes.
 * The token's own 12-hour expiry is the same either way, so the box never lengthens a session (the
 * partner door's rule, lib/partnerAuth/session.ts).
 */
export function tenantSessionCookie(remember: boolean, maxAge?: number) {
  if (remember) return maxAge === undefined ? tenantSessionCookieOptions : { ...tenantSessionCookieOptions, maxAge };
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const { maxAge: _persistentMaxAge, ...browserSession } = tenantSessionCookieOptions;
  return browserSession;
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

export type TenantPending2fa = { sub: string; tenantId: string; sessionVersion: number; redirectTo: string; remember: boolean; viaLink?: boolean };

export async function signTenantPending2faToken(input: TenantPending2fa): Promise<string> {
  return new SignJWT({ tenantId: input.tenantId, sessionVersion: input.sessionVersion, redirectTo: input.redirectTo, remember: input.remember, viaLink: input.viaLink === true })
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
    return { sub: payload.sub, tenantId: payload.tenantId, sessionVersion: payload.sessionVersion, redirectTo, remember: payload.remember !== false, viaLink: payload.viaLink === true };
  } catch {
    return null;
  }
}

export const tenantPending2faCookieOptions = { ...tenantSessionCookieOptions, maxAge: PENDING_TTL_SECONDS };

/**
 * "Trust this device for 30 days" (2026-10-24). Ticked at the code step, it leaves this cookie, and a
 * later sign-in from the same browser skips the code. It is bound to:
 *   · the person (sub),
 *   · their session version, so "sign out everywhere" and a password change end the trust too;
 *   · the moment their authenticator was set up (enabled_at), so turning two-factor off and on again,
 *     or moving to a new phone, ends every trusted device at once.
 * It lives on /api/app/auth only: the sign-in routes read it, no page ever sees it.
 */
export const TENANT_TRUSTED_DEVICE_COOKIE = "insurvas_tenant_trusted";
const TRUSTED_AUDIENCE = "insurvas:tenant-trusted-device";
const TRUSTED_TTL_SECONDS = TRUSTED_DEVICE_DAYS * 24 * 60 * 60;

export type TenantTrustedDevice = { sub: string; sessionVersion: number; enabledAt: string; verifiedAt: string };

export async function signTenantTrustedDeviceToken(input: TenantTrustedDevice): Promise<string> {
  return new SignJWT({ sessionVersion: input.sessionVersion, enabledAt: input.enabledAt, verifiedAt: input.verifiedAt })
    .setProtectedHeader({ alg: "HS256" })
    .setSubject(input.sub)
    .setAudience(TRUSTED_AUDIENCE)
    .setIssuedAt()
    .setExpirationTime(`${TRUSTED_TTL_SECONDS}s`)
    .sign(getSecret());
}

export async function verifyTenantTrustedDeviceToken(token: string): Promise<TenantTrustedDevice | null> {
  try {
    const { payload } = await jwtVerify(token, getSecret(), { audience: TRUSTED_AUDIENCE });
    if (typeof payload.sub !== "string" || typeof payload.sessionVersion !== "number" || typeof payload.enabledAt !== "string" || typeof payload.verifiedAt !== "string") return null;
    return { sub: payload.sub, sessionVersion: payload.sessionVersion, enabledAt: payload.enabledAt, verifiedAt: payload.verifiedAt };
  } catch {
    return null;
  }
}

export const tenantTrustedDeviceCookieOptions = { ...tenantSessionCookieOptions, path: "/api/app/auth", maxAge: TRUSTED_TTL_SECONDS };

/**
 * "Email me a sign-in link" (2026-10-24). A link that signs in once, within fifteen minutes. It is
 * bound to the person's session version (sign out everywhere ends it) and to their last sign-in time:
 * the first successful sign-in moves `last_login_at`, after which the link no longer matches. The
 * consume route also claims the link's id once in the rate-limit store, which closes the window
 * between two clicks landing at the same moment.
 */
const LINK_AUDIENCE = "insurvas:tenant-sign-in-link";

export type TenantSignInLink = { sub: string; email: string; sessionVersion: number; lastLoginAt: string | null; jti: string; remember: boolean };

export async function signTenantSignInLinkToken(input: TenantSignInLink): Promise<string> {
  return new SignJWT({ email: input.email, sessionVersion: input.sessionVersion, lastLoginAt: input.lastLoginAt, remember: input.remember })
    .setProtectedHeader({ alg: "HS256" })
    .setSubject(input.sub)
    .setAudience(LINK_AUDIENCE)
    .setJti(input.jti)
    .setIssuedAt()
    .setExpirationTime(`${SIGN_IN_LINK_MINUTES * 60}s`)
    .sign(getSecret());
}

export async function verifyTenantSignInLinkToken(token: string): Promise<TenantSignInLink | null> {
  try {
    const { payload } = await jwtVerify(token, getSecret(), { audience: LINK_AUDIENCE });
    if (typeof payload.sub !== "string" || typeof payload.email !== "string" || typeof payload.sessionVersion !== "number" || typeof payload.jti !== "string") return null;
    if (payload.lastLoginAt !== null && typeof payload.lastLoginAt !== "string") return null;
    return { sub: payload.sub, email: payload.email, sessionVersion: payload.sessionVersion, lastLoginAt: payload.lastLoginAt as string | null, jti: payload.jti, remember: payload.remember !== false };
  } catch {
    return null;
  }
}

/**
 * Google sign-up, between Google and "Finish your account" (2026-10-27). Google has proved the
 * address; nothing exists at Insurvas yet. This carries the Auth user Google made, the verified
 * address and the name, for twenty minutes, so the finish step can create the workspace without
 * trusting anything the browser sends about who the person is.
 */
const GOOGLE_SIGNUP_AUDIENCE = "insurvas:google-signup";
export const GOOGLE_SIGNUP_COOKIE = "insurvas_google_signup";
export const GOOGLE_SIGNUP_MINUTES = 20;

export type GoogleSignup = { sub: string; email: string; name: string; plan: string | null; cycle: string | null };

export async function signGoogleSignupToken(input: GoogleSignup): Promise<string> {
  return new SignJWT({ email: input.email, name: input.name, plan: input.plan, cycle: input.cycle })
    .setProtectedHeader({ alg: "HS256" })
    .setSubject(input.sub)
    .setAudience(GOOGLE_SIGNUP_AUDIENCE)
    .setIssuedAt()
    .setExpirationTime(`${GOOGLE_SIGNUP_MINUTES * 60}s`)
    .sign(getSecret());
}

export async function verifyGoogleSignupToken(token: string): Promise<GoogleSignup | null> {
  try {
    const { payload } = await jwtVerify(token, getSecret(), { audience: GOOGLE_SIGNUP_AUDIENCE });
    if (typeof payload.sub !== "string" || typeof payload.email !== "string" || typeof payload.name !== "string") return null;
    const text = (value: unknown) => (typeof value === "string" ? value : null);
    return { sub: payload.sub, email: payload.email, name: payload.name, plan: text(payload.plan), cycle: text(payload.cycle) };
  } catch {
    return null;
  }
}

export const googleSignupCookieOptions = {
  httpOnly: true,
  secure: process.env.NODE_ENV === "production",
  sameSite: "lax" as const,
  path: "/",
  maxAge: GOOGLE_SIGNUP_MINUTES * 60,
};
