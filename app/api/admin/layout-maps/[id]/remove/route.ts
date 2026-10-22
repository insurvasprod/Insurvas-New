import { NextResponse, type NextRequest } from "next/server";

import { resolveAdminContext } from "@/lib/adminAuth/requireAdminRole";
import { audit } from "@/lib/audit/log";
import { removeLayout } from "@/lib/ingestion/layoutAdmin";
import { isId, layoutAdmin, layoutFailure } from "@/lib/ingestion/layoutAdminHttp";

/**
 * Removes a whole layout, given any of its versions (owner request 2026-10-14): the draft is deleted,
 * the live version retired, every carrier unassigned. Versions files were read with are kept, frozen.
 */
export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const scope = layoutAdmin(await resolveAdminContext());
  if (scope instanceof NextResponse) return scope;
  const { id } = await params;
  if (!isId(id)) return NextResponse.json({ error: "That layout map does not exist." }, { status: 404 });
  try {
    const removed = await removeLayout(id);
    await audit({ actorType: "admin", actorId: scope.adminId, action: "layout_map.removed", targetType: "carrier_layout_map", targetId: id, metadata: removed, request });
    return NextResponse.json({ removed });
  } catch (error) {
    return layoutFailure(error);
  }
}
