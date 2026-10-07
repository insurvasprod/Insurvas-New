import { NextResponse, after, type NextRequest } from "next/server";

import { resolveAdminContext } from "@/lib/adminAuth/requireAdminRole";
import { audit } from "@/lib/audit/log";
import { isId, layoutAdmin } from "@/lib/ingestion/layoutAdminHttp";
import { approveProposedMapping, reprocessHeld, StatusMapError } from "@/lib/ingestion/statusAdmin";

/** LA-4.5 · approve a proposed status mapping; held rows are reprocessed after the response. */
export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const scope = layoutAdmin(await resolveAdminContext());
  if (scope instanceof NextResponse) return scope;
  const { id } = await params;
  if (!isId(id)) return NextResponse.json({ error: "That mapping does not exist." }, { status: 404 });
  try {
    const { files } = await approveProposedMapping(scope.adminId, id);
    await audit({ actorType: "admin", actorId: scope.adminId, action: "status_map.approved", targetType: "carrier_status_map", targetId: id, metadata: { heldFiles: files.length }, request });
    if (files.length) after(async () => { await reprocessHeld(files); });
    return NextResponse.json({ ok: true, heldFiles: files.length });
  } catch (error) {
    if (error instanceof StatusMapError) return NextResponse.json({ error: error.message }, { status: error.status });
    console.error("[status-maps] approve:", error);
    return NextResponse.json({ error: "The mapping could not be approved." }, { status: 500 });
  }
}
