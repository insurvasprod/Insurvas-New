import { NextResponse, type NextRequest } from "next/server";

import { audit } from "@/lib/audit/log";
import {
  getPartnerTemplateForProduct,
  getPartnerTemplateForProductProfileRevision,
  getTenantTemplateForProductVersion,
  loadFormDraft,
  saveFormDraft,
} from "@/lib/agentTemplates/service";
import { partnerProductHttpError } from "@/lib/partnerProducts/http";
import { requirePartner } from "@/lib/partnerAuth/requirePartner";
import { assertPartnerProductApproved } from "@/lib/partnerProducts/service";
import { assertPartnerMarketAccess } from "@/lib/partnerMarkets/service";
import { getSupabaseServiceClient } from "@/lib/supabase/service";

export async function GET(
  _request: Request,
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
    const draft = await loadFormDraft(
      auth.context.tenantId,
      auth.context.userId,
      productCode,
      auth.context.partnerId,
    );
    const template = draft
      ? draft.partner_submission_profile_id &&
        draft.partner_submission_profile_revision
        ? await getPartnerTemplateForProductProfileRevision(
            auth.context.tenantId,
            draft.partner_submission_profile_id,
            draft.partner_submission_profile_revision,
            productCode,
          )
        : await getTenantTemplateForProductVersion(
            auth.context.tenantId,
            productCode,
            draft.definition_version,
          )
      : null;
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
    const existingDraft = await loadFormDraft(
      auth.context.tenantId,
      auth.context.userId,
      productCode,
      auth.context.partnerId,
    );
    const template =
      existingDraft?.partner_submission_profile_id &&
      existingDraft.partner_submission_profile_revision
        ? await getPartnerTemplateForProductProfileRevision(
            auth.context.tenantId,
            existingDraft.partner_submission_profile_id,
            existingDraft.partner_submission_profile_revision,
            productCode,
          )
        : existingDraft
          ? await getTenantTemplateForProductVersion(
              auth.context.tenantId,
              productCode,
              existingDraft.definition_version,
            )
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
    const body = (await request.json().catch(() => null)) as {
      payload?: unknown;
      carrier_id?: unknown;
      carrier_state?: unknown;
    } | null;
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
    const id = await saveFormDraft(
      auth.context.tenantId,
      auth.context.userId,
      productCode,
      {
        tenant_template_id: template.tenant_template_id,
        definition_version: template.assignment.definition_version,
        partner_submission_profile_id:
          profileTemplate.partner_submission_profile_id,
        profile_revision: profileTemplate.profile_revision,
      },
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
    const result = partnerProductHttpError(error, "Could not save draft");
    return NextResponse.json(
      { error: result.message },
      { status: result.status },
    );
  }
}
