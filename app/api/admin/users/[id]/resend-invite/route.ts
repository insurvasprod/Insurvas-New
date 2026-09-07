import { NextResponse, type NextRequest } from "next/server";

import { requireAdminRole } from "@/lib/adminAuth/requireAdminRole";
import { getSupabaseServiceClient } from "@/lib/supabase/service";
import { audit } from "@/lib/audit/log";
import {
  buildInviteUrl,
  generateInviteToken,
  hashInviteToken,
  inviteExpiryFromNow,
} from "@/lib/users/invitations";
import { sendInvitationEmail } from "@/lib/email/sendInvitationEmail";
import { configuredAppOrigin } from "@/lib/urls/origin";

export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireAdminRole(["super_admin"]);
  if (auth instanceof NextResponse) return auth;

  const { id } = await params;
  const supabase = getSupabaseServiceClient();

  const { data: user } = await supabase
    .from("users")
    .select("id, name, email, password_hash, status")
    .eq("id", id)
    .maybeSingle<{ id: string; name: string; email: string; password_hash: string | null; status: string }>();

  if (!user) {
    return NextResponse.json({ error: "User not found" }, { status: 404 });
  }
  if (user.password_hash) {
    return NextResponse.json(
      { error: "This user has already set a password — send a password reset instead" },
      { status: 409 },
    );
  }

  const token = generateInviteToken();
  const expiresAt = await inviteExpiryFromNow();
  const origin = configuredAppOrigin("agent");

  const { data: replacement, error } = await supabase.rpc("admin_replace_user_token", {
    p_user_id: id,
    p_purpose: "invite",
    p_token_hash: hashInviteToken(token),
    p_expires_at: expiresAt.toISOString(),
    p_created_by: auth.session.sub,
  });

  if (error) {
    if (/PASSWORD_ALREADY_SET|USER_REMOVED/i.test(error.message ?? "")) {
      return NextResponse.json({ error: "This user is no longer waiting for an invitation" }, { status: 409 });
    }
    return NextResponse.json({ error: "Could not create invitation" }, { status: 500 });
  }

  if (!replacement) return NextResponse.json({ error: "Could not create invitation" }, { status: 500 });
  const inviteUrl = buildInviteUrl(token, origin);
  const { delivered } = await sendInvitationEmail({ to: user.email, name: user.name, inviteUrl, expiresAt });

  await audit({
    actorId: auth.session.sub,
    action: "user.invite_resent",
    targetType: "user",
    targetId: id,
    metadata: { email: user.email },
    request,
  });

  return NextResponse.json({ invite: { url: inviteUrl, expiresAt: expiresAt.toISOString(), delivered } });
}
