import { NextResponse, type NextRequest } from "next/server";
import QRCode from "qrcode";

import { isAdminRole } from "@/lib/adminAuth/roles";
import { generateTotpSecret, getTotpEnrollmentUri } from "@/lib/adminAuth/totp";
import {
  ADMIN_PENDING_2FA_COOKIE,
  ADMIN_TOTP_ENROL_COOKIE,
  isTotpEnrolled,
  signTotpEnrolToken,
  totpEnrolCookieOptions,
  verifyPending2faToken,
} from "@/lib/adminAuth/session";
import { getSupabaseServiceClient } from "@/lib/supabase/service";

/**
 * POST /api/admin/auth/enroll-2fa — first-login authenticator enrolment for a staff account.
 *
 * Reachable only with the pending-2FA cookie, i.e. after the password passed, and only for an
 * account that has no second factor yet. It mints a fresh secret, shows it to the admin themself
 * (QR code + manual key) and keeps it in a short-lived signed cookie. Nothing is written to
 * admin_users here: verify-2fa stores the secret only when a code generated from it verifies, so
 * the account is never left with a factor its owner has not proved they hold.
 *
 * Calling it again replaces the cookie with a new secret (a fresh scan), which is harmless: the old
 * one was never stored.
 */
export async function POST(request: NextRequest) {
  const pendingToken = request.cookies.get(ADMIN_PENDING_2FA_COOKIE)?.value;
  const pending = pendingToken ? await verifyPending2faToken(pendingToken) : null;
  if (!pending) {
    return NextResponse.json({ error: "Session expired, please log in again" }, { status: 401 });
  }

  const { data: admin } = await getSupabaseServiceClient()
    .from("admin_users")
    .select("id, email, role, is_active, totp_secret")
    .eq("id", pending.sub)
    .maybeSingle<{ id: string; email: string; role: string; is_active: boolean; totp_secret: string | null }>();

  if (!admin || !admin.is_active || !isAdminRole(admin.role)) {
    return NextResponse.json({ error: "Session expired, please log in again" }, { status: 401 });
  }
  if (isTotpEnrolled(admin.totp_secret)) {
    // Re-enrolling an account that already has a factor would let a stolen password replace it.
    return NextResponse.json({ error: "Two-factor authentication is already set up for this account" }, { status: 409 });
  }

  const secret = generateTotpSecret();
  const totpUri = getTotpEnrollmentUri(admin.email, secret);
  const qrDataUrl = await QRCode.toDataURL(totpUri);

  const response = NextResponse.json(
    { totpUri, qrDataUrl, secret },
    { headers: { "cache-control": "no-store" } },
  );
  response.cookies.set(ADMIN_TOTP_ENROL_COOKIE, await signTotpEnrolToken(admin.id, secret), totpEnrolCookieOptions);
  return response;
}
