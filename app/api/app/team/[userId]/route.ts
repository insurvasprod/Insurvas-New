import { NextResponse, type NextRequest } from "next/server";

import { requireTenant } from "@/lib/tenantAuth/requireTenant";
import { updateTeamRoleSchema } from "@/lib/tenantTeam/schemas";
import { getSupabaseServiceClient } from "@/lib/supabase/service";
import { audit } from "@/lib/audit/log";
import { z } from "zod";

export async function PATCH(request: NextRequest, { params }: { params: Promise<{ userId: string }> }) {
  const auth = await requireTenant(["owner"]);
  if (auth instanceof NextResponse) return auth;

  const { userId } = await params;
  if (!z.string().uuid().safeParse(userId).success) {
    return NextResponse.json({ error: "That teammate identifier is not valid" }, { status: 400 });
  }
  const parsed = updateTeamRoleSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Choose a valid role" }, { status: 400 });
  }

  const { data, error } = await getSupabaseServiceClient().rpc("tenant_update_member_role", {
    p_tenant_id: auth.context.tenantId,
    p_user_id: userId,
    p_role: parsed.data.role,
  });

  if (error) {
    if (error.message?.includes("last_owner")) {
      return NextResponse.json({ error: "This is the tenant's only owner. Promote another owner before changing this role.", code: "last_owner" }, { status: 409 });
    }
    if (error.message?.includes("member_not_found")) return NextResponse.json({ error: "That teammate is not in this workspace" }, { status: 404 });
    return NextResponse.json({ error: "Could not change this teammate's role" }, { status: 500 });
  }

  const result = Array.isArray(data) ? data[0] : data;
  if (result.old_role !== result.new_role) {
    await audit({
      actorType: "tenant",
      actorId: auth.context.userId,
      action: "tenant.member_role_changed",
      targetType: "user",
      targetId: userId,
      metadata: { tenantId: auth.context.tenantId, from: result.old_role, to: result.new_role },
      request,
    });
  }

  return NextResponse.json({ ok: true, userId, role: result.new_role });
}
