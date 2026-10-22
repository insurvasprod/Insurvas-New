import { NextResponse, type NextRequest } from "next/server";

import { requireFeatureRole } from "@/lib/tenantAuth/requireFeatureRole";
import { producerScores } from "@/lib/agency/scorecardStore";
import { NO_STORE, periodOf } from "@/lib/agency/http";

/**
 * AG-1.9 · producer scorecards, grouped from LA-4.18 and LA-7. A producer gets his own row only, a manager his
 * reports' (AG-0.4 scope): nobody sees a ranking he is not in.
 */
export async function GET(request: NextRequest) {
  const auth = await requireFeatureRole("producer_scorecards", ["owner", "bookkeeper", "producer"]);
  if (auth instanceof NextResponse) return auth;
  const period = periodOf(new URL(request.url));
  if (period instanceof NextResponse) return period;
  try {
    return NextResponse.json(await producerScores({ ...auth.context, role: auth.context.role }, period), { headers: NO_STORE });
  } catch (error) {
    console.error("[producer scorecards]", error instanceof Error ? error.message : error);
    return NextResponse.json({ error: "Could not load the scorecards" }, { status: 500 });
  }
}
