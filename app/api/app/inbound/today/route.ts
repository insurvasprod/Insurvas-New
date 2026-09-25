import { NextResponse } from "next/server";
import { z } from "zod";

import { getWorkspaceTimezone } from "@/lib/agencyProfile/timezone";
import { listLostTransfers, recoverLostTransfers, todayByPartner } from "@/lib/transferInbox/inboxExtras";
import { requireFeatureRole } from "@/lib/tenantAuth/requireFeatureRole";

/**
 * The inbox's surroundings: transfers the intake accepted but never queued (owners and producers
 * only, since they can recover them) and today's counts per partner. Read separately from the
 * inbox's one-second poll; the page refreshes this every 30 seconds.
 */
export async function GET() {
  const auth = await requireFeatureRole("inbound_transfers", ["owner", "producer", "assistant"]);
  if (auth instanceof NextResponse) return auth;
  const canRecover = auth.context.role === "owner" || auth.context.role === "producer";
  try {
    const zone = await getWorkspaceTimezone(auth.context.tenantId).catch(() => null);
    const [lost, byPartner] = await Promise.all([
      canRecover ? listLostTransfers(auth.context.tenantId) : Promise.resolve([]),
      todayByPartner(auth.context.tenantId, zone),
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
  try {
    const results = await recoverLostTransfers({ tenantId: auth.context.tenantId, userId: auth.context.userId, failureIds: parsed.data.failure_ids, request });
    return NextResponse.json({ results });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Could not recover those transfers" }, { status: 500 });
  }
}
