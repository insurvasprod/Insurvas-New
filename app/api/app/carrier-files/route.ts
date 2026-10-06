import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";

import { audit } from "@/lib/audit/log";
import { FILE_TYPES, MAX_UPLOAD_BYTES, carrierFileBytesMatch, carrierFileKind } from "@/lib/ingestion/constants";
import { isRecordUuid, isoDate } from "@/lib/ingestion/path";
import { CARRIER_FILES_PENDING_MESSAGE, CarrierFileError, listCarrierFiles, uploadCarrierFile } from "@/lib/ingestion/registry";
import { requireFeatureRole } from "@/lib/tenantAuth/requireFeatureRole";

/**
 * LA-4.1 (Notion sprint) · carrier files: the registry the agency sees, and the upload door.
 *
 * GET lists the agency's files (every door, newest first) and the duplicates that were skipped.
 * POST is the upload door: multipart `file`, `carrier_id`, `file_type` (policies | commissions),
 * `file_date` (YYYY-MM-DD) and an optional `agency`. The four facts come from the form, never from
 * the file. The file is registered whether or not it opens; one that does not is `failed`, with why.
 *
 * Owner and bookkeeper, as statements. Uploading is a write.
 */
const roles = ["owner", "bookkeeper"] as const;

const formSchema = z.object({
  carrier_id: z.string().refine(isRecordUuid, "Choose the carrier."),
  file_type: z.enum(FILE_TYPES, { message: "Choose whether this is a policy file or a commission file." }),
  file_date: z.string().refine((value) => isoDate(value) !== null, "Enter the file's date."),
  agency: z.string().trim().max(120).optional(),
});

function failure(error: unknown, fallback: string) {
  if (error instanceof CarrierFileError) return NextResponse.json({ error: error.message, code: error.code }, { status: error.status });
  console.error(`[carrier-files] ${fallback}:`, error);
  return NextResponse.json({ error: fallback }, { status: 500 });
}

export async function GET() {
  const auth = await requireFeatureRole("statement_ingestion", roles);
  if (auth instanceof NextResponse) return auth;
  try {
    const list = await listCarrierFiles(auth.context.tenantId);
    return NextResponse.json({ ok: true, ...list, message: list.available ? null : CARRIER_FILES_PENDING_MESSAGE }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return failure(error, "Could not load carrier files");
  }
}

export async function POST(request: NextRequest) {
  const auth = await requireFeatureRole("statement_ingestion", roles, { write: true });
  if (auth instanceof NextResponse) return auth;

  const form = await request.formData().catch(() => null);
  if (!form) return NextResponse.json({ error: "The file could not be read from the upload; try again." }, { status: 400 });
  const file = form.get("file");
  if (!(file instanceof File)) return NextResponse.json({ error: "Choose a file to upload." }, { status: 400 });
  const kind = carrierFileKind(file);
  if (!kind) return NextResponse.json({ error: "Choose a CSV, an Excel (.xlsx) or a PDF file." }, { status: 400 });
  if (file.size <= 0) return NextResponse.json({ error: "That file is empty." }, { status: 400 });
  if (file.size > MAX_UPLOAD_BYTES) return NextResponse.json({ error: `That file is larger than ${MAX_UPLOAD_BYTES / 1_000_000} MB. Have it dropped into the agency's bucket instead, or split it.` }, { status: 400 });

  const fields = formSchema.safeParse({
    carrier_id: form.get("carrier_id") ?? "",
    file_type: form.get("file_type") ?? "",
    file_date: form.get("file_date") ?? "",
    agency: (form.get("agency") as string | null) || undefined,
  });
  if (!fields.success) return NextResponse.json({ error: fields.error.issues[0]?.message ?? "Check the form and try again." }, { status: 400 });

  const bytes = new Uint8Array(await file.arrayBuffer());
  // The upload door refuses a file that is not what its name says before storing anything; the
  // bucket and email doors register such a file as failed instead, since nobody is there to tell.
  if (!carrierFileBytesMatch(kind, bytes.subarray(0, 1024))) {
    return NextResponse.json({ error: kind === "csv" ? "That file is not plain text, so it cannot be read as a CSV." : `That file is not the ${kind === "pdf" ? "PDF" : "Excel workbook"} its name says it is.` }, { status: 400 });
  }

  try {
    const result = await uploadCarrierFile(auth.context.tenantId, auth.context.userId, {
      filename: file.name,
      contentType: file.type || null,
      bytes,
      carrierId: fields.data.carrier_id,
      fileType: fields.data.file_type,
      fileDate: fields.data.file_date,
      agency: fields.data.agency || null,
    });
    await audit({
      actorType: "tenant",
      actorId: auth.context.userId,
      action: result.outcome === "skipped" ? "tenant.carrier_file_skipped" : "tenant.carrier_file_received",
      targetType: "carrier_file",
      targetId: result.fileId,
      metadata: { tenantId: auth.context.tenantId, source: "upload", fileType: fields.data.file_type, fileDate: fields.data.file_date, carrierId: fields.data.carrier_id, status: result.outcome === "registered" ? result.status : "skipped", supersededFileId: result.outcome === "registered" ? result.supersededFileId : null },
      request,
    });
    return NextResponse.json({ ok: true, ...result }, { status: result.outcome === "registered" ? 201 : 200 });
  } catch (error) {
    return failure(error, "The file could not be uploaded");
  }
}
