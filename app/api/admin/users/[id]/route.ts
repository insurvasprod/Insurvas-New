import { NextResponse, type NextRequest } from "next/server";

import { requireAdminRole } from "@/lib/adminAuth/requireAdminRole";
import { getSupabaseServiceClient } from "@/lib/supabase/service";
import { audit } from "@/lib/audit/log";
import { updateUserSchema } from "@/lib/users/schemas";
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
