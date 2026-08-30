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

  // Supersede any prior invitations so an older link can't still be redeemed.
  await supabase.from("user_invitations").delete().eq("user_id", id).is("accepted_at", null);

  const { error } = await supabase.from("user_invitations").insert({
    user_id: id,
    token_hash: hashInviteToken(token),
    expires_at: expiresAt.toISOString(),
    created_by: auth.session.sub,
  });

  if (error) {
    return NextResponse.json({ error: "Could not create invitation" }, { status: 500 });
  }

  const origin = process.env.NEXT_PUBLIC_APP_URL || request.nextUrl.origin;
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
