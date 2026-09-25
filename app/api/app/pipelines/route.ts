import { NextResponse, type NextRequest } from "next/server";
import { audit } from "@/lib/audit/log";
import { requireFeatureRole } from "@/lib/tenantAuth/requireFeatureRole";
import { createPipeline, listPipelinesWithSchema, pipelineCounts } from "@/lib/pipelines/service";
import { SchemaPendingError } from "@/lib/pipelines/schemaGap";

export async function GET() {
  const auth = await requireFeatureRole("book_of_business", ["owner"]);
  if (auth instanceof NextResponse) return auth;
  try {
    const { pipelines, descriptionsReady } = await listPipelinesWithSchema(auth.context.tenantId);
    // `counts` is additive: leads where they sit today, per pipeline and per stage.
    // `descriptionsReady`: false until stage descriptions can be stored (20260924130000).
    return NextResponse.json({ pipelines, counts: await pipelineCounts(auth.context.tenantId, pipelines), descriptionsReady });
  }
  catch (error) { return NextResponse.json({ error: error instanceof Error ? error.message : "Could not load pipelines" }, { status: 500 }); }
}

export async function POST(request: NextRequest) {
  const auth = await requireFeatureRole("book_of_business", ["owner"], { write: true });
  if (auth instanceof NextResponse) return auth;
  const body = await request.json().catch(() => null) as { name?: unknown; partner_type?: unknown; is_default?: unknown } | null;
  try {
    const pipeline = await createPipeline(auth.context.tenantId, { name: body?.name, partner_type: body?.partner_type, is_default: body?.is_default });
    await audit({ actorType: "tenant", actorId: auth.context.userId, action: "tenant.pipeline_created", targetType: "pipeline", targetId: pipeline.id, metadata: { name: pipeline.name, partnerType: pipeline.partner_type }, request });
    return NextResponse.json({ pipeline }, { status: 201 });
  } catch (error) { return NextResponse.json({ error: error instanceof Error ? error.message : "Could not create pipeline" }, { status: error instanceof SchemaPendingError ? 503 : 400 }); }
}
