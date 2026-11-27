import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";

import { POST as webSwitch } from "../../switch-workspace/route";
import { appResponseFrom, requestWithCookies } from "@/lib/tenantAuth/appSession";
import { requireTenant } from "@/lib/tenantAuth/requireTenant";
import { verifyTenantAppRefreshToken } from "@/lib/tenantAuth/session";

/**
 * Switch workspace from the phone (2026-11-24). The web route decides and ends the old session row;
 * this hands the app tokens for the new one. The new refresh token keeps the old one's end date, so
 * switching back and forth never stretches the 30 days.
 */
const bodySchema = z.object({ tenantId: z.string().uuid(), refresh: z.string().min(20).max(4000) }).strict();

export async function POST(request: NextRequest) {
  // Guarded here as well as in the web route it wraps: a signed-in app session, any role.
  const auth = await requireTenant();
  if (auth instanceof NextResponse) return auth;
  const parsed = bodySchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Choose a workspace to open." }, { status: 400 });
  const claim = await verifyTenantAppRefreshToken(parsed.data.refresh);
  if (!claim) return NextResponse.json({ error: "Sign in again.", code: "sign_in_again" }, { status: 401 });
  const web = await webSwitch(requestWithCookies(request, {}, JSON.stringify({ tenantId: parsed.data.tenantId })));
  return appResponseFrom(web, { refreshExp: claim.exp });
}
