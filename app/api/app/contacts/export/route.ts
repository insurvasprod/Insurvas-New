import { NextResponse } from "next/server";

import { csvContactFields } from "@/lib/contacts/csv";
import { fieldSchemaForTenant, streamContactsCsv } from "@/lib/contacts/service";
import { requireFeatureRole } from "@/lib/tenantAuth/requireFeatureRole";

/** Every active contact, streamed (the directory's page size does not apply). */
export async function GET() {
  const auth = await requireFeatureRole("duplicate_detection", ["owner", "producer", "assistant"] as const);
  if (auth instanceof NextResponse) return auth;
  try {
    // Read before the stream starts, so a failure here is still an ordinary error response.
    const fields = csvContactFields(await fieldSchemaForTenant(auth.context.tenantId, auth.context.userId));
    return new NextResponse(streamContactsCsv(auth.context.tenantId, fields), { headers: { "Content-Type": "text/csv; charset=utf-8", "Content-Disposition": "attachment; filename=contacts.csv", "Cache-Control": "no-store" } });
  } catch (error) { return NextResponse.json({ error: error instanceof Error ? error.message : "Could not export contacts" }, { status: 500 }); }
}
