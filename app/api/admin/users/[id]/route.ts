import { NextResponse, type NextRequest } from "next/server";

import { requireAdminRole } from "@/lib/adminAuth/requireAdminRole";
import { getSupabaseServiceClient } from "@/lib/supabase/service";
import { audit } from "@/lib/audit/log";
import { deleteUserSchema, updateUserSchema } from "@/lib/users/schemas";
import { CAN_SET_USER_STATUS } from "@/lib/users/permissions";
import { softDeleteDays } from "@/lib/settings/queries";
import {
  buildEmailChangeUrl,
  generateInviteToken,
  hashInviteToken,
  inviteExpiryFromNow,
} from "@/lib/users/invitations";
import { sendEmailChangeConfirmation } from "@/lib/email/sendInvitationEmail";
import { configuredAppOrigin } from "@/lib/urls/origin";

export async function PATCH(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireAdminRole(["super_admin"]);
  if (auth instanceof NextResponse) return auth;

  const { id } = await params;

  const body = await request.json().catch(() => null);
  const parsed = updateUserSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Invalid input" }, { status: 400 });
  }

  const { name, phone, role, email } = parsed.data;
  const supabase = getSupabaseServiceClient();

  const { data: existing } = await supabase
    .from("users")
    .select("id, email")
    .eq("id", id)
    .maybeSingle<{ id: string; email: string }>();

  if (!existing) {
    return NextResponse.json({ error: "User not found" }, { status: 404 });
  }

  const emailChangeRequested = email !== existing.email;
  const origin = emailChangeRequested ? configuredAppOrigin("agent") : null;
  const token = generateInviteToken();
  const expiresAt = await inviteExpiryFromNow();
  const { data, error } = await supabase.rpc("admin_update_user_with_email_change", {
    p_user_id: id,
    p_name: name,
    p_phone: phone || null,
    p_role: role,
    p_requested_email: email,
    p_token_hash: hashInviteToken(token),
    p_expires_at: expiresAt.toISOString(),
    p_created_by: auth.session.sub,
  });

  if (error) {
    if (/LAST_OWNER|last_owner/i.test(error.message ?? "")) {
      return NextResponse.json(
        { error: "This is the tenant's only owner — promote someone else before changing this role" },
        { status: 409 },
      );
    }
    if (/EMAIL_ALREADY_REGISTERED|duplicate key/i.test(error.message ?? "")) {
      return NextResponse.json({ error: "This email is already registered" }, { status: 409 });
    }
    return NextResponse.json({ error: "Could not update user" }, { status: 500 });
  }

  const result = Array.isArray(data) ? data[0] : data;

  // Only record what actually changed, so the audit row reads as a diff rather than a dump.
  const changes: Record<string, { from: unknown; to: unknown }> = {};
  if (result.old_name !== result.new_name) changes.name = { from: result.old_name, to: result.new_name };
  if (result.old_phone !== result.new_phone) changes.phone = { from: result.old_phone, to: result.new_phone };
  if (result.old_role !== result.new_role) changes.role = { from: result.old_role, to: result.new_role };

  if (Object.keys(changes).length > 0) {
    await audit({
      actorId: auth.session.sub,
      action: "user.updated",
      targetType: "user",
      targetId: id,
      metadata: { changes },
      request,
    });
  }

  // The email is never changed outright — the new address has to be confirmed first, so a typo
  // can't lock the user out of their own account.
  let emailChange: { url: string; expiresAt: string; newEmail: string } | null = null;

  if (result.email_change_created) {
    const url = buildEmailChangeUrl(token, origin!);
    await sendEmailChangeConfirmation({ to: email, name, confirmUrl: url, expiresAt });

    await audit({
      actorId: auth.session.sub,
      action: "user.email_change_requested",
      targetType: "user",
      targetId: id,
      metadata: { changes: { email: { from: existing.email, to: email } } },
      request,
    });

    emailChange = { url, expiresAt: expiresAt.toISOString(), newEmail: email };
  }

  return NextResponse.json({ ok: true, emailChange });
}

/**
 * SA-1.4 · soft-delete a user.
 *
 * This route did not exist. `DELETE /api/admin/users/:id` answered **405**, which left three of
 * SA-1.4's criteria unreachable (typed confirmation, the recovery window, "deleting the last owner
 * of a tenant is blocked") and made `pending_verification` a dead end: an invited account that was
 * never accepted could not be suspended, deactivated or removed, so the only way to clear a
 * mistyped invitation was to mark it **active** — consuming one of the tenant's seats for good.
 *
 * Soft, never hard. `admin_set_user_status` moves the row to `deleted` and the `auth.users` record
 * is deliberately left in place, which is what makes the address unusable for the length of the
 * window — verified: re-creating a soft-deleted address returns "This email is already registered".
 * A hard delete here would free the address immediately and contradict the criterion.
 */
export async function DELETE(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireAdminRole(CAN_SET_USER_STATUS);
  if (auth instanceof NextResponse) return auth;

  const { id } = await params;

  const parsed = deleteUserSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Invalid input" }, { status: 400 });
  }

  const supabase = getSupabaseServiceClient();

  const { data: user, error: readError } = await supabase
    .from("users")
    .select("id, email, status")
    .eq("id", id)
    .maybeSingle<{ id: string; email: string; status: string }>();

  if (readError) return NextResponse.json({ error: "Could not load this user" }, { status: 500 });
  if (!user) return NextResponse.json({ error: "User not found" }, { status: 404 });
  if (user.status === "deleted") {
    return NextResponse.json({ error: "This user has already been removed" }, { status: 409 });
  }

  // Compare case-insensitively: the address is stored lowercased, and an admin typing it from the
  // screen should not be defeated by their own capitalisation.
  if (parsed.data.confirm.toLowerCase() !== user.email.toLowerCase()) {
    return NextResponse.json(
      { error: "That does not match this user's email address" },
      { status: 400 },
    );
  }

  // "Deleting the last owner of a tenant is blocked." Checked here rather than in SQL, so this is
  // read-then-write and two concurrent deletes of two different owners could in principle both
  // pass. Deliberate: the alternative is a new database function, and this environment cannot
  // apply DDL. Recorded in the audit doc as the one caveat on this criterion.
  const { data: ownerships, error: ownershipError } = await supabase
    .from("tenant_users")
    .select("tenant_id")
    .eq("user_id", id)
    .eq("role", "owner");

  if (ownershipError) return NextResponse.json({ error: "Could not check tenant ownership" }, { status: 500 });

  // Every owner row of every tenant this user owns, in one query, counted per tenant here. It was
  // one count query per owned tenant, serially.
  const ownedTenantIds = [...new Set((ownerships ?? []).map((row) => row.tenant_id))];
  if (ownedTenantIds.length) {
    const { data: coOwners, error: countError } = await supabase
      .from("tenant_users")
      .select("tenant_id")
      .in("tenant_id", ownedTenantIds)
      .eq("role", "owner");
    if (countError) return NextResponse.json({ error: "Could not check tenant ownership" }, { status: 500 });

    const ownersByTenant = new Map<string, number>();
    for (const { tenant_id } of coOwners ?? []) {
      ownersByTenant.set(tenant_id, (ownersByTenant.get(tenant_id) ?? 0) + 1);
    }
    if (ownedTenantIds.some((tenantId) => (ownersByTenant.get(tenantId) ?? 0) <= 1)) {
      return NextResponse.json(
        { error: "This is the tenant's only owner — promote someone else before deleting them" },
        { status: 409 },
      );
    }
  }

  const { data, error } = await supabase.rpc("admin_set_user_status", {
    p_user_id: id,
    p_status: "deleted",
    p_reason: parsed.data.reason || null,
  });

  if (error || !data) {
    if (/USER_TRANSITION_NOT_ALLOWED/i.test(error?.message ?? "")) {
      return NextResponse.json({ error: "This user cannot be deleted from their current state" }, { status: 409 });
    }
    return NextResponse.json({ error: "Could not delete this user" }, { status: 500 });
  }

  // `admin_set_user_status` sets the status but leaves both timestamps null, so nothing recorded
  // when the window opened or when it closes — and a recovery window nobody can measure is not a
  // window. Written here from the same setting the screen displays.
  const days = await softDeleteDays();
  const now = new Date();
  const scheduled = new Date(now.getTime() + days * 24 * 60 * 60 * 1000);
  const { error: stampError } = await supabase
    .from("users")
    .update({ deleted_at: now.toISOString(), deletion_scheduled_until: scheduled.toISOString() })
    .eq("id", id);
  if (stampError) {
    // The user IS deleted at this point; failing the request would be a lie. Report the partial
    // outcome instead of pretending either way.
    return NextResponse.json(
      {
        ok: true,
        warning: "Deleted, but the recovery window could not be recorded. Note the date manually.",
        deletionScheduledUntil: null,
      },
      { status: 200 },
    );
  }

  await audit({
    actorId: auth.session.sub,
    action: "user.deleted",
    targetType: "user",
    targetId: id,
    reason: parsed.data.reason || undefined,
    metadata: {
      email: user.email,
      status: { from: user.status, to: "deleted" },
      soft_delete_days: days,
      deletion_scheduled_until: scheduled.toISOString(),
    },
    request,
  });

  return NextResponse.json({ ok: true, deletionScheduledUntil: scheduled.toISOString(), softDeleteDays: days });
}
