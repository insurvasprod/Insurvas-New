import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";

import { audit } from "@/lib/audit/log";
import { isRecordUuid } from "@/lib/ingestion/path";
import { LOGGABLE_OUTCOMES } from "@/lib/retention/campaign";
import { CampaignError, logConversionCall, saveTalkTrack } from "@/lib/retention/campaignStore";
import { requireFeatureRole } from "@/lib/tenantAuth/requireFeatureRole";
import { scopeFor } from "@/lib/agency/visibility";

/**
 * LA-5.5 (Notion sprint) · the paper-bill campaign. Log a call that didn't open a request (no answer,
 * call back, said no with a reason, no bank account), or — owners — save the agency's talk track.
 * "Agreed" is logged by opening the LA-5.4 conversion request, and counts once the file verifies it.
 *
 * Gated on `payment_repair`; owner and producer (a producer reaches the policies credited to them).
 */
const body = z.discriminatedUnion("action", [
  z.object({
    action: z.literal("log_call"),
    carrier_id: z.string().refine(isRecordUuid, "Choose the policy."),
    policy_number: z.string().min(1).max(120),
    outcome: z.enum(LOGGABLE_OUTCOMES, { message: "Choose what happened on the call." }),
    decline_reason: z.string().trim().max(500).nullable(),
    note: z.string().trim().max(2000).nullable(),
  }).strict(),
  z.object({ action: z.literal("talk_track"), text: z.string().max(4000).nullable() }).strict(),
]);

export async function POST(request: NextRequest) {
  const auth = await requireFeatureRole("payment_repair", ["owner", "producer", "retention"] as const, { write: true });
  if (auth instanceof NextResponse) return auth;
  const parsed = body.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Check the request and try again." }, { status: 400 });
  const b = parsed.data;
  const { tenantId, userId, role } = auth.context;
  // AG-0.5 · a call is logged only on a policy credited to a visible producer (agent_user_id); null scope for
  // the owner, bookkeeper and retention role leaves this exactly as it was.
  const viewer = { tenantId, userId, role, scope: await scopeFor(auth.context) };
  try {
    if (b.action === "talk_track") {
      if (role !== "owner") return NextResponse.json({ error: "Only an owner can change the talk track." }, { status: 403 });
      if (b.text !== null && b.text.trim().length > 0 && b.text.trim().length < 10) return NextResponse.json({ error: "A talk track is at least a sentence." }, { status: 400 });
      await saveTalkTrack(viewer, b.text);
      await audit({ actorType: "tenant", actorId: userId, action: "retention.talk_track_saved", targetType: "tenant", targetId: tenantId, metadata: { tenantId, cleared: !b.text?.trim() }, request });
      return NextResponse.json({ ok: true });
    }
    await logConversionCall(viewer, { carrierId: b.carrier_id, policyNumber: b.policy_number, outcome: b.outcome, declineReason: b.decline_reason, note: b.note });
    await audit({ actorType: "tenant", actorId: userId, action: "retention.conversion_call_logged", targetType: "policy", targetId: `${b.carrier_id}:${b.policy_number}`, metadata: { tenantId, outcome: b.outcome }, request });
    return NextResponse.json({ ok: true });
  } catch (error) {
    if (error instanceof CampaignError) return NextResponse.json({ error: error.message }, { status: error.status });
    console.error("[campaign]", error);
    return NextResponse.json({ error: "That could not be saved" }, { status: 500 });
  }
}
