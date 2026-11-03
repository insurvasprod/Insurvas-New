import { NextResponse, type NextRequest } from "next/server";

import { audit } from "@/lib/audit/log";
import { TaxError, taxExport } from "@/lib/accounting/taxStore";
import { requireFeatureRole } from "@/lib/tenantAuth/requireFeatureRole";

/**
 * LA-7.8 (Notion sprint) · the tax-ready export: totals per category, every transaction with its
 * category, and contractor payments — XLSX (three sheets) or CSV (one sheet). Every sheet opens with
 * the not-tax-advice notice. Owner and bookkeeper only.
 */
const ROLES = ["owner", "bookkeeper"] as const;

export async function GET(request: NextRequest) {
  const auth = await requireFeatureRole("tax_summaries", ROLES);
  if (auth instanceof NextResponse) return auth;
  const q = request.nextUrl.searchParams;
  const year = Number(q.get("year"));
  const format = q.get("format") === "csv" ? "csv" : "xlsx";
  const sheet = q.get("sheet") === "transactions" ? "transactions" : q.get("sheet") === "contractors" ? "contractors" : "totals";
  if (!Number.isInteger(year) || year < 2000 || year > 2100) return NextResponse.json({ error: "Choose a year." }, { status: 400 });
  const { tenantId, userId } = auth.context;
  try {
    const file = await taxExport(tenantId, year, format, sheet);
    await audit({ actorType: "tenant", actorId: userId, action: "accounting.tax_export", targetType: "tenant", targetId: tenantId, metadata: { tenantId, year, format, sheet }, request });
    return new NextResponse(file.body as BodyInit, { headers: { "Content-Type": file.contentType, "Content-Disposition": `attachment; filename="${file.filename}"`, "Cache-Control": "no-store" } });
  } catch (error) {
    if (error instanceof TaxError) return NextResponse.json({ error: error.message }, { status: error.status });
    console.error("[tax-export]", error);
    return NextResponse.json({ error: "The export could not be built" }, { status: 500 });
  }
}
