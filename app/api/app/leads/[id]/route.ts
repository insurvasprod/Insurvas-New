import { NextResponse, type NextRequest } from "next/server";

import { requireFeatureRole } from "@/lib/tenantAuth/requireFeatureRole";
import { getAgentTemplate, updateAgentLead } from "@/lib/agentTemplates/service";
import { audit } from "@/lib/audit/log";
import { getLeadWorkspace } from "@/lib/leadWorkspace/service";
import { leadLineageAndNext } from "@/lib/leadWorkspace/lineage";
import { hasTenantPermission } from "@/lib/tenantAuth/permissions";
import { recordOwnerStageFix } from "@/lib/pipelines/views";
import { getSupabaseServiceClient } from "@/lib/supabase/service";

export async function GET(_request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireFeatureRole("book_of_business", ["owner", "producer", "assistant"]);
  if (auth instanceof NextResponse) return auth;
  try {
    const id = (await params).id;
    // The lineage read runs alongside; nothing from it is returned unless the workspace read — which
    // carries the tenant and setter checks — succeeds first.
    const [data, extra] = await Promise.all([
      getLeadWorkspace(auth.context.tenantId, auth.context.userId, auth.context.role, id),
      leadLineageAndNext(auth.context.tenantId, id, hasTenantPermission(auth.context.role, "money.view")).catch(() => null),
    ]);
    return NextResponse.json({ ...data, lineage: extra?.lineage ?? null, nextAction: extra?.nextAction ?? null, readOnly: auth.entitlement.access === "read_only" });
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
    const leadId = (await params).id;
    // A stage change is a disposition (POST /api/app/leads/move). This direct edit stays for an owner
    // correcting data, and that correction is written to the stage history like any other move.
    const current = await getSupabaseServiceClient().from("agent_leads").select("pipeline_id, stage_id").eq("tenant_id", auth.context.tenantId).eq("id", leadId).maybeSingle();
    const requestedStage = body.stage_id ?? body.stage_key ?? "";
    const changesStage = Boolean(current.data && requestedStage && current.data.stage_id !== requestedStage);
    if (changesStage && auth.context.role !== "owner") {
      return NextResponse.json({ error: "Move a lead with a disposition: pick the outcome that sends it to that stage.", code: "move_needs_disposition" }, { status: 403 });
    }
    const template = await getAgentTemplate(auth.context.tenantId, auth.context.userId);
    const lead = await updateAgentLead(auth.context.tenantId, leadId, template, body.values, requestedStage);
    if (changesStage && current.data) {
      await recordOwnerStageFix({ tenantId: auth.context.tenantId, leadId, fromPipelineId: current.data.pipeline_id, fromStageId: current.data.stage_id, toPipelineId: lead.pipeline_id, toStageId: lead.stage_id, actorId: auth.context.userId });
    }
    await audit({ actorType: "tenant", actorId: auth.context.userId, action: "tenant.lead_stage_changed", targetType: "agent_lead", targetId: lead.id, metadata: { operation: "updated", stageId: lead.stage_id }, request });
    return NextResponse.json({ lead });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Could not update lead" }, { status: 400 });
  }
}
