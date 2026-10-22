import { NextResponse, type NextRequest } from "next/server";
import { audit } from "@/lib/audit/log";
import { recordSettingsChanges } from "@/lib/settingsAudit/record";
import { requireFeatureRole } from "@/lib/tenantAuth/requireFeatureRole";
import { reorderStages } from "@/lib/pipelines/service";

export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireFeatureRole("book_of_business", ["owner"], { write: true });
  if (auth instanceof NextResponse) return auth;
  const body = await request.json().catch(() => null) as { stage_ids?: unknown } | null;
  try { const pipelineId = (await params).id; const stages = await reorderStages(auth.context.tenantId, pipelineId, body?.stage_ids); await audit({ actorType: "tenant", actorId: auth.context.userId, action: "tenant.pipeline_reordered", targetType: "pipeline", targetId: pipelineId, metadata: { stageIds: Array.isArray(body?.stage_ids) ? body.stage_ids.length : 0 }, request }); await recordSettingsChanges({ tenantId: auth.context.tenantId, actorId: auth.context.userId, section: "pipelines", changes: [{ key: `pipeline:${pipelineId}.order`, label: "Stage order", from: null, to: stages.map((stage: { name: string }) => stage.name).join(" → "), changeType: "update" }] }); return NextResponse.json({ stages }); }
  catch (error) { return NextResponse.json({ error: error instanceof Error ? error.message : "Could not reorder stages" }, { status: 400 }); }
}
