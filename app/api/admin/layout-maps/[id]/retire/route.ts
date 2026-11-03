import { NextResponse, type NextRequest } from "next/server";

import { resolveAdminContext } from "@/lib/adminAuth/requireAdminRole";
import { audit } from "@/lib/audit/log";
import { retireLayoutMap } from "@/lib/ingestion/layoutAdmin";
import { isId, layoutAdmin, layoutFailure } from "@/lib/ingestion/layoutAdminHttp";

/** LA-4.3 · retire the published version of a layout. Files it read keep their record of it. */
export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const scope = layoutAdmin(await resolveAdminContext());
  if (scope instanceof NextResponse) return scope;
  const { id } = await params;
  if (!isId(id)) return NextResponse.json({ error: "That layout map does not exist." }, { status: 404 });
  try {
    const map = await retireLayoutMap(id);
    await audit({ actorType: "admin", actorId: scope.adminId, action: "layout_map.retired", targetType: "carrier_layout_map", targetId: id, metadata: { layoutKey: map.layoutKey, version: map.version }, request });
    return NextResponse.json({ map });
  } catch (error) {
    return layoutFailure(error);
  }
}
