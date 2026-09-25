import { NextResponse, type NextRequest } from "next/server";

import { audit } from "@/lib/audit/log";
import { eligibleTenantMarkets, saveOwnerMarketProfile } from "@/lib/partnerMarkets/service";
import type { LooseDb } from "@/lib/supabase/loose";
import { getSupabaseServiceClient } from "@/lib/supabase/service";
import { requireFeatureRole } from "@/lib/tenantAuth/requireFeatureRole";

const owner = ["owner"] as const;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
type MarketProfileRow = { id: string; current_revision: number };
type MarketItemRow = { carrier_id: string; state: string };

async function current(tenantId: string, partnerId: string) {
  const db = getSupabaseServiceClient() as unknown as LooseDb;
  const profile = await db.from<MarketProfileRow>("partner_market_access_profiles").select("id, current_revision").eq("tenant_id", tenantId).eq("partner_id", partnerId).eq("scope", "publisher").is("subject_user_id", null).maybeSingle();
  if (profile.error) throw new Error(profile.error.message);
  if (!profile.data) return null;
  const items = await db.from<MarketItemRow[]>("partner_market_access_revision_items").select("carrier_id, state").eq("profile_id", profile.data.id).eq("revision", profile.data.current_revision);
  if (items.error) throw new Error(items.error.message);
  return { ...profile.data, markets: items.data ?? [] };
}

export async function GET(_request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireFeatureRole("publisher_records", owner); if (auth instanceof NextResponse) return auth;
  const { id: partnerId } = await params; if (!UUID.test(partnerId)) return NextResponse.json({ error: "Partner not found" }, { status: 404 });
  try { const [profile, eligible] = await Promise.all([current(auth.context.tenantId, partnerId), eligibleTenantMarkets(auth.context.tenantId)]); return NextResponse.json({ profile, eligible, source: profile ? "publisher" : "tenant_appointments" }, { headers: { "Cache-Control": "no-store" } }); }
  catch (error) { return NextResponse.json({ error: error instanceof Error ? error.message : "Could not load market access" }, { status: 400 }); }
}

export async function PUT(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireFeatureRole("publisher_records", owner, { write: true }); if (auth instanceof NextResponse) return auth;
  const { id: partnerId } = await params; const body = await request.json().catch(() => null) as { markets?: unknown } | null;
  if (!UUID.test(partnerId) || !Array.isArray(body?.markets)) return NextResponse.json({ error: "Choose valid carrier/state pairs" }, { status: 400 });
  try { const saved = await saveOwnerMarketProfile(auth.context.tenantId, partnerId, "publisher", null, body.markets as Array<{ carrier_id: string; state: string }>, auth.context.userId); await audit({ actorType: "tenant", actorId: auth.context.userId, action: "tenant.partner_market_access_saved", targetType: "partner_market_access_profile", targetId: saved.profile_id, metadata: { partnerId, scope: "publisher", revision: saved.revision }, request }); return NextResponse.json({ ok: true, ...saved }); }
  catch (error) { return NextResponse.json({ error: error instanceof Error ? error.message : "Could not save market access" }, { status: 400 }); }
}
