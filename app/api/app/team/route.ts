import { NextResponse, type NextRequest } from "next/server";

import { requireTenant } from "@/lib/tenantAuth/requireTenant";
import { getEntitlement } from "@/lib/entitlements/get";
import { getTeamSnapshot } from "@/lib/tenantTeam/service";
import { inviteTeamMemberSchema } from "@/lib/tenantTeam/schemas";
import { getSupabaseServiceClient } from "@/lib/supabase/service";
import { audit } from "@/lib/audit/log";
import { buildInviteUrl, generateInviteToken, hashInviteToken, inviteExpiryFromNow } from "@/lib/users/invitations";
import { sendInvitationEmail } from "@/lib/email/sendInvitationEmail";

export async function GET() {
  const auth = await requireTenant(["owner"]);
  if (auth instanceof NextResponse) return auth;

  try {
    const entitlement = await getEntitlement(auth.context.tenantId);
    return NextResponse.json(await getTeamSnapshot(auth.context.tenantId, entitlement));
  } catch {
    return NextResponse.json({ error: "Could not load your team" }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  const auth = await requireTenant(["owner"]);
  if (auth instanceof NextResponse) return auth;

  const parsed = inviteTeamMemberSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Enter valid teammate details" }, { status: 400 });
  }

  const { name, email, role } = parsed.data;
  const token = generateInviteToken();
  const expiresAt = await inviteExpiryFromNow();
  const supabase = getSupabaseServiceClient();
  const { data, error } = await supabase.rpc("tenant_invite_user", {
    p_name: name,
    p_email: email,
    p_role: role,
    p_tenant_id: auth.context.tenantId,
    p_token_hash: hashInviteToken(token),
    p_expires_at: expiresAt.toISOString(),
    p_created_by: auth.context.userId,
  });

  if (error) {
    if (error.code === "23505") return NextResponse.json({ error: "This email is already registered" }, { status: 409 });
    return NextResponse.json({ error: "Could not invite this teammate" }, { status: 500 });
  }

  const result = Array.isArray(data) ? data[0] : data;
  const origin = process.env.NEXT_PUBLIC_AGENT_APP_URL || process.env.NEXT_PUBLIC_APP_URL || request.nextUrl.origin;
  const inviteUrl = buildInviteUrl(token, origin);
  const { delivered } = await sendInvitationEmail({ to: email, name, inviteUrl, expiresAt, userId: result.user_id, tenantId: result.tenant_id });

  await audit({
    actorType: "tenant",
    actorId: auth.context.userId,
    action: "tenant.member_invited",
    targetType: "user",
    targetId: result.user_id,
    metadata: { email, role, tenantId: result.tenant_id, delivered },
    request,
  });

  return NextResponse.json({ ok: true, member: { id: result.user_id, name, email, role }, invite: { url: inviteUrl, expiresAt: expiresAt.toISOString(), delivered } }, { status: 201 });
}
