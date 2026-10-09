import { NextResponse, after, type NextRequest } from "next/server";
import { z } from "zod";

import { audit } from "@/lib/audit/log";
import { BOOK_IMPORT_PENDING_MESSAGE, BookImportError, loadBookImport, setSkipped, uploadForImport } from "@/lib/ingestion/bookImport";
import { MAX_UPLOAD_BYTES, carrierFileBytesMatch, carrierFileKind } from "@/lib/ingestion/constants";
import { runArrival } from "@/lib/ingestion/dailyRunStore";
import { processFileQuietly } from "@/lib/ingestion/parser";
import { isRecordUuid, isoDate } from "@/lib/ingestion/path";
import { extractRawRows } from "@/lib/ingestion/rawLayer";
import { CarrierFileError } from "@/lib/ingestion/registry";
import { requireFeatureRole } from "@/lib/tenantAuth/requireFeatureRole";

/**
 * LA-4.10 (Notion sprint) · importing the agency's existing book. GET: the carriers to import, each
 * with its portal guidance, what its file produced, and the running total. POST multipart: one
 * carrier's most recent policy file, through the LA-4.1 upload door, marked as an initial import and
 * processed straight away. POST JSON: skip a carrier, or take the skip back.
 *
 * Owner and bookkeeper, as carrier files (the results carry premiums).
 */
const roles = ["owner", "bookkeeper"] as const;

const skipBody = z.object({ action: z.enum(["skip", "unskip"]), carrier_id: z.string().refine(isRecordUuid, "Choose the carrier.") }).strict();

function failure(error: unknown, fallback: string) {
  if (error instanceof BookImportError) return NextResponse.json({ error: error.message }, { status: error.status });
  if (error instanceof CarrierFileError) return NextResponse.json({ error: error.message, code: error.code }, { status: error.status });
  console.error(`[book-import] ${fallback}:`, error);
  return NextResponse.json({ error: fallback }, { status: 500 });
}

export async function GET() {
  const auth = await requireFeatureRole("statement_ingestion", roles);
  if (auth instanceof NextResponse) return auth;
  try {
    const view = await loadBookImport(auth.context.tenantId);
    return NextResponse.json({ ok: true, ...view, message: view.available ? null : BOOK_IMPORT_PENDING_MESSAGE }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return failure(error, "Could not load the import");
  }
}

export async function POST(request: NextRequest) {
  const auth = await requireFeatureRole("statement_ingestion", roles, { write: true });
  if (auth instanceof NextResponse) return auth;
  const { tenantId, userId } = auth.context;

  if ((request.headers.get("content-type") ?? "").includes("application/json")) {
    const body = skipBody.safeParse(await request.json().catch(() => null));
    if (!body.success) return NextResponse.json({ error: body.error.issues[0]?.message ?? "Check the request and try again." }, { status: 400 });
    try {
      await setSkipped(tenantId, userId, body.data.carrier_id, body.data.action === "skip");
      await audit({ actorType: "tenant", actorId: userId, action: body.data.action === "skip" ? "book_import.carrier_skipped" : "book_import.carrier_unskipped", targetType: "carrier", targetId: body.data.carrier_id, metadata: { tenantId }, request });
      return NextResponse.json({ ok: true });
    } catch (error) {
      return failure(error, "That could not be saved");
    }
  }

  const form = await request.formData().catch(() => null);
  if (!form) return NextResponse.json({ error: "The file could not be read from the upload; try again." }, { status: 400 });
  const file = form.get("file");
  if (!(file instanceof File)) return NextResponse.json({ error: "Choose a file to upload." }, { status: 400 });
  const kind = carrierFileKind(file);
  if (!kind || kind === "pdf") return NextResponse.json({ error: "Choose the carrier's policy file as a CSV or an Excel (.xlsx or .xls) file." }, { status: 400 });
  if (file.size <= 0) return NextResponse.json({ error: "That file is empty." }, { status: 400 });
  if (file.size > MAX_UPLOAD_BYTES) return NextResponse.json({ error: `That file is larger than ${MAX_UPLOAD_BYTES / 1_000_000} MB.` }, { status: 400 });
  const carrierId = String(form.get("carrier_id") ?? "");
  const fileDate = String(form.get("file_date") ?? "");
  if (!isRecordUuid(carrierId)) return NextResponse.json({ error: "Choose the carrier." }, { status: 400 });
  if (isoDate(fileDate) === null) return NextResponse.json({ error: "Enter the file's date." }, { status: 400 });
  const bytes = new Uint8Array(await file.arrayBuffer());
  if (!carrierFileBytesMatch(kind, bytes.subarray(0, 1024))) return NextResponse.json({ error: kind === "csv" ? "That file is not plain text, so it cannot be read as a CSV." : "That file is not the Excel workbook its name says it is." }, { status: 400 });

  try {
    const result = await uploadForImport(tenantId, userId, { filename: file.name, contentType: file.type || null, bytes, carrierId, fileDate, agency: null });
    await audit({ actorType: "tenant", actorId: userId, action: result.outcome === "skipped" ? "tenant.carrier_file_skipped" : "tenant.carrier_file_received", targetType: "carrier_file", targetId: result.fileId, metadata: { tenantId, source: "upload", fileType: "policies", fileDate, carrierId, initialImport: true, status: result.outcome === "registered" ? result.status : "skipped" }, request });
    // Parsed straight after the response, so the screen can show this carrier's result in seconds.
    if (result.outcome === "registered" && result.status === "received") after(() => runArrival(tenantId, result.fileId, () => processFileQuietly(tenantId, result.fileId, extractRawRows)));
    return NextResponse.json({ ok: true, ...result }, { status: result.outcome === "registered" ? 201 : 200 });
  } catch (error) {
    return failure(error, "The file could not be uploaded");
  }
}
