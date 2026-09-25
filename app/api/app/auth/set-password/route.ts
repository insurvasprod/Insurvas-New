import { NextResponse, type NextRequest } from "next/server";

import { getMaintenanceStatus } from "@/lib/system/service";
import { getSupabaseServiceClient } from "@/lib/supabase/service";
import { hashInviteToken } from "@/lib/users/invitations";
import { setPasswordSchema } from "@/lib/users/schemas";
import { hashPassword } from "@/lib/password";
import { TENANT_ROLE_LABELS, type TenantRole } from "@/lib/tenantAuth/roles";

type InvitationRow = {
  id: string;
  user_id: string;
  expires_at: string;
  accepted_at: string | null;
  partner_id: string | null;
  purpose: "invite" | "password_reset";
};

const INVALID = { error: "This invitation link is invalid or has expired" };

async function findValidInvitation(token: string) {
  const supabase = getSupabaseServiceClient();
  const { data: invitation } = await supabase
    .from("user_invitations")
    .select("id, user_id, expires_at, accepted_at, partner_id, purpose")
    .eq("token_hash", hashInviteToken(token))
    // Both purposes end in "choose a password". An email_change token must NOT be redeemable
    // here — it proves control of a mailbox, not the right to set credentials.
    .in("purpose", ["invite", "password_reset"])
    .is("partner_id", null)
    .maybeSingle<InvitationRow>();

  if (!invitation) return null;
  if (invitation.accepted_at) return null;
  if (new Date(invitation.expires_at).getTime() < Date.now()) return null;

  return invitation;
}

/** Lets the page show "expired" up front rather than after the visitor types a password. */
export async function GET(request: NextRequest) {
  const token = request.nextUrl.searchParams.get("token");
  if (!token) return NextResponse.json(INVALID, { status: 400 });

  const invitation = await findValidInvitation(token);
  if (!invitation) return NextResponse.json(INVALID, { status: 400 });

  const supabase = getSupabaseServiceClient();
  const [{ data: user }, { data: memberships }] = await Promise.all([
    supabase.from("users").select("email, name").eq("id", invitation.user_id).maybeSingle<{ email: string; name: string }>(),
    supabase
      .from("tenant_users")
      .select("role, accepted_at, invited_at, tenants(name)")
      .eq("user_id", invitation.user_id)
      .order("invited_at", { ascending: false })
      .returns<Array<{ role: TenantRole; accepted_at: string | null; invited_at: string; tenants: { name: string } | null }>>(),
  ]);

  if (!user) return NextResponse.json(INVALID, { status: 400 });

  // What the page shows beside the form: which workspace, as what, and until when. Only what the
  // holder of this link is about to become part of — nothing about the workspace beyond its name.
  // An invite names the pending membership; a reset names the one workspace, or how many.
  const rows = memberships ?? [];
  const membership = invitation.purpose === "invite" ? rows.find((row) => !row.accepted_at) ?? rows[0] : rows.length === 1 ? rows[0] : null;
  return NextResponse.json({
    valid: true,
    email: user.email,
    name: user.name,
    purpose: invitation.purpose,
    expiresAt: invitation.expires_at,
    organization: membership?.tenants?.name ?? (rows.length > 1 ? `${rows.length} workspaces` : null),
    role: membership ? TENANT_ROLE_LABELS[membership.role] ?? null : null,
  });
}

export async function POST(request: NextRequest) {
  const maintenance = await getMaintenanceStatus();
  if (maintenance.level === "locked" || maintenance.level === "read_only") {
    return NextResponse.json(
      {
        error: maintenance.message,
        code: maintenance.level === "locked" ? "maintenance_locked" : "maintenance_read_only",
      },
      { status: 503 },
    );
  }

  const body = await request.json().catch(() => null);
  const parsed = setPasswordSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Invalid input" }, { status: 400 });
  }

  const { token, password } = parsed.data;
  const invitation = await findValidInvitation(token);
  if (!invitation) return NextResponse.json(INVALID, { status: 400 });

  const supabase = getSupabaseServiceClient();
  const passwordHash = await hashPassword(password);

  const { error: consumeError } = await supabase.rpc("consume_user_password_token", {
    p_token_hash: hashInviteToken(token),
    p_password_hash: passwordHash,
  });

  // The RPC locks and re-validates the token, changes the password, burns the token, and accepts
  // the membership in one transaction. `findValidInvitation` above is only an early UX check;
  // it is deliberately not trusted as the concurrency boundary.
  if (consumeError) {
    if (
      consumeError.message?.includes("PASSWORD_TOKEN_INVALID_OR_EXPIRED") ||
      consumeError.message?.includes("PASSWORD_TOKEN_ALREADY_USED")
    ) {
      return NextResponse.json(INVALID, { status: 400 });
    }
    return NextResponse.json({ error: "Could not set password" }, { status: 500 });
  }

  // Tenant login uses Supabase Auth as the credential authority. Keep the legacy profile hash
  // updated through the atomic RPC above, then synchronize the Auth credential before reporting
  // success so a newly invited teammate can actually sign in.
  const { error: authPasswordError } = await supabase.auth.admin.updateUserById(invitation.user_id, {
    password,
    email_confirm: true,
  });
  if (authPasswordError) return NextResponse.json({ error: "Could not set password" }, { status: 500 });

  return NextResponse.json({ ok: true });
}
