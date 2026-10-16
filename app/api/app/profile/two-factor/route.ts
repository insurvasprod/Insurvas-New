import { NextResponse, type NextRequest } from "next/server";
import QRCode from "qrcode";
import { z } from "zod";

import { audit } from "@/lib/audit/log";
import { checkLoginAllowed, clearLoginFailures, recordLoginFailure } from "@/lib/authProtection";
import { getSupabaseServiceClient } from "@/lib/supabase/service";
import { requireTenant } from "@/lib/tenantAuth/requireTenant";
import { requiresTwoFactor } from "@/lib/tenantAuth/securityRules";
import { confirmEnrolment, disableTwoFactor, regenerateRecoveryCodes, startEnrolment, twoFactorStatus, TwoFactorError, verifySecondFactor } from "@/lib/tenantAuth/twoFactor";
import { recordSecurityEvent, sendSecurityNotice } from "@/lib/users/securityEvents";

/**
 * LA-8.2 · my two-factor authentication: an authenticator app (TOTP), never SMS. Recovery codes are
 * returned once — at enrolment, or when replaced — and never again. Turning it off, or replacing the
 * codes, needs a current code. Every role; required (for revealing sensitive fields) by the roles
 * that can reveal them.
 */
const bodySchema = z.discriminatedUnion("action", [
  z.object({ action: z.literal("start") }).strict(),
  z.object({ action: z.literal("confirm"), code: z.string().trim().regex(/^\d{6}$/, "Enter the six-digit code") }).strict(),
  z.object({ action: z.literal("disable"), code: z.string().trim().max(20) }).strict(),
  z.object({ action: z.literal("recovery_codes"), code: z.string().trim().regex(/^\d{6}$/, "Enter the six-digit code") }).strict(),
]);

// eslint-disable-next-line @typescript-eslint/no-explicit-any -- the session table is not in database.types.ts yet
const db = () => getSupabaseServiceClient() as any;

export async function GET() {
  const auth = await requireTenant();
  if (auth instanceof NextResponse) return auth;
  const status = await twoFactorStatus(auth.context.userId);
  return NextResponse.json({ ...status, required: requiresTwoFactor(auth.context.role), sessionVerified: Boolean(auth.context.twoFactorAt) }, { headers: { "Cache-Control": "no-store" } });
}

export async function POST(request: NextRequest) {
  const auth = await requireTenant();
  if (auth instanceof NextResponse) return auth;
  const parsed = bodySchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Choose what to do." }, { status: 400 });
  const { userId, tenantId } = auth.context;
  const log = (action: "user.two_factor_enabled" | "user.two_factor_disabled" | "user.recovery_codes_regenerated") =>
    audit({ actorType: "tenant", actorId: userId, action, targetType: "user", targetId: userId, metadata: { tenantId }, request });
  try {
    const input = parsed.data;
    if (input.action === "start") {
      const { data: user } = await getSupabaseServiceClient().from("users").select("email").eq("id", userId).maybeSingle<{ email: string }>();
      const { uri, secret } = await startEnrolment(userId, user?.email ?? userId);
      return NextResponse.json({ uri, secret, qr: await QRCode.toDataURL(uri, { margin: 1, width: 200 }) }, { headers: { "Cache-Control": "no-store" } });
    }
    if (input.action === "confirm") {
      const codes = await confirmEnrolment(userId, input.code);
      // This session just proved the second factor; it may reveal sensitive fields now.
      if (auth.context.sessionId) await db().from("tenant_user_session").update({ two_factor_at: new Date().toISOString() }).eq("id", auth.context.sessionId);
      await Promise.all([recordSecurityEvent({ userId, tenantId, type: "two_factor_enabled", request }), log("user.two_factor_enabled")]);
      return NextResponse.json({ ok: true, recoveryCodes: codes }, { headers: { "Cache-Control": "no-store" } });
    }
    // Turning it off and replacing the codes both need proof of the factor itself, not just a session —
    // under the same lockout as the sign-in code step, so a stolen session cannot guess its way to
    // switching two-factor off.
    const { data: me } = await getSupabaseServiceClient().from("users").select("email").eq("id", userId).maybeSingle<{ email: string }>();
    const email = me?.email ?? userId;
    const protection = await checkLoginAllowed("user", email, request, "totp");
    if (!protection.allowed) return NextResponse.json({ error: "Too many wrong codes. Wait a few minutes and try again." }, { status: 429, headers: { "Retry-After": String(protection.retryAfterSeconds) } });
    const ok = input.action === "disable"
      ? await verifySecondFactor(userId, /^\d{6}$/.test(input.code) ? { code: input.code } : { recoveryCode: input.code })
      : await verifySecondFactor(userId, { code: input.code });
    if (!ok) {
      await recordLoginFailure("user", email, request, "totp");
      return NextResponse.json({ error: "That code is not right, or has been used." }, { status: 400 });
    }
    await clearLoginFailures("user", email, request, "totp");
    if (input.action === "recovery_codes") {
      const codes = await regenerateRecoveryCodes(userId);
      await Promise.all([recordSecurityEvent({ userId, tenantId, type: "recovery_codes_regenerated", request }), log("user.recovery_codes_regenerated")]);
      return NextResponse.json({ ok: true, recoveryCodes: codes }, { headers: { "Cache-Control": "no-store" } });
    }
    await disableTwoFactor(userId);
    const { data: user } = await getSupabaseServiceClient().from("users").select("email, name").eq("id", userId).maybeSingle<{ email: string; name: string }>();
    await Promise.all([
      recordSecurityEvent({ userId, tenantId, type: "two_factor_disabled", request }),
      log("user.two_factor_disabled"),
      user ? sendSecurityNotice({ to: user.email, name: user.name, what: "Two-factor authentication was turned off", detail: requiresTwoFactor(auth.context.role) ? "Your role can reveal sensitive details, so those reveals are blocked until it is back on." : undefined, userId, tenantId }) : Promise.resolve(),
    ]);
    return NextResponse.json({ ok: true });
  } catch (error) {
    if (error instanceof TwoFactorError) return NextResponse.json({ error: error.message }, { status: error.status });
    console.error("[profile/two-factor]", error instanceof Error ? error.message : error);
    return NextResponse.json({ error: "That could not be done. Nothing changed." }, { status: 500 });
  }
}
