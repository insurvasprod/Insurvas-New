import { NextResponse, after, type NextRequest } from "next/server";

import { resolveAdminContext } from "@/lib/adminAuth/requireAdminRole";
import { audit } from "@/lib/audit/log";
import { removeLayoutAssignment, setLayoutAssignment } from "@/lib/ingestion/layoutAdmin";
import { assignmentSchema, isId, layoutAdmin, layoutFailure } from "@/lib/ingestion/layoutAdminHttp";
import { parsePendingFiles } from "@/lib/ingestion/parser";

/**
 * LA-4.3 · which layout a carrier's files of one type are read with, platform-wide. One layout can
 * serve many carriers (Aetna, Aflac and AHL share one). Assigning parses waiting files afterwards.
 */
export async function PUT(request: NextRequest) {
  const scope = layoutAdmin(await resolveAdminContext());
  if (scope instanceof NextResponse) return scope;
  const body = assignmentSchema.safeParse(await request.json().catch(() => null));
  if (!body.success) return NextResponse.json({ error: body.error.issues[0]?.message ?? "Choose a carrier, a file type and a layout." }, { status: 400 });
  try {
    await setLayoutAssignment(scope.adminId, { carrierId: body.data.carrier_id, fileType: body.data.file_type, layoutKey: body.data.layout_key });
    await audit({ actorType: "admin", actorId: scope.adminId, action: "layout_assignment.saved", targetType: "carrier", targetId: body.data.carrier_id, metadata: { fileType: body.data.file_type, layoutKey: body.data.layout_key }, request });
    after(async () => {
      try { await parsePendingFiles(50); } catch (error) { console.error("[layout-maps] parse after assignment failed; the poll retries:", error); }
    });
    return NextResponse.json({ ok: true });
  } catch (error) {
    return layoutFailure(error);
  }
}

export async function DELETE(request: NextRequest) {
  const scope = layoutAdmin(await resolveAdminContext());
  if (scope instanceof NextResponse) return scope;
  const id = request.nextUrl.searchParams.get("id") ?? "";
  if (!isId(id)) return NextResponse.json({ error: "Choose the assignment to remove." }, { status: 400 });
  try {
    await removeLayoutAssignment(id);
    await audit({ actorType: "admin", actorId: scope.adminId, action: "layout_assignment.removed", targetType: "carrier_layout_assignment", targetId: id, request });
    return NextResponse.json({ ok: true });
  } catch (error) {
    return layoutFailure(error);
  }
}
