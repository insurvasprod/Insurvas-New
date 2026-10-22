import { NextResponse } from "next/server";
import { z } from "zod";

import { getWorkspaceTimezone } from "@/lib/agencyProfile/timezone";
import { listLostTransfers, recoverLostTransfers, todayByPartner } from "@/lib/transferInbox/inboxExtras";
import { requireFeatureRole } from "@/lib/tenantAuth/requireFeatureRole";
import { refuseNarrowInAgency } from "@/lib/agency/routeScope";
import { scopeFor } from "@/lib/agency/visibility";

/**
 * The inbox's surroundings: transfers the intake accepted but never queued (owners and producers
 * only, since they can recover them) and today's counts per partner. Read separately from the
 * inbox's one-second poll; the page refreshes this every 30 seconds.
 */
export async function GET() {
  const auth = await requireFeatureRole("inbound_transfers", ["owner", "producer", "assistant"], { prefetchScope: true });
  if (auth instanceof NextResponse) return auth;
  // AG-0.5: both halves are the agency's, not a producer's. Lost transfers were never queued to anyone
  // and recovering them is routing; today-by-partner counts every producer's completed and dropped
  // transfers. In an agency a narrow session gets neither (empty, nothing to recover); solo tenants and
  // the all-seeing roles are unchanged.
  const scope = await scopeFor(auth.context);
  if (scope !== null) return NextResponse.json({ lost: [], byPartner: [], canRecover: false }, { headers: { "Cache-Control": "no-store" } });
  const canRecover = auth.context.role === "owner" || auth.context.role === "producer";
  try {
    // The lost transfers do not need the workspace zone, so they do not wait for it; only today's counts do.
    const [lost, byPartner] = await Promise.all([
      canRecover ? listLostTransfers(auth.context.tenantId) : Promise.resolve([]),
      getWorkspaceTimezone(auth.context.tenantId).catch(() => null).then((zone) => todayByPartner(auth.context.tenantId, zone)),
    ]);
    return NextResponse.json({ lost, byPartner, canRecover }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Could not load today's inbox facts" }, { status: 500 });
  }
}

const recoverSchema = z.object({ failure_ids: z.array(z.string().uuid()).min(1).max(200) }).strict();

export async function POST(request: Request) {
  const auth = await requireFeatureRole("inbound_transfers", ["owner", "producer"], { write: true });
  if (auth instanceof NextResponse) return auth;
  const parsed = recoverSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Choose the lost transfers to recover" }, { status: 400 });
  // AG-0.5: putting lost transfers into the inbox is the agency's routing, not a producer's.
  const refused = await refuseNarrowInAgency(auth.context, "Recovering lost transfers");
  if (refused) return refused;
  try {
    const results = await recoverLostTransfers({ tenantId: auth.context.tenantId, userId: auth.context.userId, failureIds: parsed.data.failure_ids, request });
    return NextResponse.json({ results });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Could not recover those transfers" }, { status: 500 });
  }
}
