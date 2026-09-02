import { NextResponse } from "next/server";
import { requireFeatureRole } from "@/lib/tenantAuth/requireFeatureRole";

/**
 * Money boundary for the agent plane. The ledger module is still a frame, but its authorization
 * boundary exists now so a future query cannot accidentally make assistant money visible.
 * Producers must be filtered to their own producer_id when ledger rows are added.
 */
export async function GET() {
  const auth = await requireFeatureRole("commission_ledger", ["owner", "producer", "bookkeeper"]);
  if (auth instanceof NextResponse) return auth;

  return NextResponse.json({ ok: true, readOnly: auth.entitlement.access === "read_only", entries: [] });
}
