import { randomUUID } from "node:crypto";
import { NextResponse, type NextRequest } from "next/server";

import { audit } from "@/lib/audit/log";
import { writePartnerIntakeArtifacts } from "@/lib/agentTemplates/intake";
import { createPartnerLead, getTenantTemplateForProduct, PartnerDuplicateError, validateValues } from "@/lib/agentTemplates/service";
import { buildAffiliateTemplate } from "@/lib/affiliate/form";
import { partnerRejectsThisMonth } from "@/lib/compliance/partnerCompliance";
import { NEUTRAL_END_CALL_SCRIPT, recordRejectedPartnerSubmission, TCPA_REJECTION_REASON } from "@/lib/compliance/rejectedSubmissions";
import { SCREENING_UNAVAILABLE_MESSAGE } from "@/lib/compliance/screeningCore";
import { evaluateTransfer, linkVerdictToLead, TransferGateUnrecorded } from "@/lib/compliance/transferGate";
import { partnerRejectPayload } from "@/lib/compliance/transferGateCore";
import { partnerMayOpen, partnerPageRefused, requirePartner } from "@/lib/partnerAuth/requirePartner";
import { assertPartnerProductApproved, listPartnerApprovedProducts } from "@/lib/partnerProducts/service";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

/**
 * LA-1.8 · "Refer someone" inside the partner portal (roles board P2/P3): the short form — name,
 * phone, state, product interest, consent — for affiliates and marketing partners.
 *
 * The one intake pipeline, not a second one (LA-1.8 "the rule"): the same short form definition as the
 * public tracked link (lib/affiliate/form.ts), the same transfer gate and screening (LA-6.2, LA-1.5),
 * the same createPartnerLead and intake artifacts as a portal submission. What differs from the public
 * link is only the entry point: the partner is signed in, so the lead carries the person who referred
 * it, and no click is counted (only /affiliate/[slug] counts clicks).
 *
 * Answers the partner the way the portal answers a block: a coded reason and a count, never which list
 * matched or the number (Q9).
 */
export async function POST(request: NextRequest) {
  const auth = await requirePartner();
  if (auth instanceof NextResponse) return auth;
  if (!(await partnerMayOpen(auth.context, "refer"))) return partnerPageRefused();
  // LA-1.1: a paused partner sends nothing new.
  if (auth.context.partnerStatus !== "active") return NextResponse.json({ error: "This partner is paused and cannot send new referrals" }, { status: 403 });
  const { context } = auth;
  const body = (await request.json().catch(() => null)) as { product_code?: unknown; values?: unknown; submission_id?: unknown; screening_warning_acknowledged?: unknown; consent_attested?: unknown } | null;
  if (typeof body?.product_code !== "string" || !/^[a-z][a-z0-9_]{1,59}$/.test(body.product_code)) return NextResponse.json({ error: "Choose a valid product" }, { status: 400 });
  if (body.submission_id !== undefined && (typeof body.submission_id !== "string" || !UUID.test(body.submission_id))) return NextResponse.json({ error: "This referral has an invalid retry key" }, { status: 400 });
  if (body.screening_warning_acknowledged !== undefined && typeof body.screening_warning_acknowledged !== "boolean") return NextResponse.json({ error: "The DNC acknowledgement is invalid" }, { status: 400 });
  const values = body.values && typeof body.values === "object" && !Array.isArray(body.values) ? body.values as Record<string, unknown> : {};
  if (values.product_interest !== body.product_code) return NextResponse.json({ error: "Choose what they are interested in" }, { status: 400 });
  // The referred person's consent to be contacted, attested by the partner who referred them.
  if (values.consent !== true || body.consent_attested !== true) return NextResponse.json({ error: "Confirm they agreed to be contacted before you send this", code: "consent_required" }, { status: 400 });
  const submissionId = typeof body.submission_id === "string" ? body.submission_id : randomUUID();
  try {
    await assertPartnerProductApproved(context.tenantId, context.partnerId, body.product_code);
    const approvedProducts = await listPartnerApprovedProducts(context.tenantId, context.partnerId);
    const template = buildAffiliateTemplate(await getTenantTemplateForProduct(context.tenantId, body.product_code), approvedProducts);
    const validationError = validateValues(template.template.fields, values, template.template.form_definition);
    const phoneField = template.template.fields.find((field) => field.field_key === "phone");
    const phoneValidationError = Boolean(phoneField && validationError?.startsWith(phoneField.label));
    if (validationError && !phoneValidationError) return NextResponse.json({ error: validationError }, { status: 400 });
    const carrierState = typeof values.state === "string" && /^[A-Z]{2}$/.test(values.state.trim().toUpperCase()) ? values.state.trim().toUpperCase() : null;
    const gate = await evaluateTransfer({ tenantId: context.tenantId, partnerId: context.partnerId, partnerUserId: context.userId, productCode: body.product_code, phone: values.phone, carrierState, submissionId, stage: "submit", values });
    const screening = gate.screening;
    if (!screening) return NextResponse.json({ error: SCREENING_UNAVAILABLE_MESSAGE, code: "unavailable", blocked: true }, { status: 503 });
    if (gate.decision.verdict === "reject" && (gate.decision.blockingReason === "internal_dnc" || gate.decision.blockingReason === "consent_missing")) {
      const count = await partnerRejectsThisMonth(context.tenantId, context.partnerId);
      return NextResponse.json(partnerRejectPayload(Math.max(count, 1), NEUTRAL_END_CALL_SCRIPT), { status: 422 });
    }
    if (gate.decision.verdict === "reject" && screening.allowed) return NextResponse.json({ error: SCREENING_UNAVAILABLE_MESSAGE, code: "unavailable", blocked: true }, { status: 503 });
    if (!screening.allowed) {
      if (screening.outcome === "tcpa_litigator") {
        const rejection = await recordRejectedPartnerSubmission({ tenantId: context.tenantId, partnerId: context.partnerId, userId: context.userId, submissionId, productCode: body.product_code, reason: TCPA_REJECTION_REASON, phoneDigits: screening.phoneDigits, screeningResultId: screening.resultId });
        if (rejection.created) await audit({ actorType: "tenant", actorId: context.userId, action: "tenant.partner_submission_rejected", targetType: "partner_rejected_submission", targetId: rejection.id, reason: TCPA_REJECTION_REASON, metadata: { partnerId: context.partnerId, productCode: body.product_code, count: rejection.count, phone: rejection.maskedPhone, entry: "portal_referral" }, request });
        const count = await partnerRejectsThisMonth(context.tenantId, context.partnerId);
        return NextResponse.json(partnerRejectPayload(Math.max(count, 1), NEUTRAL_END_CALL_SCRIPT), { status: 422 });
      }
      const status = screening.outcome === "unavailable" ? 503 : 422;
      return NextResponse.json({ error: screening.message, code: screening.outcome, blocked: true, phone: screening.phoneDigits ? `••••${screening.phoneDigits.slice(-4)}` : null }, { status });
    }
    if (validationError) return NextResponse.json({ error: validationError }, { status: 400 });
    // No internal-DQ justification on the short form: a number the agency disqualified is refused, as on the public link.
    const result = await createPartnerLead(context.tenantId, context.partnerId, context.userId, template, values, submissionId, screening, { screeningWarningAcknowledged: body.screening_warning_acknowledged === true, requireInternalDqReason: true, duplicateOverrideJustification: null });
    await linkVerdictToLead(context.tenantId, gate.verdictId, result.lead.id);
    await writePartnerIntakeArtifacts({ tenantId: context.tenantId, partnerId: context.partnerId, userId: context.userId, partnerTimezone: context.partnerTimezone, submissionId, lead: result.lead, request });
    await audit({ actorType: "tenant", actorId: context.userId, action: "tenant.partner_lead_submitted", targetType: "agent_lead", targetId: result.lead.id, metadata: { partnerId: context.partnerId, productCode: body.product_code, replayed: result.replayed, entry: "portal_referral", consentAttestedAt: new Date().toISOString() }, request });
    // The lead's id, so the form can open its record; nothing of the agency's screening notes.
    return NextResponse.json({ ok: true, leadId: result.lead.id, replayed: result.replayed }, { status: result.replayed ? 200 : 201 });
  } catch (error) {
    if (error instanceof TransferGateUnrecorded) return NextResponse.json({ error: SCREENING_UNAVAILABLE_MESSAGE, code: "unavailable", blocked: true }, { status: error.status });
    if (error instanceof PartnerDuplicateError) {
      // Which fields matched, never which lead (LA-1 audit); the agency's audit row keeps the matches.
      await audit({ actorType: "tenant", actorId: context.userId, action: "tenant.partner_lead_duplicate_detected", targetType: "partner_lead_submission", targetId: submissionId, metadata: { partnerId: context.partnerId, productCode: body.product_code, matches: error.matches, entry: "portal_referral" }, request });
      return NextResponse.json({ error: "The agency already has this person. They will be in touch.", code: "duplicate_lead" }, { status: 409 });
    }
    const message = error instanceof Error ? error.message : "Could not send this referral";
    if (message === "internal_dq_reason_required") return NextResponse.json({ error: "The agency can't take this referral. Message your agent if you think it should.", code: "referral_not_accepted" }, { status: 422 });
    if (message === "dnc_acknowledgement_required") return NextResponse.json({ error: "Acknowledge the DNC warning before sending", code: "dnc_acknowledgement_required" }, { status: 409 });
    const status = message === "partner_product_not_approved" || message === "product_not_enabled" ? 403 : message === "product_not_found" || message.includes("No configured form") ? 404 : 400;
    return NextResponse.json({ error: message === "partner_product_not_approved" ? "That product is not available to you" : message === "product_not_enabled" ? "That product is not currently available" : message }, { status });
  }
}
