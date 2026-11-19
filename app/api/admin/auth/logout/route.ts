import { NextResponse, type NextRequest } from "next/server";

import { audit } from "@/lib/audit/log";
import { resolveAdminContext } from "@/lib/adminAuth/requireAdminRole";
import { endAdminSessions, type SessionVersionClient } from "@/lib/adminAuth/sessionVersion";
import { getSupabaseServiceClient } from "@/lib/supabase/service";
import {
  ADMIN_PENDING_2FA_COOKIE,
  ADMIN_SESSION_COOKIE,
  ADMIN_TOTP_ENROL_COOKIE,
  clearedAdminCookieOptions,
} from "@/lib/adminAuth/session";

export async function POST(request: NextRequest) {
  // Who is signing out, from a session that is still live: signed, unexpired, an active admin and
  // the current session version. A cookie that was already ended (or never valid) ends nothing
  // further and writes nothing; otherwise a copied old cookie could keep signing its owner out.
  const session = await resolveAdminContext();

  if (session) {
    // Security review 2026-11, M-2: signing out ends this admin's sessions on the server, every
    // browser at once, so a copy of the cookie stops working too. Until 20261117200000 is applied
    // this is "unavailable" and signing out only clears the cookie, as before.
    const ended = await endAdminSessions(getSupabaseServiceClient() as unknown as SessionVersionClient, session.sub);
    if (ended === "error") console.error("[admin-logout] could not end the admin's sessions on the server");

    try {
      await audit({
        actorId: session.sub,
        action: "admin.logout",
        targetType: "admin_user",
        targetId: session.sub,
        metadata: { sessions_ended: ended === "ended" },
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
  response.cookies.set(ADMIN_TOTP_ENROL_COOKIE, "", clearedAdminCookieOptions);
  return response;
}
