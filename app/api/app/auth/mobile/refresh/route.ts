import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";

import { getSupabaseServiceClient } from "@/lib/supabase/service";
import { APP_CLIENT, APP_SESSION_SECONDS, signTenantSessionToken, verifyTenantAppRefreshToken } from "@/lib/tenantAuth/session";
import { checkTenantSession } from "@/lib/tenantAuth/sessionStore";

/**
 * The phone app's new session token, for the same session (2026-11-24). Called when the twelve-hour
 * token runs out, after the app has unlocked its Keychain / Keystore with Face ID or the fingerprint.
 *
 * Refused — and the app goes back to the password — when the session row was ended (Signed-in
 * devices, sign out), the person's session version moved (sign out everywhere, password change), the
 * account is no longer active, or the 30 days since sign-in are up. Membership, suspension and the
 * partner plane are checked again by requireTenant on the very next request, as for any session.
 */
const bodySchema = z.object({ refresh: z.string().min(20).max(4000) }).strict();
const AGAIN = { error: "Sign in again.", code: "sign_in_again" };

export async function POST(request: NextRequest) {
  const parsed = bodySchema.safeParse(await request.json().catch(() => null));
  const claim = parsed.success ? await verifyTenantAppRefreshToken(parsed.data.refresh) : null;
  if (!claim) return NextResponse.json(AGAIN, { status: 401 });

  const [{ data: user, error }, live] = await Promise.all([
    getSupabaseServiceClient().from("users").select("status, session_version").eq("id", claim.sub).maybeSingle<{ status: string; session_version: number }>(),
    claim.sid ? checkTenantSession(claim.sid, claim.sub).catch(() => null) : Promise.resolve({ live: true, twoFactorAt: null }),
  ]);
  // A read that failed is not a refusal: still no new token (fail closed), but 503, so the phone keeps
  // the session and tries again instead of sending the person back to the password over a slow database.
  if (error || live === null) {
    return NextResponse.json({ error: "Your session could not be checked. Try again.", code: "session_check_unavailable" }, { status: 503, headers: { "cache-control": "no-store" } });
  }
  if (!user || user.status !== "active" || user.session_version !== claim.sessionVersion || !live.live) {
    return NextResponse.json(AGAIN, { status: 401 });
  }

  // Never past the refresh token's own end: the 30 days are a hard stop.
  const now = Math.floor(Date.now() / 1000);
  const expiresAt = Math.min(now + APP_SESSION_SECONDS, claim.exp ?? now + APP_SESSION_SECONDS);
  const access = await signTenantSessionToken(claim.sub, claim.tenantId, claim.sessionVersion, claim.sid ?? undefined, { client: APP_CLIENT, expiresAt });
  return NextResponse.json({ ok: true, access, expiresAt }, { headers: { "cache-control": "no-store" } });
}
