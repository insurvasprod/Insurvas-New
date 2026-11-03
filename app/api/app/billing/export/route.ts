import { NextResponse, type NextRequest } from "next/server";

import { audit } from "@/lib/audit/log";
import { BOOK_EXPORT_PARTS, bookExportCsv, type BookExportPart } from "@/lib/billing/bookExport";
import { requireTenant } from "@/lib/tenantAuth/requireTenant";

/**
 * The agency's own records, to take with it (LA-8.5): offered when it cancels, and readable through
 * the whole retention window — a read, so a paused or cancelled agency can always run it. Owners only.
 *
 *   GET ?part=policies      the book of business
 *   GET ?part=commissions   every commission statement line, with its carrier and period
 */
export async function GET(request: NextRequest) {
  const auth = await requireTenant(["owner"]);
  if (auth instanceof NextResponse) return auth;
  const part = request.nextUrl.searchParams.get("part") as BookExportPart | null;
  if (!part || !BOOK_EXPORT_PARTS.includes(part)) return NextResponse.json({ error: "Choose policies or commissions" }, { status: 400 });
  try {
    const csv = await bookExportCsv(auth.context.tenantId, part);
    await audit({ actorType: "tenant", actorId: auth.context.userId, action: "tenant.book_exported", targetType: "tenant", targetId: auth.context.tenantId, metadata: { tenantId: auth.context.tenantId, part }, request });
    return new NextResponse(csv, { headers: { "Content-Type": "text/csv; charset=utf-8", "Content-Disposition": `attachment; filename=${part}.csv`, "Cache-Control": "no-store" } });
  } catch (error) {
    console.error("[billing/export]", error instanceof Error ? error.message : error);
    return NextResponse.json({ error: "The export could not be built" }, { status: 500 });
  }
}
