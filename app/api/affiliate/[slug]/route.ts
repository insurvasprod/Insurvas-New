import { randomUUID } from "node:crypto";
import { NextResponse, type NextRequest } from "next/server";

import { writePartnerIntakeArtifacts } from "@/lib/agentTemplates/intake";
import { createPartnerLead, getTenantTemplateForProduct, PartnerDuplicateError, validateValues } from "@/lib/agentTemplates/service";
import { buildAffiliateTemplate } from "@/lib/affiliate/form";
import { getAffiliateLinkBySlug, recordAffiliateClick } from "@/lib/affiliate/service";
import { audit } from "@/lib/audit/log";
import { screenPartnerPhone } from "@/lib/compliance/screening";
import { listPartnerApprovedProducts, assertPartnerProductApproved } from "@/lib/partnerProducts/service";

function unavailable(link: Awaited<ReturnType<typeof getAffiliateLinkBySlug>>) {
  if (!link) return NextResponse.json({ error: "This referral link is not available", code: "affiliate_not_found" }, { status: 404 });
  const paused = link.partner_status === "paused";
  return NextResponse.json({ error: paused ? "This affiliate is temporarily not accepting referrals" : "This referral link is no longer accepting referrals", code: paused ? "affiliate_paused" : "affiliate_inactive" }, { status: 410 });
}

export async function GET(_request: NextRequest, { params }: { params: Promise<{ slug: string }> }) {
  const slug = (await params).slug;
  const existing = await getAffiliateLinkBySlug(slug);
  if (!existing || !existing.is_active || existing.partner_status !== "active") return unavailable(existing);
  const link = await recordAffiliateClick(slug);
  if (!link) return unavailable(existing);
  try {
    const products = await listPartnerApprovedProducts(link.tenant_id, link.partner_id);
    return NextResponse.json({ link: { slug: link.slug, campaign: link.campaign, partner_name: link.partner_name }, products: products.map((product) => ({ code: product.code, name: product.name, category: product.category })) }, { headers: { "Cache-Control": "no-store" } });
  } catch { return NextResponse.json({ error: "This referral link could not be loaded" }, { status: 500 }); }
}

export async function POST(request: NextRequest, { params }: { params: Promise<{ slug: string }> }) {
  const slug = (await params).slug;
  const existing = await getAffiliateLinkBySlug(slug);
  if (!existing || !existing.is_active || existing.partner_status !== "active") return unavailable(existing);
  const body = await request.json().catch(() => null) as { product_code?: unknown; values?: unknown; submission_id?: unknown; screening_warning_acknowledged?: unknown } | null;
  if (typeof body?.product_code !== "string" || !/^[a-z][a-z0-9_]{1,59}$/.test(body.product_code)) return NextResponse.json({ error: "Choose a valid product" }, { status: 400 });
  if (body.submission_id !== undefined && (typeof body.submission_id !== "string" || !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(body.submission_id))) return NextResponse.json({ error: "This submission has an invalid retry key" }, { status: 400 });
  if (body.screening_warning_acknowledged !== undefined && typeof body.screening_warning_acknowledged !== "boolean") return NextResponse.json({ error: "The DNC acknowledgement is invalid" }, { status: 400 });
  try {
    await assertPartnerProductApproved(existing.tenant_id, existing.partner_id, body.product_code);
    const approvedProducts = await listPartnerApprovedProducts(existing.tenant_id, existing.partner_id);
    const template = buildAffiliateTemplate(await getTenantTemplateForProduct(existing.tenant_id, body.product_code), approvedProducts);
    const values = body.values && typeof body.values === "object" && !Array.isArray(body.values) ? body.values as Record<string, unknown> : {};
    if (values.product_interest !== body.product_code) return NextResponse.json({ error: "Choose the product you are interested in" }, { status: 400 });
    if (values.consent !== true) return NextResponse.json({ error: "Consent is required before the agent can contact you" }, { status: 400 });
    const validationError = validateValues(template.template.fields, values, template.template.form_definition);
    const phoneField = template.template.fields.find((field) => field.field_key === "phone");
    const phoneValidationError = Boolean(phoneField && validationError?.startsWith(phoneField.label));
    if (validationError && !phoneValidationError) return NextResponse.json({ error: validationError }, { status: 400 });
    const screening = await screenPartnerPhone({ tenantId: existing.tenant_id, partnerId: existing.partner_id, userId: null, phone: values.phone });
    if (!screening.allowed) {
      const status = screening.outcome === "unavailable" ? 503 : 422;
      return NextResponse.json({ error: screening.message, code: screening.outcome, blocked: true, phone: screening.phoneDigits ? `••••${screening.phoneDigits.slice(-4)}` : null }, { status });
    }
    if (screening.warning?.code === "dnc" && body.screening_warning_acknowledged !== true) return NextResponse.json({ error: "Please acknowledge the DNC warning before submitting", code: "dnc_acknowledgement_required", warning: screening.warning }, { status: 409 });
    if (validationError) return NextResponse.json({ error: validationError }, { status: 400 });
    const submissionId = typeof body.submission_id === "string" ? body.submission_id : randomUUID();
    const result = await createPartnerLead(existing.tenant_id, existing.partner_id, null, template, values, submissionId, screening, { screeningWarningAcknowledged: body.screening_warning_acknowledged === true, affiliateLinkId: existing.id, affiliateCampaign: existing.campaign });
    await writePartnerIntakeArtifacts({ tenantId: existing.tenant_id, partnerId: existing.partner_id, userId: null, partnerTimezone: existing.partner_timezone, submissionId, lead: result.lead, affiliateLinkId: existing.id, affiliateCampaign: existing.campaign, request });
    await audit({ actorType: "system", actorId: null, action: "tenant.partner_lead_submitted", targetType: "agent_lead", targetId: result.lead.id, metadata: { partnerId: existing.partner_id, affiliateLinkId: existing.id, campaign: existing.campaign, productCode: body.product_code, replayed: result.replayed }, request });
    return NextResponse.json({ lead: result.lead, replayed: result.replayed }, { status: result.replayed ? 200 : 201 });
  } catch (error) {
    if (error instanceof PartnerDuplicateError) return NextResponse.json({ error: error.message, code: "duplicate_lead", matches: error.matches }, { status: 409 });
    const message = error instanceof Error ? error.message : "Could not submit your referral";
    const status = message === "partner_product_not_approved" || message === "product_not_enabled" ? 403 : message === "product_not_found" || message.includes("No configured form") ? 404 : 400;
    return NextResponse.json({ error: message === "partner_product_not_approved" ? "That product is not available through this referral" : message === "product_not_enabled" ? "That product is not currently available" : message }, { status });
  }
}
