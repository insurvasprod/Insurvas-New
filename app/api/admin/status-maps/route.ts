import { NextResponse, after, type NextRequest } from "next/server";
import { z } from "zod";

import { resolveAdminContext } from "@/lib/adminAuth/requireAdminRole";
import { audit } from "@/lib/audit/log";
import { isId, layoutAdmin } from "@/lib/ingestion/layoutAdminHttp";
import { listStatusQueue, mapAndApproveStatus, reprocessHeld, StatusMapError } from "@/lib/ingestion/statusAdmin";
import { FILE_TYPES } from "@/lib/ingestion/constants";
import { STATUS_VOCABULARY } from "@/lib/ingestion/statuses";

/**
 * LA-4.5 · the unknown-status queue (gathered across agencies) and the status map, for staff.
 * POST maps one carrier word — exactly as given, never trimmed — and approves it; the files whose
 * rows were held are reprocessed after the response. Same access rule as the carrier library.
 */
const mapSchema = z.object({
  carrier_id: z.string().refine(isId, "Choose the carrier."),
  file_type: z.enum(FILE_TYPES),
  // Not trimmed: "ACTIVE " is a different word from "ACTIVE".
  carrier_status_raw: z.string().min(1).max(200),
  status_normalized: z.enum(STATUS_VOCABULARY),
  notes: z.string().trim().max(1000).nullable().optional(),
}).strict();

function failure(error: unknown) {
  if (error instanceof StatusMapError) return NextResponse.json({ error: error.message }, { status: error.status });
  console.error("[status-maps]", error);
  return NextResponse.json({ error: "Something went wrong with the status map. Try again." }, { status: 500 });
}

export async function GET() {
  const scope = layoutAdmin(await resolveAdminContext());
  if (scope instanceof NextResponse) return scope;
  try {
    return NextResponse.json(await listStatusQueue(), { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return failure(error);
  }
}

export async function POST(request: NextRequest) {
  const scope = layoutAdmin(await resolveAdminContext());
  if (scope instanceof NextResponse) return scope;
  const body = mapSchema.safeParse(await request.json().catch(() => null));
  if (!body.success) return NextResponse.json({ error: body.error.issues[0]?.message ?? "Choose a carrier word and a status." }, { status: 400 });
  try {
    const result = await mapAndApproveStatus(scope.adminId, { carrierId: body.data.carrier_id, fileType: body.data.file_type, raw: body.data.carrier_status_raw, status: body.data.status_normalized, notes: body.data.notes ?? null });
    await audit({ actorType: "admin", actorId: scope.adminId, action: "status_map.approved", targetType: "carrier_status_map", targetId: result.mapId, metadata: { carrierId: body.data.carrier_id, fileType: body.data.file_type, raw: body.data.carrier_status_raw, status: body.data.status_normalized, heldFiles: result.files.length }, request });
    if (result.files.length) {
      after(async () => {
        const outcome = await reprocessHeld(result.files);
        if (outcome.failed) console.error(`[status-maps] ${outcome.failed} of ${result.files.length} held file(s) did not reprocess; a manual reprocess retries.`);
      });
    }
    return NextResponse.json({ ok: true, mapId: result.mapId, heldFiles: result.files.length }, { status: 201 });
  } catch (error) {
    return failure(error);
  }
}
