import { NextResponse, type NextRequest } from "next/server";

import { requireFeatureRole } from "@/lib/tenantAuth/requireFeatureRole";
import { getAgentTemplate, updateAgentLead } from "@/lib/agentTemplates/service";
import { LeadPhoneScreeningError } from "@/lib/compliance/phoneEdit";
import { audit } from "@/lib/audit/log";
import { getLeadWorkspace } from "@/lib/leadWorkspace/service";
import { leadLineageAndNext } from "@/lib/leadWorkspace/lineage";
import { leadReadiness } from "@/lib/leadWorkspace/readiness";
import { anyRoleHasPermission } from "@/lib/tenantAuth/permissions";
import { contextRoles } from "@/lib/tenantAuth/requireTenant";
import { recordOwnerStageFix } from "@/lib/pipelines/views";
import { getSupabaseServiceClient } from "@/lib/supabase/service";
import { guardLead } from "@/lib/agency/guards";

export async function GET(_request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireFeatureRole("book_of_business", ["owner", "producer", "assistant"]);
  if (auth instanceof NextResponse) return auth;
  // AG-0.5 · a producer cannot open another producer's record by id (404, not 403).
  const hidden = await guardLead(auth.context, (await params).id);
  if (hidden) return hidden;
  try {
    const id = (await params).id;
    // The lineage read runs alongside; nothing from it is returned unless the workspace read — which
    // carries the tenant and setter checks — succeeds first.
    const [data, extra] = await Promise.all([
      getLeadWorkspace(auth.context.tenantId, auth.context.userId, auth.context.role, id),
      leadLineageAndNext(auth.context.tenantId, id, anyRoleHasPermission(contextRoles(auth.context), "money.view")).catch(() => null),
    ]);
    // The phone's lead page (2026-11-26, additive): what an application still needs, who ran the
    // verification, and where each licensed agent a handoff may go to holds a licence. Read only after
    // the workspace read (tenant and setter checks) succeeded; each one failing leaves it out.
    const [readiness, verifierName, licensedStates] = await Promise.all([
      leadReadiness(auth.context.tenantId, id, data.lead.values).catch(() => null),
      userName(data.verification?.session.user_id ?? null),
      agentLicensedStates(auth.context.tenantId, (data.licensedAgents ?? []).map((agent) => agent.id)),
    ]);
    return NextResponse.json({ ...data, lineage: extra?.lineage ?? null, nextAction: extra?.nextAction ?? null, readiness, verifierName, licensedStates, readOnly: auth.entitlement.access === "read_only" });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Could not load lead workspace";
    return NextResponse.json({ error: message }, { status: message === "Lead not found" ? 404 : 400 });
  }
}

async function userName(userId: string | null): Promise<string | null> {
  if (!userId) return null;
  const { data, error } = await getSupabaseServiceClient().from("users").select("name").eq("id", userId).maybeSingle();
  return error ? null : data?.name ?? null;
}

/** Each agent's unexpired licensed states (Team & access); {} when the table is not there yet or the read fails. */
async function agentLicensedStates(tenantId: string, userIds: string[]): Promise<Record<string, string[]>> {
  if (!userIds.length) return {};
  type Read = PromiseLike<{ data: Array<{ user_id: string; state: string; expires_on?: string | null }> | null; error: { message: string } | null }>;
  const table = () => (getSupabaseServiceClient() as unknown as { from(name: string): { select(columns: string): { eq(c: string, v: string): { in(c: string, v: string[]): Read } } } }).from("tenant_user_licensed_states");
  try {
    let read = await table().select("user_id, state, expires_on").eq("tenant_id", tenantId).in("user_id", userIds);
    if (read.error) read = await table().select("user_id, state").eq("tenant_id", tenantId).in("user_id", userIds);
    if (read.error) return {};
    const today = new Date().toISOString().slice(0, 10);
    const out: Record<string, string[]> = {};
    for (const row of read.data ?? []) {
      if (row.expires_on && row.expires_on < today) continue;
      const state = String(row.state ?? "").trim().toUpperCase();
      if (!state) continue;
      const list = (out[row.user_id] ??= []);
      if (!list.includes(state)) list.push(state);
    }
    return out;
  } catch {
    return {};
  }
}

export async function PATCH(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireFeatureRole("book_of_business", ["owner", "producer", "assistant"], { write: true });
  if (auth instanceof NextResponse) return auth;
  // AG-0.5 · a producer cannot open another producer's record by id (404, not 403).
  const hidden = await guardLead(auth.context, (await params).id);
  if (hidden) return hidden;
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
    const lead = await updateAgentLead(auth.context.tenantId, leadId, template, body.values, requestedStage, auth.context.userId);
    if (changesStage && current.data) {
      await recordOwnerStageFix({ tenantId: auth.context.tenantId, leadId, fromPipelineId: current.data.pipeline_id, fromStageId: current.data.stage_id, toPipelineId: lead.pipeline_id, toStageId: lead.stage_id, actorId: auth.context.userId });
    }
    await audit({ actorType: "tenant", actorId: auth.context.userId, action: "tenant.lead_stage_changed", targetType: "agent_lead", targetId: lead.id, metadata: { operation: "updated", stageId: lead.stage_id }, request });
    return NextResponse.json({ lead });
  } catch (error) {
    // A changed number that is listed, invalid or could not be screened: nothing was saved.
    if (error instanceof LeadPhoneScreeningError) return NextResponse.json({ error: error.message, code: error.code }, { status: error.status });
    return NextResponse.json({ error: error instanceof Error ? error.message : "Could not update lead" }, { status: 400 });
  }
}
