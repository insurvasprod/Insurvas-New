import { NextResponse, type NextRequest } from "next/server";

import { getSupabaseServiceClient } from "@/lib/supabase/service";
import { hashInviteToken } from "@/lib/users/invitations";
import { setPasswordSchema } from "@/lib/users/schemas";
import { hashPassword } from "@/lib/password";

type InvitationRow = {
  id: string;
  user_id: string;
  expires_at: string;
  accepted_at: string | null;
};

const INVALID = { error: "This invitation link is invalid or has expired" };

async function findValidInvitation(token: string) {
  const supabase = getSupabaseServiceClient();
  const { data: invitation } = await supabase
    .from("user_invitations")
    .select("id, user_id, expires_at, accepted_at")
    .eq("token_hash", hashInviteToken(token))
    // Both purposes end in "choose a password". An email_change token must NOT be redeemable
    // here — it proves control of a mailbox, not the right to set credentials.
    .in("purpose", ["invite", "password_reset"])
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
  const { data: user } = await supabase
    .from("users")
    .select("email, name")
    .eq("id", invitation.user_id)
    .maybeSingle<{ email: string; name: string }>();

  if (!user) return NextResponse.json(INVALID, { status: 400 });

  return NextResponse.json({ valid: true, email: user.email, name: user.name });
}

export async function POST(request: NextRequest) {
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

  return NextResponse.json({ ok: true });
}
