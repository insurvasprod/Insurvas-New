import { NextResponse } from "next/server";

import { audit } from "@/lib/audit/log";
import { actorOf, isUuid } from "@/lib/applications/http";
import { leadStageState, reconcileLeadStage } from "@/lib/applications/stageSyncService";
import { requireFeatureRole } from "@/lib/tenantAuth/requireFeatureRole";

/**
 * LA-3.23 · the leads board's reconcile hint. GET says where the lead's application puts the card and
 * whether a person has moved it elsewhere since; POST puts it there. Only the card moves — an
 * application is never changed from the board.
 */
export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireFeatureRole("applications", ["owner", "producer"]);
  if (auth instanceof NextResponse) return auth;
  const actor = actorOf(auth, request);
  const { id } = await params;
  if (!isUuid(id)) return NextResponse.json({ error: "That lead could not be found." }, { status: 404 });
  try {
    const state = await leadStageState(actor.tenantId, id);
    return NextResponse.json({ state });
  } catch (error) {
    console.error("[reconcile-stage]", error);
    return NextResponse.json({ error: "Could not compare the card with the application." }, { status: 500 });
  }
}

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireFeatureRole("applications", ["owner", "producer"], { write: true });
  if (auth instanceof NextResponse) return auth;
  const actor = actorOf(auth, request);
  const { id } = await params;
  if (!isUuid(id)) return NextResponse.json({ error: "That lead could not be found." }, { status: 404 });
  try {
    const result = await reconcileLeadStage(actor.tenantId, id, actor.userId);
    if (!result.moved) {
      const message = result.reason === "already_there" ? "The card is already where the application says." : result.reason === "raced" ? "Someone moved this card just now — refresh and look again." : "The application's stage is not mapped to a live stage on this pipeline.";
      return NextResponse.json({ ...result, error: result.reason === "already_there" ? undefined : message }, { status: result.reason === "already_there" ? 200 : 409 });
    }
    await audit({ actorType: "tenant", actorId: actor.userId, action: "tenant.lead_stage_changed", targetType: "agent_lead", targetId: id, metadata: { operation: "application_reconcile", stageId: result.toStageId }, request });
    return NextResponse.json(result);
  } catch (error) {
    console.error("[reconcile-stage]", error);
    return NextResponse.json({ error: "Could not move the card." }, { status: 500 });
  }
}
