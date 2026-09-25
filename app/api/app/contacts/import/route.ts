import { NextResponse, type NextRequest } from "next/server";

import { audit } from "@/lib/audit/log";
import { parseContactCsv } from "@/lib/contacts/csv";
import { createContact, fieldSchemaForTenant } from "@/lib/contacts/service";
import { requireFeatureRole } from "@/lib/tenantAuth/requireFeatureRole";

const CONTACT_ROLES = ["owner", "producer", "assistant"] as const;

/**
 * Each row goes through the same createContact as "Add contact": confident matches auto-merge,
 * medium and high ones are queued for review. A row that fails is reported and the rest carry on;
 * one bad row used to stop the import there, with the rows before it already saved.
 */
export async function POST(request: NextRequest) {
  const auth = await requireFeatureRole("duplicate_detection", CONTACT_ROLES, { write: true });
  if (auth instanceof NextResponse) return auth;
  const body = await request.json().catch(() => null) as { csv?: unknown } | null;
  if (typeof body?.csv !== "string") return NextResponse.json({ error: "Paste a CSV file to import" }, { status: 400 });
  let rows;
  let schema;
  try {
    schema = await fieldSchemaForTenant(auth.context.tenantId, auth.context.userId);
    rows = parseContactCsv(body.csv, schema);
  } catch (error) { return NextResponse.json({ error: error instanceof Error ? error.message : "Could not import contacts" }, { status: 400 }); }

  const results: Array<{ id: string; outcome: string; duplicateCount: number }> = [];
  const failed: Array<{ row: number; error: string }> = [];
  let autoMerged = 0;
  let queued = 0;
  let reviewsReady = true;
  for (const [index, row] of rows.entries()) {
    try {
      const result = await createContact(auth.context.tenantId, auth.context.userId, row, { schema });
      results.push({ id: result.contact.id, outcome: result.outcome, duplicateCount: result.duplicates.length });
      if (result.outcome === "auto_merged") autoMerged += 1;
      queued += result.queued;
      reviewsReady &&= result.reviewsReady;
      await audit({ actorType: "tenant", actorId: auth.context.userId, action: "tenant.contact_imported", targetType: "contact", targetId: result.contact.id, metadata: { outcome: result.outcome, duplicateCount: result.duplicates.length, queued: result.queued }, request });
      if (result.mergeId) await audit({ actorType: "tenant", actorId: auth.context.userId, action: "tenant.contact_merged", targetType: "merge", targetId: result.mergeId, metadata: { outcome: result.outcome, source: "auto" }, request });
    } catch (error) {
      // Row numbers count the header as row 1, as a spreadsheet does.
      failed.push({ row: index + 2, error: error instanceof Error ? error.message : "Could not import this row" });
    }
  }
  if (!results.length && failed.length) return NextResponse.json({ error: `No contacts were imported. Row ${failed[0].row}: ${failed[0].error}`, failed: failed.slice(0, 20), failedCount: failed.length }, { status: 400 });
  return NextResponse.json({ imported: results.length, autoMerged, queued, reviewsReady, results, failed: failed.slice(0, 20), failedCount: failed.length }, { status: 201 });
}
