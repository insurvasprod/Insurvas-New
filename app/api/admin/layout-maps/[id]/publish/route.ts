import { NextResponse, after, type NextRequest } from "next/server";

import { resolveAdminContext } from "@/lib/adminAuth/requireAdminRole";
import { audit } from "@/lib/audit/log";
import { publishLayoutMap } from "@/lib/ingestion/layoutAdmin";
import { isId, layoutAdmin, layoutFailure } from "@/lib/ingestion/layoutAdminHttp";
import { parsePendingFiles } from "@/lib/ingestion/parser";

/**
 * LA-4.3 · publish a draft layout map: checked against its file type's fields first, then live; the
 * version before it retires. Files that were waiting for a layout map are parsed after the response.
 */
export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const scope = layoutAdmin(await resolveAdminContext());
  if (scope instanceof NextResponse) return scope;
  const { id } = await params;
  if (!isId(id)) return NextResponse.json({ error: "That layout map does not exist." }, { status: 404 });
  try {
    const map = await publishLayoutMap(scope.adminId, id);
    await audit({ actorType: "admin", actorId: scope.adminId, action: "layout_map.published", targetType: "carrier_layout_map", targetId: id, metadata: { layoutKey: map.layoutKey, version: map.version, columns: map.entries.length }, request });
    after(async () => {
      try { await parsePendingFiles(50); } catch (error) { console.error("[layout-maps] parse after publish failed; the poll retries:", error); }
    });
    return NextResponse.json({ map });
  } catch (error) {
    return layoutFailure(error);
  }
}
