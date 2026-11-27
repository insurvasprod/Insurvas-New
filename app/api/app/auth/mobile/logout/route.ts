import { NextResponse, type NextRequest } from "next/server";

import { bearerFrom } from "@/lib/tenantAuth/appClient";
import { APP_CLIENT, verifyTenantSessionToken } from "@/lib/tenantAuth/session";
import { endTenantSessions } from "@/lib/tenantAuth/sessionStore";
import { forgetPushDevicesForSession } from "@/lib/push/devices";

/**
 * The phone app's sign out (2026-11-24): the session row ends, so the session token and the refresh
 * token are both dead even if copied, and this phone stops getting push for the session. The app then
 * wipes its Keychain / Keystore entries. Always answers ok: a phone that is signing out has nothing to
 * retry.
 */
export async function POST(request: NextRequest) {
  const token = bearerFrom(request.headers.get("authorization"));
  const session = token ? await verifyTenantSessionToken(token) : null;
  if (session?.cli === APP_CLIENT) {
    await Promise.all([
      session.sid
        ? endTenantSessions({ userId: session.sub, sessionId: session.sid, reason: "signed_out", by: session.sub }).catch((e) => console.error("[app logout] session row", e instanceof Error ? e.message : e))
        : Promise.resolve(),
      forgetPushDevicesForSession(session.sub, session.sid ?? null).catch((e) => console.error("[app logout] push devices", e instanceof Error ? e.message : e)),
    ]);
  }
  return NextResponse.json({ ok: true });
}
