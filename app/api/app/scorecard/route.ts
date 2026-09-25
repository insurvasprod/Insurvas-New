import { NextResponse, type NextRequest } from "next/server";

import { requireTenant } from "@/lib/tenantAuth/requireTenant";
import { getRoster, getScorecard } from "@/lib/setters/service";
import { hasTenantPermission } from "@/lib/tenantAuth/permissions";

// LA-2.12. Every role that has a scorecard at all, which is not the same as every role that sees
// the team's: the scope is decided inside the service from the caller's role, so a setter reaching
// this route gets their own rows and a bookkeeper does not reach it at all.
const SCORECARD_ROLES = ["owner", "producer", "setter"] as const;

export async function GET(request: NextRequest) {
  const auth = await requireTenant(SCORECARD_ROLES);
  if (auth instanceof NextResponse) return auth;

  const days = Number(request.nextUrl.searchParams.get("days") ?? "30");
  const sinceDays = Number.isFinite(days) ? Math.min(Math.max(Math.trunc(days), 1), 180) : 30;

  try {
    const scorecard = await getScorecard(auth.context.tenantId, auth.context.userId, auth.context.role, sinceDays);
    // The roster is the owner's view of who is on shift. A setter sees their own numbers, not a
    // list of their colleagues' working hours.
    const roster = hasTenantPermission(auth.context.role, "scorecard.view.all")
      ? await getRoster(auth.context.tenantId)
      : [];
    return NextResponse.json({ ...scorecard, roster }, { headers: { "Cache-Control": "no-store" } });
  } catch {
    return NextResponse.json({ error: "Could not load the scorecard" }, { status: 503 });
  }
}
