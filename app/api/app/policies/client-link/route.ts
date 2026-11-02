import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";

import { audit } from "@/lib/audit/log";
import { isRecordUuid } from "@/lib/ingestion/path";
import { linkPolicyToClient } from "@/lib/ingestion/policyClientStore";
import { MatchingError } from "@/lib/ingestion/policyMatchingStore";
import { WHY_MAX } from "@/lib/ingestion/policyPage";
import { requireFeatureRole } from "@/lib/tenantAuth/requireFeatureRole";

/**
 * Book of business, round 2 · Policy › Client › Change client: link a carrier policy to another client of
 * this agency, with the reason kept on the link. Through record_policy_match (supersedes, never overwrites),
 * as Policy matching. Owner and bookkeeper, exactly as Policy matching's writes; audited. Unlink is Policy
 * matching's own "reopen" (POST /api/app/policy-matching), not a second path.
 */
const roles = ["owner", "bookkeeper"] as const;
const uuid = z.string().refine(isRecordUuid, "Choose a record.");
const body = z.object({
  carrier_id: uuid,
  policy_number: z.string().trim().min(1).max(100),
  contact_id: uuid,
  reason: z.string().trim().min(1, "Say why, so the link history explains the change.").max(WHY_MAX),
}).strict();

export async function POST(request: NextRequest) {
  const auth = await requireFeatureRole("statement_ingestion", roles, { write: true });
  if (auth instanceof NextResponse) return auth;
  const parsed = body.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Check the request and try again." }, { status: 400 });
  const input = parsed.data;
  const scope = { tenantId: auth.context.tenantId, userId: auth.context.userId };
  try {
    const done = await linkPolicyToClient(scope, { carrierId: input.carrier_id, policyNumber: input.policy_number, contactId: input.contact_id, reason: input.reason });
    await audit({ actorType: "tenant", actorId: auth.context.userId, action: "policy_match.resolved", targetType: "policy_match", targetId: done.matchId, metadata: { via: "change_client", tenantId: scope.tenantId, carrierId: input.carrier_id, policyNumber: input.policy_number, contactId: input.contact_id, previousContactId: done.previousContactId, applicationId: done.applicationId }, request });
    return NextResponse.json({ ok: true, id: done.matchId }, { status: 201 });
  } catch (error) {
    if (error instanceof MatchingError) return NextResponse.json({ error: error.message }, { status: error.status });
    console.error("[policies/client-link]", error);
    return NextResponse.json({ error: "That could not be saved. Try again." }, { status: 500 });
  }
}
