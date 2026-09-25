import { NextResponse } from "next/server";

import { resolvePartnerMarkets } from "@/lib/partnerMarkets/service";
import { requirePartner } from "@/lib/partnerAuth/requirePartner";

export async function GET() {
  const auth = await requirePartner();
  if (auth instanceof NextResponse) return auth;
  try {
    const resolved = await resolvePartnerMarkets(auth.context.tenantId, auth.context.partnerId, auth.context.userId);
    return NextResponse.json({ markets: resolved.markets, source: resolved.source, profile_id: resolved.profile_id, revision: resolved.revision }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Could not load available markets" }, { status: 400 });
  }
}
