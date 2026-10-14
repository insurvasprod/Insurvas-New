import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";

import { audit } from "@/lib/audit/log";
import { isRecordUuid } from "@/lib/ingestion/path";
import { ACTION_TAKEN, CONTACT_OUTCOMES, SNOOZE_DAYS } from "@/lib/retention/constants";
import { holdCard, logSaveAttempt, SaveQueueError } from "@/lib/retention/queueStore";
import { requireFeatureRole } from "@/lib/tenantAuth/requireFeatureRole";

/**
 * LA-5.3 (Notion sprint) · work a save-queue card: log what happened (the score, band, weight version
 * and exposure at that moment are read here, never from the browser), or snooze / dismiss it with a
 * reason. Owner and producer, as the radar; a producer only reaches policies credited to them.
 */
const policy = {
  carrier_id: z.string().refine(isRecordUuid, "Choose the policy."),
  policy_number: z.string().min(1).max(120),
};
const body = z.discriminatedUnion("action", [
  z.object({
    action: z.literal("log_attempt"),
    ...policy,
    outcome: z.enum(CONTACT_OUTCOMES, { message: "Choose what happened on the call." }),
    action_taken: z.enum(ACTION_TAKEN, { message: "Choose what you did." }),
    note: z.string().trim().max(2000).nullable(),
  }).strict(),
  z.object({
    action: z.literal("hold"),
    ...policy,
    kind: z.enum(["snooze", "dismiss"]),
    reason: z.string().trim().min(3, "Say why, in a few words.").max(500),
    days: z.number().int().refine((d) => (SNOOZE_DAYS as readonly number[]).includes(d), "Choose how long to snooze.").nullable(),
  }).strict(),
]);

export async function POST(request: NextRequest) {
  const auth = await requireFeatureRole("chargeback_radar", ["owner", "producer"] as const, { write: true });
  if (auth instanceof NextResponse) return auth;
  const parsed = body.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Check the request and try again." }, { status: 400 });
  const b = parsed.data;
  const { tenantId, userId, role } = auth.context;
  const viewer = { tenantId, userId, role };
  try {
    if (b.action === "log_attempt") {
      const logged = await logSaveAttempt(viewer, { carrierId: b.carrier_id, policyNumber: b.policy_number, outcome: b.outcome, actionTaken: b.action_taken, note: b.note });
      await audit({ actorType: "tenant", actorId: userId, action: "retention.save_attempt_logged", targetType: "policy", targetId: `${b.carrier_id}:${b.policy_number}`, metadata: { tenantId, outcome: b.outcome, actionTaken: b.action_taken, score: logged.score, band: logged.band }, request });
      return NextResponse.json({ ok: true });
    }
    if (b.kind === "snooze" && b.days === null) return NextResponse.json({ error: "Choose how long to snooze." }, { status: 400 });
    const held = await holdCard(viewer, { carrierId: b.carrier_id, policyNumber: b.policy_number, kind: b.kind, reason: b.reason, days: b.kind === "snooze" ? b.days : null });
    await audit({ actorType: "tenant", actorId: userId, action: "retention.save_card_held", targetType: "policy", targetId: `${b.carrier_id}:${b.policy_number}`, metadata: { tenantId, kind: b.kind, until: held.until }, request });
    return NextResponse.json({ ok: true, until: held.until });
  } catch (error) {
    if (error instanceof SaveQueueError) return NextResponse.json({ error: error.message }, { status: error.status });
    console.error("[save-queue]", error);
    return NextResponse.json({ error: "That could not be saved" }, { status: 500 });
  }
}
