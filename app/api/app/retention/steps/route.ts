import { NextResponse } from "next/server";

import { scopeFor } from "@/lib/agency/visibility";
import { retentionStepCounts } from "@/lib/retention/stepCounts";
import { requireFeatureRole } from "@/lib/tenantAuth/requireFeatureRole";

/**
 * The Retention rail's counts (round 7, owner pick 0·A, 2026-11-10): cases past due, requests to check or send,
 * clients to call now. Head reads only, no money. Gated like Cases (`chargeback_radar`; owner, producer, retention);
 * any failure answers an empty map, so the rail keeps its plain lines.
 */
export async function GET() {
  const auth = await requireFeatureRole("chargeback_radar", ["owner", "producer", "retention"] as const);
  if (auth instanceof NextResponse) return auth;
  const headers = { "Cache-Control": "no-store" };
  try {
    const { tenantId, userId, role } = auth.context;
    const counts = await retentionStepCounts({ tenantId, userId, role, scope: await scopeFor(auth.context) });
    return NextResponse.json({ counts }, { headers });
  } catch {
    return NextResponse.json({ counts: {} }, { headers });
  }
}
