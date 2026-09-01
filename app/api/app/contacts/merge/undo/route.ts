import { NextResponse, type NextRequest } from "next/server";

import { audit } from "@/lib/audit/log";
import { undoContactMerge } from "@/lib/contacts/service";
import { requireFeatureRole } from "@/lib/tenantAuth/requireFeatureRole";

export async function POST(request: NextRequest) {
  const auth = await requireFeatureRole("duplicate_detection", ["owner", "producer", "assistant"] as const, { write: true });
  if (auth instanceof NextResponse) return auth;
  const body = await request.json().catch(() => null) as { merge_id?: unknown } | null;
  if (typeof body?.merge_id !== "string") return NextResponse.json({ error: "Choose a merge to undo" }, { status: 400 });
  try {
    const mergeId = await undoContactMerge(auth.context.tenantId, body.merge_id);
    await audit({ actorType: "tenant", actorId: auth.context.userId, action: "tenant.contact_merge_undone", targetType: "merge", targetId: mergeId, request });
    return NextResponse.json({ mergeId });
  } catch (error) { return NextResponse.json({ error: error instanceof Error ? error.message : "Could not undo merge" }, { status: 400 }); }
}
