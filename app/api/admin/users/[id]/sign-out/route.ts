import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";

import { requireAdminRole } from "@/lib/adminAuth/requireAdminRole";
import { audit } from "@/lib/audit/log";
import { getSupabaseServiceClient } from "@/lib/supabase/service";

const bodySchema = z.object({ reason: z.string().trim().min(3, "Say why, in a few words.").max(500) }).strict();

/**
 * "Sign out everywhere" on the admin user record: ends every agency and partner session this person
 * has, at once.
 *
 * Every session token carries users.session_version and every request compares it with the row
 * (requireTenant, requirePartner), so raising it closes them all on their next request. The raise
 * is conditional on the version read, so two presses cannot skip a number — the same increment the
 * partner "sign out other sessions" route uses. The account itself is untouched: they can sign
 * straight back in with their password. Super admin only, a reason required, one audit row.
 */
export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireAdminRole(["super_admin"]);
  if (auth instanceof NextResponse) return auth;

  const { id } = await params;
  const parsed = bodySchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Say why, in a few words." }, { status: 400 });

  const db = getSupabaseServiceClient();
  const current = await db.from("users").select("id, email, status, session_version").eq("id", id).maybeSingle<{ id: string; email: string; status: string; session_version: number }>();
  if (current.error) return NextResponse.json({ error: "Could not read this user." }, { status: 503 });
  if (!current.data || current.data.status === "deleted") return NextResponse.json({ error: "User not found" }, { status: 404 });

  const next = current.data.session_version + 1;
  const updated = await db.from("users").update({ session_version: next }).eq("id", id).eq("session_version", current.data.session_version).select("id");
  if (updated.error) return NextResponse.json({ error: "Could not sign this user out." }, { status: 503 });
  if (!updated.data?.length) return NextResponse.json({ error: "Their sessions changed while this was running. Try again." }, { status: 409 });

  await audit({
    actorId: auth.session.sub,
    action: "user.sessions_revoked",
    targetType: "user",
    targetId: id,
    reason: parsed.data.reason,
    metadata: { email: current.data.email, sessionVersion: next },
    request,
  });

  return NextResponse.json({ ok: true });
}
