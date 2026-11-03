import { after, NextResponse, type NextRequest } from "next/server";
import { z } from "zod";

import { audit } from "@/lib/audit/log";
import { credentialAction } from "@/lib/adminUsers/credential";
import { sendPasswordResetEmail } from "@/lib/email/sendInvitationEmail";
import { callerIp, claim, retryAfterSeconds, type RateLimitRule } from "@/lib/rateLimit";
import { getSetting } from "@/lib/settings/queries";
import { getSupabaseServiceClient } from "@/lib/supabase/service";
import { getMaintenanceStatus } from "@/lib/system/service";
import { configuredAppOrigin } from "@/lib/urls/origin";
import { buildPasswordResetUrl, generateInviteToken, hashInviteToken, inviteExpiryFromNow } from "@/lib/users/invitations";

/**
 * "Forgot password" from the agent sign-in page: emails a one-time link to /app/set-password,
 * the same page and the same `password_reset` token an administrator's reset uses.
 *
 * Nothing in the response depends on whether the address has an account — same body, same status,
 * and the lookup and the email happen after the response is sent (`after`), so the timing does not
 * tell either. Limited per address and per caller before anything is looked up, so the limit
 * itself reveals nothing and nobody can use this to flood an inbox.
 *
 * Only an active agent account with an accepted workspace membership gets a link.
 * A partner user resets at the partner door; a pending signup verifies its email instead.
 */
const schema = z.object({ email: z.string().trim().toLowerCase().email().max(320) });
const SENT = { ok: true };
const PER_CALLER: RateLimitRule = { name: "password_reset_request_ip", max: 20, windowSeconds: 3600 };

export async function POST(request: NextRequest) {
  const maintenance = await getMaintenanceStatus();
  if (maintenance.level === "locked") {
    return NextResponse.json({ error: maintenance.message ?? "The platform is temporarily locked for maintenance.", code: "maintenance_locked" }, { status: 503 });
  }

  const parsed = schema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Enter the email address you sign in with." }, { status: 400 });
  const { email } = parsed.data;

  const perAddress: RateLimitRule = { name: "password_reset_request", max: await getSetting<number>("security.password_reset_per_hour"), windowSeconds: 3600 };
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
      console.error("Could not issue a self-serve password reset", error instanceof Error ? error.message : error);
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
  if (!user || user.status !== "active") return;

  // Onboarding, not the legacy hash, decides (lib/adminUsers/credential.ts): most accounts were
  // created through Supabase Auth and have no `password_hash`, and the set-password page writes
  // the Auth credential as well. An accepted membership is the proof they are past the invite.
  const { count } = await supabase.from("tenant_users").select("user_id", { count: "exact", head: true }).eq("user_id", user.id).not("accepted_at", "is", null);
  if (credentialAction({ status: user.status, hasPassword: Boolean(user.password_hash), acceptedMembership: (count ?? 0) > 0 }) !== "reset") return;

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
    resetUrl: buildPasswordResetUrl(token, configuredAppOrigin("agent")),
    expiresAt,
    userId: user.id,
  });
  await audit({ actorType: "tenant", actorId: user.id, action: "user.password_reset_requested", targetType: "user", targetId: user.id, metadata: { delivered }, request });
}
