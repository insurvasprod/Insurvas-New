import "server-only";

import { NextResponse } from "next/server";

import {
  PARTNER_APP_CLIENT,
  PARTNER_APP_SESSION_SECONDS,
  PARTNER_SESSION_COOKIE,
  signPartnerAppRefreshToken,
  signPartnerSessionToken,
  verifyPartnerSessionToken,
} from "./session";

/**
 * The phone app's door for partners (2026-11-25), the partner plane's copy of lib/tenantAuth/appSession.ts.
 * The app never gets a cookie: it calls the partner portal's own sign-in route through
 * /api/partner/auth/mobile/login, and this turns the partner session cookie that route sets into tokens
 * the app keeps in the Keychain / Keystore. Who may sign in (password, rate limit, membership, an agency
 * account refused, suspension, the partner feature, maintenance) is decided by the web route alone; this
 * only changes how the answer is carried, so the app and the portal can never drift apart.
 */

export type PartnerAppTokens = { access: string; refresh: string; expiresAt: number };

/** An app session token and its 30-day refresh token for the session a partner cookie names. */
export async function partnerAppTokensForCookie(cookieToken: string): Promise<PartnerAppTokens | null> {
  const web = await verifyPartnerSessionToken(cookieToken);
  // Only a browser-shaped token is converted: the web route never issues an app token as a cookie.
  if (!web || web.cli !== undefined) return null;
  const expiresAt = Math.floor(Date.now() / 1000) + PARTNER_APP_SESSION_SECONDS;
  const sessionVersion = web.sessionVersion ?? 0;
  const [access, refresh] = await Promise.all([
    signPartnerSessionToken(web.sub, web.tenantId, web.partnerId, sessionVersion, { client: PARTNER_APP_CLIENT, expiresAt, remember: true }),
    signPartnerAppRefreshToken({ sub: web.sub, tenantId: web.tenantId, partnerId: web.partnerId, sessionVersion }),
  ]);
  return { access, refresh, expiresAt };
}

/**
 * The web route's answer, as the app needs it: the same JSON and status, with the partner session
 * cookie turned into tokens in the body and every cookie dropped (including the web route's clearing
 * of a tenant cookie, which means nothing to a phone).
 */
export async function partnerAppResponseFrom(web: NextResponse): Promise<NextResponse> {
  const body = (await web.clone().json().catch(() => ({}))) as Record<string, unknown>;
  const out: Record<string, unknown> = { ...body };
  const session = web.cookies.get(PARTNER_SESSION_COOKIE)?.value;
  if (session) {
    const tokens = await partnerAppTokensForCookie(session);
    if (!tokens) return NextResponse.json({ error: "Sign in again." }, { status: 401, headers: { "cache-control": "no-store" } });
    Object.assign(out, tokens);
  }
  // The portal's landing page is a browser address; the app opens its own partner home.
  delete out.redirectTo;
  const retryAfter = web.headers.get("retry-after");
  const response = NextResponse.json(out, { status: web.status });
  if (retryAfter) response.headers.set("retry-after", retryAfter);
  response.headers.set("cache-control", "no-store");
  return response;
}
