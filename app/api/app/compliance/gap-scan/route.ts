import { NextResponse, type NextRequest } from "next/server";

import { bookGapScan, EvidenceError, mayGenerateReports } from "@/lib/compliance/evidenceReport";
import { evidenceRange } from "@/lib/compliance/evidenceRange";
import { requireFeatureRole } from "@/lib/tenantAuth/requireFeatureRole";

/**
 * LA-6.3 (Notion sprint) · the book-wide gap scan: the evidence report's eight gap checks across the
 * whole book, as a summary, with the numbers behind each line. Same roles as the report. Logged.
 */
const ROLES = ["owner", "producer"] as const;

export async function GET(request: NextRequest) {
  const auth = await requireFeatureRole("litigation_packet", ROLES);
  if (auth instanceof NextResponse) return auth;
  const range = evidenceRange(request.nextUrl.searchParams.get("from"), request.nextUrl.searchParams.get("to"));
  if ("error" in range) return NextResponse.json({ error: range.error }, { status: 400 });
  const { tenantId, userId, role } = auth.context;
  if (!(await mayGenerateReports(tenantId, role))) return NextResponse.json({ error: "Your agency has not allowed your role to generate compliance reports." }, { status: 403 });
  try {
    return NextResponse.json(await bookGapScan({ tenantId, userId, role }, range), { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    if (error instanceof EvidenceError) return NextResponse.json({ error: error.message }, { status: error.status });
    console.error("[gap-scan]", error);
    return NextResponse.json({ error: "The scan could not be run" }, { status: 500 });
  }
}
