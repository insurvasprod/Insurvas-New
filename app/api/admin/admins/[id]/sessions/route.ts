import { NextResponse, type NextRequest } from "next/server";

import { audit } from "@/lib/audit/log";
import { requireAdminRole } from "@/lib/adminAuth/requireAdminRole";
import { endAdminSessions, type SessionVersionClient } from "@/lib/adminAuth/sessionVersion";
import { getSupabaseServiceClient } from "@/lib/supabase/service";

/**
 * "Sign out everywhere" for another staff account (security review 2026-11, M-2): a super admin
 * ends every session of that admin, for a lost laptop or a cookie that may have been copied. The
 * account stays active; its owner signs in again with their password and authenticator code.
 * Your own account is not ended here: signing out does that.
 */
export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireAdminRole(["super_admin"]);
  if (auth instanceof NextResponse) return auth;

  const { id } = await params;
  if (id === auth.session.sub) {
    return NextResponse.json({ error: "This is your account. Sign out to end your own sessions." }, { status: 400 });
  }

  const ended = await endAdminSessions(getSupabaseServiceClient() as unknown as SessionVersionClient, id);
  if (ended === "not_found") return NextResponse.json({ error: "Admin not found" }, { status: 404 });
  if (ended === "unavailable") {
    return NextResponse.json(
      { error: "Sessions cannot be ended yet: migration 20261117200000 has not been applied." },
      { status: 503 },
    );
  }
  if (ended === "error") return NextResponse.json({ error: "Could not end this admin's sessions. Try again." }, { status: 500 });

  await audit({
    actorId: auth.session.sub,
    action: "admin.sessions_ended",
    targetType: "admin_user",
    targetId: id,
    request,
  });

  return NextResponse.json({ ok: true });
}
