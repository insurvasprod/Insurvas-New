import { after, NextResponse, type NextRequest } from "next/server";
import { z } from "zod";

import { audit } from "@/lib/audit/log";
import { sendPasswordResetEmail } from "@/lib/email/sendInvitationEmail";
import { callerIp, claim, retryAfterSeconds, type RateLimitRule } from "@/lib/rateLimit";
import { getSetting } from "@/lib/settings/queries";
import { getSupabaseServiceClient } from "@/lib/supabase/service";
import { getMaintenanceStatus } from "@/lib/system/service";
import { configuredAppOrigin } from "@/lib/urls/origin";
import { buildPartnerPasswordResetUrl, generateInviteToken, hashInviteToken, inviteExpiryFromNow } from "@/lib/users/invitations";

/**
 * "Forgot password" at the partner door (sign-in redesign, 2026-10-24). Until now it was a mailto
 * to support. Built exactly like the agent door's (app/api/app/auth/forgot-password): the same
 * answer for every address, the lookup and the email after the response (`after`), limited per
 * address and per caller before anything is looked up.
 *
 * Only an active account with a password and an active membership of a partner that is not
 * offboarded gets a link; the link lands on /partner/set-password, where
 * consume_partner_password_reset (20261024110000) checks all of it again inside one transaction.
 */
const schema = z.object({ email: z.string().trim().toLowerCase().email().max(320) });
const SENT = { ok: true };
const PER_CALLER: RateLimitRule = { name: "partner_password_reset_request_ip", max: 20, windowSeconds: 3600 };

export async function POST(request: NextRequest) {
  const maintenance = await getMaintenanceStatus();
  if (maintenance.level === "locked") {
    return NextResponse.json({ error: maintenance.message ?? "The platform is temporarily locked for maintenance.", code: "maintenance_locked" }, { status: 503 });
  }

  const parsed = schema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Enter the email address you sign in with." }, { status: 400 });
  const { email } = parsed.data;

  const perAddress: RateLimitRule = { name: "partner_password_reset_request", max: await getSetting<number>("security.password_reset_per_hour"), windowSeconds: 3600 };
  for (const [rule, subject] of [[PER_CALLER, callerIp(request.headers)], [perAddress, email]] as const) {
    const limited = await claim(rule, subject);
    if (!limited.allowed) {
      return NextResponse.json({ error: "Too many reset requests. Try again later." }, { status: 429, headers: { "retry-after": String(retryAfterSeconds(limited.rule)) } });
    }
  }

  after(async () => {
    try {
      await issueReset(email, request);
    } catch (error) {
      console.error("Could not issue a partner password reset", error instanceof Error ? error.message : error);
    }
  });
  return NextResponse.json(SENT);
}

async function issueReset(email: string, request: NextRequest) {
  const supabase = getSupabaseServiceClient();
  const { data: user } = await supabase
    .from("users")
    .select("id, name, email, status, password_hash")
    .eq("email", email)
    .maybeSingle<{ id: string; name: string; email: string; status: string; password_hash: string | null }>();
  if (!user || user.status !== "active" || !user.password_hash) return;

  const { data: memberships } = await supabase
    .from("partner_users")
    .select("partner_id, partners!inner(status)")
    .eq("user_id", user.id)
    .eq("status", "active")
    .neq("partners.status", "offboarded")
    .limit(1);
  if (!memberships?.length) return;

  const token = generateInviteToken();
  const expiresAt = await inviteExpiryFromNow();
  const { data: replacement, error } = await supabase.rpc("admin_replace_user_token", {
    p_user_id: user.id,
    p_purpose: "password_reset",
    p_token_hash: hashInviteToken(token),
    p_expires_at: expiresAt.toISOString(),
    // No administrator issued this one; the function's default is null. Cast: the generated
    // types declare the defaulted parameter as required.
    p_created_by: null as unknown as string,
  });
  if (error || !replacement) throw new Error(error?.message ?? "No reset token was created");

  const { delivered } = await sendPasswordResetEmail({
    to: user.email,
    name: user.name,
    resetUrl: buildPartnerPasswordResetUrl(token, configuredAppOrigin("partner")),
    expiresAt,
    userId: user.id,
  });
  await audit({ actorType: "tenant", actorId: user.id, action: "user.password_reset_requested", targetType: "user", targetId: user.id, metadata: { delivered, actorPlane: "partner" }, request });
}
