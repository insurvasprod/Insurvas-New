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
export type PartnerSessionPayload = { sub: string; tenantId: string; partnerId: string; sessionVersion?: number; remember?: boolean; exp?: number };

export type PartnerSessionTokenOptions = {
  /** The "Keep me signed in" choice this session was started with. */
  remember?: boolean;
  /** Epoch seconds. A re-issued token keeps its session's original expiry rather than restarting it. */
  expiresAt?: number;
};

export async function signPartnerSessionToken(userId: string, tenantId: string, partnerId: string, sessionVersion = 0, options: PartnerSessionTokenOptions = {}): Promise<string> {
  return new SignJWT({ tenantId, partnerId, sessionVersion, remember: options.remember === true })
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
    return payload as unknown as PartnerSessionPayload;
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
