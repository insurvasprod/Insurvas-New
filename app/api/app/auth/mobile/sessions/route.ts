import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";

import { POST as webSessions } from "../../../profile/sessions/route";
import { appResponseFrom, requestWithCookies } from "@/lib/tenantAuth/appSession";
import { requireTenant } from "@/lib/tenantAuth/requireTenant";
import { verifyTenantAppRefreshToken } from "@/lib/tenantAuth/session";

/**
 * Signed-in devices from the phone (2026-11-24). Listing is the web's GET /api/app/profile/sessions.
 * Ending ONE session is the web's POST too; "end every other session" moves the person's session
 * version, which would sign this phone out as well, so it comes through here and the phone gets tokens
 * for its re-issued session (the refresh token keeps its original end date).
 */
const bodySchema = z.union([
  z.object({ action: z.literal("end"), id: z.string().uuid(), refresh: z.string().min(20).max(4000) }).strict(),
  z.object({ action: z.literal("end_others"), refresh: z.string().min(20).max(4000) }).strict(),
]);

export async function POST(request: NextRequest) {
  // Guarded here as well as in the web route it wraps: a signed-in app session, any role (own sessions only).
  const auth = await requireTenant();
  if (auth instanceof NextResponse) return auth;
  const parsed = bodySchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Choose a session to end." }, { status: 400 });
  const claim = await verifyTenantAppRefreshToken(parsed.data.refresh);
  if (!claim) return NextResponse.json({ error: "Sign in again.", code: "sign_in_again" }, { status: 401 });
  const { refresh: _refresh, ...web } = parsed.data; // eslint-disable-line @typescript-eslint/no-unused-vars
  return appResponseFrom(await webSessions(requestWithCookies(request, {}, JSON.stringify(web))), { refreshExp: claim.exp });
}
