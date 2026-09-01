import { NextResponse, type NextRequest } from "next/server";

import { audit } from "@/lib/audit/log";
import { parseContactCsv } from "@/lib/contacts/csv";
import { createContact, getContactWorkspace } from "@/lib/contacts/service";
import { requireFeatureRole } from "@/lib/tenantAuth/requireFeatureRole";

const CONTACT_ROLES = ["owner", "producer", "assistant"] as const;

export async function POST(request: NextRequest) {
  const auth = await requireFeatureRole("duplicate_detection", CONTACT_ROLES, { write: true });
  if (auth instanceof NextResponse) return auth;
  const body = await request.json().catch(() => null) as { csv?: unknown } | null;
  if (typeof body?.csv !== "string") return NextResponse.json({ error: "Paste a CSV file to import" }, { status: 400 });
  try {
    const schema = (await getContactWorkspace(auth.context.tenantId, auth.context.userId)).fieldSchema;
    const rows = parseContactCsv(body.csv, schema);
    const results = [];
    for (const row of rows) {
      const result = await createContact(auth.context.tenantId, auth.context.userId, row);
      results.push({ id: result.contact.id, outcome: result.outcome, duplicateCount: result.duplicates.length });
      await audit({ actorType: "tenant", actorId: auth.context.userId, action: "tenant.contact_imported", targetType: "contact", targetId: result.contact.id, metadata: { outcome: result.outcome, duplicateCount: result.duplicates.length }, request });
      if (result.mergeId) await audit({ actorType: "tenant", actorId: auth.context.userId, action: "tenant.contact_merged", targetType: "merge", targetId: result.mergeId, metadata: { outcome: result.outcome }, request });
    }
    return NextResponse.json({ imported: results.length, results }, { status: 201 });
  } catch (error) { return NextResponse.json({ error: error instanceof Error ? error.message : "Could not import contacts" }, { status: 400 }); }
}
