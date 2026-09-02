import { NextResponse, type NextRequest } from "next/server";

import { requireFeatureRole } from "@/lib/tenantAuth/requireFeatureRole";
import { getAgentTemplate, updateAgentLead } from "@/lib/agentTemplates/service";
import { audit } from "@/lib/audit/log";
import { getLeadWorkspace } from "@/lib/leadWorkspace/service";

export async function GET(_request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireFeatureRole("book_of_business", ["owner", "producer", "assistant"]);
  if (auth instanceof NextResponse) return auth;
  try {
    const data = await getLeadWorkspace(auth.context.tenantId, auth.context.userId, auth.context.role, (await params).id);
    return NextResponse.json({ ...data, readOnly: auth.entitlement.access === "read_only" });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Could not load lead workspace";
    return NextResponse.json({ error: message }, { status: message === "Lead not found" ? 404 : 400 });
  }
}

export async function PATCH(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireFeatureRole("book_of_business", ["owner", "producer", "assistant"], { write: true });
  if (auth instanceof NextResponse) return auth;
  const body = await request.json().catch(() => null) as { values?: unknown; stage_id?: string; stage_key?: string } | null;
  if (!body?.values || !(body.stage_id || body.stage_key)) return NextResponse.json({ error: "Lead values and stage are required" }, { status: 400 });
  try {
    const template = await getAgentTemplate(auth.context.tenantId, auth.context.userId);
    const lead = await updateAgentLead(auth.context.tenantId, (await params).id, template, body.values, body.stage_id ?? body.stage_key ?? "");
    await audit({ actorType: "tenant", actorId: auth.context.userId, action: "tenant.lead_stage_changed", targetType: "agent_lead", targetId: lead.id, metadata: { operation: "updated", stageId: lead.stage_id }, request });
    return NextResponse.json({ lead });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Could not update lead" }, { status: 400 });
  }
}
