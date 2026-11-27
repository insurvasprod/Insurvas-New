import { SignJWT, jwtVerify } from "jose";

// A partner portal session is a third identity plane. It must never be accepted as an agent or
// admin session, even when the same browser visits both applications.
export const PARTNER_SESSION_COOKIE = "insurvas_partner_session";

const SESSION_TTL_SECONDS = 60 * 60 * 12;

function getSecret(): Uint8Array {
  // Keep local development convenient without reusing the tenant signing key. The namespace
  // prefix makes a partner token cryptographically distinct even when only TENANT_SESSION_SECRET
  // exists; production should still set PARTNER_SESSION_SECRET explicitly.
  const secret = process.env.PARTNER_SESSION_SECRET || (process.env.TENANT_SESSION_SECRET ? `insurvas-partner:${process.env.TENANT_SESSION_SECRET}` : "");
  if (!secret) throw new Error("Missing PARTNER_SESSION_SECRET or TENANT_SESSION_SECRET env var.");
  return new TextEncoder().encode(secret);
}

/**
 * `remember` records the person's "Keep me signed in on this device" choice at sign-in, so a token
 * re-issued later (sign out other sessions) keeps the cookie they chose. Tokens issued before the
 * claim existed carry no `remember`; they are treated as a browser session, the narrower choice.
 */
export type PartnerSessionPayload = {
  sub: string;
  tenantId: string;
  partnerId: string;
  sessionVersion?: number;
  remember?: boolean;
  /**
   * "app" on a token issued to the iOS / Android app (2026-11-25). The app sends it as a Bearer header,
   * never a cookie; requirePartner accepts a header token only with this mark and a cookie token only
   * without it, so neither can stand in for the other.
   */
  cli?: typeof PARTNER_APP_CLIENT;
  exp?: number;
};

/** The `cli` mark on a partner session issued to the phone app (the same word the tenant plane uses). */
export const PARTNER_APP_CLIENT = "app" as const;

export type PartnerSessionTokenOptions = {
  /** The "Keep me signed in" choice this session was started with. */
  remember?: boolean;
  /** Epoch seconds. A re-issued token keeps its session's original expiry rather than restarting it. */
  expiresAt?: number;
  /** Issue the token for the phone app (sent as a Bearer header, never a cookie). */
  client?: typeof PARTNER_APP_CLIENT;
};

export async function signPartnerSessionToken(userId: string, tenantId: string, partnerId: string, sessionVersion = 0, options: PartnerSessionTokenOptions = {}): Promise<string> {
  const claims: Record<string, unknown> = { tenantId, partnerId, sessionVersion, remember: options.remember === true };
  if (options.client === PARTNER_APP_CLIENT) claims.cli = PARTNER_APP_CLIENT;
  return new SignJWT(claims)
    .setProtectedHeader({ alg: "HS256" })
    .setSubject(userId)
    .setIssuedAt()
    .setExpirationTime(options.expiresAt ?? `${SESSION_TTL_SECONDS}s`)
    .sign(getSecret());
}

/**
 * What a token re-issued for the current session must carry: the same "Keep me signed in" choice
 * and the same expiry, so re-issuing neither turns a browser-session sign-in into a persistent
 * cookie nor lengthens the session. `maxAge` is the time the session has left, for a remembered one.
 */
export function continuedPartnerSession(current: Pick<PartnerSessionPayload, "remember" | "exp">, nowSeconds = Math.floor(Date.now() / 1000)) {
  const remember = current.remember === true;
  const expiresAt = typeof current.exp === "number" && current.exp > nowSeconds ? current.exp : nowSeconds + SESSION_TTL_SECONDS;
  return { remember, expiresAt, maxAge: Math.max(1, Math.min(SESSION_TTL_SECONDS, expiresAt - nowSeconds)) };
}

export async function verifyPartnerSessionToken(token: string): Promise<PartnerSessionPayload | null> {
  try {
    const { payload } = await jwtVerify(token, getSecret());
    if (typeof payload.sub !== "string" || typeof payload.tenantId !== "string" || typeof payload.partnerId !== "string") return null;
    // A token with an audience is something else signed with this secret (the app's refresh token
    // below) and is never a session. Before 2026-11-25 nothing else was signed with this key, so no
    // live session carries one.
    if (payload.aud !== undefined) return null;
    if (payload.cli !== undefined && payload.cli !== PARTNER_APP_CLIENT) return null;
    return payload as unknown as PartnerSessionPayload;
  } catch {
    return null;
  }
}

/**
 * Whether a verified partner session may be used, given how it arrived. A browser cookie never holds a
 * token issued to the app, and an `Authorization: Bearer` header only ever holds one: a web cookie
 * copied into a header is refused, and an app token planted in a cookie is refused too.
 */
export function partnerSessionCarriedRightly(session: Pick<PartnerSessionPayload, "cli"> | null, carrier: "cookie" | "bearer"): boolean {
  if (!session) return false;
  return carrier === "cookie" ? session.cli === undefined : session.cli === PARTNER_APP_CLIENT;
}

/**
 * The phone app's refresh token for a partner (2026-11-25), the partner plane's copy of the tenant
 * one (lib/tenantAuth/session.ts). Kept in the Keychain / Keystore behind Face ID or the fingerprint,
 * it gets a new twelve-hour session token without the password again. It is bound to:
 *   · the person, partner and agency it was issued for (a new token names the same three);
 *   · the person's session version, so signing out (which raises it, ending every partner session),
 *     "sign out other sessions" and a password change all end it on the next refresh;
 *   · a fixed 30 days from sign-in. It is never extended: after 30 days the password is asked again.
 * Its own audience means it can never stand in for a session (verifyPartnerSessionToken refuses any
 * token with an audience), and a session token can never stand in for it (jwtVerify demands the audience).
 * Signed with the partner key, so the tenant plane cannot verify it at all.
 */
const PARTNER_APP_REFRESH_AUDIENCE = "insurvas:partner-app-refresh";
export const PARTNER_APP_REFRESH_DAYS = 30;
/** Twelve hours: the app's partner session token lives exactly as long as the web's cookie. */
export const PARTNER_APP_SESSION_SECONDS = SESSION_TTL_SECONDS;

export type PartnerAppRefresh = { sub: string; tenantId: string; partnerId: string; sessionVersion: number; exp?: number };

export async function signPartnerAppRefreshToken(input: PartnerAppRefresh): Promise<string> {
  return new SignJWT({ tenantId: input.tenantId, partnerId: input.partnerId, sessionVersion: input.sessionVersion })
    .setProtectedHeader({ alg: "HS256" })
    .setSubject(input.sub)
    .setAudience(PARTNER_APP_REFRESH_AUDIENCE)
    .setIssuedAt()
    .setExpirationTime(input.exp ?? `${PARTNER_APP_REFRESH_DAYS * 24 * 60 * 60}s`)
    .sign(getSecret());
}

export async function verifyPartnerAppRefreshToken(token: string): Promise<PartnerAppRefresh | null> {
  try {
    const { payload } = await jwtVerify(token, getSecret(), { audience: PARTNER_APP_REFRESH_AUDIENCE });
    if (typeof payload.sub !== "string" || typeof payload.tenantId !== "string" || typeof payload.partnerId !== "string" || typeof payload.sessionVersion !== "number") return null;
    return { sub: payload.sub, tenantId: payload.tenantId, partnerId: payload.partnerId, sessionVersion: payload.sessionVersion, exp: payload.exp };
  } catch {
    return null;
  }
}

/**
 * The session cookie for one sign-in. "Keep me signed in on this device" keeps the 12-hour cookie
 * across a browser restart; unticked, the cookie has no max-age and ends with the browser session.
 * The token's own 12-hour expiry is the same either way, so the box never lengthens a session;
 * it only decides whether closing the browser ends it sooner.
 */
export function partnerSessionCookie(remember: boolean, maxAge?: number) {
  if (remember) return maxAge === undefined ? partnerSessionCookieOptions : { ...partnerSessionCookieOptions, maxAge };
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const { maxAge: _persistentMaxAge, ...browserSession } = partnerSessionCookieOptions;
  return browserSession;
}

export const partnerSessionCookieOptions = {
  httpOnly: true as const,
  secure: process.env.NODE_ENV === "production",
  sameSite: "lax" as const,
  path: "/",
  domain: process.env.PARTNER_COOKIE_DOMAIN || undefined,
  maxAge: SESSION_TTL_SECONDS,
};
