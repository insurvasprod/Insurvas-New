import { NextResponse, type NextRequest } from "next/server";

import { audit } from "@/lib/audit/log";
import { getSupabaseServiceClient } from "@/lib/supabase/service";
import { requireFeatureRole } from "@/lib/tenantAuth/requireFeatureRole";

const OWNER_ROLES = ["owner"] as const;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

/** Explicitly link a legacy partner user to an admin. The browser never chooses a partner outside the owner session. */
export async function PUT(request: NextRequest, { params }: { params: Promise<{ id: string; userId: string }> }) {
  const auth = await requireFeatureRole("publisher_records", OWNER_ROLES, { write: true });
  if (auth instanceof NextResponse) return auth;
  const { id: partnerId, userId } = await params;
  const body = await request.json().catch(() => null) as { partner_admin_user_id?: unknown } | null;
  const adminUserId = body?.partner_admin_user_id;
  if (!UUID.test(partnerId) || !UUID.test(userId) || (adminUserId !== null && (typeof adminUserId !== "string" || !UUID.test(adminUserId)))) {
    return NextResponse.json({ error: "Choose a valid partner admin" }, { status: 400 });
  }

  const db = getSupabaseServiceClient();
  const { data: member } = await db.from("partner_users").select("user_id, role").eq("tenant_id", auth.context.tenantId).eq("partner_id", partnerId).eq("user_id", userId).maybeSingle<{ user_id: string; role: string }>();
  if (!member || member.role !== "partner_user") return NextResponse.json({ error: "Partner user not found" }, { status: 404 });
  if (adminUserId !== null) {
    const { data: admin } = await db.from("partner_users").select("user_id").eq("tenant_id", auth.context.tenantId).eq("partner_id", partnerId).eq("user_id", adminUserId).eq("role", "partner_admin").maybeSingle<{ user_id: string }>();
    if (!admin) return NextResponse.json({ error: "Partner admin not found for this publisher" }, { status: 404 });
  }
  const { error } = await db.from("partner_users").update({ partner_admin_user_id: adminUserId }).eq("tenant_id", auth.context.tenantId).eq("partner_id", partnerId).eq("user_id", userId);
  if (error) return NextResponse.json({ error: "Could not update partner admin assignment" }, { status: 500 });
  await audit({ actorType: "tenant", actorId: auth.context.userId, action: "tenant.partner_user_admin_assigned", targetType: "partner_user", targetId: userId, metadata: { partnerId, partnerAdminUserId: adminUserId }, request });
  return NextResponse.json({ ok: true, partner_admin_user_id: adminUserId });
}
