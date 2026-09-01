import { NextResponse } from "next/server";

import { csvForContacts } from "@/lib/contacts/csv";
import { getContactWorkspace } from "@/lib/contacts/service";
import { requireFeatureRole } from "@/lib/tenantAuth/requireFeatureRole";

export async function GET() {
  const auth = await requireFeatureRole("duplicate_detection", ["owner", "producer", "assistant"] as const);
  if (auth instanceof NextResponse) return auth;
  try {
    const workspace = await getContactWorkspace(auth.context.tenantId, auth.context.userId);
    return new NextResponse(csvForContacts(workspace.fieldSchema, workspace.contacts), { headers: { "Content-Type": "text/csv; charset=utf-8", "Content-Disposition": "attachment; filename=contacts.csv", "Cache-Control": "no-store" } });
  } catch (error) { return NextResponse.json({ error: error instanceof Error ? error.message : "Could not export contacts" }, { status: 500 }); }
}
