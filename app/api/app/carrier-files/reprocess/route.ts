import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";

import { audit } from "@/lib/audit/log";
import { isRecordUuid, isoDate } from "@/lib/ingestion/path";
import { REPROCESS_STAGES, listReprocessRuns, reprocessCarrierFiles } from "@/lib/ingestion/reprocessRuns";
import { requireFeatureRole } from "@/lib/tenantAuth/requireFeatureRole";

/**
 * LA-4.2 (Notion sprint) · reprocessing carrier files from their raw rows.
 *
 *   GET   the agency's recent reprocess runs (trigger, scope, parser version, files, rows, result).
 *   POST  { file_id } or { carrier_id, from, to } — rebuild every layer above the raw rows for those
 *         files. Nothing is uploaded again and no raw row changes; the run is recorded either way.
 *
 * Owner and bookkeeper; starting a run is a write.
 */
const roles = ["owner", "bookkeeper"] as const;

const bodySchema = z.union([
  z.object({ file_id: z.string().refine(isRecordUuid, "Choose the file.") }).strict(),
  z.object({
    carrier_id: z.string().refine(isRecordUuid, "Choose the carrier."),
    from: z.string().refine((value) => isoDate(value) !== null, "Enter the first file date."),
    to: z.string().refine((value) => isoDate(value) !== null, "Enter the last file date."),
  }).strict().refine((value) => value.from <= value.to, "The first date comes before the last."),
]);

export async function GET() {
  const auth = await requireFeatureRole("statement_ingestion", roles);
  if (auth instanceof NextResponse) return auth;
  try {
    const runs = await listReprocessRuns(auth.context.tenantId);
    return NextResponse.json({ ok: true, ...runs, stages: REPROCESS_STAGES.map((stage) => stage.name) }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    console.error("[carrier-files/reprocess] list:", error);
    return NextResponse.json({ error: "Could not load reprocess runs" }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  const auth = await requireFeatureRole("statement_ingestion", roles, { write: true });
  if (auth instanceof NextResponse) return auth;
  const body = bodySchema.safeParse(await request.json().catch(() => null));
  if (!body.success) return NextResponse.json({ error: body.error.issues[0]?.message ?? "Choose a file, or a carrier and dates." }, { status: 400 });
  const scope = "file_id" in body.data
    ? { kind: "file" as const, fileId: body.data.file_id }
    : { kind: "carrier" as const, carrierId: body.data.carrier_id, from: body.data.from, to: body.data.to };
  try {
    const result = await reprocessCarrierFiles(auth.context.tenantId, auth.context.userId, scope, "manual");
    await audit({
      actorType: "tenant",
      actorId: auth.context.userId,
      action: "tenant.carrier_files_reprocessed",
      targetType: "reprocess_run",
      targetId: result.runId,
      metadata: { tenantId: auth.context.tenantId, scope, status: result.status, files: result.fileIds.length, rowsRead: result.rowsRead, rowsChanged: result.rowsChanged },
      request,
    });
    return NextResponse.json({ ok: true, ...result }, { status: result.status === "succeeded" ? 200 : 500 });
  } catch (error) {
    console.error("[carrier-files/reprocess] run:", error);
    return NextResponse.json({ error: "The reprocess could not run" }, { status: 500 });
  }
}
