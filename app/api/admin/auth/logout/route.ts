import { NextResponse, type NextRequest } from "next/server";

import { audit } from "@/lib/audit/log";
import { getAdminSession } from "@/lib/adminAuth/requireAdminRole";
import { ADMIN_SESSION_COOKIE, ADMIN_PENDING_2FA_COOKIE, clearedAdminCookieOptions } from "@/lib/adminAuth/session";

export async function POST(request: NextRequest) {
  // Who is signing out, from the verified cookie. No session (already expired, or never signed
  // in) means there is nobody to attribute the sign-out to, and nothing is written.
  const session = await getAdminSession();

  if (session) {
    try {
      await audit({
        actorId: session.sub,
        action: "admin.logout",
        targetType: "admin_user",
        targetId: session.sub,
        request,
      });
    } catch (error) {
      // The one admin write that does not fail when its audit row cannot be written: refusing to
      // sign someone out would leave a live session on the machine, which is worse than a missing
      // row. audit() has already logged the failure.
      console.error("[admin-logout] signed out without an admin.logout audit row", error);
    }
  }

  const response = NextResponse.json({ ok: true });
  // set(..., maxAge 0) with the cookies' own domain and path: delete(name) sends no domain, and
  // would leave an ADMIN_COOKIE_DOMAIN cookie in place.
  response.cookies.set(ADMIN_SESSION_COOKIE, "", clearedAdminCookieOptions);
  response.cookies.set(ADMIN_PENDING_2FA_COOKIE, "", clearedAdminCookieOptions);
  return response;
}
