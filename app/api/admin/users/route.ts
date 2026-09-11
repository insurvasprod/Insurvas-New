import { NextResponse, type NextRequest } from "next/server";

import { requireAdminRole } from "@/lib/adminAuth/requireAdminRole";
import { CAN_VIEW_USERS } from "@/lib/users/permissions";
import { parseUsersQuery } from "@/lib/users/query";
import { fetchUsersPage } from "@/lib/users/list";
import { USERS_PAGE_SIZE } from "@/lib/users/constants";
import { createUserSchema } from "@/lib/users/schemas";
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

export async function GET(request: NextRequest) {
  const auth = await requireAdminRole(CAN_VIEW_USERS);
  if (auth instanceof NextResponse) return auth;

  const query = parseUsersQuery(request.nextUrl.searchParams);

  try {
    const { users, total } = await fetchUsersPage(query);
    return NextResponse.json({ users, total, page: query.page, pageSize: USERS_PAGE_SIZE });
  } catch {
    return NextResponse.json({ error: "Could not load users" }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  // Creating accounts is a stronger action than reading the list — restricted to super_admin,
  // matching how tenant creation is gated. Support/billing can view but not provision.
  const auth = await requireAdminRole(["super_admin"]);
  if (auth instanceof NextResponse) return auth;

  const body = await request.json().catch(() => null);
  const parsed = createUserSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Invalid input" }, { status: 400 });
  }

  const { name, email, phone, tenantId, newTenantName, role } = parsed.data;
  const supabase = getSupabaseServiceClient();

  const token = generateInviteToken();
  const expiresAt = await inviteExpiryFromNow();
  const origin = configuredAppOrigin("agent");

  // The user is born in Supabase Auth, not here. `public.users.id` is foreign-keyed to
  // `auth.users` (LA-0 made Auth the credential authority for the tenant plane), so a SQL-only
  // create has nothing to point at. The `on_auth_user_created` trigger writes the `public.users`
  // row; `admin_attach_user_to_tenant` then does the tenant, role, seat check and invitation in
  // one transaction.
  //
  // No password is set: the account is reached through the invitation link below, which is the
  // whole point of an invite. `email_confirm` stays false so the address is still unverified
  // until they act on it.
  const { data: authUser, error: authError } = await supabase.auth.admin.createUser({
    email,
    email_confirm: false,
    user_metadata: { name, full_name: name },
  });

  if (authError || !authUser?.user) {
    const alreadyRegistered = /already|exists|registered|duplicate/i.test(authError?.message ?? "");
    return NextResponse.json(
      { error: alreadyRegistered ? "This email is already registered" : "Could not create user" },
      { status: alreadyRegistered ? 409 : 500 },
    );
  }

  const { data, error } = await supabase.rpc("admin_attach_user_to_tenant", {
    p_user_id: authUser.user.id,
    p_name: name,
    p_email: email,
    p_phone: phone || null,
    p_tenant_id: tenantId ?? null,
    p_new_tenant_name: newTenantName || null,
    p_role: role,
    p_token_hash: hashInviteToken(token),
    p_expires_at: expiresAt.toISOString(),
    p_created_by: auth.session.sub,
  });

  // Atomicity does not span the Auth boundary, so it is bought back by compensation: if the
  // attach failed, the half-made account is removed rather than left as an orphan that blocks the
  // address from ever being used again.
  if (error) {
    await supabase.auth.admin.deleteUser(authUser.user.id).catch(() => {
      // Nothing more to try. The attach error is the one worth reporting.
    });
  }

  if (error) {
    // 23505 = unique violation on users.email. The whole function is one transaction, so
    // nothing was created.
    if (error.code === "23505") {
      return NextResponse.json({ error: "This email is already registered" }, { status: 409 });
    }

    // SA-2.5 seat limit, raised as `seat_limit_reached:<used>:<max>`.
    const seatLimit = /seat_limit_reached:(\d+):(\d+)/.exec(error.message ?? "");
    if (seatLimit) {
      const [, used, max] = seatLimit;
      return NextResponse.json(
        {
          error: `This tenant is using all ${max} seat${max === "1" ? "" : "s"} on its plan (${used} in use). Deactivate a user or move them to a larger plan.`,
        },
        { status: 409 },
      );
    }

    return NextResponse.json({ error: "Could not create user" }, { status: 500 });
  }

  const result = Array.isArray(data) ? data[0] : data;

  const inviteUrl = buildInviteUrl(token, origin);
  const { delivered } = await sendInvitationEmail({ to: email, name, inviteUrl, expiresAt });

  await audit({
    actorId: auth.session.sub,
    action: "user.created",
    targetType: "user",
    targetId: result.user_id,
    metadata: { email, role, tenantId: result.tenant_id, createdNewTenant: Boolean(newTenantName) },
    request,
  });

  return NextResponse.json(
    {
      user: { id: result.user_id, name, email },
      tenantId: result.tenant_id,
      // Returned so the admin can pass the link on by hand while no email transport exists.
      invite: { url: inviteUrl, expiresAt: expiresAt.toISOString(), delivered },
    },
    { status: 201 },
  );
}
