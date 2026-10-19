import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";

import { audit } from "@/lib/audit/log";
import { isRecordUuid } from "@/lib/ingestion/path";
import { ReinstatementError, updateCase } from "@/lib/retention/reinstatementStore";
import { requireFeatureRole } from "@/lib/tenantAuth/requireFeatureRole";
import { scopeFor } from "@/lib/agency/visibility";

/**
 * LA-5.6 (Notion sprint) · a step on a reinstatement case: the call, what the carrier needs (amount
 * owed, health questions, a signed form), sent, or the client's / carrier's no with its reason.
 * Reinstated and expired are never a person's to set: the carrier file and the calendar decide.
 *
 * Gated on `winback`; owner and producer (a producer reaches the policies credited to them).
 */
const body = z.object({
  id: z.string().refine(isRecordUuid, "Choose the case."),
  status: z.enum(["contacted", "client_agreed", "submitted", "declined_by_client", "declined_by_carrier"]).optional(),
  decline_reason: z.string().trim().max(500).nullable().optional(),
  amount_owed_cents: z.number().int().min(0).max(100_000_000).nullable().optional(),
  months_owed: z.number().int().min(0).max(60).nullable().optional(),
  requires_health_questions: z.boolean().nullable().optional(),
  requires_signed_form: z.boolean().nullable().optional(),
  requirements_note: z.string().trim().max(1000).nullable().optional(),
  carrier_reference: z.string().trim().max(120).nullable().optional(),
  note: z.string().trim().max(2000).nullable().optional(),
}).strict();

export async function POST(request: NextRequest) {
  const auth = await requireFeatureRole("winback", ["owner", "producer", "retention"] as const, { write: true });
  if (auth instanceof NextResponse) return auth;
  const parsed = body.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Check the request and try again." }, { status: 400 });
  const b = parsed.data;
  const { tenantId, userId, role } = auth.context;
  try {
    // AG-0.5 · a case on a policy credited to an invisible producer is "not in your book" (404).
    const moved = await updateCase({ tenantId, userId, role, scope: await scopeFor(auth.context) }, b.id, {
      status: b.status, declineReason: b.decline_reason, amountOwedCents: b.amount_owed_cents, monthsOwed: b.months_owed,
      requiresHealthQuestions: b.requires_health_questions, requiresSignedForm: b.requires_signed_form, requirementsNote: b.requirements_note,
      carrierReference: b.carrier_reference, note: b.note,
    });
    await audit({ actorType: "tenant", actorId: userId, action: "retention.reinstatement_updated", targetType: "reinstatement_case", targetId: b.id, metadata: { tenantId, from: moved.from, to: moved.to }, request });
    return NextResponse.json({ ok: true });
  } catch (error) {
    if (error instanceof ReinstatementError) return NextResponse.json({ error: error.message }, { status: error.status });
    console.error("[reinstatement]", error);
    return NextResponse.json({ error: "That could not be saved" }, { status: 500 });
  }
}
