import { NextResponse, type NextRequest } from "next/server";

import { requirePartner } from "@/lib/partnerAuth/requirePartner";
import { assertPartnerProductApproved } from "@/lib/partnerProducts/service";
import { screenPartnerPhone } from "@/lib/compliance/screening";
import { NEUTRAL_END_CALL_SCRIPT, recordRejectedPartnerSubmission, TCPA_REJECTION_REASON } from "@/lib/compliance/rejectedSubmissions";
import { audit } from "@/lib/audit/log";

/** Screen before the form is made available. The submit endpoint repeats this check. */
export async function POST(request: NextRequest, { params }: { params: Promise<{ productCode: string }> }) {
  const auth = await requirePartner();
  if (auth instanceof NextResponse) return auth;
  if (auth.context.partnerStatus !== "active") return NextResponse.json({ error: "This partner is paused and cannot screen new leads" }, { status: 403 });
  const productCode = (await params).productCode;
  try {
    await assertPartnerProductApproved(auth.context.tenantId, auth.context.partnerId, productCode);
    const body = await request.json().catch(() => null) as { phone?: unknown; submission_id?: unknown } | null;
    if (body?.submission_id !== undefined && (typeof body.submission_id !== "string" || !UUID.test(body.submission_id))) return NextResponse.json({ error: "This screening request is missing a valid retry key" }, { status: 400 });
    const submissionId = typeof body?.submission_id === "string" ? body.submission_id : crypto.randomUUID();
    const screening = await screenPartnerPhone({ tenantId: auth.context.tenantId, partnerId: auth.context.partnerId, userId: auth.context.userId, phone: body?.phone });
    if (!screening.allowed) {
      const status = screening.outcome === "unavailable" ? 503 : 422;
      if (screening.outcome === "tcpa_litigator") {
        const rejection = await recordRejectedPartnerSubmission({ tenantId: auth.context.tenantId, partnerId: auth.context.partnerId, userId: auth.context.userId, submissionId, productCode, reason: TCPA_REJECTION_REASON, phoneDigits: screening.phoneDigits, screeningResultId: screening.resultId });
        if (rejection.created) await audit({ actorType: "tenant", actorId: auth.context.userId, action: "tenant.partner_submission_rejected", targetType: "partner_rejected_submission", targetId: rejection.id, reason: TCPA_REJECTION_REASON, metadata: { partnerId: auth.context.partnerId, productCode, count: rejection.count, phone: rejection.maskedPhone }, request });
        return NextResponse.json({ error: "This submission cannot continue", code: TCPA_REJECTION_REASON, blocked: true, phone: rejection.maskedPhone, blocked_count: rejection.count, neutral_end_call_script: NEUTRAL_END_CALL_SCRIPT }, { status: 422 });
      }
      return NextResponse.json({ error: screening.message, code: screening.outcome, blocked: true, phone: screening.phoneDigits ? `••••${screening.phoneDigits.slice(-4)}` : null }, { status });
    }
    return NextResponse.json({ screened: true, outcome: screening.outcome, warning: screening.warning, phone: screening.phoneDigits ? `••••${screening.phoneDigits.slice(-4)}` : null, cached: screening.cached, checked_at: screening.checkedAt }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Could not screen this number";
    const status = message === "partner_product_not_approved" || message === "product_not_enabled" ? 403 : message === "product_not_found" ? 404 : 400;
    return NextResponse.json({ error: message === "partner_product_not_approved" ? "This partner is not approved for that product" : message === "product_not_enabled" ? "That product is disabled for this tenant" : message }, { status });
  }
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
