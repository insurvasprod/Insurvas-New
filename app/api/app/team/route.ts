import { NextResponse, type NextRequest } from "next/server";

import { requireTenant } from "@/lib/tenantAuth/requireTenant";
import { getEntitlement } from "@/lib/entitlements/get";
import { getTeamSnapshot } from "@/lib/tenantTeam/service";
import { inviteTeamMemberSchema } from "@/lib/tenantTeam/schemas";
import { getSupabaseServiceClient } from "@/lib/supabase/service";
import { audit } from "@/lib/audit/log";
import { buildInviteUrl, generateInviteToken, hashInviteToken, inviteExpiryFromNow } from "@/lib/users/invitations";
import { sendInvitationEmail } from "@/lib/email/sendInvitationEmail";
import { configuredAppOrigin } from "@/lib/urls/origin";
import { assertOutboundLimit, outboundLimitResponse, outboundLimitSnapshot } from "@/lib/metering/outbound";

export async function GET() {
  const auth = await requireTenant(["owner"]);
  if (auth instanceof NextResponse) return auth;

  try {
    const entitlement = await getEntitlement(auth.context.tenantId);
    return NextResponse.json({ ...(await getTeamSnapshot(auth.context.tenantId, entitlement)), outboundLimits: await outboundLimitSnapshot(auth.context.tenantId) });
  } catch (error) {
    console.error("[team] failed to load team snapshot", error instanceof Error ? error.message : error);
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
  const origin = configuredAppOrigin("agent");
  const supabase = getSupabaseServiceClient();
  const entitlement = await getEntitlement(auth.context.tenantId);
  if (role === "setter") {
    try { await assertOutboundLimit(auth.context.tenantId, "max_setter_seats"); }
    catch (error) { const limit = outboundLimitResponse(error); if (limit) return NextResponse.json(limit, { status: 403 }); return NextResponse.json({ error: "Could not check setter-seat availability" }, { status: 500 }); }
  }
  const { data: existingUser, error: existingUserError } = await supabase
    .from("users")
    .select("id")
    .ilike("email", email)
    .maybeSingle<{ id: string }>();
  if (existingUserError) return NextResponse.json({ error: "Could not invite this teammate" }, { status: 500 });
  if (existingUser) return NextResponse.json({ error: "This email is already registered" }, { status: 409 });

  // The public profile is correctly FK-linked to auth.users. Create the Auth identity first;
  // the database trigger creates its profile, and the invitation RPC attaches that identity to
  // this tenant atomically. The random password is unusable until the invitation is redeemed.
  const { data: authUser, error: authUserError } = await supabase.auth.admin.createUser({
    email,
    password: `Invite-${crypto.randomUUID()}-Only!`,
    email_confirm: false,
    user_metadata: { name, full_name: name, display_name: name },
  });
  if (authUserError || !authUser.user) {
    if (authUserError?.code === "email_exists") return NextResponse.json({ error: "This email is already registered" }, { status: 409 });
    return NextResponse.json({ error: "Could not invite this teammate" }, { status: 500 });
  }

  const { data, error } = await supabase.rpc("tenant_invite_user_with_auth", {
    p_auth_user_id: authUser.user.id,
    p_name: name,
    p_email: email,
    p_role: role,
    p_tenant_id: auth.context.tenantId,
    p_token_hash: hashInviteToken(token),
    p_expires_at: expiresAt.toISOString(),
    p_created_by: auth.context.userId,
    p_max_buffer_seats: entitlement.limits.max_buffer_seats,
  });

  if (error) {
    await supabase.auth.admin.deleteUser(authUser.user.id);
    // LA-2.12: the invite path now refuses past max_seats as well as max_buffer_seats. Both arrive
    // as the same shape of message, and both have to reach the user as an upgrade prompt rather
    // than as "Could not invite this teammate".
    const seats = error.message?.match(/seat_limit_reached:(\d+):(\d+)/);
    if (seats) return NextResponse.json({ error: `Your plan has reached max_seats (${seats[1]} of ${seats[2]}). Upgrade to add another teammate.`, code: "limit_reached", limitKey: "max_seats", usage: Number(seats[1]), limit: Number(seats[2]), upgrade: true }, { status: 403 });
    const limit = error.message?.match(/max_buffer_seats:(\d+):(\d+)/);
    if (limit) return NextResponse.json({ error: `Your plan has reached max_buffer_seats (${limit[1]} of ${limit[2]}). Upgrade to invite another buffer agent.`, code: "limit_reached", limitKey: "max_buffer_seats", usage: Number(limit[1]), limit: Number(limit[2]), upgrade: true }, { status: 403 });
    const setters = error.message?.match(/max_setter_seats:(\d+):(\d+)/);
    if (setters) return NextResponse.json({ error: `Your plan has reached setter seats (${setters[1]} of ${setters[2]}). Upgrade to invite another setter.`, code: "limit_reached", limitKey: "max_setter_seats", usage: Number(setters[1]), limit: Number(setters[2]), upgrade: true }, { status: 403 });
    if (error.code === "23505" || error.message?.includes("email_exists")) return NextResponse.json({ error: "This email is already registered" }, { status: 409 });
    return NextResponse.json({ error: "Could not invite this teammate" }, { status: 500 });
  }

  const result = Array.isArray(data) ? data[0] : data;
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
