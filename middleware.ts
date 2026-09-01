import { NextResponse, type NextRequest } from "next/server";

import { ADMIN_SESSION_COOKIE, verifyAdminSessionToken } from "@/lib/adminAuth/session";
import { TENANT_SESSION_COOKIE, verifyTenantSessionToken } from "@/lib/tenantAuth/session";
import { PARTNER_SESSION_COOKIE, verifyPartnerSessionToken } from "@/lib/partnerAuth/session";

export async function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;
  const hostname = (request.headers.get("x-forwarded-host") ?? request.headers.get("host") ?? request.nextUrl.hostname)
    .split(",")[0]
    .trim()
    .split(":")[0]
    .toLowerCase();

  // The customer/agent application has its own host. Keep the local /app path available for
  // development, while making https://app.insurvas.com the tenant entry point when deployed.
  if (pathname === "/" && hostname === "app.insurvas.com") {
    return redirectTo(request, "/app/login");
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

    if (!session) return redirectTo(request, "/app/login");
    return NextResponse.next();
  }

  if (pathname.startsWith("/partner/login") || pathname.startsWith("/partner/set-password")) {
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
  matcher: ["/", "/admin/:path*", "/app/:path*", "/partner/:path*"],
};
