import { NextResponse, type NextRequest } from "next/server";

import { audit } from "@/lib/audit/log";
import { runExistingCustomerPreflight } from "@/lib/existingCustomerPreflight/service";
import { requireFeatureRole } from "@/lib/tenantAuth/requireFeatureRole";
import { getSupabaseServiceClient } from "@/lib/supabase/service";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireFeatureRole("book_of_business", ["owner", "producer", "assistant"], { write: true });
  if (auth instanceof NextResponse) return auth;
  const leadId = (await params).id;
  if (!UUID.test(leadId)) return NextResponse.json({ error: "Choose a valid lead" }, { status: 400 });
  try {
    const lead = await getSupabaseServiceClient().from("agent_leads").select("id, values").eq("tenant_id", auth.context.tenantId).eq("id", leadId).maybeSingle();
    if (lead.error) throw new Error(`Could not load lead: ${lead.error.message}`);
    if (!lead.data) return NextResponse.json({ error: "Lead not found" }, { status: 404 });
    const result = await runExistingCustomerPreflight({ tenantId: auth.context.tenantId, leadId, values: lead.data.values });
    await audit({ actorType: "tenant", actorId: auth.context.userId, action: "tenant.lead_preflight_rechecked", targetType: "agent_lead", targetId: leadId, metadata: { status: result.status, matchCount: result.matches.length }, request });
    return NextResponse.json({ result });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Could not re-check this lead" }, { status: 400 });
  }
}
