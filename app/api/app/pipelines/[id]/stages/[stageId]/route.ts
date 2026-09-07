import { NextResponse, type NextRequest } from "next/server";
import { audit } from "@/lib/audit/log";
import { requireFeatureRole } from "@/lib/tenantAuth/requireFeatureRole";
import { archiveStage, updateStage } from "@/lib/pipelines/service";

export async function PATCH(request: NextRequest, { params }: { params: Promise<{ id: string; stageId: string }> }) {
  const auth = await requireFeatureRole("book_of_business", ["owner"], { write: true });
  if (auth instanceof NextResponse) return auth;
  const body = await request.json().catch(() => null) as { name?: unknown; stage_type?: unknown; color?: unknown; is_archived?: unknown } | null;
  try { const { id: pipelineId, stageId } = await params; const stage = body?.is_archived === true ? await archiveStage(auth.context.tenantId, pipelineId, stageId) : await updateStage(auth.context.tenantId, pipelineId, stageId, body ?? {}); await audit({ actorType: "tenant", actorId: auth.context.userId, action: body?.is_archived === true ? "tenant.pipeline_stage_archived" : "tenant.pipeline_stage_updated", targetType: "pipeline_stage", targetId: stageId, metadata: { pipelineId, name: stage.name }, request }); return NextResponse.json({ stage }); }
  catch (error) { return NextResponse.json({ error: error instanceof Error ? error.message : "Could not update stage" }, { status: 400 }); }
}
