import { NextResponse, type NextRequest } from "next/server";

import { getSupabaseServiceClient } from "@/lib/supabase/service";
import { hashInviteToken } from "@/lib/users/invitations";
import { confirmEmailSchema } from "@/lib/users/schemas";

type ChangeRow = {
  id: string;
  user_id: string;
  expires_at: string;
  accepted_at: string | null;
  new_email: string | null;
};

const INVALID = { error: "This confirmation link is invalid or has expired" };

async function findValidChange(token: string) {
  const supabase = getSupabaseServiceClient();
  const { data: change } = await supabase
    .from("user_invitations")
    .select("id, user_id, expires_at, accepted_at, new_email")
    .eq("token_hash", hashInviteToken(token))
    .eq("purpose", "email_change")
    .maybeSingle<ChangeRow>();

  if (!change || !change.new_email) return null;
  if (change.accepted_at) return null;
  if (new Date(change.expires_at).getTime() < Date.now()) return null;

  return change;
}

/** Lets the page show the pending address, and say "expired" before anyone clicks confirm. */
export async function GET(request: NextRequest) {
  const token = request.nextUrl.searchParams.get("token");
  if (!token) return NextResponse.json(INVALID, { status: 400 });

  const change = await findValidChange(token);
  if (!change) return NextResponse.json(INVALID, { status: 400 });

  return NextResponse.json({ valid: true, newEmail: change.new_email });
}

export async function POST(request: NextRequest) {
  const body = await request.json().catch(() => null);
  const parsed = confirmEmailSchema.safeParse(body);
  if (!parsed.success) return NextResponse.json(INVALID, { status: 400 });

  const change = await findValidChange(parsed.data.token);
  if (!change) return NextResponse.json(INVALID, { status: 400 });

  const supabase = getSupabaseServiceClient();
  const { error } = await supabase.rpc("consume_user_email_change_token", {
    p_token_hash: hashInviteToken(parsed.data.token),
  });

  if (error) {
    if (error.message?.includes("EMAIL_ALREADY_REGISTERED")) {
      return NextResponse.json({ error: "That email address is no longer available" }, { status: 409 });
    }
    if (
      error.message?.includes("EMAIL_CHANGE_TOKEN_INVALID_OR_EXPIRED") ||
      error.message?.includes("EMAIL_CHANGE_TOKEN_ALREADY_USED")
    ) {
      return NextResponse.json(INVALID, { status: 400 });
    }
    return NextResponse.json({ error: "Could not confirm email address" }, { status: 500 });
  }

  return NextResponse.json({ ok: true, email: change.new_email });
}
