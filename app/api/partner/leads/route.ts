import { NextResponse, type NextRequest } from "next/server";

import { audit } from "@/lib/audit/log";
import { createPartnerLead, deleteFormDraft, getTenantTemplateForProduct, PartnerDuplicateError, validateValues } from "@/lib/agentTemplates/service";
import { requirePartner } from "@/lib/partnerAuth/requirePartner";
import { assertPartnerProductApproved } from "@/lib/partnerProducts/service";
import { getSupabaseServiceClient } from "@/lib/supabase/service";
import { screenPartnerPhone } from "@/lib/compliance/screening";

export async function POST(request: NextRequest) {
  const auth = await requirePartner(); if (auth instanceof NextResponse) return auth;
  if (auth.context.partnerStatus !== "active") return NextResponse.json({ error: "This partner is paused and cannot submit new leads" }, { status: 403 });
  const body = await request.json().catch(() => null) as { product_code?: unknown; values?: unknown; submission_id?: unknown; screening_warning_acknowledged?: unknown; duplicate_override_justification?: unknown } | null;
  if (typeof body?.product_code !== "string" || !/^[a-z][a-z0-9_]{1,59}$/.test(body.product_code)) return NextResponse.json({ error: "Choose a valid product" }, { status: 400 });
  if (typeof body.submission_id !== "string" || !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(body.submission_id)) return NextResponse.json({ error: "This submission is missing a valid retry key" }, { status: 400 });
  if (body.screening_warning_acknowledged !== undefined && typeof body.screening_warning_acknowledged !== "boolean") return NextResponse.json({ error: "The DNC acknowledgement is invalid" }, { status: 400 });
  if (body.duplicate_override_justification !== undefined && body.duplicate_override_justification !== null && typeof body.duplicate_override_justification !== "string") return NextResponse.json({ error: "The duplicate justification is invalid" }, { status: 400 });
  try {
    await assertPartnerProductApproved(auth.context.tenantId, auth.context.partnerId, body.product_code);
    const template = await getTenantTemplateForProduct(auth.context.tenantId, body.product_code);
    const values = body.values && typeof body.values === "object" && !Array.isArray(body.values) ? body.values as Record<string, unknown> : {};
    const phoneField = template.template.fields.find((field) => field.type === "phone" && (field.field_key === "phone" || field.field_key === "phone_number"))
      ?? template.template.fields.find((field) => field.type === "phone");
    const validationError = validateValues(template.template.fields, body.values, template.template.form_definition);
    const phoneValidationError = Boolean(phoneField && validationError?.startsWith(phoneField.label));
    if (validationError && !phoneValidationError) return NextResponse.json({ error: validationError }, { status: 400 });
    const screening = await screenPartnerPhone({ tenantId: auth.context.tenantId, partnerId: auth.context.partnerId, userId: auth.context.userId, phone: phoneField ? values[phoneField.field_key] : undefined });
    if (!screening.allowed) {
      const status = screening.outcome === "unavailable" ? 503 : 422;
      return NextResponse.json({ error: screening.message, code: screening.outcome === "tcpa_litigator" ? "tcpa_litigator" : screening.outcome, blocked: true, phone: screening.phoneDigits ? `••••${screening.phoneDigits.slice(-4)}` : null }, { status });
    }
    if (validationError) return NextResponse.json({ error: validationError }, { status: 400 });
    const result = await createPartnerLead(auth.context.tenantId, auth.context.partnerId, auth.context.userId, template, body.values, body.submission_id, screening, { screeningWarningAcknowledged: body.screening_warning_acknowledged === true, duplicateOverrideJustification: typeof body.duplicate_override_justification === "string" ? body.duplicate_override_justification : null });
    const lead = result.lead;
    {
      const values = (lead.values ?? {}) as Record<string, unknown>;
      const textValue = (keys: string[]) => keys.map((key) => values[key]).find((value) => typeof value === "string" && value.trim()) as string | undefined;
      const name = textValue(["full_name"]) ?? ([textValue(["first_name"]), textValue(["last_name"])].filter(Boolean).join(" ") || null);
      const phone = textValue(["phone", "phone_number"]);
      const quote = textValue(["initial_quote", "quote"]);
      const trackingId = textValue(["tracking_id", "affiliate_tracking_id"]);
      const localDate = new Intl.DateTimeFormat("en-CA", { timeZone: auth.context.partnerTimezone, year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());
      const supabase = getSupabaseServiceClient();
      const failures: Array<{ step: "work_item" | "deal_flow" | "notification"; error: string }> = [];
      const queue = await supabase.from("lead_queue").insert({ tenant_id: auth.context.tenantId, lead_id: lead.id, partner_id: auth.context.partnerId, product_line: lead.product_line, stage_key: lead.stage_key });
      if (queue.error && queue.error.code !== "23505") failures.push({ step: "work_item", error: queue.error.message });
      const deal = await supabase.from("deal_flow").upsert({ tenant_id: auth.context.tenantId, lead_id: lead.id, partner_id: auth.context.partnerId, submission_id: body.submission_id, product_line: lead.product_line, stage_key: lead.stage_key, insured_name: name, phone, initial_quote: quote, tracking_id: trackingId, local_date: localDate }, { onConflict: "lead_id" });
      if (deal.error && deal.error.code !== "23505") failures.push({ step: "deal_flow", error: deal.error.message });
      const notification = await supabase.from("lead_notifications").insert({ tenant_id: auth.context.tenantId, lead_id: lead.id, channel: "internal", event_type: "lead_available", payload: { productCode: lead.product_line, partnerId: auth.context.partnerId, submissionId: body.submission_id } });
      if (notification.error && notification.error.code !== "23505") failures.push({ step: "notification", error: notification.error.message });
      for (const failure of failures) {
        const recorded = await supabase.from("intake_failures").insert({ tenant_id: auth.context.tenantId, lead_id: lead.id, step: failure.step, error_message: failure.error.slice(0, 2000), metadata: { submissionId: body.submission_id, productCode: lead.product_line } }).select("id").single();
        if (recorded.error || !recorded.data) await audit({ actorType: "tenant", actorId: auth.context.userId, action: "tenant.intake_failure_recording_failed", targetType: "agent_lead", targetId: lead.id, reason: failure.error.slice(0, 1000), metadata: { step: failure.step, submissionId: body.submission_id }, request });
      }
    }
    await deleteFormDraft(auth.context.tenantId, auth.context.userId, body.product_code, auth.context.partnerId);
    await audit({ actorType: "tenant", actorId: auth.context.userId, action: "tenant.partner_lead_submitted", targetType: "agent_lead", targetId: lead.id, metadata: { partnerId: auth.context.partnerId, productCode: body.product_code, definitionVersion: template.assignment.definition_version, replayed: result.replayed }, request });
    if (!result.replayed && typeof body.duplicate_override_justification === "string" && body.duplicate_override_justification.trim()) await audit({ actorType: "tenant", actorId: auth.context.userId, action: "tenant.partner_lead_duplicate_overridden", targetType: "agent_lead", targetId: lead.id, reason: body.duplicate_override_justification.trim(), metadata: { partnerId: auth.context.partnerId, productCode: body.product_code }, request });
    return NextResponse.json({ lead, replayed: result.replayed }, { status: result.replayed ? 200 : 201 });
  } catch (error) {
    if (error instanceof PartnerDuplicateError) {
      await audit({ actorType: "tenant", actorId: auth.context.userId, action: "tenant.partner_lead_duplicate_detected", targetType: "partner_lead_submission", targetId: body.submission_id, metadata: { partnerId: auth.context.partnerId, productCode: body.product_code, matches: error.matches }, request });
      return NextResponse.json({ error: error.message, code: "duplicate_lead", matches: error.matches }, { status: 409 });
    }
    const message = error instanceof Error ? error.message : "Could not submit lead";
    const status = message === "partner_product_not_approved" || message === "product_not_enabled" ? 403 : message === "product_not_found" || message.includes("No configured form") ? 404 : message === "dnc_acknowledgement_required" ? 409 : 400;
    return NextResponse.json({ error: message === "partner_product_not_approved" ? "This partner is not approved for that product" : message === "product_not_enabled" ? "That product is disabled for this tenant" : message === "dnc_acknowledgement_required" ? "Acknowledge the DNC warning before submitting" : message }, { status });
  }
}
