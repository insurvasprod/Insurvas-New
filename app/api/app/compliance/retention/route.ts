import { NextResponse } from "next/server";

import { listHolds, listRules, listRuns, RetentionError } from "@/lib/compliance/retentionStore";
import { requireFeatureRole } from "@/lib/tenantAuth/requireFeatureRole";

/**
 * LA-6.6 (Notion sprint) · retention: the rules each record type resolves to, the legal holds, and the
 * runs. Agency configuration: the owner's.
 */
export async function GET() {
  const auth = await requireFeatureRole("tcpa_checker", ["owner"]);
  if (auth instanceof NextResponse) return auth;
  const { tenantId } = auth.context;
  try {
    const [rules, holds, runs] = await Promise.all([listRules(tenantId), listHolds(tenantId), listRuns(tenantId)]);
    return NextResponse.json({ rules, holds, runs }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    if (error instanceof RetentionError) return NextResponse.json({ error: error.message }, { status: error.status });
    console.error("[retention]", error);
    return NextResponse.json({ error: "Retention could not be loaded" }, { status: 500 });
  }
}
