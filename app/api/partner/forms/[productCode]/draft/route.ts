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
import { assertPartnerMarketAccess } from "@/lib/partnerMarkets/service";
import { getSupabaseServiceClient } from "@/lib/supabase/service";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

type DraftRow = NonNullable<Awaited<ReturnType<typeof loadFormDraft>>>;

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
    return NextResponse.json(
      { draft, template },
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
 * PUT { payload, carrier_id, carrier_state, draft_id }
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
      carrier_id?: unknown;
      carrier_state?: unknown;
      draft_id?: unknown;
    } | null;
    const slotted = body !== null && Object.prototype.hasOwnProperty.call(body, "draft_id");
    if (slotted && body?.draft_id !== null && (typeof body?.draft_id !== "string" || !UUID.test(body.draft_id)))
      return NextResponse.json({ error: "That draft id is not valid" }, { status: 400 });
    const draftId = slotted && typeof body?.draft_id === "string" ? body.draft_id : null;
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
    const profileTemplate = template as typeof template & {
      partner_submission_profile_id?: string | null;
      profile_revision?: number | null;
    };
    if (
      typeof body?.carrier_id !== "string" ||
      typeof body.carrier_state !== "string"
    )
      throw new Error(
        "Choose an allowed carrier and state before saving a draft",
      );
    const market = await assertPartnerMarketAccess(
      auth.context.tenantId,
      auth.context.partnerId,
      auth.context.userId,
      body.carrier_id,
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
    const { error: snapshotError } = await getSupabaseServiceClient()
      .from("form_drafts")
      .update({
        carrier_id: body.carrier_id,
        carrier_state: body.carrier_state,
        partner_market_access_profile_id: market.profile_id,
        partner_market_access_profile_revision: market.revision,
      })
      .eq("id", id)
      .eq("tenant_id", auth.context.tenantId);
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
      return NextResponse.json({ error: "You have 25 drafts open. Submit or discard one before starting another.", code: "form_draft_limit_reached" }, { status: 409 });
    if (error instanceof Error && error.message === "form_draft_not_found")
      return NextResponse.json({ error: "That draft was not found. It may have been submitted already." }, { status: 404 });
    const result = partnerProductHttpError(error, "Could not save draft");
    return NextResponse.json(
      { error: result.message },
      { status: result.status },
    );
  }
}
