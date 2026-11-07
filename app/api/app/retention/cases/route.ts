import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";

import { audit } from "@/lib/audit/log";
import { isRecordUuid } from "@/lib/ingestion/path";
import { ACTION_TAKEN, CONTACT_OUTCOMES } from "@/lib/retention/constants";
import { CaseError, FIX_KINDS, addNote, assignCase, closeCase, linkServicing, logCaseCall, openManualCase, recordFix } from "@/lib/retention/cases/store";
import { requireFeatureRole } from "@/lib/tenantAuth/requireFeatureRole";
import { scopeFor } from "@/lib/agency/visibility";

/**
 * The Retention ladder (owner 2026-11-05, docs/retention/SPEC.md) · what a person does on a case: log a call,
 * record a fix (the case then waits for a carrier file to prove it), link the servicing request opened from it,
 * assign it (owner), close it without a save (with a reason) or close a lost one to win-back, and open a case no
 * file carries (a new payment date). Opening, moving and saving are the files' (lib/retention/cases/sync.ts).
 *
 * Gated on `chargeback_radar` (the Retention module); owner, producer (their policies), retention (their cases).
 */
const id = z.string().refine(isRecordUuid, "Choose the case.");
const body = z.discriminatedUnion("action", [
  z.object({ action: z.literal("call"), id, outcome: z.enum(CONTACT_OUTCOMES, { message: "Choose what happened on the call." }), did: z.enum(ACTION_TAKEN), note: z.string().trim().max(2000).nullable() }).strict(),
  z.object({ action: z.literal("fix"), id, kind: z.enum(FIX_KINDS), note: z.string().trim().max(2000).nullable(), amount_cents: z.number().int().min(0).max(100_000_000).nullable().optional(), items: z.array(z.string().trim().min(1).max(200)).max(20).optional() }).strict(),
  z.object({ action: z.literal("link_servicing"), id, request_id: z.string().refine(isRecordUuid, "Choose the request.") }).strict(),
  z.object({ action: z.literal("note"), id, note: z.string().trim().min(1, "Write the note first.").max(2000) }).strict(),
  z.object({ action: z.literal("assign"), id, user_id: z.string().refine(isRecordUuid, "Choose who.") }).strict(),
  z.object({ action: z.literal("close"), id, as: z.enum(["closed_no_save", "lost"]), reason: z.string().trim().max(1000) }).strict(),
  z.object({ action: z.literal("open"), carrier_id: z.string().refine(isRecordUuid, "Choose the policy."), policy_number: z.string().trim().min(1).max(120), reason: z.literal("payment_date_change"), note: z.string().trim().max(2000).nullable() }).strict(),
]);

export async function POST(request: NextRequest) {
  const auth = await requireFeatureRole("chargeback_radar", ["owner", "producer", "retention"] as const, { write: true });
  if (auth instanceof NextResponse) return auth;
  const parsed = body.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Check the request and try again." }, { status: 400 });
  const b = parsed.data;
  const { tenantId, userId, role } = auth.context;
  const viewer = { tenantId, userId, role, scope: await scopeFor(auth.context) };
  try {
    let result: Record<string, unknown> = { ok: true };
    if (b.action === "call") await logCaseCall(viewer, b.id, { outcome: b.outcome, did: b.did, note: b.note });
    else if (b.action === "fix") await recordFix(viewer, b.id, { kind: b.kind, note: b.note, amountCents: b.amount_cents ?? null, items: b.items });
    else if (b.action === "link_servicing") await linkServicing(viewer, b.id, b.request_id);
    else if (b.action === "note") await addNote(viewer, b.id, b.note);
    else if (b.action === "assign") await assignCase(viewer, b.id, b.user_id);
    else if (b.action === "close") await closeCase(viewer, b.id, { as: b.as, reason: b.reason });
    else result = { ok: true, ...(await openManualCase(viewer, { carrierId: b.carrier_id, policyNumber: b.policy_number, reason: b.reason, note: b.note })) };
    await audit({ actorType: "tenant", actorId: userId, action: `retention.case_${b.action}`, targetType: "retention_case", targetId: "id" in b ? b.id : `${b.carrier_id}:${b.policy_number}`, metadata: { tenantId }, request });
    return NextResponse.json(result);
  } catch (error) {
    if (error instanceof CaseError) return NextResponse.json({ error: error.message }, { status: error.status });
    console.error("[retention cases]", error);
    return NextResponse.json({ error: "That could not be saved" }, { status: 500 });
  }
}
