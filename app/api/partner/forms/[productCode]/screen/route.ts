import { NextResponse, type NextRequest } from "next/server";

import { requirePartner } from "@/lib/partnerAuth/requirePartner";
import { evaluateTransfer, TransferGateUnrecorded } from "@/lib/compliance/transferGate";
import { partnerRejectsThisMonth } from "@/lib/compliance/partnerCompliance";
import { partnerClearedPayload, partnerRejectPayload } from "@/lib/compliance/transferGateCore";
import { SCREENING_UNAVAILABLE_MESSAGE } from "@/lib/compliance/screeningCore";
import { NEUTRAL_END_CALL_SCRIPT, recordRejectedPartnerSubmission, TCPA_REJECTION_REASON } from "@/lib/compliance/rejectedSubmissions";
import { audit } from "@/lib/audit/log";

/**
 * Screen on phone-number entry, before the call is transferred (LA-6.2, Q9): the real gate. Every
 * check runs once through the module that owns it and one verdict is recorded. The submit endpoint
 * evaluates again.
 *
 * What the partner learns (Sixteen Open Questions #9): a coded, neutral verdict and a running count.
 * Never which check fired, which list a number is on, or any digits of a blocked number — a list of
 * which numbers are litigators or on a do-not-call list is something a call centre could sell. So a
 * litigator hit, our own do-not-call list and a blocking consent gap all answer the same
 * `compliance_screening` payload, and an accept says only that the number is cleared. The reason
 * stays in the tenant's own records (the verdict row, the rejected-submission row).
 */
export async function POST(request: NextRequest, { params }: { params: Promise<{ productCode: string }> }) {
  const auth = await requirePartner();
  if (auth instanceof NextResponse) return auth;
  if (auth.context.partnerStatus !== "active") return NextResponse.json({ error: "This partner is paused and cannot screen new leads" }, { status: 403 });
  const productCode = (await params).productCode;
  try {
    const body = await request.json().catch(() => null) as { phone?: unknown; submission_id?: unknown; carrier_state?: unknown } | null;
    if (body?.submission_id !== undefined && (typeof body.submission_id !== "string" || !UUID.test(body.submission_id))) return NextResponse.json({ error: "This screening request is missing a valid retry key" }, { status: 400 });
    const submissionId = typeof body?.submission_id === "string" ? body.submission_id : crypto.randomUUID();
    const carrierState = typeof body?.carrier_state === "string" && /^[A-Z]{2}$/.test(body.carrier_state) ? body.carrier_state : null;
    const gate = await evaluateTransfer({ tenantId: auth.context.tenantId, partnerId: auth.context.partnerId, partnerUserId: auth.context.userId, productCode, phone: body?.phone, carrierState, submissionId, stage: "number_entry" });
    const { decision, screening } = gate;
    if (decision.verdict === "reject") {
      if (decision.blockingReason === "partner_not_approved") {
        const detail = decision.checks.find((c) => c.check === "partner_product_approved")?.detail ?? "This partner is not approved for that product";
        return NextResponse.json({ error: detail.replace(/\.$/, "") }, { status: /does not exist/.test(detail) ? 404 : 403 });
      }
      if (decision.blockingReason === "tcpa_litigator") {
        const rejection = await recordRejectedPartnerSubmission({ tenantId: auth.context.tenantId, partnerId: auth.context.partnerId, userId: auth.context.userId, submissionId, productCode, reason: TCPA_REJECTION_REASON, phoneDigits: gate.phoneDigits, screeningResultId: screening?.resultId ?? null });
        if (rejection.created) await audit({ actorType: "tenant", actorId: auth.context.userId, action: "tenant.partner_submission_rejected", targetType: "partner_rejected_submission", targetId: rejection.id, reason: TCPA_REJECTION_REASON, metadata: { partnerId: auth.context.partnerId, productCode, count: rejection.count, phone: rejection.maskedPhone, verdictId: gate.verdictId }, request });
        // Recorded in full for the tenant above; the partner gets the same coded answer as any other block.
      }
      if (decision.blockingReason === "invalid_phone") {
        // The partner's own typing: they may be told the number is not a valid US number.
        return NextResponse.json({ error: screening?.message ?? "Enter a valid US phone number", code: "invalid_phone", blocked: true }, { status: 422 });
      }
      if (decision.blockingReason === "screening_incomplete") {
        // LA-1.5's copy: "Screening could not be completed. Do not treat this number as safe." Not a list hit.
        return NextResponse.json({ error: SCREENING_UNAVAILABLE_MESSAGE, code: "unavailable", blocked: true }, { status: 503 });
      }
      // A litigator hit, our own do-not-call list, or a missing consent artefact where the tenant
      // blocks on it: one coded reason and a count, never which one or the number.
      const count = await partnerRejectsThisMonth(auth.context.tenantId, auth.context.partnerId);
      return NextResponse.json(partnerRejectPayload(Math.max(count, 1), NEUTRAL_END_CALL_SCRIPT), { status: 422 });
    }
    if (!screening) return NextResponse.json({ error: SCREENING_UNAVAILABLE_MESSAGE, code: "unavailable", blocked: true }, { status: 503 });
    return NextResponse.json(partnerClearedPayload(screening), { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    if (error instanceof TransferGateUnrecorded) return NextResponse.json({ error: error.message, code: "unavailable", blocked: true }, { status: error.status });
    const message = error instanceof Error ? error.message : "Could not screen this number";
    return NextResponse.json({ error: message }, { status: 400 });
  }
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
