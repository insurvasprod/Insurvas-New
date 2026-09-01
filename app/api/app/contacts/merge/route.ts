import { NextResponse, type NextRequest } from "next/server";

import { audit } from "@/lib/audit/log";
import { mergeSchema } from "@/lib/contacts/schemas";
import { mergeContacts } from "@/lib/contacts/service";
import { requireFeatureRole } from "@/lib/tenantAuth/requireFeatureRole";

export async function POST(request: NextRequest) {
  const auth = await requireFeatureRole("duplicate_detection", ["owner", "producer", "assistant"] as const, { write: true });
  if (auth instanceof NextResponse) return auth;
  const parsed = mergeSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Merge selection is invalid" }, { status: 400 });
  try {
    const mergeId = await mergeContacts(auth.context.tenantId, auth.context.userId, { ...parsed.data, field_choices: parsed.data.field_choices as Record<string, "kept" | "merged"> });
    await audit({ actorType: "tenant", actorId: auth.context.userId, action: "tenant.contact_merged", targetType: "merge", targetId: mergeId, metadata: { keptId: parsed.data.kept_id, mergedId: parsed.data.merged_id }, request });
    return NextResponse.json({ mergeId });
  } catch (error) { return NextResponse.json({ error: error instanceof Error ? error.message : "Could not merge contacts" }, { status: 400 }); }
}
