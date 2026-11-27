import { type NextRequest } from "next/server";

import { POST as webLogin } from "../../login/route";
import { appResponseFrom, requestWithCookies } from "@/lib/tenantAuth/appSession";
import { TENANT_TRUSTED_DEVICE_COOKIE } from "@/lib/tenantAuth/session";

/**
 * The phone app's sign-in, first factor (2026-11-24). Same body as the web's (email + password, or an
 * emailed link) and the web route decides everything. The app may send the trusted-device token it was
 * given at an earlier code step in `X-Insurvas-Trusted`; it is checked exactly as the browser's cookie.
 *
 * Answers: { ok, access, refresh, expiresAt, landing } signed in · { ok, twoFactor, pending } the code
 * is owed (POST it with `pending` to /api/app/auth/mobile/verify-2fa) · the web's error otherwise.
 */
export async function POST(request: NextRequest) {
  const body = await request.text();
  const trusted = request.headers.get("x-insurvas-trusted");
  return appResponseFrom(await webLogin(requestWithCookies(request, { [TENANT_TRUSTED_DEVICE_COOKIE]: trusted }, body)));
}
