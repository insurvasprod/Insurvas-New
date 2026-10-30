import { NextResponse } from "next/server";

import { failure } from "@/lib/applications/http";
import { STATE_CODES } from "@/lib/appointments/constants";
import { callCoverage } from "@/lib/salesSettings/disclosureLibrary";
import { COMMON_PRODUCT_CODES } from "@/lib/stateDisclosures/constants";
import { listStateDisclosures } from "@/lib/stateDisclosures/service";
import { requireFeatureRole } from "@/lib/tenantAuth/requireFeatureRole";

/**
 * LA-2.23 · Settings › Disclosures › Read on the call (owners and producers, read-only). Per product
 * and state, the wording the dialer serves today — approved, still the seeded placeholder, or missing
 * (dialing that state is blocked) — and any change dated later. `state_disclosures` is platform data
 * that Insurvas compliance maintains on /admin/state-disclosures; nothing here writes it.
 */
export async function GET() {
  const auth = await requireFeatureRole("applications", ["owner", "producer"]);
  if (auth instanceof NextResponse) return auth;
  try {
    const rows = await listStateDisclosures();
    const today = new Date().toISOString().slice(0, 10);
    return NextResponse.json({ products: callCoverage(rows, STATE_CODES, COMMON_PRODUCT_CODES, today) }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return failure(error);
  }
}
