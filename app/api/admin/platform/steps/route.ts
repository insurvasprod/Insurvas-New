import { NextResponse } from "next/server";

import { requireAdminRole } from "@/lib/adminAuth/requireAdminRole";
import { platformStepCounts } from "@/lib/adminPlatform/needs";
import { platformQueues } from "@/lib/adminPlatform/reads";
import { platformStepsFor } from "@/lib/adminPlatform/steps";

/**
 * GET /api/admin/platform/steps — the Platform rail's badges (admin round 1, owner 2026-11-18):
 * `{ counts: { workspace, compliance, disclosures, calling, mail, maintenance, admins, legal } }`.
 *
 * Only what waits on an admin; only the steps this role may open (the admin menu's own answer,
 * lib/adminPlatform/steps.ts); a count whose read failed is left out, never sent as 0. The queues are read at once,
 * each with its page's own loader. Read-only, so no audit row.
 */
export async function GET() {
  const auth = await requireAdminRole();
  if (auth instanceof NextResponse) return auth;
  const { sub, role } = auth.session;

  const steps = new Set<string>(platformStepsFor(role).map((step) => step.key));
  if (steps.size === 0) return NextResponse.json({ counts: {} }, { headers: { "Cache-Control": "private, no-store" } });

  const queues = await platformQueues({ id: sub, role });
  return NextResponse.json({ counts: platformStepCounts(queues, steps, Date.now()) }, { headers: { "Cache-Control": "private, no-store" } });
}
