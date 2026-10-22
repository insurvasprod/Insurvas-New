import { NextResponse } from "next/server";

import { disputePdf } from "@/lib/ingestion/discrepancyStore";
import { isRecordUuid } from "@/lib/ingestion/path";
import { requireFeatureRole } from "@/lib/tenantAuth/requireFeatureRole";

/** LA-4.15 · a dispute letter as a PDF, exactly as drafted, for the agent to send himself. Owner and bookkeeper. */
export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireFeatureRole("discrepancy_report", ["owner", "bookkeeper"] as const);
  if (auth instanceof NextResponse) return auth;
  const { id } = await params;
  if (!isRecordUuid(id)) return NextResponse.json({ error: "No such letter." }, { status: 404 });
  const pdf = await disputePdf(auth.context.tenantId, id);
  if (!pdf) return NextResponse.json({ error: "No such letter." }, { status: 404 });
  return new NextResponse(Buffer.from(pdf.bytes), { headers: { "Content-Type": "application/pdf", "Content-Disposition": `attachment; filename="${pdf.filename}"`, "Cache-Control": "no-store" } });
}
