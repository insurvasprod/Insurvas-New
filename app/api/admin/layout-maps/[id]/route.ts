import { NextResponse, type NextRequest } from "next/server";

import { resolveAdminContext } from "@/lib/adminAuth/requireAdminRole";
import { audit } from "@/lib/audit/log";
import { deleteLayoutDraft, saveLayoutMap } from "@/lib/ingestion/layoutAdmin";
import { isId, layoutAdmin, layoutFailure, saveSchema } from "@/lib/ingestion/layoutAdminHttp";

/** LA-4.3 · save a draft layout map: its settings and its whole column list. A published version is frozen. */
export async function PUT(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const scope = layoutAdmin(await resolveAdminContext());
  if (scope instanceof NextResponse) return scope;
  const { id } = await params;
  if (!isId(id)) return NextResponse.json({ error: "That layout map does not exist." }, { status: 404 });
  const body = saveSchema.safeParse(await request.json().catch(() => null));
  if (!body.success) return NextResponse.json({ error: body.error.issues[0]?.message ?? "Check the map and try again." }, { status: 400 });
  try {
    const map = await saveLayoutMap(id, {
      name: body.data.name,
      headerRowIndex: body.data.header_row_index,
      sheetName: body.data.sheet_name,
      rowCountSwingPct: body.data.row_count_swing_pct,
      totalRowColumn: body.data.total_row_column,
      totalRowValue: body.data.total_row_value,
      entries: body.data.entries.map((entry) => ({ sourceColumn: entry.source_column, targetField: entry.target_field, dataType: entry.data_type, transform: entry.transform, required: entry.required, enumValues: entry.enum_values })),
    });
    await audit({ actorType: "admin", actorId: scope.adminId, action: "layout_map.updated", targetType: "carrier_layout_map", targetId: id, metadata: { layoutKey: map.layoutKey, version: map.version, columns: map.entries.length }, request });
    return NextResponse.json({ map });
  } catch (error) {
    return layoutFailure(error);
  }
}

/** LA-4.3 · delete a draft version. A published or retired version is never deleted; retire it instead. */
export async function DELETE(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const scope = layoutAdmin(await resolveAdminContext());
  if (scope instanceof NextResponse) return scope;
  const { id } = await params;
  if (!isId(id)) return NextResponse.json({ error: "That layout map does not exist." }, { status: 404 });
  try {
    const map = await deleteLayoutDraft(id);
    await audit({ actorType: "admin", actorId: scope.adminId, action: "layout_map.deleted", targetType: "carrier_layout_map", targetId: id, metadata: { layoutKey: map.layoutKey, version: map.version, status: map.status }, request });
    return NextResponse.json({ deleted: true });
  } catch (error) {
    return layoutFailure(error);
  }
}
