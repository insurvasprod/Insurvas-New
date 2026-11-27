import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";

import { POST as webVerify } from "../../verify-2fa/route";
import { appResponseFrom, requestWithCookies } from "@/lib/tenantAuth/appSession";
import { TENANT_PENDING_2FA_COOKIE } from "@/lib/tenantAuth/session";

/**
 * The phone app's code step (2026-11-24). `pending` is the five-minute token the first step returned;
 * the rest of the body is the web's ({ code | recoveryCode, trust }). With `trust`, the answer carries a
 * `trusted` token the app keeps for 30 days and sends as `X-Insurvas-Trusted` on its next sign-in.
 */
const bodySchema = z.object({ pending: z.string().min(20).max(4000) }).passthrough();

export async function POST(request: NextRequest) {
  const parsed = bodySchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "That took too long. Sign in again." }, { status: 401 });
  const { pending, ...rest } = parsed.data;
  return appResponseFrom(await webVerify(requestWithCookies(request, { [TENANT_PENDING_2FA_COOKIE]: pending }, JSON.stringify(rest))));
}
