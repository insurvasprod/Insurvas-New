import { NextResponse, type NextRequest } from "next/server";

import { audit } from "@/lib/audit/log";
import { writePartnerIntakeArtifacts } from "@/lib/agentTemplates/intake";
import {
  createPartnerLead,
  deleteFormDraft,
  getPartnerTemplateForProduct,
  getPartnerTemplateForProductProfileRevision,
  getTenantTemplateForProductVersion,
  loadFormDraft,
  PartnerDuplicateError,
  validateValues,
} from "@/lib/agentTemplates/service";
import { requirePartner } from "@/lib/partnerAuth/requirePartner";
import { assertPartnerProductApproved } from "@/lib/partnerProducts/service";
import { screenPartnerPhone } from "@/lib/compliance/screening";
import {
  NEUTRAL_END_CALL_SCRIPT,
  recordRejectedPartnerSubmission,
  TCPA_REJECTION_REASON,
} from "@/lib/compliance/rejectedSubmissions";
import { assertPartnerMarketAccess } from "@/lib/partnerMarkets/service";
import { isPhoneTemplateField } from "@/lib/templates/constants";

export async function POST(request: NextRequest) {
  const auth = await requirePartner();
  if (auth instanceof NextResponse) return auth;
  if (auth.context.partnerStatus !== "active")
    return NextResponse.json(
      { error: "This partner is paused and cannot submit new leads" },
      { status: 403 },
    );
  const body = (await request.json().catch(() => null)) as {
    product_code?: unknown;
    values?: unknown;
    submission_id?: unknown;
    screening_warning_acknowledged?: unknown;
    duplicate_override_justification?: unknown;
    consent_attested?: unknown;
    carrier_id?: unknown;
    carrier_state?: unknown;
  } | null;
  if (
    typeof body?.product_code !== "string" ||
    !/^[a-z][a-z0-9_]{1,59}$/.test(body.product_code)
  )
    return NextResponse.json(
      { error: "Choose a valid product" },
      { status: 400 },
    );
  if (
    typeof body.submission_id !== "string" ||
    !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
      body.submission_id,
    )
  )
    return NextResponse.json(
      { error: "This submission is missing a valid retry key" },
      { status: 400 },
    );
  if (
    body.screening_warning_acknowledged !== undefined &&
    typeof body.screening_warning_acknowledged !== "boolean"
  )
    return NextResponse.json(
      { error: "The DNC acknowledgement is invalid" },
      { status: 400 },
    );
  if (
    body.duplicate_override_justification !== undefined &&
    body.duplicate_override_justification !== null &&
    typeof body.duplicate_override_justification !== "string"
  )
    return NextResponse.json(
      { error: "The duplicate justification is invalid" },
      { status: 400 },
    );
  if (
    body.consent_attested !== undefined &&
    typeof body.consent_attested !== "boolean"
  )
    return NextResponse.json(
      { error: "The consent confirmation is invalid" },
      { status: 400 },
    );
  try {
    if (
      typeof body.carrier_id !== "string" ||
      !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
        body.carrier_id,
      ) ||
      typeof body.carrier_state !== "string" ||
      !/^[A-Z]{2}$/.test(body.carrier_state)
    ) {
      // The product check has always been decided before the carrier shape; keep that order.
      await assertPartnerProductApproved(
        auth.context.tenantId,
        auth.context.partnerId,
        body.product_code,
      );
      return NextResponse.json(
        { error: "Choose an allowed carrier and state" },
        { status: 400 },
      );
    }
    const values =
      body.values &&
      typeof body.values === "object" &&
      !Array.isArray(body.values)
        ? (body.values as Record<string, unknown>)
        : {};
    // The four reads are independent, so they run together. Failures are rethrown in the
    // original order, so a product rejection still wins over a market/template/draft error.
    const [productCheck, marketResult, templateResult, draftResult] =
      await Promise.allSettled([
        assertPartnerProductApproved(
          auth.context.tenantId,
          auth.context.partnerId,
          body.product_code,
        ),
        assertPartnerMarketAccess(
          auth.context.tenantId,
          auth.context.partnerId,
          auth.context.userId,
          body.carrier_id,
          body.carrier_state,
        ),
        getPartnerTemplateForProduct(
          auth.context.tenantId,
          auth.context.partnerId,
          auth.context.userId,
          body.product_code,
        ),
        loadFormDraft(
          auth.context.tenantId,
          auth.context.userId,
          body.product_code,
          auth.context.partnerId,
        ),
      ]);
    const settled = <T,>(result: PromiseSettledResult<T>): T => {
      if (result.status === "rejected") throw result.reason;
      return result.value;
    };
    settled(productCheck);
    const market = settled(marketResult);
    const currentTemplate = settled(templateResult);
    const existingDraft = settled(draftResult);
    let template = currentTemplate as Parameters<typeof createPartnerLead>[3];
    if (existingDraft) {
      const draftTemplate =
        existingDraft.partner_submission_profile_id &&
        existingDraft.partner_submission_profile_revision
          ? await getPartnerTemplateForProductProfileRevision(
              auth.context.tenantId,
              existingDraft.partner_submission_profile_id,
              existingDraft.partner_submission_profile_revision,
              body.product_code,
            )
          : await getTenantTemplateForProductVersion(
              auth.context.tenantId,
              body.product_code,
              existingDraft.definition_version,
            );
      // A portal resuming the saved draft submits only fields from that immutable snapshot.
      // If a caller sends a newer field set, treat it as a new live-form submission instead
      // of rejecting the valid new field as hidden/unknown.
      const draftKeys = new Set(
        draftTemplate.template.fields.map((field) => field.field_key),
      );
      if (!Object.keys(values).some((key) => !draftKeys.has(key)))
        template = draftTemplate as Parameters<typeof createPartnerLead>[3];
    }
    const phoneField = template.template.fields.find(isPhoneTemplateField);
    const validationError = validateValues(
      template.template.fields,
      body.values,
      template.template.form_definition,
    );
    const phoneValidationError = Boolean(
      phoneField && validationError?.startsWith(phoneField.label),
    );
    if (validationError && !phoneValidationError)
      return NextResponse.json({ error: validationError }, { status: 400 });
    const screening = await screenPartnerPhone({
      tenantId: auth.context.tenantId,
      partnerId: auth.context.partnerId,
      userId: auth.context.userId,
      phone: phoneField ? values[phoneField.field_key] : undefined,
    });
    if (!screening.allowed) {
      const status = screening.outcome === "unavailable" ? 503 : 422;
      if (screening.outcome === "tcpa_litigator") {
        const rejection = await recordRejectedPartnerSubmission({
          tenantId: auth.context.tenantId,
          partnerId: auth.context.partnerId,
          userId: auth.context.userId,
          submissionId: body.submission_id,
          productCode: body.product_code,
          reason: TCPA_REJECTION_REASON,
          phoneDigits: screening.phoneDigits,
          screeningResultId: screening.resultId,
        });
        if (rejection.created)
          await audit({
            actorType: "tenant",
            actorId: auth.context.userId,
            action: "tenant.partner_submission_rejected",
            targetType: "partner_rejected_submission",
            targetId: rejection.id,
            reason: TCPA_REJECTION_REASON,
            metadata: {
              partnerId: auth.context.partnerId,
              productCode: body.product_code,
              count: rejection.count,
              phone: rejection.maskedPhone,
            },
            request,
          });
        return NextResponse.json(
          {
            error: "This submission cannot continue",
            code: TCPA_REJECTION_REASON,
            blocked: true,
            phone: rejection.maskedPhone,
            blocked_count: rejection.count,
            neutral_end_call_script: NEUTRAL_END_CALL_SCRIPT,
          },
          { status: 422 },
        );
      }
      return NextResponse.json(
        {
          error: screening.message,
          code: screening.outcome,
          blocked: true,
          phone: screening.phoneDigits
            ? `••••${screening.phoneDigits.slice(-4)}`
            : null,
        },
        { status },
      );
    }
    // The partner attests to the customer's documented express written consent (p-par-submit-lead,
    // step Consent). It is asked after screening so a blocked number is still answered as blocked,
    // and the moment it was given is kept on the lead's submission record below.
    if (body.consent_attested !== true)
      return NextResponse.json(
        {
          error: "Confirm the customer's documented consent before submitting",
          code: "consent_required",
        },
        { status: 400 },
      );
    const consentAttestedAt = new Date().toISOString();
    if (validationError)
      return NextResponse.json({ error: validationError }, { status: 400 });
    const result = await createPartnerLead(
      auth.context.tenantId,
      auth.context.partnerId,
      auth.context.userId,
      template,
      body.values,
      body.submission_id,
      screening,
      {
        screeningWarningAcknowledged:
          body.screening_warning_acknowledged === true,
        duplicateOverrideJustification:
          typeof body.duplicate_override_justification === "string"
            ? body.duplicate_override_justification
            : null,
        market: {
          carrier_id: market.carrier_id,
          state: market.state,
          profile_id: market.profile_id,
          revision: market.revision,
        },
      },
    );
    const lead = result.lead;
    const failureInjection =
      process.env.NODE_ENV !== "production" &&
      request.headers.get("x-insurvas-test-fail-step") === "work_item"
        ? ("work_item" as const)
        : undefined;
    await writePartnerIntakeArtifacts({
      tenantId: auth.context.tenantId,
      partnerId: auth.context.partnerId,
      userId: auth.context.userId,
      partnerTimezone: auth.context.partnerTimezone,
      submissionId: body.submission_id,
      lead,
      request,
      failureInjection,
    });
    await deleteFormDraft(
      auth.context.tenantId,
      auth.context.userId,
      body.product_code,
      auth.context.partnerId,
    );
    await audit({
      actorType: "tenant",
      actorId: auth.context.userId,
      action: "tenant.partner_lead_submitted",
      targetType: "agent_lead",
      targetId: lead.id,
      metadata: {
        partnerId: auth.context.partnerId,
        productCode: body.product_code,
        definitionVersion: template.assignment.definition_version,
        replayed: result.replayed,
        consentAttestedAt,
      },
      request,
    });
    if (
      !result.replayed &&
      typeof body.duplicate_override_justification === "string" &&
      body.duplicate_override_justification.trim()
    )
      await audit({
        actorType: "tenant",
        actorId: auth.context.userId,
        action: "tenant.partner_lead_duplicate_overridden",
        targetType: "agent_lead",
        targetId: lead.id,
        reason: body.duplicate_override_justification.trim(),
        metadata: {
          partnerId: auth.context.partnerId,
          productCode: body.product_code,
        },
        request,
      });
    return NextResponse.json(
      { lead, replayed: result.replayed },
      { status: result.replayed ? 200 : 201 },
    );
  } catch (error) {
    if (error instanceof PartnerDuplicateError) {
      await audit({
        actorType: "tenant",
        actorId: auth.context.userId,
        action: "tenant.partner_lead_duplicate_detected",
        targetType: "partner_lead_submission",
        targetId: body.submission_id,
        metadata: {
          partnerId: auth.context.partnerId,
          productCode: body.product_code,
          matches: error.matches,
        },
        request,
      });
      return NextResponse.json(
        {
          error: error.message,
          code: "duplicate_lead",
          matches: error.matches,
        },
        { status: 409 },
      );
    }
    const message =
      error instanceof Error ? error.message : "Could not submit lead";
    const status =
      message === "partner_product_not_approved" ||
      message === "product_not_enabled" ||
      message === "partner_market_not_allowed"
        ? 403
        : message === "product_not_found" ||
            message.includes("No configured form")
          ? 404
          : message === "dnc_acknowledgement_required"
            ? 409
            : 400;
    return NextResponse.json(
      {
        error:
          message === "partner_product_not_approved"
            ? "This partner is not approved for that product"
            : message === "product_not_enabled"
              ? "That product is disabled for this tenant"
              : message === "partner_market_not_allowed"
                ? "That carrier and state are not available to your account"
                : message === "dnc_acknowledgement_required"
                  ? "Acknowledge the DNC warning before submitting"
                  : message,
      },
      { status },
    );
  }
}
