import { NextResponse, type NextRequest } from "next/server";

import { requirePartner } from "@/lib/partnerAuth/requirePartner";
import { evaluateTransfer, TransferGateUnrecorded } from "@/lib/compliance/transferGate";
import { partnerRejectsThisMonth } from "@/lib/compliance/partnerCompliance";
import { partnerClearedPayload, partnerRejectPayload } from "@/lib/compliance/transferGateCore";
import { SCREENING_UNAVAILABLE_MESSAGE } from "@/lib/compliance/screeningCore";
import { NEUTRAL_END_CALL_SCRIPT, recordRejectedPartnerSubmission, TCPA_REJECTION_REASON } from "@/lib/compliance/rejectedSubmissions";
import { audit } from "@/lib/audit/log";
import { assertPartnerStateAccess } from "@/lib/partnerMarkets/service";
import {
  getPartnerTemplateForProduct,
  getPartnerTemplateForProductProfileRevision,
  getPartnerTenantTemplateForProductVersion,
  loadPartnerFormDraftById,
  savePartnerFormDraftSlot,
} from "@/lib/agentTemplates/service";
import { isPhoneTemplateField, type TemplateField } from "@/lib/templates/constants";
import { getUsPhone10Digits } from "@/lib/compliance/scrub";
import { getSupabaseServiceClient } from "@/lib/supabase/service";

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
    const body = await request.json().catch(() => null) as { phone?: unknown; payload?: unknown; submission_id?: unknown; carrier_state?: unknown; draft_id?: unknown } | null;
    if (body?.submission_id !== undefined && (typeof body.submission_id !== "string" || !UUID.test(body.submission_id))) return NextResponse.json({ error: "This screening request is missing a valid retry key" }, { status: 400 });
    if (body?.draft_id !== undefined && body.draft_id !== null && (typeof body.draft_id !== "string" || !UUID.test(body.draft_id))) return NextResponse.json({ error: "That draft id is not valid" }, { status: 400 });
    const submissionId = typeof body?.submission_id === "string" ? body.submission_id : crypto.randomUUID();
    if (typeof body?.carrier_state !== "string")
      return NextResponse.json({ error: "Choose an allowed customer state" }, { status: 400 });
    const market = await assertPartnerStateAccess(auth.context.tenantId, auth.context.partnerId, auth.context.userId, body.carrier_state);
    const carrierState = market.state;
    const draftId = typeof body?.draft_id === "string" ? body.draft_id : null;
    let existingDraft: Awaited<ReturnType<typeof loadPartnerFormDraftById>> = null;
    let screenTemplate: {
      tenant_template_id: string;
      assignment: { definition_version: number };
      template: { fields: TemplateField[] };
      partner_submission_profile_id?: string | null;
      profile_revision?: number | null;
    } | null = null;
    if (draftId) {
      existingDraft = await loadPartnerFormDraftById(auth.context.tenantId, auth.context.userId, auth.context.partnerId, draftId);
      if (!existingDraft || existingDraft.product_code !== productCode) return NextResponse.json({ error: "That draft was not found" }, { status: 404 });
      screenTemplate = existingDraft.partner_submission_profile_id && existingDraft.partner_submission_profile_revision
        ? await getPartnerTemplateForProductProfileRevision(auth.context.tenantId, existingDraft.partner_submission_profile_id, existingDraft.partner_submission_profile_revision, productCode)
        : await getPartnerTenantTemplateForProductVersion(auth.context.tenantId, productCode, existingDraft.definition_version);
      if (existingDraft.carrier_state !== carrierState)
        return NextResponse.json({ error: "Choose the same customer state saved with this draft before screening" }, { status: 409 });
    } else {
      screenTemplate = await getPartnerTemplateForProduct(auth.context.tenantId, auth.context.partnerId, auth.context.userId, productCode);
    }
    const submittedPayload = body?.payload && typeof body.payload === "object" && !Array.isArray(body.payload)
      ? body.payload as Record<string, unknown>
      : null;
    const phoneField = screenTemplate?.template.fields.find(isPhoneTemplateField);
    let submittedDigits: string | null = null;
    let payloadDigits: string | null = null;
    try { submittedDigits = getUsPhone10Digits(body?.phone); } catch { /* invalid phones are handled by the normal gate */ }
    try { payloadDigits = getUsPhone10Digits(phoneField && submittedPayload ? submittedPayload[phoneField.field_key] : null); } catch { /* invalid phones are handled by the normal gate */ }
    if (!phoneField || !submittedPayload || !submittedDigits || submittedDigits !== payloadDigits)
      return NextResponse.json({ error: "The phone number changed. Check it and try screening again." }, { status: 409 });

    const persistCompletedScreen = async (resultId: string | null, checkedAt: string | null, snapshot: Record<string, unknown>) => {
      if (!resultId || !checkedAt || snapshot.screened !== true || !screenTemplate || !submittedPayload) return null;
      const { data: result, error: resultError } = await getSupabaseServiceClient()
        .from("screening_results")
        .select("id, phone_digits, outcome")
        .eq("tenant_id", auth.context.tenantId)
        .eq("id", resultId)
        .maybeSingle();
      if (resultError || !result || result.phone_digits !== submittedDigits || result.outcome === "invalid_phone" || result.outcome === "unavailable") return null;
      const profileTemplate = screenTemplate as {
        partner_submission_profile_id?: string | null;
        profile_revision?: number | null;
      };
      const savedDraftId = await savePartnerFormDraftSlot(
        auth.context.tenantId,
        auth.context.userId,
        auth.context.partnerId,
        productCode,
        {
          tenant_template_id: screenTemplate.tenant_template_id,
          definition_version: screenTemplate.assignment.definition_version,
          partner_submission_profile_id: profileTemplate.partner_submission_profile_id,
          profile_revision: profileTemplate.profile_revision,
        },
        submittedPayload,
        draftId,
      );
      const { error } = await getSupabaseServiceClient()
        .from("form_drafts")
        .update({
          carrier_id: null,
          carrier_state: carrierState,
          partner_market_access_profile_id: market.profile_id,
          partner_market_access_profile_revision: market.revision,
          screening_result_id: result.id,
          screening_submission_id: submissionId,
          screening_snapshot: snapshot,
        } as never)
        .eq("id", savedDraftId)
        .eq("tenant_id", auth.context.tenantId)
        .eq("partner_id", auth.context.partnerId)
        .eq("user_id", auth.context.userId)
        .eq("product_code", productCode);
      if (error) throw new Error("Could not save the screening result with this draft");
      if (!existingDraft) await audit({
        actorType: "tenant",
        actorId: auth.context.userId,
        action: "tenant.form_draft_saved",
        targetType: "form_draft",
        targetId: savedDraftId,
        metadata: { partnerId: auth.context.partnerId, productCode, definitionVersion: screenTemplate.assignment.definition_version, profileId: profileTemplate.partner_submission_profile_id, profileRevision: profileTemplate.profile_revision, createdAfterPhoneScreen: true },
        request,
      });
      return savedDraftId;
    };

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
      const payload = { ...partnerRejectPayload(Math.max(count, 1), NEUTRAL_END_CALL_SCRIPT), screened: Boolean(screening?.resultId && screening.checkedAt) };
      return NextResponse.json(payload, { status: 422 });
    }
    if (!screening) return NextResponse.json({ error: SCREENING_UNAVAILABLE_MESSAGE, code: "unavailable", blocked: true }, { status: 503 });
    const payload = partnerClearedPayload(screening);
    const savedDraftId = await persistCompletedScreen(screening.resultId, screening.checkedAt, { ...payload, screened: true });
    if (!savedDraftId) return NextResponse.json({ error: SCREENING_UNAVAILABLE_MESSAGE, code: "unavailable", blocked: true }, { status: 503 });
    return NextResponse.json({ ...payload, draft_id: savedDraftId }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    if (error instanceof TransferGateUnrecorded) return NextResponse.json({ error: error.message, code: "unavailable", blocked: true }, { status: error.status });
    const message = error instanceof Error ? error.message : "Could not screen this number";
    return NextResponse.json({ error: message }, { status: 400 });
  }
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
