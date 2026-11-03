import { NextResponse, type NextRequest } from "next/server";

import { TENANT_SESSION_COOKIE, verifyTenantSessionToken } from "@/lib/tenantAuth/session";
import { endTenantSessions } from "@/lib/tenantAuth/sessionStore";
import { revokeExtensionGrantsForSessionEnd } from "@/lib/extension/sessionGrants";

/** Sign out: the cookie goes, and so does its session row (LA-8.2), so the token is dead even if copied. */
export async function POST(request: NextRequest) {
  const token = request.cookies.get(TENANT_SESSION_COOKIE)?.value;
  const session = token ? await verifyTenantSessionToken(token) : null;
  if (session?.sid) {
    // Ends the session row and, with it, the browser-extension grants it opened (LA-3.12).
    await endTenantSessions({ userId: session.sub, sessionId: session.sid, reason: "signed_out", by: session.sub }).catch((error) => console.error("[logout] session row", error instanceof Error ? error.message : error));
  } else if (session?.sub) {
    // A cookie from before sessions were rows names no session: every live grant of this person ends.
    await revokeExtensionGrantsForSessionEnd({ userId: session.sub, reason: "signed_out" }).catch((error) => console.error("[logout] extension grants", error instanceof Error ? error.message : error));
  }
  const response = NextResponse.json({ ok: true });
  response.cookies.delete(TENANT_SESSION_COOKIE);
  return response;
}
