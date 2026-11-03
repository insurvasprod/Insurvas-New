import { NextResponse, type NextRequest } from "next/server";

import { audit } from "@/lib/audit/log";
import { isRecordUuid } from "@/lib/ingestion/path";
import { CarrierFileError, carrierFileDownloadUrl } from "@/lib/ingestion/registry";
import { requireFeatureRole } from "@/lib/tenantAuth/requireFeatureRole";

/**
 * LA-4.1 (Notion sprint) · a sixty-second link to one original carrier file, named as received.
 * Reading, so a read-only account may. Every download is recorded (who, which file): carrier files
 * carry names, policy numbers and sometimes partial SSNs (Notion LA-4.20).
 */
const roles = ["owner", "bookkeeper"] as const;

export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireFeatureRole("statement_ingestion", roles);
  if (auth instanceof NextResponse) return auth;
  const { id } = await params;
  if (!isRecordUuid(id)) return NextResponse.json({ error: "That file is not in this workspace." }, { status: 404 });
  try {
    const url = await carrierFileDownloadUrl(auth.context.tenantId, id);
    await audit({ actorType: "tenant", actorId: auth.context.userId, action: "tenant.carrier_file_downloaded", targetType: "carrier_file", targetId: id, metadata: { tenantId: auth.context.tenantId }, request });
    return NextResponse.json({ ok: true, url }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    if (error instanceof CarrierFileError) return NextResponse.json({ error: error.message, code: error.code }, { status: error.status });
    console.error("[carrier-files] download link:", error);
    return NextResponse.json({ error: "A download link could not be made" }, { status: 500 });
  }
}
