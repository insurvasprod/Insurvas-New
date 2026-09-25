import { NextResponse, type NextRequest } from "next/server";

import { requireAdminRole } from "@/lib/adminAuth/requireAdminRole";
import { getSupabaseServiceClient } from "@/lib/supabase/service";
import { audit } from "@/lib/audit/log";
import {
  buildPasswordResetUrl,
  generateInviteToken,
  hashInviteToken,
  inviteExpiryFromNow,
} from "@/lib/users/invitations";
import { sendPasswordResetEmail } from "@/lib/email/sendInvitationEmail";
import { configuredAppOrigin } from "@/lib/urls/origin";
import { claim, retryAfterSeconds, type RateLimitRule } from "@/lib/rateLimit";
import { getSetting } from "@/lib/settings/queries";
import { resetRefusal } from "@/lib/adminUsers/credential";

export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireAdminRole(["super_admin"]);
  if (auth instanceof NextResponse) return auth;

  const { id } = await params;
  const supabase = getSupabaseServiceClient();

  const { data: user } = await supabase
    .from("users")
    .select("id, name, email, status, password_hash")
    .eq("id", id)
    .maybeSingle<{ id: string; name: string; email: string; status: string; password_hash: string | null }>();

  if (!user) {
    return NextResponse.json({ error: "User not found" }, { status: 404 });
  }
  // Eligibility is onboarding, not the legacy hash — see lib/adminUsers/credential.ts. The
  // set-password page this link opens writes the Supabase Auth credential as well as the hash.
  const accepted = await supabase
    .from("tenant_users")
    .select("user_id", { count: "exact", head: true })
    .eq("user_id", id)
    .not("accepted_at", "is", null);
  if (accepted.error) return NextResponse.json({ error: "Could not check this user's membership" }, { status: 500 });
  const refusal = resetRefusal({ status: user.status, hasPassword: Boolean(user.password_hash), acceptedMembership: (accepted.count ?? 0) > 0 });
  if (refusal) return NextResponse.json({ error: refusal }, { status: 409 });

  const resetRule: RateLimitRule = {
    name: "password_reset_email",
    max: await getSetting<number>("security.password_reset_per_hour"),
    windowSeconds: 3600,
  };
  const limited = await claim(resetRule, user.email);
  if (!limited.allowed) {
    return NextResponse.json({ error: "Too many password reset requests. Please try again later." }, {
      status: 429,
      headers: { "retry-after": String(retryAfterSeconds(limited.rule)) },
    });
  }

  const token = generateInviteToken();
  const expiresAt = await inviteExpiryFromNow();
  const origin = configuredAppOrigin("agent");

  const { data: replacement, error } = await supabase.rpc("admin_replace_user_token", {
    p_user_id: id,
    p_purpose: "password_reset",
    p_token_hash: hashInviteToken(token),
    p_expires_at: expiresAt.toISOString(),
    p_created_by: auth.session.sub,
  });

  if (error) {
    if (/PASSWORD_NOT_SET|USER_REMOVED/i.test(error.message ?? "")) {
      return NextResponse.json({ error: "This user is not eligible for a password reset" }, { status: 409 });
    }
    return NextResponse.json({ error: "Could not create reset link" }, { status: 500 });
  }

  if (!replacement) return NextResponse.json({ error: "Could not create reset link" }, { status: 500 });
  const resetUrl = buildPasswordResetUrl(token, origin);
  const { delivered } = await sendPasswordResetEmail({
    to: user.email,
    name: user.name,
    resetUrl,
    expiresAt,
  });

  await audit({
    actorId: auth.session.sub,
    action: "user.password_reset_sent",
    targetType: "user",
    targetId: id,
    metadata: { email: user.email },
    request,
  });

  return NextResponse.json({ reset: { url: resetUrl, expiresAt: expiresAt.toISOString(), delivered } });
}
