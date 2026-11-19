import { NextResponse, type NextRequest } from "next/server";

import { partnerCampaigns } from "@/lib/partnerLeads/campaigns";
import { partnerMayOpen, partnerPageRefused, partnerTeamMembers, requirePartner } from "@/lib/partnerAuth/requirePartner";
import { visibleSubmitters } from "@/lib/partnerAuth/team";

const DAY = /^\d{4}-\d{2}-\d{2}$/;

/**
 * Roles board P2 · a marketing partner's leads by campaign, with what happened to them. Counts only.
 * Tenant, partner and the visible submitters come from the session (as Lead Pipeline's), never from the
 * request. Marketing partners only (lib/partnerAuth/portalAccess.ts): another type is refused here.
 */
export async function GET(request: NextRequest) {
  const auth = await requirePartner();
  if (auth instanceof NextResponse) return auth;
  if (!(await partnerMayOpen(auth.context, "campaigns"))) return partnerPageRefused();
  const params = request.nextUrl.searchParams;
  const from = params.get("date_from") ?? "";
  const to = params.get("date_to") ?? "";
  if (!DAY.test(from) || !DAY.test(to) || to < from) return NextResponse.json({ error: "Choose a valid date range" }, { status: 400 });
  if ((Date.parse(to) - Date.parse(from)) / 86_400_000 > 366) return NextResponse.json({ error: "Choose a range of a year or less" }, { status: 400 });
  try {
    const members = await partnerTeamMembers(auth.context.tenantId, auth.context.partnerId);
    const visible = visibleSubmitters({ userId: auth.context.userId, role: auth.context.role }, members);
    return NextResponse.json(await partnerCampaigns(auth.context.tenantId, auth.context.partnerId, visible, { from, to }, auth.context.role === "partner_admin"), { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    console.error("[partner-campaigns]", error);
    return NextResponse.json({ error: "Your campaigns could not be loaded" }, { status: 500 });
  }
}
