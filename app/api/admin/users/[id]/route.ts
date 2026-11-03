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
import { resolveEditTenant, tenantsLeftWithoutOwner, type OwnerRow } from "@/lib/users/ownerGuard";

/** A function this code expects but the database does not have yet (migration not applied). */
function isMissingFunction(error: { code?: string; message?: string } | null): boolean {
  if (!error) return false;
  return ["42883", "PGRST202"].includes(error.code ?? "") || /could not find the function/i.test(error.message ?? "");
}

export async function PATCH(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireAdminRole(["super_admin"]);
  if (auth instanceof NextResponse) return auth;

  const { id } = await params;

  const body = await request.json().catch(() => null);
  const parsed = updateUserSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Invalid input" }, { status: 400 });
  }

  const { name, phone, role, email, tenantId: requestedTenantId } = parsed.data;
  const supabase = getSupabaseServiceClient();

  const { data: existing } = await supabase
    .from("users")
    .select("id, email")
    .eq("id", id)
    .maybeSingle<{ id: string; email: string }>();

  if (!existing) {
    return NextResponse.json({ error: "User not found" }, { status: 404 });
  }

  // The role is per tenant, and a user can belong to several. The database function used to take
  // `tenant_users ... limit 1` with no order, so editing a two-workspace user changed the role in
  // whichever tenant Postgres happened to return. The edit now names its tenant (the dialog sends
  // the row's), and a request that does not, for a user with more than one, is refused.
  const { data: memberships, error: membershipError } = await supabase
    .from("tenant_users")
    .select("tenant_id")
    .eq("user_id", id);
  if (membershipError) return NextResponse.json({ error: "Could not load this user's tenants" }, { status: 500 });

  const target = resolveEditTenant((memberships ?? []).map((row) => row.tenant_id), requestedTenantId);
  if ("error" in target) {
    return target.error === "ambiguous"
      ? NextResponse.json(
          { error: "This user belongs to more than one tenant — edit them from the tenant whose role you mean to change" },
          { status: 409 },
        )
      : NextResponse.json({ error: "This user is not a member of that tenant" }, { status: 400 });
  }

  const emailChangeRequested = email !== existing.email;
  const origin = emailChangeRequested ? configuredAppOrigin("agent") : null;
  const token = generateInviteToken();
  const expiresAt = await inviteExpiryFromNow();
  const args = {
    p_user_id: id,
    p_name: name,
    p_phone: phone || null,
    p_role: role,
    p_requested_email: email,
    p_token_hash: hashInviteToken(token),
    p_expires_at: expiresAt.toISOString(),
    p_created_by: auth.session.sub,
  };
  // p_tenant_id arrives with 20261015530000; database.types.ts predates it, hence the cast.
  let { data, error } = await supabase.rpc(
    "admin_update_user_with_email_change",
    { ...args, p_tenant_id: target.tenantId } as typeof args,
  );
  if (isMissingFunction(error)) {
    // Until 20261015530000 is applied: the old function picks the user's only tenant, and the
    // check above has already proved there is at most one, so it is the same tenant.
    ({ data, error } = await supabase.rpc("admin_update_user_with_email_change", args));
  }

  if (error) {
    if (/TENANT_AMBIGUOUS|TENANT_MEMBERSHIP_NOT_FOUND/i.test(error.message ?? "")) {
      return NextResponse.json(
        { error: "This user's tenant memberships changed — reload and try again" },
        { status: 409 },
      );
    }
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
  if (!result) return NextResponse.json({ error: "Could not update user" }, { status: 500 });

  // Only record what actually changed, so the audit row reads as a diff rather than a dump.
  const changes: Record<string, { from: unknown; to: unknown }> = {};
  if (result.old_name !== result.new_name) changes.name = { from: result.old_name, to: result.new_name };
  if (result.old_phone !== result.new_phone) changes.phone = { from: result.old_phone, to: result.new_phone };
  if (result.old_role !== result.new_role) changes.role = { from: result.old_role, to: result.new_role };

  // The email is never changed outright — the new address has to be confirmed first, so a typo
  // can't lock the user out of their own account.
  let emailChange: { url: string; expiresAt: string; newEmail: string } | null = null;

  if (result.email_change_created) {
    const url = buildEmailChangeUrl(token, origin!);
    await sendEmailChangeConfirmation({ to: email, name, confirmUrl: url, expiresAt });
    changes.email = { from: existing.email, to: email };
    emailChange = { url, expiresAt: expiresAt.toISOString(), newEmail: email };
  }

  // Exactly one audit row per edit. It used to write two when the email changed alongside another
  // field (user.updated + user.email_change_requested). An edit that only requests a new address
  // keeps that specific action; anything else is user.updated, with the email request in its diff.
  if (Object.keys(changes).length > 0) {
    const onlyEmail = Object.keys(changes).length === 1 && "email" in changes;
    await audit({
      actorId: auth.session.sub,
      action: onlyEmail ? "user.email_change_requested" : "user.updated",
      targetType: "user",
      targetId: id,
      metadata: { changes, tenant_id: target.tenantId, email_change_requested: Boolean(result.email_change_created) },
      request,
    });
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
  //
  // Owners are counted as the database guard counts them (`u.status <> 'deleted'`): a soft-deleted
  // owner is not an owner. This used to count every owner row, so a tenant whose other "owner" had
  // been removed passed and was left with nobody (lib/users/ownerGuard.ts).
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
      .select("tenant_id, users!inner(status)")
      .in("tenant_id", ownedTenantIds)
      .eq("role", "owner")
      .returns<{ tenant_id: string; users: { status: string | null } | null }[]>();
    if (countError) return NextResponse.json({ error: "Could not check tenant ownership" }, { status: 500 });

    const rows: OwnerRow[] = (coOwners ?? []).map((row) => ({ tenant_id: row.tenant_id, status: row.users?.status ?? null }));
    if (tenantsLeftWithoutOwner(ownedTenantIds, rows).length > 0) {
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

  // Exactly one audit row per delete, whether or not the window could be stamped. The user IS
  // deleted once admin_set_user_status returned; a stamp failure used to return before this and
  // leave the deletion with no audit row at all.
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
      deletion_scheduled_until: stampError ? null : scheduled.toISOString(),
      ...(stampError ? { recovery_window_recorded: false } : {}),
    },
    request,
  });

  if (stampError) {
    // Failing the request would be a lie. Report the partial outcome instead of pretending either way.
    return NextResponse.json(
      {
        ok: true,
        warning: "Deleted, but the recovery window could not be recorded. Note the date manually.",
        deletionScheduledUntil: null,
      },
      { status: 200 },
    );
  }

  return NextResponse.json({ ok: true, deletionScheduledUntil: scheduled.toISOString(), softDeleteDays: days });
}
