import { NextResponse, type NextRequest } from "next/server";

import { audit } from "@/lib/audit/log";
import { eligibleTenantMarkets, resolvePartnerMarkets, saveOwnerMarketProfile } from "@/lib/partnerMarkets/service";
import type { LooseDb } from "@/lib/supabase/loose";
import { getSupabaseServiceClient } from "@/lib/supabase/service";
import { requireFeatureRole } from "@/lib/tenantAuth/requireFeatureRole";

const owner = ["owner"] as const;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
type PartnerMember = { user_id: string; role: "partner_admin" | "partner_user" };

async function member(tenantId: string, partnerId: string, userId: string) {
  const db = getSupabaseServiceClient() as unknown as LooseDb;
  const { data, error } = await db.from<PartnerMember>("partner_users").select("user_id, role").eq("tenant_id", tenantId).eq("partner_id", partnerId).eq("user_id", userId).maybeSingle();
  if (error) throw new Error(error.message); return data;
}

export async function GET(_request: NextRequest, { params }: { params: Promise<{ id: string; userId: string }> }) {
  const auth = await requireFeatureRole("publisher_records", owner); if (auth instanceof NextResponse) return auth;
  const { id: partnerId, userId } = await params; if (!UUID.test(partnerId) || !UUID.test(userId)) return NextResponse.json({ error: "Partner user not found" }, { status: 404 });
  try { const target = await member(auth.context.tenantId, partnerId, userId); if (!target) return NextResponse.json({ error: "Partner user not found" }, { status: 404 }); const [effective, eligible] = await Promise.all([resolvePartnerMarkets(auth.context.tenantId, partnerId, userId), eligibleTenantMarkets(auth.context.tenantId)]); return NextResponse.json({ target, effective, eligible }, { headers: { "Cache-Control": "no-store" } }); }
  catch (error) { return NextResponse.json({ error: error instanceof Error ? error.message : "Could not load market access" }, { status: 400 }); }
}

export async function PUT(request: NextRequest, { params }: { params: Promise<{ id: string; userId: string }> }) {
  const auth = await requireFeatureRole("publisher_records", owner, { write: true }); if (auth instanceof NextResponse) return auth;
  const { id: partnerId, userId } = await params; const body = await request.json().catch(() => null) as { markets?: unknown } | null;
  if (!UUID.test(partnerId) || !UUID.test(userId) || !Array.isArray(body?.markets)) return NextResponse.json({ error: "Choose valid carrier/state pairs" }, { status: 400 });
  try { const target = await member(auth.context.tenantId, partnerId, userId); if (!target) return NextResponse.json({ error: "Partner user not found" }, { status: 404 }); const saved = await saveOwnerMarketProfile(auth.context.tenantId, partnerId, target.role, userId, body.markets as Array<{ carrier_id: string; state: string }>, auth.context.userId); await audit({ actorType: "tenant", actorId: auth.context.userId, action: "tenant.partner_market_access_saved", targetType: "partner_market_access_profile", targetId: saved.profile_id, metadata: { partnerId, subjectUserId: userId, scope: target.role, revision: saved.revision }, request }); return NextResponse.json({ ok: true, ...saved }); }
  catch (error) { return NextResponse.json({ error: error instanceof Error ? error.message : "Could not save market access" }, { status: 400 }); }
}
