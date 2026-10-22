import { randomUUID } from "node:crypto";
import { NextResponse, type NextRequest } from "next/server";

import { writePartnerIntakeArtifacts } from "@/lib/agentTemplates/intake";
import { createPartnerLead, getTenantTemplateForProduct, PartnerDuplicateError, validateValues } from "@/lib/agentTemplates/service";
import { buildAffiliateTemplate } from "@/lib/affiliate/form";
import { getAffiliateLinkBySlug, recordAffiliateClick } from "@/lib/affiliate/service";
import { audit } from "@/lib/audit/log";
import { evaluateTransfer, linkVerdictToLead, TransferGateUnrecorded } from "@/lib/compliance/transferGate";
import { recordRejectedPartnerSubmission, TCPA_REJECTION_REASON } from "@/lib/compliance/rejectedSubmissions";
import { SCREENING_UNAVAILABLE_MESSAGE } from "@/lib/compliance/screeningCore";
import { getEntitlement } from "@/lib/entitlements/get";
import { hasFeature } from "@/lib/entitlements/types";
import { PARTNER_PORTAL_FEATURE } from "@/lib/partnerAuth/requirePartner";
import { listPartnerApprovedProducts, assertPartnerProductApproved } from "@/lib/partnerProducts/service";
import { callerIp, claim, retryAfterSeconds, type RateLimitRule } from "@/lib/rateLimit";
import { getSupabaseServiceClient } from "@/lib/supabase/service";
import { isTenantSuspended } from "@/lib/tenants/suspension";
import { configuredHosts, CROSS_SITE_REFUSED, refuseCrossSite } from "@/lib/security/originCheck";

function unavailable(link: Awaited<ReturnType<typeof getAffiliateLinkBySlug>>) {
  if (!link) return NextResponse.json({ error: "This referral link is not available", code: "affiliate_not_found" }, { status: 404 });
  const paused = link.partner_status === "paused";
  return NextResponse.json({ error: paused ? "This affiliate is temporarily not accepting referrals" : "This referral link is no longer accepting referrals", code: paused ? "affiliate_paused" : "affiliate_inactive" }, { status: 410 });
}

// A public, unauthenticated endpoint: every submit can trigger a paid screening lookup and a queued
// lead, and every open counts a click, so both are limited per caller and per link.
const SUBMIT_PER_IP: RateLimitRule = { name: "affiliate_submit_ip", max: 10, windowSeconds: 3600 };
const SUBMIT_PER_LINK: RateLimitRule = { name: "affiliate_submit_link", max: 120, windowSeconds: 3600 };
const OPEN_PER_IP: RateLimitRule = { name: "affiliate_open_ip", max: 60, windowSeconds: 3600 };

function limited(rule: RateLimitRule) {
  return NextResponse.json({ error: "Too many requests. Please try again later.", code: "rate_limited" }, { status: 429, headers: { "Retry-After": String(retryAfterSeconds(rule)) } });
}

/**
 * A suspended agency takes no referrals, as its partner portal takes no submissions; nor does one
 * whose plan no longer carries partners (publisher_records, which partner access is part of).
 */
async function agencySuspended(tenantId: string) {
  const [{ data }, hasPartners] = await Promise.all([
    getSupabaseServiceClient().from("tenants").select("status").eq("id", tenantId).maybeSingle<{ status: string }>(),
    getEntitlement(tenantId).then((entitlement) => hasFeature(entitlement, PARTNER_PORTAL_FEATURE), () => false),
  ]);
  return !data || isTenantSuspended(data.status) || !hasPartners;
}

/** One neutral refusal for every gate reject: a public form never learns which list matched. */
const REFERRAL_REFUSED = { error: "We can't accept this referral online. Please contact the agency directly.", code: "referral_not_accepted", blocked: true } as const;

export async function GET(request: NextRequest, { params }: { params: Promise<{ slug: string }> }) {
  const slug = (await params).slug;
  try {
    const existing = await getAffiliateLinkBySlug(slug);
    if (!existing || !existing.is_active || existing.partner_status !== "active") return unavailable(existing);
    if (await agencySuspended(existing.tenant_id)) return unavailable(null);
    // Over the limit the page still loads; the open just isn't counted again.
    const counted = await claim(OPEN_PER_IP, `${callerIp(request.headers)}:${slug}`);
    const link = counted.allowed ? await recordAffiliateClick(slug) : existing;
    if (!link) return unavailable(existing);
    const products = await listPartnerApprovedProducts(link.tenant_id, link.partner_id);
    return NextResponse.json({ link: { slug: link.slug, campaign: link.campaign, partner_name: link.partner_name }, products: products.map((product) => ({ code: product.code, name: product.name, category: product.category })) }, { headers: { "Cache-Control": "no-store" } });
  } catch { return NextResponse.json({ error: "This referral link could not be loaded" }, { status: 500 }); }
}

export async function POST(request: NextRequest, { params }: { params: Promise<{ slug: string }> }) {
  // The referral form is served from this app; a submission posted from another site is refused.
  if (refuseCrossSite({ method: request.method, pathname: request.nextUrl.pathname, origin: request.headers.get("origin"), referer: request.headers.get("referer"), authorization: null, requestHost: request.headers.get("x-forwarded-host") ?? request.headers.get("host"), allowedHosts: configuredHosts(process.env) }, { paths: () => true })) {
    return NextResponse.json(CROSS_SITE_REFUSED, { status: 403 });
  }
  const slug = (await params).slug;
  const existing = await getAffiliateLinkBySlug(slug);
  if (!existing || !existing.is_active || existing.partner_status !== "active") return unavailable(existing);
  if (await agencySuspended(existing.tenant_id)) return unavailable(null);
  const perIp = await claim(SUBMIT_PER_IP, callerIp(request.headers));
  if (!perIp.allowed) return limited(perIp.rule);
  const perLink = await claim(SUBMIT_PER_LINK, existing.id);
  if (!perLink.allowed) return limited(perLink.rule);
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
    const submissionId = typeof body.submission_id === "string" ? body.submission_id : randomUUID();
    // LA-6.2: the same transfer gate as the partner portal — internal DNC, consent, calling hours,
    // existing customer — with its verdict recorded. Affiliates are a lighter path, not a looser one.
    const carrierState = typeof values.state === "string" && /^[A-Z]{2}$/.test(values.state.trim().toUpperCase()) ? values.state.trim().toUpperCase() : null;
    const gate = await evaluateTransfer({ tenantId: existing.tenant_id, partnerId: existing.partner_id, partnerUserId: null, productCode: body.product_code, phone: values.phone, carrierState, submissionId, stage: "submit", values });
    const screening = gate.screening;
    if (!screening) return NextResponse.json({ error: SCREENING_UNAVAILABLE_MESSAGE, code: "unavailable", blocked: true }, { status: 503 });
    if (gate.decision.verdict === "reject" && (gate.decision.blockingReason === "internal_dnc" || gate.decision.blockingReason === "consent_missing")) return NextResponse.json(REFERRAL_REFUSED, { status: 422 });
    // Any other reject that LA-1.5 itself let through (a list could not be read): not treated as safe.
    if (gate.decision.verdict === "reject" && screening.allowed) return NextResponse.json({ error: SCREENING_UNAVAILABLE_MESSAGE, code: "unavailable", blocked: true }, { status: 503 });
    if (!screening.allowed) {
      if (screening.outcome === "tcpa_litigator") {
        const rejection = await recordRejectedPartnerSubmission({ tenantId: existing.tenant_id, partnerId: existing.partner_id, userId: null, submissionId, productCode: body.product_code, reason: TCPA_REJECTION_REASON, phoneDigits: screening.phoneDigits, screeningResultId: screening.resultId });
        if (rejection.created) await audit({ actorType: "system", actorId: null, action: "tenant.partner_submission_rejected", targetType: "partner_rejected_submission", targetId: rejection.id, reason: TCPA_REJECTION_REASON, metadata: { partnerId: existing.partner_id, affiliateLinkId: existing.id, productCode: body.product_code, count: rejection.count, phone: rejection.maskedPhone }, request });
        return NextResponse.json(REFERRAL_REFUSED, { status: 422 });
      }
      const status = screening.outcome === "unavailable" ? 503 : 422;
      return NextResponse.json({ error: screening.message, code: screening.outcome, blocked: true, phone: screening.phoneDigits ? `••••${screening.phoneDigits.slice(-4)}` : null }, { status });
    }
    // A number on a DNC list is not refused here and never named: this is a public form, so saying
    // "this number is on a DNC list" would turn it into a lookup tool. The consumer is asking to be
    // contacted (consent is required above), so the referral is accepted and the warning travels with
    // the lead to the agency, which sees it on the card (screening_warning_acknowledged below).
    if (validationError) return NextResponse.json({ error: validationError }, { status: 400 });
    // requireInternalDqReason with no justification: an affiliate cannot explain an internal DQ, so
    // a number the agency disqualified is refused rather than queued without a reason.
    const result = await createPartnerLead(existing.tenant_id, existing.partner_id, null, template, values, submissionId, screening, { screeningWarningAcknowledged: screening.warning?.code === "dnc" ? true : body.screening_warning_acknowledged === true, requireInternalDqReason: true, duplicateOverrideJustification: null, affiliateLinkId: existing.id, affiliateCampaign: existing.campaign });
    await linkVerdictToLead(existing.tenant_id, gate.verdictId, result.lead.id);
    await writePartnerIntakeArtifacts({ tenantId: existing.tenant_id, partnerId: existing.partner_id, userId: null, partnerTimezone: existing.partner_timezone, submissionId, lead: result.lead, affiliateLinkId: existing.id, affiliateCampaign: existing.campaign, request });
    await audit({ actorType: "system", actorId: null, action: "tenant.partner_lead_submitted", targetType: "agent_lead", targetId: result.lead.id, metadata: { partnerId: existing.partner_id, affiliateLinkId: existing.id, campaign: existing.campaign, productCode: body.product_code, replayed: result.replayed }, request });
    // A confirmation only: this is a public form, and the lead row carries internal ids, the pipeline
    // and the agency's screening notes (a DNC warning, for one), none of which the consumer may see.
    return NextResponse.json({ ok: true, replayed: result.replayed }, { status: result.replayed ? 200 : 201 });
  } catch (error) {
    // Never which lead, nor how it matched: this endpoint is public, and the matches would tell anyone
    // holding a link whether a phone number is already one of this agency's leads, and its id.
    if (error instanceof TransferGateUnrecorded) return NextResponse.json({ error: SCREENING_UNAVAILABLE_MESSAGE, code: "unavailable", blocked: true }, { status: error.status });
    if (error instanceof Error && error.message === "internal_dq_reason_required") return NextResponse.json(REFERRAL_REFUSED, { status: 422 });
    if (error instanceof PartnerDuplicateError) return NextResponse.json({ error: "We already have your details. An agent will be in touch.", code: "duplicate_lead" }, { status: 409 });
    const message = error instanceof Error ? error.message : "Could not submit your referral";
    const status = message === "partner_product_not_approved" || message === "product_not_enabled" ? 403 : message === "product_not_found" || message.includes("No configured form") ? 404 : 400;
    return NextResponse.json({ error: message === "partner_product_not_approved" ? "That product is not available through this referral" : message === "product_not_enabled" ? "That product is not currently available" : message }, { status });
  }
}
