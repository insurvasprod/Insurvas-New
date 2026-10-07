import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";

import { audit } from "@/lib/audit/log";
import { isRecordUuid } from "@/lib/ingestion/path";
import { loadMatching, mapAgent, MATCHING_PENDING_MESSAGE, MatchingError, reopenMatch, resolveReview, unmapAgent } from "@/lib/ingestion/policyMatchingStore";
import { requireFeatureRole } from "@/lib/tenantAuth/requireFeatureRole";

/**
 * LA-4.8 (Notion sprint) · this agency's policy matching: the policies waiting for a person to pick
 * the client (with the scored shortlist), the links made and how, and the carrier agent codes still
 * unmapped. POST decides a review, reopens a link, or maps / unmaps an agent code. Owner and
 * bookkeeper; every change is audited.
 */
const roles = ["owner", "bookkeeper"] as const;
const uuid = z.string().refine(isRecordUuid, "Choose a record.");

const action = z.discriminatedUnion("action", [
  z.object({ action: z.literal("resolve"), review_id: uuid, candidate: z.number().int().min(0).max(20).nullable() }).strict(),
  z.object({ action: z.literal("reopen"), match_id: uuid }).strict(),
  z.object({ action: z.literal("map_agent"), carrier_id: uuid, agent_identifier: z.string().min(1).max(200), user_id: uuid }).strict(),
  z.object({ action: z.literal("unmap_agent"), map_id: uuid }).strict(),
]);

function failure(error: unknown) {
  if (error instanceof MatchingError) return NextResponse.json({ error: error.message }, { status: error.status });
  console.error("[policy-matching]", error);
  return NextResponse.json({ error: "That could not be saved. Try again." }, { status: 500 });
}

export async function GET() {
  const auth = await requireFeatureRole("statement_ingestion", roles);
  if (auth instanceof NextResponse) return auth;
  try {
    const view = await loadMatching(auth.context.tenantId);
    return NextResponse.json({ ok: true, ...view, message: view.available ? null : MATCHING_PENDING_MESSAGE }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return failure(error);
  }
}

export async function POST(request: NextRequest) {
  const auth = await requireFeatureRole("statement_ingestion", roles, { write: true });
  if (auth instanceof NextResponse) return auth;
  const parsed = action.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Check the request and try again." }, { status: 400 });
  const body = parsed.data;
  const scope = { tenantId: auth.context.tenantId, userId: auth.context.userId };
  const base = { actorType: "tenant" as const, actorId: auth.context.userId, request };
  try {
    if (body.action === "resolve") {
      const done = await resolveReview(scope, body.review_id, body.candidate === null ? { none: true } : { ref: body.candidate });
      await audit({ ...base, action: "policy_match.resolved", targetType: "policy_match", targetId: done.matchId, metadata: { tenantId: scope.tenantId, reviewId: body.review_id, carrierId: done.carrierId, policyNumber: done.policyNumber, candidate: body.candidate } });
      return NextResponse.json({ ok: true, id: done.matchId }, { status: 201 });
    }
    if (body.action === "reopen") {
      const done = await reopenMatch(scope, body.match_id);
      await audit({ ...base, action: "policy_match.reopened", targetType: "policy_match", targetId: body.match_id, metadata: { tenantId: scope.tenantId, carrierId: done.carrierId, policyNumber: done.policyNumber } });
      return NextResponse.json({ ok: true, id: body.match_id });
    }
    if (body.action === "map_agent") {
      await mapAgent(scope, body.carrier_id, body.agent_identifier, body.user_id);
      await audit({ ...base, action: "carrier_agent.mapped", targetType: "carrier", targetId: body.carrier_id, metadata: { tenantId: scope.tenantId, agentIdentifier: body.agent_identifier, userId: body.user_id } });
      return NextResponse.json({ ok: true, id: body.carrier_id });
    }
    const done = await unmapAgent(scope, body.map_id);
    await audit({ ...base, action: "carrier_agent.unmapped", targetType: "carrier", targetId: done.carrierId, metadata: { tenantId: scope.tenantId, agentIdentifier: done.agentIdentifier, mapId: body.map_id } });
    return NextResponse.json({ ok: true, id: body.map_id });
  } catch (error) {
    return failure(error);
  }
}
