import { NextResponse, after, type NextRequest } from "next/server";
import { z } from "zod";

import { audit } from "@/lib/audit/log";
import { FILE_TYPES, carrierFileBytesMatch, carrierFileKind } from "@/lib/ingestion/constants";
import { runArrival } from "@/lib/ingestion/dailyRunStore";
import { processFileQuietly } from "@/lib/ingestion/parser";
import { isRecordUuid, isoDate } from "@/lib/ingestion/path";
import { extractRawRows } from "@/lib/ingestion/rawLayer";
import { CarrierFileError, readCarrierFileOriginal, uploadCarrierFile } from "@/lib/ingestion/registry";
import { StorageNotFoundError } from "@/lib/ingestion/storage";
import { requireFeatureRole } from "@/lib/tenantAuth/requireFeatureRole";

/**
 * Owner request 2026-10-14 · "Who sent this?": a person tells a file that arrived without a carrier
 * (an email from an unknown sender, a bucket drop in a folder no carrier is named) its carrier, type
 * and date. Notion LA-4.1 attributes automatic files by their path without opening them; the file
 * checker (lib/ingestion/fileCheck.ts) only SUGGESTS who sent it, and this is where a person CONFIRMS.
 *
 * The stored bytes go through the upload door again with the three facts, so the database's
 * awaiting-carrier path (register_carrier_file, 20261009210000) updates the failed file in place:
 * its name, source and arrival stay as they were, nothing is stored twice, and it is then read like
 * a new arrival. Only a file that failed for want of its carrier and was never read can be told.
 *
 * Owner and bookkeeper; a write, so a read-only account may not.
 */
const roles = ["owner", "bookkeeper"] as const;

const bodySchema = z.object({
  carrier_id: z.string().refine(isRecordUuid, "Choose the carrier."),
  file_type: z.enum(FILE_TYPES, { message: "Choose whether this is a policy file or a commission file." }),
  file_date: z.string().refine((value) => isoDate(value) !== null, "Enter the file's date."),
});

export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireFeatureRole("statement_ingestion", roles, { write: true });
  if (auth instanceof NextResponse) return auth;
  const { id } = await params;
  if (!isRecordUuid(id)) return NextResponse.json({ error: "That file is not in this workspace." }, { status: 404 });

  const fields = bodySchema.safeParse(await request.json().catch(() => ({})));
  if (!fields.success) return NextResponse.json({ error: fields.error.issues[0]?.message ?? "Check the form and try again." }, { status: 400 });

  try {
    const file = await readCarrierFileOriginal(auth.context.tenantId, id);
    if (file.carrierId !== null || file.status !== "failed" || file.rawExtractedAt !== null) {
      return NextResponse.json({ error: "This file already has its carrier, so it can't be given another one here.", code: "not_awaiting_carrier" }, { status: 409 });
    }
    // A file that does not open would only fail again: say so instead of trying.
    const kind = carrierFileKind({ name: file.originalFilename, type: file.contentType });
    if (!kind || !carrierFileBytesMatch(kind, file.bytes.subarray(0, 2048))) {
      return NextResponse.json({ error: "This file can't be read as a CSV, Excel file or PDF, so giving it a carrier would not help. Ask the carrier to send it again.", code: "unreadable" }, { status: 409 });
    }

    const result = await uploadCarrierFile(auth.context.tenantId, auth.context.userId, {
      filename: file.originalFilename,
      contentType: file.contentType,
      bytes: file.bytes,
      carrierId: fields.data.carrier_id,
      fileType: fields.data.file_type,
      fileDate: fields.data.file_date,
      agency: null,
    });
    const attributed = result.outcome === "registered" && result.fileId === id && result.status === "received";
    await audit({
      actorType: "tenant",
      actorId: auth.context.userId,
      action: "tenant.carrier_file_attributed",
      targetType: "carrier_file",
      targetId: id,
      metadata: { tenantId: auth.context.tenantId, carrierId: fields.data.carrier_id, fileType: fields.data.file_type, fileDate: fields.data.file_date, outcome: attributed ? "attributed" : result.outcome, supersededFileId: result.outcome === "registered" ? result.supersededFileId : null },
      request,
    });
    if (!attributed) {
      const why = result.outcome === "registered" && result.errorDetail ? ` ${result.errorDetail}` : "";
      return NextResponse.json({ error: `The file could not be given its carrier.${why}`, code: "not_attributed" }, { status: 409 });
    }
    // Read like a new arrival, after the response, as the upload door does.
    const { tenantId } = auth.context;
    after(() => runArrival(tenantId, id, () => processFileQuietly(tenantId, id, extractRawRows)));
    return NextResponse.json({ ok: true, fileId: id, supersededFileId: result.supersededFileId });
  } catch (error) {
    if (error instanceof CarrierFileError) return NextResponse.json({ error: error.message, code: error.code }, { status: error.status });
    if (error instanceof StorageNotFoundError) return NextResponse.json({ error: "The original file is no longer in storage." }, { status: 404 });
    console.error("[carrier-files] attribute:", error);
    return NextResponse.json({ error: "The file could not be given its carrier" }, { status: 500 });
  }
}
