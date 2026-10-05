import { NextResponse, type NextRequest } from "next/server";

import { isRecordId, statementFailure } from "@/lib/ledger/statementHttp";
import { statementFileUrl } from "@/lib/ledger/statementService";
import { requireFeatureRole } from "@/lib/tenantAuth/requireFeatureRole";

/**
 * Money boundary (LA-4.1): a 60-second link to one statement's original file — the carrier's CSV,
 * workbook or PDF exactly as it was imported. `?download=1` asks for a link that saves the file
 * under its original name. Reading, so a read-only account may still open it.
 *
 * Owner and bookkeeper only, the two roles that hold `statements.view`.
 */
const roles = ["owner", "bookkeeper"] as const;

export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireFeatureRole("statement_ingestion", roles);
  if (auth instanceof NextResponse) return auth;
  const { id } = await params;
  if (!isRecordId(id)) return NextResponse.json({ error: "That statement is not in this workspace" }, { status: 404 });
  try {
    const file = await statementFileUrl(auth.context.tenantId, id, { download: request.nextUrl.searchParams.get("download") === "1" });
    return NextResponse.json({ ok: true, ...file }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return statementFailure(error, "Could not open the statement file");
  }
}
