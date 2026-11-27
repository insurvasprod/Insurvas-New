import { NextResponse, type NextRequest } from "next/server";

import { getPartnerLeadDetail } from "@/lib/partnerLeads/service";
import { requirePartner } from "@/lib/partnerAuth/requirePartner";
import { leadPhoneFacts, pipelineLiveFacts } from "@/lib/partnerLeads/phoneFacts";

export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requirePartner();
  if (auth instanceof NextResponse) return auth;
  try {
    const detail = await getPartnerLeadDetail(auth.context.tenantId, auth.context.partnerId, (await params).id, { userId: auth.context.userId, role: auth.context.role });
    // The phone app (board K2b, K3b) asks with phone=1, after the scoped read above has proved the lead
    // is the caller's: the live line, the dialer attempts as a count and a span, and agents ready now.
    if (request.nextUrl.searchParams.get("phone") === "1") {
      const [live, extra] = await Promise.all([pipelineLiveFacts(auth.context.tenantId, auth.context.partnerId, [detail.workItemId]), leadPhoneFacts(auth.context.tenantId, detail.id)]);
      return NextResponse.json({ ...detail, live: live[detail.workItemId] ?? null, ...extra }, { headers: { "Cache-Control": "no-store" } });
    }
    return NextResponse.json(detail, { headers: { "Cache-Control": "no-store" } });
  }
  catch (error) { return NextResponse.json({ error: error instanceof Error ? error.message : "Could not load lead" }, { status: 404 }); }
}
