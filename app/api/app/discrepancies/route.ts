import { NextResponse, type NextRequest } from "next/server";

import { DISCREPANCY_SCHEMA_PENDING_MESSAGE, listDiscrepancies, owedToYou, refreshDiscrepancies } from "@/lib/discrepancies/service";
import { requireFeatureRole } from "@/lib/tenantAuth/requireFeatureRole";

/**
 * Money boundary (LA-4.4): what the carriers appear to owe. GET lists every finding, open first by
 * amount, with the total owed. `?refresh=1` recomputes from the book and the accepted statement
 * lines first — a read of the facts, not a decision, so a read-only account may ask for it too.
 *
 * Owner and bookkeeper only, as the Discrepancies menu item.
 */
const roles = ["owner", "bookkeeper"] as const;

export async function GET(request: NextRequest) {
  const auth = await requireFeatureRole("discrepancy_report", roles);
  if (auth instanceof NextResponse) return auth;
  try {
    if (request.nextUrl.searchParams.get("refresh") === "1") await refreshDiscrepancies(auth.context.tenantId);
    const [list, owed] = await Promise.all([listDiscrepancies(auth.context.tenantId), owedToYou(auth.context.tenantId)]);
    return NextResponse.json(
      { ok: true, available: list.available, message: list.available ? null : DISCREPANCY_SCHEMA_PENDING_MESSAGE, owed, items: list.items },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (error) {
    console.error("[discrepancies] list", error);
    return NextResponse.json({ error: "Could not load discrepancies" }, { status: 500 });
  }
}
