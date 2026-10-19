import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";

import { audit } from "@/lib/audit/log";
import { isRecordUuid } from "@/lib/ingestion/path";
import { OUTCOMES } from "@/lib/ingestion/retentionBoard";
import { logOutcome, RetentionError } from "@/lib/ingestion/retentionStore";
import { requireFeatureRole } from "@/lib/tenantAuth/requireFeatureRole";
import { scopeFor } from "@/lib/agency/visibility";

/**
 * LA-4.16 (Notion sprint) · log a retention call. What the board claimed at that moment is recorded
 * from the server's own reading, and the next carrier file decides saved, still at risk or lost.
 *
 * Owner and producer, as the lapse-risk board; a producer only reaches policies credited to them.
 */
const body = z.object({
  action: z.literal("log_outcome"),
  carrier_id: z.string().refine(isRecordUuid, "Choose the policy."),
  policy_number: z.string().min(1).max(100),
  outcome: z.enum(OUTCOMES, { message: "Choose what happened on the call." }),
  note: z.string().trim().max(2000).nullable(),
}).strict();

export async function POST(request: NextRequest) {
  const auth = await requireFeatureRole("chargeback_radar", ["owner", "producer", "retention"] as const, { write: true });
  if (auth instanceof NextResponse) return auth;
  const parsed = body.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Check the request and try again." }, { status: 400 });
  const b = parsed.data;
  const { tenantId, userId, role } = auth.context;
  try {
    // AG-0.5 · the policy is found through the session's producer scope too (agent_user_id): another producer's
    // policy is "not on your board" (404). The retention role's scope is null: it works the whole book.
    const logged = await logOutcome({ tenantId, userId, role, scope: await scopeFor(auth.context) }, { carrierId: b.carrier_id, policyNumber: b.policy_number, outcome: b.outcome, note: b.note });
    await audit({ actorType: "tenant", actorId: userId, action: "retention.call_logged", targetType: "policy", targetId: `${b.carrier_id}:${b.policy_number}`, metadata: { tenantId, outcome: b.outcome, reason: logged.reason }, request });
    return NextResponse.json({ ok: true });
  } catch (error) {
    if (error instanceof RetentionError) return NextResponse.json({ error: error.message }, { status: error.status });
    console.error("[retention] log:", error);
    return NextResponse.json({ error: "The call could not be logged" }, { status: 500 });
  }
}
