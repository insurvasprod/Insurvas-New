import { NextResponse, type NextRequest } from "next/server";

import { audit } from "@/lib/audit/log";
import { requireAdminRole } from "@/lib/adminAuth/requireAdminRole";
import { createTenantSchema } from "@/lib/tenants/schemas";
import { getSupabaseServiceClient } from "@/lib/supabase/service";
import { CAN_VIEW_TENANTS } from "@/lib/tenants/permissions";
import { generateInviteToken, hashInviteToken, inviteExpiryFromNow, buildInviteUrl } from "@/lib/users/invitations";
import { sendInvitationEmail } from "@/lib/email/sendInvitationEmail";
import { configuredAppOrigin } from "@/lib/urls/origin";

export async function GET() {
  const auth = await requireAdminRole(CAN_VIEW_TENANTS);
  if (auth instanceof NextResponse) return auth;

  const supabase = getSupabaseServiceClient();

  // Independent reads, so they run together. The owners read stays best-effort, as it was.
  const [{ data: tenants, error }, { data: owners }] = await Promise.all([
    supabase
      .from("tenants")
      .select("id, name, status, plan_code, onboarding_state, created_at, suspended_at")
      .order("created_at", { ascending: true }),
    supabase
      .from("tenant_users")
      .select("tenant_id, users(name, email)")
      .eq("role", "owner")
      .returns<{ tenant_id: string; users: { name: string; email: string } | null }[]>(),
  ]);

  if (error) {
    return NextResponse.json({ error: "Could not load tenants" }, { status: 500 });
  }

  const ownerByTenant = new Map((owners ?? []).map((row) => [row.tenant_id, row.users]));

  const withOwners = (tenants ?? []).map((tenant) => ({
    ...tenant,
    owner: ownerByTenant.get(tenant.id) ?? null,
  }));

  return NextResponse.json({ tenants: withOwners });
}

/**
 * Create a tenant and invite its owner (backlog 1 and 193).
 *
 * This used to hash a password the administrator typed and call `create_tenant_with_owner`, whose
 * body is
 *
 *   insert into users (email, password_hash, name) values (...)
 *
 * with no `id`. Since SA-1.2 gave `public.users.id` a foreign key to `auth.users` and no default,
 * that statement cannot succeed, so the RPC raised 23502 and the route answered a flat
 * `409 Could not create tenant`. An administrator could not create a tenant at all, and the
 * message gave no indication why. `verify-kill-switches` had diagnosed it exactly in a local
 * workaround comment; that knowledge reached neither the other suites nor this route.
 *
 * It now uses `admin_attach_user_to_tenant`, which is the same function POST /api/admin/users has
 * been using successfully all along and which already creates the tenant when given
 * `p_new_tenant_name`. Reusing it rather than writing a second Auth-aware provisioning RPC is the
 * point: two functions that provision an owner would eventually disagree about seats, roles or
 * invitations, and only one of them would be the one anybody tested.
 *
 * Two things change for the better as a side effect, and both are deliberate:
 *
 *   the owner is invited        no password is typed by an administrator, which is what SA-1.2's
 *                               own out-of-scope line always said should happen. The response
 *                               carries the invite link so the admin can pass it on by hand when
 *                               mail delivery fails.
 *
 *   the tenant starts active    `create_tenant_with_owner` opened it as `provisioning`, a status
 *                               nothing subsequently cleared. `admin_attach_user_to_tenant` opens
 *                               it `active` with `onboarding_state = 'pending'`, which is the
 *                               shape the rest of the platform reads.
 */
export async function POST(request: NextRequest) {
  const auth = await requireAdminRole(["super_admin"]);
  if (auth instanceof NextResponse) return auth;

  const body = await request.json().catch(() => null);
  const parsed = createTenantSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Invalid input" }, { status: 400 });
  }

  const { tenantName, ownerName, ownerEmail } = parsed.data;
  const supabase = getSupabaseServiceClient();

  const token = generateInviteToken();
  const expiresAt = await inviteExpiryFromNow();
  const origin = configuredAppOrigin("agent");

  // Born in Supabase Auth, which is the credential authority for this plane. The
  // `on_auth_user_created` bridge writes the `public.users` row; the RPC below then does the
  // tenant, the membership and the invitation in one transaction.
  const { data: authUser, error: authError } = await supabase.auth.admin.createUser({
    email: ownerEmail,
    email_confirm: false,
    user_metadata: { name: ownerName, full_name: ownerName },
  });

  if (authError || !authUser?.user) {
    const alreadyRegistered = /already|exists|registered|duplicate/i.test(authError?.message ?? "");
    return NextResponse.json(
      {
        error: alreadyRegistered
          ? "A user with this email already exists"
          : "Could not create the owner account",
      },
      { status: alreadyRegistered ? 409 : 500 },
    );
  }

  const { data, error } = await supabase.rpc("admin_attach_user_to_tenant", {
    p_user_id: authUser.user.id,
    p_name: ownerName,
    p_email: ownerEmail,
    p_phone: null,
    p_tenant_id: null,
    p_new_tenant_name: tenantName,
    p_role: "owner",
    p_token_hash: hashInviteToken(token),
    p_expires_at: expiresAt.toISOString(),
    p_created_by: auth.session.sub,
  });

  // Atomicity does not span the Auth boundary, so it is bought back by compensation: a half-made
  // account left behind would block that address from ever being used again.
  if (error) {
    await supabase.auth.admin.deleteUser(authUser.user.id).catch(() => {
      // Nothing more to try. The attach error is the one worth reporting.
    });

    if (error.code === "23505") {
      return NextResponse.json({ error: "A user with this email already exists" }, { status: 409 });
    }
    return NextResponse.json({ error: "Could not create tenant", code: "tenant_provisioning_failed" }, { status: 500 });
  }

  const result = Array.isArray(data) ? data[0] : data;
  const inviteUrl = buildInviteUrl(token, origin);
  const { delivered } = await sendInvitationEmail({
    to: ownerEmail,
    name: ownerName,
    inviteUrl,
    expiresAt,
    userId: result.user_id,
    tenantId: result.tenant_id,
  });

  await audit({
    actorId: auth.session.sub,
    action: "tenant.created",
    targetType: "tenant",
    targetId: result.tenant_id,
    metadata: { name: tenantName, ownerEmail, inviteDelivered: delivered },
    request,
  });

  return NextResponse.json(
    {
      tenant: { id: result.tenant_id, name: tenantName },
      owner: { id: result.user_id, email: ownerEmail },
      // The link is returned whether or not the mail was delivered, for the same reason
      // POST /api/admin/users returns it: a link the admin can pass on by hand is the right
      // fallback when the mail server is down, and the admin should not have to guess.
      invite: { url: inviteUrl, expiresAt: expiresAt.toISOString(), delivered },
    },
    { status: 201 },
  );
}
