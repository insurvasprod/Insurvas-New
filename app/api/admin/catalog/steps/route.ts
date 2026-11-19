import { NextResponse } from "next/server";

import { requireAdminRole } from "@/lib/adminAuth/requireAdminRole";
import { catalogStepCounts } from "@/lib/adminCatalog/needs";
import { catalogQueues } from "@/lib/adminCatalog/reads";
import { catalogStepsFor } from "@/lib/adminCatalog/steps";

/**
 * GET /api/admin/catalog/steps — the Catalog rail's badges (admin round 1, docs/design/admin-r1/catalog.html):
 * `{ counts: { workspace, features, templates, rules, layouts, status, fields, guidance, servicing, reports } }`.
 *
 * Only what waits on an admin; only the steps this role may open (the admin menu's own answer,
 * lib/adminCatalog/steps.ts); a count whose read failed is left out, never sent as 0. The queues are read at once,
 * each with its page's own loader. Read-only.
 */
export async function GET() {
  const auth = await requireAdminRole();
  if (auth instanceof NextResponse) return auth;
  const { sub, role } = auth.session;

  const steps = new Set<string>(catalogStepsFor(role).map((step) => step.key));
  if (steps.size === 0) return NextResponse.json({ counts: {} }, { headers: { "Cache-Control": "private, no-store" } });

  const queues = await catalogQueues({ id: sub, role });
  return NextResponse.json({ counts: catalogStepCounts(queues, steps) }, { headers: { "Cache-Control": "private, no-store" } });
}
