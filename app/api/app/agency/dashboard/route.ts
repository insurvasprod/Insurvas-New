import { NextResponse, type NextRequest } from "next/server";

import { requireFeatureRole } from "@/lib/tenantAuth/requireFeatureRole";
import { readDashboard } from "@/lib/agency/dashboardStore";
import { NO_STORE, periodOf, refuseProducerWithoutTitle } from "@/lib/agency/http";

/** AG-0.11 · the agency dashboard. Owner, admin, bookkeeper; a manager scoped to his reports; never a producer. */
export async function GET(request: NextRequest) {
  const auth = await requireFeatureRole("agency_dashboard", ["owner", "bookkeeper", "producer"]);
  if (auth instanceof NextResponse) return auth;
  const refused = refuseProducerWithoutTitle(auth.context, "The agency dashboard");
  if (refused) return refused;
  const period = periodOf(new URL(request.url));
  if (period instanceof NextResponse) return period;
  try {
    return NextResponse.json(await readDashboard({ ...auth.context, role: auth.context.memberRole ?? auth.context.role }, period), { headers: NO_STORE });
  } catch (error) {
    console.error("[agency dashboard]", error instanceof Error ? error.message : error);
    return NextResponse.json({ error: "Could not load the agency dashboard" }, { status: 500 });
  }
}
