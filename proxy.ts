import { NextResponse, type NextRequest } from "next/server";

import { ADMIN_SESSION_COOKIE, verifyAdminSessionToken } from "@/lib/adminAuth/session";
import { adminPageRedirect, refuseAdminOnThisHost, requestHostname } from "@/lib/adminAuth/adminHost";
import { configuredHosts, CROSS_SITE_REFUSED, refuseCrossSite } from "@/lib/security/originCheck";
import { siteHostMove } from "@/lib/security/siteHosts";
import { TENANT_SESSION_COOKIE, verifyTenantSessionToken } from "@/lib/tenantAuth/session";
import { PARTNER_SESSION_COOKIE, verifyPartnerSessionToken } from "@/lib/partnerAuth/session";
import { APP_PATH_HEADER } from "@/lib/tenantAuth/teamAccess";
// --- maintenance gate (SA-4.9) ---
import { maintenanceGateResponse } from "@/lib/system/maintenanceGate";
// --- end maintenance gate ---

export async function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl;
  // The Host header, never a client-sent X-Forwarded-Host (security review 2026-11, H-2 / L-14).
  const hostname = requestHostname(request.headers.get("host"), request.nextUrl.hostname);

  // The admin plane on its own host. With ADMIN_HOST set (production: `admin.insurvas.com`), /admin
  // and /api/admin are never answered on any other host — the agent app's above all — so the staff
  // console and its cookies never sit on the customer-facing origin. A page read moves to the same page
  // on the admin host (old links and bookmarks); everything else is a 404. Unset, nothing changes
  // (local dev). Production must also set ADMIN_COOKIE_DOMAIN / AGENT_COOKIE_DOMAIN; see .env.example.
  // Until it does, the staff console shows a critical alert (lib/adminAlerts, adminHostSetupGaps).
  if (refuseAdminOnThisHost(hostname, pathname, process.env.ADMIN_HOST)) {
    const moved = adminPageRedirect(request.method, pathname, request.nextUrl.search, process.env.ADMIN_HOST);
    if (moved) return NextResponse.redirect(moved, 308);
    return new NextResponse("Not found", { status: 404 });
  }
  // Cross-site writes (LA-1 audit): a POST/PUT/PATCH/DELETE to /api/app, /api/partner or /api/admin
  // must come from this app's own origin or a configured app/admin host. Token-authenticated calls
  // (an Authorization header) are not cookie-borne and pass. Rules: lib/security/originCheck.ts.
  if (refuseCrossSite({
    method: request.method,
    pathname,
    origin: request.headers.get("origin"),
    referer: request.headers.get("referer"),
    authorization: request.headers.get("authorization"),
    requestHost: request.headers.get("x-forwarded-host") ?? request.headers.get("host"),
    allowedHosts: configuredHosts(process.env),
  })) {
    return NextResponse.json(CROSS_SITE_REFUSED, { status: 403 });
  }

  // /api/admin is matched only for the host rule above; its routes do their own auth, and the
  // maintenance gate below never applied to them (staff need in while customers are out).
  if (pathname.startsWith("/api/admin")) {
    return NextResponse.next();
  }

  // --- maintenance gate (SA-4.9) ---
  // Every /api/app and /api/partner request passes here before its route runs, so read_only refuses
  // every tenant/partner write and locked refuses everything but sign-in/out and the status read,
  // whichever guard the route itself uses. Rules: lib/system/maintenanceGateRules.ts.
  if (pathname.startsWith("/api/")) {
    const maintenance = await maintenanceGateResponse(pathname, request.method);
    if (maintenance) return maintenance;
    // No early NextResponse.next(): later /api checks (e.g. the Origin check) still run.
  }
  // --- end maintenance gate ---

  // Separate sites per plane (owner, 2026-11-18): insurvas.com / www is the landing site; app., partner. and
  // admin. each serve their own product, and `/` there opens it. With SITE_HOST and APP_HOST set (PARTNER_HOST
  // optional), a product address on the wrong host moves to its own (path and query kept), because each plane's
  // session cookie is pinned to its host and a sign-in made elsewhere would never stick.
  // Unset, every host serves everything. Rules: lib/security/siteHosts.ts.
  const move = siteHostMove(hostname, pathname, process.env);
  if (move?.kind === "to_app_host") {
    const url = request.nextUrl.clone();
    url.host = move.host;
    if (move.pathname) url.pathname = move.pathname;
    url.protocol = "https:";
    url.port = "";
    return NextResponse.redirect(url, 308);
  }

  if (pathname.startsWith("/admin/login")) {
    return NextResponse.next();
  }

  if (pathname.startsWith("/admin")) {
    const token = request.cookies.get(ADMIN_SESSION_COOKIE)?.value;
    const session = token ? await verifyAdminSessionToken(token) : null;

    if (!session) return redirectTo(request, "/admin/login");
    return NextResponse.next();
  }

  // All reached by people who aren't (or can't be) signed in: an invitee setting their first
  // password (SA-1.2), and someone confirming a new email address from their inbox (SA-1.3).
  if (
    pathname.startsWith("/app/login") ||
    pathname.startsWith("/app/signup") ||
    pathname.startsWith("/app/set-password") ||
    pathname.startsWith("/app/confirm-email")
  ) {
    return NextResponse.next();
  }

  if (pathname.startsWith("/app")) {
    const token = request.cookies.get(TENANT_SESSION_COOKIE)?.value;
    const session = token ? await verifyTenantSessionToken(token) : null;

    // A browser can legitimately hold both sessions (for example, a user who works in
    // the partner portal and also owns a tenant). Prefer the explicitly requested tenant
    // plane whenever its session is valid; otherwise the partner fallback below used to
    // hijack every /app request and made a successful LA login appear to fail.
    if (session) {
      // The page guard reads the path to honour pages the owner hid for this member (custom team access).
      const headers = new Headers(request.headers);
      headers.set(APP_PATH_HEADER, pathname);
      return NextResponse.next({ request: { headers } });
    }

    const partnerToken = request.cookies.get(PARTNER_SESSION_COOKIE)?.value;
    if (partnerToken && await verifyPartnerSessionToken(partnerToken)) return redirectTo(request, "/partner");

    return redirectTo(request, "/app/login");
  }

  if (pathname.startsWith("/partner/login") || pathname.startsWith("/partner/set-password") || pathname.startsWith("/partner/accept-invite")) {
    return NextResponse.next();
  }

  if (pathname.startsWith("/partner")) {
    const token = request.cookies.get(PARTNER_SESSION_COOKIE)?.value;
    const session = token ? await verifyPartnerSessionToken(token) : null;
    if (!session) return redirectTo(request, "/partner/login");
    return NextResponse.next();
  }

  return NextResponse.next();
}

function redirectTo(request: NextRequest, pathname: string) {
  const url = request.nextUrl.clone();
  url.pathname = pathname;
  url.search = "";
  return NextResponse.redirect(url);
}

export const config = {
  // /signup is here only for the host rule above (the sign-up form must run on the app host); every
  // other check in this file falls through for it.
  matcher: ["/", "/admin/:path*", "/app/:path*", "/partner/:path*", "/signup/:path*", "/api/app/:path*", "/api/partner/:path*", "/api/admin/:path*"],
};
