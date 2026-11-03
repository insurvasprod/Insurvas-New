import { NextResponse, type NextRequest } from "next/server";

import { resolveAdminContext } from "@/lib/adminAuth/requireAdminRole";
import { audit } from "@/lib/audit/log";
import { newLayoutVersion } from "@/lib/ingestion/layoutAdmin";
import { isId, layoutAdmin, layoutFailure } from "@/lib/ingestion/layoutAdminHttp";

/** LA-4.3 · start version N+1 of a layout from a published or retired version (the only way to change one). */
export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const scope = layoutAdmin(await resolveAdminContext());
  if (scope instanceof NextResponse) return scope;
  const { id } = await params;
  if (!isId(id)) return NextResponse.json({ error: "That layout map does not exist." }, { status: 404 });
  try {
    const map = await newLayoutVersion(scope.adminId, id);
    await audit({ actorType: "admin", actorId: scope.adminId, action: "layout_map.created", targetType: "carrier_layout_map", targetId: map.id, metadata: { layoutKey: map.layoutKey, version: map.version, from: id }, request });
    return NextResponse.json({ map }, { status: 201 });
  } catch (error) {
    return layoutFailure(error);
  }
}
