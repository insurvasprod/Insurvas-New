import "server-only";

import { NextRequest, NextResponse } from "next/server";

import {
  APP_CLIENT,
  APP_SESSION_SECONDS,
  signTenantAppRefreshToken,
  signTenantSessionToken,
  TENANT_PENDING_2FA_COOKIE,
  TENANT_SESSION_COOKIE,
  TENANT_TRUSTED_DEVICE_COOKIE,
  verifyTenantSessionToken,
} from "./session";

/**
 * The phone app's door (2026-11-24). The app never gets a cookie: it calls the web's own sign-in routes
 * through /api/app/auth/mobile/*, and this turns their cookies into tokens the app keeps in the
 * Keychain / Keystore. Nothing about who may sign in is decided here — the web route decides, and this
 * only changes how the answer is carried. That keeps the app and the web from ever drifting apart.
 */

/** The web route's request, rebuilt with the cookies the app holds as tokens (and the body it sent). */
export function requestWithCookies(request: NextRequest, cookies: Record<string, string | null | undefined>, body: string): NextRequest {
  const headers = new Headers(request.headers);
  const jar = Object.entries(cookies).filter(([, v]) => typeof v === "string" && v.length > 0).map(([k, v]) => `${k}=${v}`);
  if (jar.length) headers.set("cookie", jar.join("; "));
  else headers.delete("cookie");
  headers.set("content-type", "application/json");
  return new NextRequest(request.url, { method: "POST", headers, body });
}

export type AppSessionTokens = { access: string; refresh: string; expiresAt: number };

/** An app session token and its refresh token for the session a web cookie names. */
export async function appTokensForCookie(cookieToken: string, refreshExp?: number): Promise<AppSessionTokens | null> {
  const web = await verifyTenantSessionToken(cookieToken);
  if (!web) return null;
  const expiresAt = Math.floor(Date.now() / 1000) + APP_SESSION_SECONDS;
  const sessionVersion = web.sessionVersion ?? 0;
  const [access, refresh] = await Promise.all([
    signTenantSessionToken(web.sub, web.tenantId, sessionVersion, web.sid, { client: APP_CLIENT, expiresAt: refreshExp ? Math.min(expiresAt, refreshExp) : expiresAt }),
    signTenantAppRefreshToken({ sub: web.sub, tenantId: web.tenantId, sessionVersion, sid: web.sid ?? null, exp: refreshExp }),
  ]);
  return { access, refresh, expiresAt };
}

/**
 * The web route's answer, as the app needs it: the same JSON and status, with any session, two-factor
 * or trusted-device cookie moved into the body and every cookie dropped.
 */
export async function appResponseFrom(web: NextResponse, options: { refreshExp?: number } = {}): Promise<NextResponse> {
  const body = (await web.clone().json().catch(() => ({}))) as Record<string, unknown>;
  const out: Record<string, unknown> = { ...body };
  const session = web.cookies.get(TENANT_SESSION_COOKIE)?.value;
  const pending = web.cookies.get(TENANT_PENDING_2FA_COOKIE)?.value;
  const trusted = web.cookies.get(TENANT_TRUSTED_DEVICE_COOKIE)?.value;
  if (session) {
    const tokens = await appTokensForCookie(session, options.refreshExp);
    if (!tokens) return NextResponse.json({ error: "Sign in again." }, { status: 401 });
    Object.assign(out, tokens);
    // The web's landing page is a browser address; the app opens its own Home.
    if (typeof body.redirectTo === "string") out.landing = body.redirectTo;
    delete out.redirectTo;
  }
  if (pending) out.pending = pending;
  if (trusted) out.trusted = trusted;
  const retryAfter = web.headers.get("retry-after");
  const response = NextResponse.json(out, { status: web.status });
  if (retryAfter) response.headers.set("retry-after", retryAfter);
  response.headers.set("cache-control", "no-store");
  return response;
}
