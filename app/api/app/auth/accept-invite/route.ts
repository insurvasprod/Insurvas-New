import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";

import { getSupabaseServiceClient } from "@/lib/supabase/service";
import { hashInviteToken } from "@/lib/users/invitations";
import { audit } from "@/lib/audit/log";

/**
 * AG-0.6 · accepting an agency invitation with an account that already exists (decision D7: one person may
 * belong to two agencies). The token proves the person controls the invited mailbox; nothing about his
 * credentials changes. A brand-new account still goes through set-password, which chooses the password.
 */
const schema = z.object({ token: z.string().min(20).max(200) });

export async function POST(request: NextRequest) {
  const parsed = schema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "This invitation link is invalid or has expired" }, { status: 400 });
  const { data, error } = await getSupabaseServiceClient().rpc("accept_tenant_invitation" as never, { p_token_hash: hashInviteToken(parsed.data.token) } as never);
  if (error) {
    const message = (error as { message?: string }).message ?? "";
    if (/INVITE_NEEDS_PASSWORD/.test(message)) return NextResponse.json({ error: "Choose a password to finish joining.", code: "needs_password" }, { status: 409 });
    if (/PASSWORD_TOKEN_INVALID_OR_EXPIRED/.test(message)) return NextResponse.json({ error: "This invitation link is invalid or has expired" }, { status: 400 });
    return NextResponse.json({ error: "Could not accept this invitation" }, { status: 500 });
  }
  const row = (Array.isArray(data) ? data[0] : data) as { user_id: string; tenant_id: string } | null;
  if (row) await audit({ actorType: "tenant", actorId: row.user_id, action: "tenant.member_invite_accepted", targetType: "tenant", targetId: row.tenant_id, metadata: { tenantId: row.tenant_id, existingAccount: true }, request });
  return NextResponse.json({ ok: true });
}
