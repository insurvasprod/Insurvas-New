import { NextRequest, NextResponse } from "next/server";

import { audit } from "@/lib/audit/log";
import { fieldSchema } from "@/lib/contacts/schemas";
import { saveFieldSchema, getContactWorkspace } from "@/lib/contacts/service";
import { requireFeatureRole } from "@/lib/tenantAuth/requireFeatureRole";

const CONTACT_ROLES = ["owner", "producer", "assistant"] as const;

export async function GET() {
  const auth = await requireFeatureRole("duplicate_detection", CONTACT_ROLES);
  if (auth instanceof NextResponse) return auth;
  try { return NextResponse.json({ fieldSchema: (await getContactWorkspace(auth.context.tenantId, auth.context.userId)).fieldSchema }); }
  catch (error) { return NextResponse.json({ error: error instanceof Error ? error.message : "Could not load field schema" }, { status: 500 }); }
}

export async function POST(request: NextRequest) {
  const auth = await requireFeatureRole("duplicate_detection", CONTACT_ROLES, { write: true });
  if (auth instanceof NextResponse) return auth;
  const parsed = fieldSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Field definition is invalid" }, { status: 400 });
  try {
    const row = await saveFieldSchema(auth.context.tenantId, parsed.data);
    await audit({ actorType: "tenant", actorId: auth.context.userId, action: "tenant.contact_field_schema_saved", targetType: "field_schema", targetId: row.id, metadata: { fieldKey: row.field_key, entity: row.entity }, request });
    return NextResponse.json({ field: row }, { status: 201 });
  } catch (error) { return NextResponse.json({ error: error instanceof Error ? error.message : "Could not save field schema" }, { status: 400 }); }
}
