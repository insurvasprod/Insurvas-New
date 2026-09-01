import { NextResponse, type NextRequest } from "next/server";
import { audit } from "@/lib/audit/log";
import { requireFeatureRole } from "@/lib/tenantAuth/requireFeatureRole";
import { listDispositionMappings, removeDispositionMapping, setDispositionMapping } from "@/lib/pipelines/service";

export async function GET() {
  const auth = await requireFeatureRole("book_of_business", ["owner"]);
  if (auth instanceof NextResponse) return auth;
  try { return NextResponse.json({ mappings: await listDispositionMappings(auth.context.tenantId) }); } catch (error) { return NextResponse.json({ error: error instanceof Error ? error.message : "Could not load mappings" }, { status: 500 }); }
}

export async function POST(request: NextRequest) {
  const auth = await requireFeatureRole("book_of_business", ["owner"], { write: true });
  if (auth instanceof NextResponse) return auth;
  const body = await request.json().catch(() => null) as { stage_id?: unknown; disposition_key?: unknown } | null;
  try { const mapping = await setDispositionMapping(auth.context.tenantId, { stage_id: body?.stage_id, disposition_key: body?.disposition_key }); await audit({ actorType: "tenant", actorId: auth.context.userId, action: "tenant.stage_disposition_mapped", targetType: "stage_disposition", targetId: mapping.id, metadata: { stageId: mapping.stage_id, dispositionKey: mapping.disposition_key }, request }); return NextResponse.json({ mapping }, { status: 201 }); }
  catch (error) { return NextResponse.json({ error: error instanceof Error ? error.message : "Could not save mapping" }, { status: 400 }); }
}

export async function DELETE(request: NextRequest) {
  const auth = await requireFeatureRole("book_of_business", ["owner"], { write: true });
  if (auth instanceof NextResponse) return auth;
  const body = await request.json().catch(() => null) as { id?: string } | null;
  try { if (!body?.id) throw new Error("Mapping id is required"); await removeDispositionMapping(auth.context.tenantId, body.id); await audit({ actorType: "tenant", actorId: auth.context.userId, action: "tenant.stage_disposition_removed", targetType: "stage_disposition", targetId: body.id, request }); return new NextResponse(null, { status: 204 }); }
  catch (error) { return NextResponse.json({ error: error instanceof Error ? error.message : "Could not remove mapping" }, { status: 400 }); }
}
