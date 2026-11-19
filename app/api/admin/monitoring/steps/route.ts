import { NextResponse } from "next/server";

import { requireAdminRole } from "@/lib/adminAuth/requireAdminRole";
import { monitoringStepsFor } from "@/lib/adminMonitoring/steps";
import { monitoringStepCounts } from "@/lib/adminMonitoring/workspaceQueries";

/**
 * GET /api/admin/monitoring/steps — the Monitoring rail's badges (admin round 1, monitoring.html screen 0):
 * `{ counts: { workspace, logins, lockouts, jobs } }`.
 *
 * Only the steps this role may open (the admin menu's own answer, lib/adminMonitoring/steps.ts), each read under
 * the page's own rule (staff sign-ins and lockouts super admin only); a count whose read failed is left out, never
 * sent as 0. Read-only, so no audit row.
 */
export async function GET() {
  const auth = await requireAdminRole();
  if (auth instanceof NextResponse) return auth;
  const { sub, role } = auth.session;

  const steps = new Set<string>(monitoringStepsFor(role).map((step) => step.key));
  if (steps.size === 0) return NextResponse.json({ counts: {} }, { headers: { "Cache-Control": "private, no-store" } });

  const counts = await monitoringStepCounts({ id: sub, role }, steps);
  return NextResponse.json({ counts }, { headers: { "Cache-Control": "private, no-store" } });
}
