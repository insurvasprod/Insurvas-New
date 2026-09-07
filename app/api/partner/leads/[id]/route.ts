import { NextResponse, type NextRequest } from "next/server";

import { getPartnerLeadDetail } from "@/lib/partnerLeads/service";
import { requirePartner } from "@/lib/partnerAuth/requirePartner";

export async function GET(_request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requirePartner();
  if (auth instanceof NextResponse) return auth;
  try { return NextResponse.json(await getPartnerLeadDetail(auth.context.tenantId, auth.context.partnerId, (await params).id), { headers: { "Cache-Control": "no-store" } }); }
  catch (error) { return NextResponse.json({ error: error instanceof Error ? error.message : "Could not load lead" }, { status: 404 }); }
}
