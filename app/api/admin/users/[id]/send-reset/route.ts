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

export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireAdminRole(["super_admin"]);
  if (auth instanceof NextResponse) return auth;

  const { id } = await params;
  const supabase = getSupabaseServiceClient();

  const { data: user } = await supabase
    .from("users")
    .select("id, name, email, password_hash")
    .eq("id", id)
    .maybeSingle<{ id: string; name: string; email: string; password_hash: string | null }>();

  if (!user) {
    return NextResponse.json({ error: "User not found" }, { status: 404 });
  }
  if (!user.password_hash) {
    return NextResponse.json(
      { error: "This user hasn't set a password yet — resend their invitation instead" },
      { status: 409 },
    );
  }

  const token = generateInviteToken();
  const expiresAt = await inviteExpiryFromNow();

  // Only the newest reset link should work. Scoped to purpose so this can't clobber a pending
  // invite or email change.
  await supabase
    .from("user_invitations")
    .delete()
    .eq("user_id", id)
    .eq("purpose", "password_reset")
    .is("accepted_at", null);

  const { error } = await supabase.from("user_invitations").insert({
    user_id: id,
    token_hash: hashInviteToken(token),
    expires_at: expiresAt.toISOString(),
    created_by: auth.session.sub,
    purpose: "password_reset",
  });

  if (error) {
    return NextResponse.json({ error: "Could not create reset link" }, { status: 500 });
  }

  const origin = process.env.NEXT_PUBLIC_APP_URL || request.nextUrl.origin;
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
