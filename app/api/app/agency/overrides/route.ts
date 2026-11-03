import { NextResponse, type NextRequest } from "next/server";

import { requireFeatureRole } from "@/lib/tenantAuth/requireFeatureRole";
import { readOverrides } from "@/lib/agency/overrideStore";
import { NO_STORE, periodOf, refuseProducerWithoutTitle } from "@/lib/agency/http";

/** AG-1.2 · Hierarchy & Overrides. Owner, admin, bookkeeper; a manager sees his reports. */
export async function GET(request: NextRequest) {
  const auth = await requireFeatureRole("team_hierarchy", ["owner", "bookkeeper", "producer"]);
  if (auth instanceof NextResponse) return auth;
  const refused = refuseProducerWithoutTitle(auth.context, "Hierarchy & Overrides");
  if (refused) return refused;
  const period = periodOf(new URL(request.url));
  if (period instanceof NextResponse) return period;
  try {
    return NextResponse.json({ period, rows: await readOverrides(auth.context, period) }, { headers: NO_STORE });
  } catch (error) {
    console.error("[agency overrides]", error instanceof Error ? error.message : error);
    return NextResponse.json({ error: "Could not load hierarchy and overrides" }, { status: 500 });
  }
}
