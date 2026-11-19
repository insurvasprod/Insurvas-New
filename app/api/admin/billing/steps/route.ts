import { NextResponse } from "next/server";

import { requireAdminRole } from "@/lib/adminAuth/requireAdminRole";
import { billingStepsFor } from "@/lib/adminBilling/steps";
import { canOpenAdminHref } from "@/lib/adminDashboard/compose";
import { needsFor, stepCounts } from "@/lib/billingWorkspace/needs";
import { billingNeedsInput } from "@/lib/billingWorkspace/reads";

/**
 * GET /api/admin/billing/steps — the Billing rail's badges (admin round 1, billing-r2 screen 0):
 * `{ counts: { workspace, trials, failed, invoices, refunds, reconciliation, credits } }`.
 *
 * Only what waits on an admin; only the steps this role may open (the admin menu's own answer,
 * lib/adminBilling/steps.ts); a count whose read failed is left out, never sent as 0. Read-only.
 */
export async function GET() {
  const auth = await requireAdminRole();
  if (auth instanceof NextResponse) return auth;
  const { sub, role } = auth.session;

  const steps = new Set<string>(billingStepsFor(role).map((step) => step.key));
  if (steps.size === 0) return NextResponse.json({ counts: {} }, { headers: { "Cache-Control": "private, no-store" } });

  const input = await billingNeedsInput(sub, role);
  const rows = needsFor(input, (href) => canOpenAdminHref(role, href));
  return NextResponse.json({ counts: stepCounts(input, steps, rows) }, { headers: { "Cache-Control": "private, no-store" } });
}
