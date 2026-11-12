import { NextResponse, type NextRequest } from "next/server";

import { requireFeatureRole } from "@/lib/tenantAuth/requireFeatureRole";
import { loadBoard } from "@/lib/leadPost/boardStore";

/**
 * Settings › Lead posting, round 8: the vendor table, its figures and the wizard's lists in one read.
 * `tz` is the viewer's time zone, so "today" starts at their midnight. Owner only, on `lead_import`,
 * as the keys it sits beside.
 */
const ROLES = ["owner"] as const;

function zoneOf(value: string | null): string {
  if (!value || value.length > 64) return "America/Chicago";
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: value });
    return value;
  } catch {
    return "America/Chicago";
  }
}

export async function GET(request: NextRequest) {
  const auth = await requireFeatureRole("lead_import", ROLES);
  if (auth instanceof NextResponse) return auth;
  try {
    const board = await loadBoard(auth.context.tenantId, zoneOf(request.nextUrl.searchParams.get("tz")));
    return NextResponse.json(board, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Vendors didn't load" }, { status: 500 });
  }
}
