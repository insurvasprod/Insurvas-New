import { NextResponse, type NextRequest } from "next/server";

import { resolveAdminContext } from "@/lib/adminAuth/requireAdminRole";
import { audit } from "@/lib/audit/log";
import { createLayoutMap, listLayoutMaps } from "@/lib/ingestion/layoutAdmin";
import { createSchema, layoutAdmin, layoutFailure } from "@/lib/ingestion/layoutAdminHttp";

/** LA-4.3 · the platform's layout maps: list them (with carrier assignments), or start a new layout at version 1. */
export async function GET() {
  const scope = layoutAdmin(await resolveAdminContext());
  if (scope instanceof NextResponse) return scope;
  try {
    return NextResponse.json(await listLayoutMaps(), { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return layoutFailure(error);
  }
}

export async function POST(request: NextRequest) {
  const scope = layoutAdmin(await resolveAdminContext());
  if (scope instanceof NextResponse) return scope;
  const body = createSchema.safeParse(await request.json().catch(() => null));
  if (!body.success) return NextResponse.json({ error: body.error.issues[0]?.message ?? "Check the layout's key, name and file type." }, { status: 400 });
  try {
    const map = await createLayoutMap(scope.adminId, { layoutKey: body.data.layout_key, name: body.data.name, fileType: body.data.file_type });
    await audit({ actorType: "admin", actorId: scope.adminId, action: "layout_map.created", targetType: "carrier_layout_map", targetId: map.id, metadata: { layoutKey: map.layoutKey, version: map.version, fileType: map.fileType }, request });
    return NextResponse.json({ map }, { status: 201 });
  } catch (error) {
    return layoutFailure(error);
  }
}
