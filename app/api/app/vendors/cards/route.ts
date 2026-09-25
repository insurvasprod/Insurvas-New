import { NextResponse } from "next/server";

import { hasFeature } from "@/lib/entitlements/types";
import { requireFeatureRole } from "@/lib/tenantAuth/requireFeatureRole";
import { getVendorCards } from "@/lib/vendors/service";

/**
 * The Vendors roster's per-vendor facts (LA-2 §5 concept board): trialling, renewal, cost per
 * issued policy, claimable returns, undialable share and the drop-recommendation facts.
 *
 * Separate from GET /api/app/vendors on purpose. That route answers the vendor list, the rollup,
 * speed and consent — the page cannot work without it. This one runs the scorecard over the
 * vendor's whole history and the returns summary; the page renders without waiting for it.
 *
 * Owner and producer only, like the vendors and campaigns routes: it returns what a policy cost.
 * The True CPA figures are read only when the tenant has True CPA (`true_cpa: false` otherwise).
 */
const roles = ["owner", "producer"] as const;

export async function GET() {
  const auth = await requireFeatureRole("outbound_dialing", roles);
  if (auth instanceof NextResponse) return auth;
  try {
    const body = await getVendorCards(auth.context.tenantId, hasFeature(auth.entitlement, "true_cpa"));
    return NextResponse.json(body, { headers: { "Cache-Control": "no-store" } });
  } catch (cause) {
    return NextResponse.json({ error: cause instanceof Error ? cause.message : "Could not load vendor facts" }, { status: 500 });
  }
}
