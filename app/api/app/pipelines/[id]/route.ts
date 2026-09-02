import { NextResponse, type NextRequest } from "next/server";
import { audit } from "@/lib/audit/log";
import { requireFeatureRole } from "@/lib/tenantAuth/requireFeatureRole";
import { deletePipeline, updatePipeline } from "@/lib/pipelines/service";

export async function PATCH(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireFeatureRole("book_of_business", ["owner"], { write: true });
  if (auth instanceof NextResponse) return auth;
  const body = await request.json().catch(() => null) as { name?: unknown; partner_type?: unknown; is_default?: unknown } | null;
  try { const id = (await params).id; const pipeline = await updatePipeline(auth.context.tenantId, id, body ?? {}); await audit({ actorType: "tenant", actorId: auth.context.userId, action: "tenant.pipeline_updated", targetType: "pipeline", targetId: id, metadata: { name: pipeline.name, partnerType: pipeline.partner_type }, request }); return NextResponse.json({ pipeline }); }
  catch (error) { return NextResponse.json({ error: error instanceof Error ? error.message : "Could not update pipeline" }, { status: 400 }); }
}

export async function DELETE(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireFeatureRole("book_of_business", ["owner"], { write: true });
  if (auth instanceof NextResponse) return auth;
  try { const id = (await params).id; await deletePipeline(auth.context.tenantId, id); await audit({ actorType: "tenant", actorId: auth.context.userId, action: "tenant.pipeline_deleted", targetType: "pipeline", targetId: id, request }); return new NextResponse(null, { status: 204 }); }
  catch (error) { return NextResponse.json({ error: error instanceof Error ? error.message : "Could not delete pipeline" }, { status: 400 }); }
}
