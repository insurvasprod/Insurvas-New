import { NextResponse } from "next/server";

import { requireFeatureRole } from "@/lib/tenantAuth/requireFeatureRole";
import { getLapseRisk, LAPSE_SCHEMA_PENDING_MESSAGE } from "@/lib/lapseRisk/service";

/**
 * Enforcement point 3 of 3: the API. THE only real one.
 *
 * The doc's example route, and the one SA-2.8's headline criterion tests: a tenant on plan_a
 * calling this gets 403 even with a valid session and a hand-crafted request, because the check
 * reads the entitlement server-side rather than trusting anything the client sent.
 *
 * `policies` are the policies with at least one OPEN lapse signal — a missed draft, a returned
 * payment, a service call — most urgent first (lib/lapseRisk/model.ts, rankAtRisk). A policy is
 * never listed without the signal that put it there: there is no score, the reason is the risk.
 * Each carries the commission its lapse would charge back today, from lib/ledger.
 *
 * `chargebackExposure` is "the chargeback figure on Lapse risk" that Settings › Carrier library
 * points at: for every active policy still inside its advance rule's clawback months, what would be
 * charged back if it lapsed today — all of the advance for a full clawback, the unexpired share for
 * a prorated one (lib/ledger/compute.ts). It is exposure, not a prediction.
 *
 * `recordable` is the active and pending policies this viewer may record a signal on. Scope is the
 * commission rule (roleCanViewCommission): an owner every policy, a producer the ones they recorded.
 */
export async function GET() {
  const auth = await requireFeatureRole("chargeback_radar", ["owner", "producer"]);
  if (auth instanceof NextResponse) return auth;

  try {
    const view = await getLapseRisk(auth.context);
    return NextResponse.json(
      {
        ok: true,
        feature: "chargeback_radar",
        plan: auth.entitlement.plan_code,
        readOnly: auth.entitlement.access === "read_only",
        storage: view.storage,
        ...(view.storage === "pending" ? { notice: LAPSE_SCHEMA_PENDING_MESSAGE } : {}),
        policies: view.policies,
        totals: view.totals,
        recordable: view.recordable,
        chargebackExposure: view.chargebackExposure,
      },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (error) {
    console.error("[lapse-risk] could not load lapse risk", error);
    return NextResponse.json({ error: "Could not load lapse risk" }, { status: 500 });
  }
}
