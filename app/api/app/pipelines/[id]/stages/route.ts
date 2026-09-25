import { NextResponse, type NextRequest } from "next/server";
import { audit } from "@/lib/audit/log";
import { requireFeatureRole } from "@/lib/tenantAuth/requireFeatureRole";
import { createStage } from "@/lib/pipelines/service";
import { SchemaPendingError } from "@/lib/pipelines/schemaGap";

export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireFeatureRole("book_of_business", ["owner"], { write: true });
  if (auth instanceof NextResponse) return auth;
  const body = await request.json().catch(() => null) as { name?: unknown; stage_type?: unknown; color?: unknown; description?: unknown } | null;
  try { const pipelineId = (await params).id; const stage = await createStage(auth.context.tenantId, pipelineId, { name: body?.name, stage_type: body?.stage_type, color: body?.color, description: body?.description }); await audit({ actorType: "tenant", actorId: auth.context.userId, action: "tenant.pipeline_stage_created", targetType: "pipeline_stage", targetId: stage.id, metadata: { pipelineId, name: stage.name }, request }); return NextResponse.json({ stage }, { status: 201 }); }
  catch (error) { if (error instanceof SchemaPendingError) return NextResponse.json({ error: error.message }, { status: 503 }); return NextResponse.json({ error: error instanceof Error ? error.message : "Could not create stage" }, { status: 400 }); }
}
