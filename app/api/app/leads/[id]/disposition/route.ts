import { NextResponse, type NextRequest } from "next/server";
import { audit } from "@/lib/audit/log";
import { requireFeatureRole } from "@/lib/tenantAuth/requireFeatureRole";
import { moveLeadByDisposition } from "@/lib/pipelines/service";

export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireFeatureRole("book_of_business", ["owner", "producer"], { write: true });
  if (auth instanceof NextResponse) return auth;
  const body = await request.json().catch(() => null) as { disposition_key?: unknown } | null;
  try { const leadId = (await params).id; const lead = await moveLeadByDisposition(auth.context.tenantId, leadId, body?.disposition_key); await audit({ actorType: "tenant", actorId: auth.context.userId, action: "tenant.lead_stage_changed", targetType: "agent_lead", targetId: leadId, metadata: { dispositionKey: body?.disposition_key, stageId: lead.stage_id }, request }); return NextResponse.json({ lead }); }
  catch (error) { return NextResponse.json({ error: error instanceof Error ? error.message : "Could not move lead" }, { status: 400 }); }
}
