import { NextResponse, type NextRequest } from "next/server";

import { audit } from "@/lib/audit/log";
import {
  getPartnerTemplateForProduct,
  getPartnerTemplateForProductProfileRevision,
  getPartnerTenantTemplateForProductVersion,
  loadFormDraft,
  loadPartnerFormDraftById,
  saveFormDraft,
  savePartnerFormDraftSlot,
} from "@/lib/agentTemplates/service";
import { partnerProductHttpError } from "@/lib/partnerProducts/http";
import { requirePartner } from "@/lib/partnerAuth/requirePartner";
import { assertPartnerProductApproved } from "@/lib/partnerProducts/service";
import { assertPartnerStateAccess } from "@/lib/partnerMarkets/service";
import { getSupabaseServiceClient } from "@/lib/supabase/service";
import { isPhoneTemplateField } from "@/lib/templates/constants";
import { getUsPhone10Digits } from "@/lib/compliance/scrub";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

type DraftRow = NonNullable<Awaited<ReturnType<typeof loadFormDraft>>>;
const phoneDigits = (value: unknown) => {
  try { return getUsPhone10Digits(value); } catch { return null; }
};

/** The immutable template a saved draft was started on. */
async function draftTemplate(tenantId: string, productCode: string, draft: DraftRow) {
  return draft.partner_submission_profile_id && draft.partner_submission_profile_revision
    ? getPartnerTemplateForProductProfileRevision(tenantId, draft.partner_submission_profile_id, draft.partner_submission_profile_revision, productCode)
    : getPartnerTenantTemplateForProductVersion(tenantId, productCode, draft.definition_version);
}

/**
 * GET ?draft_id=<id>  resumes that draft (LA-1.6-5: any started form can be resumed).
 * GET ?new=1          a fresh form: no draft.
 * GET                 the newest draft for the product (the behaviour before the draft list).
 */
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ productCode: string }> },
) {
  const auth = await requirePartner();
  if (auth instanceof NextResponse) return auth;
  try {
    const productCode = (await params).productCode;
    await assertPartnerProductApproved(
      auth.context.tenantId,
      auth.context.partnerId,
      productCode,
    );
    const draftId = request.nextUrl.searchParams.get("draft_id");
    if (draftId !== null && !UUID.test(draftId))
      return NextResponse.json({ error: "That draft id is not valid" }, { status: 400 });
    const draft = request.nextUrl.searchParams.get("new") === "1"
      ? null
      : draftId
        ? await loadPartnerFormDraftById(auth.context.tenantId, auth.context.userId, auth.context.partnerId, draftId)
        : await loadFormDraft(
            auth.context.tenantId,
            auth.context.userId,
            productCode,
            auth.context.partnerId,
          );
    if (draftId && (!draft || draft.product_code !== productCode))
      return NextResponse.json({ error: "That draft was not found. It may have been submitted already." }, { status: 404 });
    const template = draft ? await draftTemplate(auth.context.tenantId, productCode, draft as DraftRow) : null;
    const draftResume = draft as (typeof draft & {
      screening_result_id?: string | null;
      screening_submission_id?: string | null;
      screening_snapshot?: unknown;
    }) | null;
    let resumeScreening: Record<string, unknown> | null = null;
    if (draftResume && template && draftResume.screening_result_id && draftResume.screening_snapshot) {
      const phoneField = template.template.fields.find(isPhoneTemplateField);
      const savedPayload = draftResume.payload && typeof draftResume.payload === "object" && !Array.isArray(draftResume.payload)
        ? draftResume.payload as Record<string, unknown>
        : {};
      const savedDigits = phoneDigits(phoneField ? savedPayload[phoneField.field_key] : null);
      if (savedDigits) {
        const { data: result } = await getSupabaseServiceClient()
          .from("screening_results")
          .select("id, phone_digits, outcome, checked_at")
          .eq("tenant_id", auth.context.tenantId)
          .eq("id", draftResume.screening_result_id)
          .maybeSingle();
        const snapshot = draftResume.screening_snapshot as Record<string, unknown>;
        if (result?.phone_digits === savedDigits && result.outcome !== "invalid_phone" && result.outcome !== "unavailable" && snapshot.screened === true) {
          resumeScreening = { ...snapshot, checked_at: result.checked_at };
        }
      }
    }
    return NextResponse.json(
      { draft, template, resume_screening: resumeScreening, screening_submission_id: resumeScreening ? draftResume?.screening_submission_id ?? null : null },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (error) {
    const result = partnerProductHttpError(error, "Could not load draft");
    return NextResponse.json(
      { error: result.message },
      { status: result.status },
    );
  }
}

/**
 * PUT { payload, carrier_state, draft_id }
 *   draft_id: "<id>"  saves that draft;  draft_id: null  starts a new one and returns its id;
 *   no draft_id       the one-draft-per-product save used before the draft list.
 */
export async function PUT(
  request: NextRequest,
  { params }: { params: Promise<{ productCode: string }> },
) {
  const auth = await requirePartner();
  if (auth instanceof NextResponse) return auth;
  if (auth.context.partnerStatus !== "active")
    return NextResponse.json(
      { error: "This partner is paused and cannot save new lead drafts" },
      { status: 403 },
    );
  try {
    const productCode = (await params).productCode;
    await assertPartnerProductApproved(
      auth.context.tenantId,
      auth.context.partnerId,
      productCode,
    );
    const body = (await request.json().catch(() => null)) as {
      payload?: unknown;
      carrier_state?: unknown;
      draft_id?: unknown;
      pause_reason?: unknown;
      pause_notes?: unknown;
      submission_id?: unknown;
    } | null;
    const slotted = body !== null && Object.prototype.hasOwnProperty.call(body, "draft_id");
    if (slotted && body?.draft_id !== null && (typeof body?.draft_id !== "string" || !UUID.test(body.draft_id)))
      return NextResponse.json({ error: "That draft id is not valid" }, { status: 400 });
    const draftId = slotted && typeof body?.draft_id === "string" ? body.draft_id : null;
    if (body?.submission_id !== undefined && (typeof body.submission_id !== "string" || !UUID.test(body.submission_id)))
      return NextResponse.json({ error: "That screening retry key is not valid" }, { status: 400 });
    const pauseReason = typeof body?.pause_reason === "string" ? body.pause_reason.trim() : null;
    const pauseNotes = typeof body?.pause_notes === "string" ? body.pause_notes.trim() : null;
    if ((body?.pause_reason !== undefined && (!pauseReason || pauseReason.length > 120)) ||
        (body?.pause_notes !== undefined && (!pauseNotes || pauseNotes.length > 1000)))
      return NextResponse.json({ error: "Add a short reason and notes before leaving this draft" }, { status: 400 });
    const existingDraft = slotted
      ? draftId
        ? await loadPartnerFormDraftById(auth.context.tenantId, auth.context.userId, auth.context.partnerId, draftId)
        : null
      : await loadFormDraft(
          auth.context.tenantId,
          auth.context.userId,
          productCode,
          auth.context.partnerId,
        );
    if (draftId && (!existingDraft || existingDraft.product_code !== productCode))
      return NextResponse.json({ error: "That draft was not found. It may have been submitted already." }, { status: 404 });
    const template = existingDraft
      ? await draftTemplate(auth.context.tenantId, productCode, existingDraft as DraftRow)
      : await getPartnerTemplateForProduct(
          auth.context.tenantId,
          auth.context.partnerId,
          auth.context.userId,
          productCode,
        );
    const phoneField = template.template.fields.find(isPhoneTemplateField);
    const payload = body?.payload && typeof body.payload === "object" && !Array.isArray(body.payload)
      ? body.payload as Record<string, unknown>
      : {};
    let phoneChanged = false;
    if (existingDraft) {
      const previousTemplate = await draftTemplate(auth.context.tenantId, productCode, existingDraft as DraftRow);
      const previousPhoneField = previousTemplate.template.fields.find(isPhoneTemplateField);
      const previousPayload = existingDraft.payload && typeof existingDraft.payload === "object" && !Array.isArray(existingDraft.payload)
        ? existingDraft.payload as Record<string, unknown>
        : {};
      const previousDigits = phoneDigits(previousPhoneField ? previousPayload[previousPhoneField.field_key] : null);
      const nextDigits = phoneDigits(phoneField ? payload[phoneField.field_key] : null);
      phoneChanged = previousDigits !== nextDigits;
    }
    // New drafts are created by the screening endpoint only, after it has verified and recorded
    // the submitted phone. Likewise, never persist a changed phone until that new value passes
    // screening; the last successfully screened draft stays intact if screening is blocked.
    if (!existingDraft || phoneChanged)
      return NextResponse.json(
        { error: "Screen the current phone number before saving this draft", code: "phone_screen_required" },
        { status: 409 },
      );
    const profileTemplate = template as typeof template & {
      partner_submission_profile_id?: string | null;
      profile_revision?: number | null;
    };
    if (typeof body?.carrier_state !== "string")
      throw new Error("Choose an allowed customer state before saving a draft");
    const market = await assertPartnerStateAccess(
      auth.context.tenantId,
      auth.context.partnerId,
      auth.context.userId,
      body.carrier_state,
    );
    const snapshot = {
      tenant_template_id: template.tenant_template_id,
      definition_version: template.assignment.definition_version,
      partner_submission_profile_id:
        profileTemplate.partner_submission_profile_id,
      profile_revision: profileTemplate.profile_revision,
    };
    const id = slotted
      ? await savePartnerFormDraftSlot(
          auth.context.tenantId,
          auth.context.userId,
          auth.context.partnerId,
          productCode,
          snapshot,
          body?.payload,
          draftId,
        )
      : await saveFormDraft(
          auth.context.tenantId,
          auth.context.userId,
          productCode,
          snapshot,
          body?.payload,
          auth.context.partnerId,
        );
    const update: Record<string, unknown> = {
      carrier_id: null,
      carrier_state: body.carrier_state,
      partner_market_access_profile_id: market.profile_id,
      partner_market_access_profile_revision: market.revision,
      screening_submission_id: typeof body?.submission_id === "string" ? body.submission_id : null,
    };
    if (body.pause_reason !== undefined) {
      update.pause_reason = pauseReason;
      update.pause_notes = pauseNotes;
    }
    const { error: snapshotError } = await getSupabaseServiceClient()
      .from("form_drafts")
      .update(update as never)
      .eq("id", id)
      .eq("tenant_id", auth.context.tenantId)
      .eq("partner_id", auth.context.partnerId)
      .eq("user_id", auth.context.userId);
    if (snapshotError) throw new Error(snapshotError.message);
    await audit({
      actorType: "tenant",
      actorId: auth.context.userId,
      action: "tenant.form_draft_saved",
      targetType: "form_draft",
      targetId: id,
      metadata: {
        partnerId: auth.context.partnerId,
        productCode,
        definitionVersion: template.assignment.definition_version,
        profileId: profileTemplate.partner_submission_profile_id,
        profileRevision: profileTemplate.profile_revision,
      },
      request,
    });
    return NextResponse.json({ id });
  } catch (error) {
    if (error instanceof Error && error.message === "form_draft_limit_reached")
      return NextResponse.json({ error: "Could not save this draft. Please try again.", code: "form_draft_limit_reached" }, { status: 409 });
    if (error instanceof Error && error.message === "form_draft_not_found")
      return NextResponse.json({ error: "That draft was not found. It may have been submitted already." }, { status: 404 });
    const result = partnerProductHttpError(error, "Could not save draft");
    return NextResponse.json(
      { error: result.message },
      { status: result.status },
    );
  }
}
