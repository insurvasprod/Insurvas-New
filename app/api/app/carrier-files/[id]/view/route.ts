import { NextResponse, type NextRequest } from "next/server";

import { audit } from "@/lib/audit/log";
import { FILE_KIND_CONTENT_TYPE } from "@/lib/ingestion/constants";
import { isRecordUuid } from "@/lib/ingestion/path";
import { CarrierFileError, readCarrierFileOriginal } from "@/lib/ingestion/registry";
import { StorageNotFoundError } from "@/lib/ingestion/storage";
import { requireFeatureRole } from "@/lib/tenantAuth/requireFeatureRole";

/**
 * Owner request 2026-10-14 · one original carrier file, shown inside the software (the whole-file
 * page embeds a PDF from here) rather than downloaded: its stored bytes, inline, never cached.
 * Reading, so a read-only account may. Every view is recorded (who, which file), as a download is:
 * carrier files carry names, policy numbers and sometimes partial SSNs (Notion LA-4.20).
 */
const roles = ["owner", "bookkeeper"] as const;

/** A header-safe file name: plain ASCII in `filename`, the real name in `filename*`. */
function disposition(name: string): string {
  const ascii = name.replace(/[^\x20-\x7e]/g, "_").replace(/["\\]/g, "_");
  return `inline; filename="${ascii}"; filename*=UTF-8''${encodeURIComponent(name)}`;
}

export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireFeatureRole("statement_ingestion", roles);
  if (auth instanceof NextResponse) return auth;
  const { id } = await params;
  if (!isRecordUuid(id)) return NextResponse.json({ error: "That file is not in this workspace." }, { status: 404 });
  try {
    const file = await readCarrierFileOriginal(auth.context.tenantId, id);
    await audit({ actorType: "tenant", actorId: auth.context.userId, action: "tenant.carrier_file_viewed", targetType: "carrier_file", targetId: id, metadata: { tenantId: auth.context.tenantId }, request });
    return new NextResponse(file.bytes.slice().buffer as ArrayBuffer, {
      headers: {
        "Content-Type": file.fileKind ? FILE_KIND_CONTENT_TYPE[file.fileKind] : "application/octet-stream",
        "Content-Disposition": disposition(file.originalFilename),
        "Content-Length": String(file.bytes.byteLength),
        "Cache-Control": "no-store",
        "X-Content-Type-Options": "nosniff",
        // Shown only inside this app's own pages.
        "Content-Security-Policy": "frame-ancestors 'self'",
      },
    });
  } catch (error) {
    if (error instanceof CarrierFileError) return NextResponse.json({ error: error.message, code: error.code }, { status: error.status });
    if (error instanceof StorageNotFoundError) return NextResponse.json({ error: "The original file is no longer in storage." }, { status: 404 });
    console.error("[carrier-files] view:", error);
    return NextResponse.json({ error: "The file could not be shown" }, { status: 500 });
  }
}
