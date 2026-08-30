import { NextResponse, type NextRequest } from "next/server";

import { getMaintenanceStatus } from "@/lib/system/service";
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
  const parsed = confirmEmailSchema.safeParse(body);
  if (!parsed.success) return NextResponse.json(INVALID, { status: 400 });

  const change = await findValidChange(parsed.data.token);
  if (!change) return NextResponse.json(INVALID, { status: 400 });

  const supabase = getSupabaseServiceClient();

  // Re-check at the moment of confirmation: someone else may have taken this address while the
  // change was pending.
  const { data: clash } = await supabase
    .from("users")
    .select("id")
    .eq("email", change.new_email!)
    .neq("id", change.user_id)
    .maybeSingle<{ id: string }>();

  if (clash) {
    return NextResponse.json({ error: "That email address is no longer available" }, { status: 409 });
  }

  const { error } = await supabase
    .from("users")
    .update({ email: change.new_email! })
    .eq("id", change.user_id);

  if (error) {
    return NextResponse.json({ error: "Could not confirm email address" }, { status: 500 });
  }

  // Burn the token so the link can't be replayed.
  await supabase
    .from("user_invitations")
    .update({ accepted_at: new Date().toISOString() })
    .eq("id", change.id);

  return NextResponse.json({ ok: true, email: change.new_email });
}
