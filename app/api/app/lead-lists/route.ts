import { NextResponse, type NextRequest } from "next/server";

import { leadListsReport, listLeadsInList } from "@/lib/leadLists/service";
import { requireFeatureRole } from "@/lib/tenantAuth/requireFeatureRole";

/**
 * The lead list — what was bought, and what is left of it.
 *
 * Gated on `lead_import` rather than `outbound_dialing`: this is the inventory of imported lists, and
 * a tenant who buys lists should be able to look at them whether or not they have the dialer.
 *
 * A setter is excluded. LA-2.12's role table gives them the queue, not the book — deciding which
 * list to work through and who gets it is the licensed agent's call, and this screen is where the
 * handing-out happens.
 */
const LIST_ROLES = ["owner", "producer", "assistant"] as const;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function GET(request: NextRequest) {
  const auth = await requireFeatureRole("lead_import", LIST_ROLES);
  if (auth instanceof NextResponse) return auth;

  const params = request.nextUrl.searchParams;
  const campaignId = params.get("campaign_id");

  try {
    if (campaignId) {
      if (!UUID.test(campaignId))
        return NextResponse.json({ error: "Choose a valid lead list" }, { status: 400 });
      const leads = await listLeadsInList(auth.context.tenantId, campaignId, {
        state: params.get("state"),
        unassignedOnly: params.get("unassigned") === "1",
      });
      return NextResponse.json({ leads }, { headers: { "Cache-Control": "no-store" } });
    }
    const report = await leadListsReport(auth.context.tenantId);
    return NextResponse.json(
      // `role` travels with the payload so the screen decides what to OFFER. Assigning is a write
      // and the assignment route enforces it; this only decides whether the control is drawn.
      { lists: report.lists, licensedStates: report.licensedStates, role: auth.context.role, readOnly: auth.entitlement.access === "read_only" },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Could not load the lead lists" },
      { status: 500 },
    );
  }
}
