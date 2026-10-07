import { NextResponse, type NextRequest } from "next/server";

import { resolveAdminContext } from "@/lib/adminAuth/requireAdminRole";
import { audit } from "@/lib/audit/log";
import { isId, layoutAdmin } from "@/lib/ingestion/layoutAdminHttp";
import { discardProposedMapping, StatusMapError } from "@/lib/ingestion/statusAdmin";

/** LA-4.5 · discard a proposed status mapping nobody approved. An approved one is never removed. */
export async function DELETE(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const scope = layoutAdmin(await resolveAdminContext());
  if (scope instanceof NextResponse) return scope;
  const { id } = await params;
  if (!isId(id)) return NextResponse.json({ error: "That mapping does not exist." }, { status: 404 });
  try {
    await discardProposedMapping(id);
    await audit({ actorType: "admin", actorId: scope.adminId, action: "status_map.discarded", targetType: "carrier_status_map", targetId: id, request });
    return NextResponse.json({ ok: true });
  } catch (error) {
    if (error instanceof StatusMapError) return NextResponse.json({ error: error.message }, { status: error.status });
    console.error("[status-maps] discard:", error);
    return NextResponse.json({ error: "The proposal could not be discarded." }, { status: 500 });
  }
}
