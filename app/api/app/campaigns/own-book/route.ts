import { NextResponse } from "next/server";

import { requireFeatureRole } from "@/lib/tenantAuth/requireFeatureRole";
import { refuseNarrowInAgency } from "@/lib/agency/routeScope";
import { ensureOwnBookCampaign, OwnBookConflictError } from "@/lib/campaigns/ownBookStore";

/**
 * Import › "Your own book (no vendor)" (board LirI1, 2026-10-29): finds or creates this tenant's
 * own-book vendor and its campaign (lib/campaigns/ownBook.ts), so a list the agency already owns can
 * be imported like any vendor's. Gated exactly as creating a campaign is (POST /api/app/campaigns).
 */
const roles = ["owner", "producer"] as const;

export async function POST() {
  const auth = await requireFeatureRole("outbound_dialing", roles, { write: true });
  if (auth instanceof NextResponse) return auth;
  const refused = await refuseNarrowInAgency(auth.context, "Campaigns");
  if (refused) return refused;
  try {
    const result = await ensureOwnBookCampaign(auth.context.tenantId, auth.context.userId);
    return NextResponse.json(result, { status: result.created ? 201 : 200, headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    if (error instanceof OwnBookConflictError) return NextResponse.json({ error: error.message }, { status: 409 });
    return NextResponse.json({ error: "Could not set up your own book" }, { status: 500 });
  }
}
