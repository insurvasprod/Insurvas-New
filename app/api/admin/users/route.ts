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
  const expiresAt = inviteExpiryFromNow();

  const { data, error } = await supabase.rpc("admin_create_user", {
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

  if (error) {
    // 23505 = unique violation on users.email. The whole function is one transaction, so
    // nothing was created.
    const message =
      error.code === "23505" ? "This email is already registered" : "Could not create user";
    return NextResponse.json({ error: message }, { status: error.code === "23505" ? 409 : 500 });
  }

  const result = Array.isArray(data) ? data[0] : data;

  const origin = process.env.NEXT_PUBLIC_APP_URL || request.nextUrl.origin;
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
