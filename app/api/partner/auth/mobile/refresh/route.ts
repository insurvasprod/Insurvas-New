import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";

import { getSupabaseServiceClient } from "@/lib/supabase/service";
import { PARTNER_APP_CLIENT, PARTNER_APP_SESSION_SECONDS, signPartnerSessionToken, verifyPartnerAppRefreshToken } from "@/lib/partnerAuth/session";

/**
 * The phone app's new partner session token, for the same sign-in (2026-11-25). Called when the
 * twelve-hour token runs out, after the app has unlocked its Keychain / Keystore with Face ID or the
 * fingerprint. The partner plane's copy of /api/app/auth/mobile/refresh.
 *
 * Refused — and the app goes back to the password — when the person's session version moved (signing
 * out on any device raises it and so ends every partner session; so do "sign out other sessions" and a
 * password change), the account is no longer active, or the 30 days since sign-in are up. Membership,
 * partner status, agency suspension, the partner feature and the agency-account rule are checked again
 * by requirePartner on the very next request, as for any partner session.
 *
 * Only a refresh token is accepted (its own audience, the partner key); a session token, a web cookie
 * or anything from the tenant plane fails verification.
 */
const bodySchema = z.object({ refresh: z.string().min(20).max(4000) }).strict();
const AGAIN = { error: "Sign in again.", code: "sign_in_again" };

export async function POST(request: NextRequest) {
  const parsed = bodySchema.safeParse(await request.json().catch(() => null));
  const claim = parsed.success ? await verifyPartnerAppRefreshToken(parsed.data.refresh) : null;
  if (!claim) return NextResponse.json(AGAIN, { status: 401, headers: { "cache-control": "no-store" } });

  const { data: user, error } = await getSupabaseServiceClient().from("users").select("status, session_version").eq("id", claim.sub).maybeSingle<{ status: string; session_version: number }>();
  // A read that failed is not a refusal: still no new token (fail closed), but 503, so the phone keeps
  // the sign-in and tries again instead of sending the person back to the password over a slow database.
  if (error) {
    return NextResponse.json({ error: "Your session could not be checked. Try again.", code: "session_check_unavailable" }, { status: 503, headers: { "cache-control": "no-store" } });
  }
  if (!user || user.status !== "active" || user.session_version !== claim.sessionVersion) {
    return NextResponse.json(AGAIN, { status: 401, headers: { "cache-control": "no-store" } });
  }

  // Never past the refresh token's own end: the 30 days are a hard stop.
  const now = Math.floor(Date.now() / 1000);
  const expiresAt = Math.min(now + PARTNER_APP_SESSION_SECONDS, claim.exp ?? now + PARTNER_APP_SESSION_SECONDS);
  const access = await signPartnerSessionToken(claim.sub, claim.tenantId, claim.partnerId, claim.sessionVersion, { client: PARTNER_APP_CLIENT, expiresAt, remember: true });
  return NextResponse.json({ ok: true, access, expiresAt }, { headers: { "cache-control": "no-store" } });
}
