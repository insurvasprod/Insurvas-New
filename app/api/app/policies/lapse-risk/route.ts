import { NextResponse } from "next/server";

import { requireFeature } from "@/lib/entitlements/requireFeature";

/**
 * Enforcement point 3 of 3: the API. THE only real one.
 *
 * The doc's example route, and the one SA-2.8's headline criterion tests: a tenant on plan_a
 * calling this gets 403 even with a valid session and a hand-crafted request, because the check
 * reads the entitlement server-side rather than trusting anything the client sent.
 */
export async function GET() {
  const auth = await requireFeature("chargeback_radar");
  if (auth instanceof NextResponse) return auth;

  return NextResponse.json({
    ok: true,
    feature: "chargeback_radar",
    plan: auth.entitlement.plan_code,
    // Scaffolding for LA-0.1 — the point here is that the guard ran, not the payload.
    policies: [],
  });
}
