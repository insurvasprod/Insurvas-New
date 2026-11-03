import { NextResponse } from "next/server";

import { requireFeatureRole } from "@/lib/tenantAuth/requireFeatureRole";
import { readUnassignedPool } from "@/lib/agency/routing";

/** AG-0.10 · the unassigned pool, with an age on every lead. Owner and admin only. */
export async function GET() {
  const auth = await requireFeatureRole("lead_assignment", ["owner"]);
  if (auth instanceof NextResponse) return auth;
  try {
    return NextResponse.json({ pool: await readUnassignedPool(auth.context.tenantId) }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    console.error("[agency pool]", error instanceof Error ? error.message : error);
    return NextResponse.json({ error: "Could not load the unassigned pool" }, { status: 500 });
  }
}
