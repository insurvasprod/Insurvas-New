import { NextResponse } from "next/server";

import { requireFeatureRole } from "@/lib/tenantAuth/requireFeatureRole";
import { readRoster } from "@/lib/agency/producerStore";
import { NO_STORE, refuseProducerWithoutTitle } from "@/lib/agency/http";
import type { AgencyStepCounts } from "@/lib/agency/steps";

/**
 * The live counts on the Home › Agency rail (owner 2026-11-03): what waits on a person, per step. Counts only —
 * never an amount — read through the same scoped store as the step itself (AG-0.4: a manager counts his reports).
 * The dashboard step has no queue; Hierarchy's count moved with it to the Commissions rail.
 *
 *   producers  working producers (active or onboarding) the AG-1.10 gate still stops from submitting
 */
export async function GET() {
  const auth = await requireFeatureRole("team_hierarchy", ["owner", "bookkeeper", "producer"], { prefetchScope: true });
  if (auth instanceof NextResponse) return auth;
  const refused = refuseProducerWithoutTitle(auth.context, "The Agency rail");
  if (refused) return refused;

  const roster = await readRoster(auth.context).catch(() => null);
  const counts: AgencyStepCounts = {};
  if (roster && !roster.schemaPending) {
    counts.producers = roster.rows.filter((row) => (row.status === "active" || row.status === "onboarding") && !row.canSubmit).length;
  }
  return NextResponse.json({ counts }, { headers: NO_STORE });
}
