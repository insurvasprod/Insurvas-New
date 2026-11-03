import { NextResponse, type NextRequest } from "next/server";

import { audit } from "@/lib/audit/log";
import { loadFileHead, loadFileRows, problemRows } from "@/lib/ingestion/fileOutcomeStore";
import { ROW_OUTCOMES, ROW_OUTCOME_LABELS, toCsv, type RowOutcome } from "@/lib/ingestion/fileStages";
import { isRecordUuid } from "@/lib/ingestion/path";
import { listCarrierFiles } from "@/lib/ingestion/registry";
import { requireFeatureRole } from "@/lib/tenantAuth/requireFeatureRole";

/**
 * Book of business › Files (round 2, owner 2026-11-02) · rows as a CSV, read-only.
 *
 *   no file   Download problem rows: every row that waits on a person or is held, across the agency's
 *             current files (and each file that failed, as one line).
 *   ?file=    one file's Rows › Export rows: every row and what it came to, or one outcome (?outcome=).
 *
 * Owner and bookkeeper, as the file itself; every export is recorded like a download (the rows carry
 * policy numbers and client names).
 */
const roles = ["owner", "bookkeeper"] as const;

const csvResponse = (body: string, name: string) =>
  new NextResponse(body, { headers: { "Content-Type": "text/csv; charset=utf-8", "Content-Disposition": `attachment; filename="${name.replace(/[^\w.-]+/g, "_")}"`, "Cache-Control": "no-store" } });

export async function GET(request: NextRequest) {
  const auth = await requireFeatureRole("statement_ingestion", roles);
  if (auth instanceof NextResponse) return auth;
  const { tenantId, userId } = auth.context;
  const fileId = request.nextUrl.searchParams.get("file");
  const asked = request.nextUrl.searchParams.get("outcome");
  const outcome = (ROW_OUTCOMES as readonly string[]).includes(asked ?? "") ? (asked as RowOutcome) : null;
  try {
    if (fileId) {
      if (!isRecordUuid(fileId)) return NextResponse.json({ error: "That file is not in this workspace." }, { status: 404 });
      const head = await loadFileHead(tenantId, fileId);
      if (!head) return NextResponse.json({ error: "That file is not in this workspace." }, { status: 404 });
      const rows = (await loadFileRows(tenantId, fileId))?.rows ?? [];
      const shown = outcome ? rows.filter((row) => row.outcome === outcome) : rows;
      await audit({ actorType: "tenant", actorId: userId, action: "tenant.carrier_file_downloaded", targetType: "carrier_file", targetId: fileId, metadata: { tenantId, export: "rows", outcome, rows: shown.length }, request });
      return csvResponse(
        toCsv(["Row", "Policy", "Client", "Outcome", "What changed", "Linked", "Card moved"], shown.map((row) => [row.rowNumber, row.policyNumber, row.clientName, ROW_OUTCOME_LABELS[row.outcome], row.what, row.linkedBy, row.card ? `${row.card.from ?? "—"} → ${row.card.to}` : null])),
        `${head.name.replace(/\.[^.]+$/, "")}-rows${outcome ? `-${outcome}` : ""}.csv`,
      );
    }
    const list = await listCarrierFiles(tenantId);
    if (!list.available) return NextResponse.json({ error: "Carrier files are not available yet." }, { status: 503 });
    const rows = await problemRows(tenantId, list.files);
    await audit({ actorType: "tenant", actorId: userId, action: "tenant.carrier_file_downloaded", targetType: "carrier_file", metadata: { tenantId, export: "problem_rows", rows: rows.length }, request });
    return csvResponse(
      toCsv(["File", "Carrier", "File date", "Row", "Policy", "Outcome", "Why"], rows.map((row) => [row.file, row.carrier, row.fileDate, row.rowNumber, row.policyNumber, row.outcome, row.why])),
      `problem-rows-${new Date().toISOString().slice(0, 10)}.csv`,
    );
  } catch (error) {
    console.error("[carrier-files] rows export:", error);
    return NextResponse.json({ error: "The rows could not be exported." }, { status: 500 });
  }
}
