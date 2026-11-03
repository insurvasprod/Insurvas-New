import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";

import { requireFeatureRole } from "@/lib/tenantAuth/requireFeatureRole";
import { audit } from "@/lib/audit/log";
import { deletePreset } from "@/lib/tenantTeam/access";

/** Deleting a preset changes nobody's access: it was applied by copying, never by reference. */
export async function DELETE(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireFeatureRole("custom_team_access", ["owner"], { write: true });
  if (auth instanceof NextResponse) return auth;
  const { id } = await params;
  if (!z.string().uuid().safeParse(id).success) return NextResponse.json({ error: "That preset could not be found." }, { status: 404 });
  if (!(await deletePreset(auth.context.tenantId, id))) return NextResponse.json({ error: "Could not delete the preset." }, { status: 500 });
  await audit({ actorType: "tenant", actorId: auth.context.userId, action: "tenant.access_preset_deleted", targetType: "tenant", targetId: auth.context.tenantId, metadata: { presetId: id }, request });
  return NextResponse.json({ ok: true });
}
