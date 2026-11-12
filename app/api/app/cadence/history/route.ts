import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";

import { scopeVersions } from "@/lib/cadence/historyService";
import { requireFeatureRole } from "@/lib/tenantAuth/requireFeatureRole";

/**
 * Settings › Dialing cadence › History (round 8). Every save of one scope is a version
 * (tenant_cadence_versions, written by replace_cadence_rules since 20260925706200); this reads them
 * for the History sheet, newest first, with who saved each. Read by the same roles that may read the
 * cadence. `ready: false` before that migration — the sheet says so instead of showing nothing.
 */
const READ_ROLES = ["owner", "producer", "setter", "assistant"] as const;

export async function GET(request: NextRequest) {
  const auth = await requireFeatureRole("outbound_dialing", READ_ROLES);
  if (auth instanceof NextResponse) return auth;

  const campaignId = request.nextUrl.searchParams.get("campaignId");
  if (campaignId && !z.string().uuid().safeParse(campaignId).success)
    return NextResponse.json({ error: "That is not a campaign id", code: "invalid_campaign" }, { status: 400 });

  try {
    const versions = await scopeVersions(auth.context.tenantId, campaignId || null);
    return NextResponse.json({ ready: versions !== null, versions: versions ?? [] }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Could not load the cadence history" }, { status: 500 });
  }
}
