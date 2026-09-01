import { NextResponse, type NextRequest } from "next/server";

import { audit } from "@/lib/audit/log";
import { createPartnerLead, deleteFormDraft, getTenantTemplateForProduct } from "@/lib/agentTemplates/service";
import { requirePartner } from "@/lib/partnerAuth/requirePartner";
import { assertPartnerProductApproved } from "@/lib/partnerProducts/service";
import { getSupabaseServiceClient } from "@/lib/supabase/service";

export async function POST(request: NextRequest) {
  const auth = await requirePartner(); if (auth instanceof NextResponse) return auth;
  if (auth.context.partnerStatus !== "active") return NextResponse.json({ error: "This partner is paused and cannot submit new leads" }, { status: 403 });
  const body = await request.json().catch(() => null) as { product_code?: unknown; values?: unknown; submission_id?: unknown } | null;
  if (typeof body?.product_code !== "string" || !/^[a-z][a-z0-9_]{1,59}$/.test(body.product_code)) return NextResponse.json({ error: "Choose a valid product" }, { status: 400 });
  if (typeof body.submission_id !== "string" || !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(body.submission_id)) return NextResponse.json({ error: "This submission is missing a valid retry key" }, { status: 400 });
  try {
    await assertPartnerProductApproved(auth.context.tenantId, auth.context.partnerId, body.product_code);
    const template = await getTenantTemplateForProduct(auth.context.tenantId, body.product_code);
    const result = await createPartnerLead(auth.context.tenantId, auth.context.partnerId, auth.context.userId, template, body.values, body.submission_id);
    const lead = result.lead;
    if (!result.replayed) {
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
      const deal = await supabase.from("deal_flow").insert({ tenant_id: auth.context.tenantId, lead_id: lead.id, partner_id: auth.context.partnerId, submission_id: body.submission_id, product_line: lead.product_line, stage_key: lead.stage_key, insured_name: name, phone, initial_quote: quote, tracking_id: trackingId, local_date: localDate });
      if (deal.error && deal.error.code !== "23505") failures.push({ step: "deal_flow", error: deal.error.message });
      const notification = await supabase.from("lead_notifications").insert({ tenant_id: auth.context.tenantId, lead_id: lead.id, channel: "internal", event_type: "lead_available", payload: { productCode: lead.product_line, partnerId: auth.context.partnerId, submissionId: body.submission_id } });
      if (notification.error && notification.error.code !== "23505") failures.push({ step: "notification", error: notification.error.message });
      for (const failure of failures) {
        const recorded = await supabase.from("intake_failures").insert({ tenant_id: auth.context.tenantId, lead_id: lead.id, step: failure.step, error_message: failure.error, metadata: { submissionId: body.submission_id, productCode: lead.product_line } }).select("id").single();
        if (recorded.error || !recorded.data) { console.error("intake failure record failed", failure, recorded.error); continue; }
        const alert = await supabase.from("intake_alerts").insert({ tenant_id: auth.context.tenantId, intake_failure_id: recorded.data.id });
        if (alert.error) console.error("intake alert record failed", failure, alert.error);
      }
    }
    await deleteFormDraft(auth.context.tenantId, auth.context.userId, body.product_code, auth.context.partnerId);
    await audit({ actorType: "tenant", actorId: auth.context.userId, action: "tenant.partner_lead_submitted", targetType: "agent_lead", targetId: lead.id, metadata: { partnerId: auth.context.partnerId, productCode: body.product_code, definitionVersion: template.assignment.definition_version, replayed: result.replayed }, request });
    return NextResponse.json({ lead, replayed: result.replayed }, { status: result.replayed ? 200 : 201 });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Could not submit lead";
    const status = message === "partner_product_not_approved" || message === "product_not_enabled" ? 403 : message === "product_not_found" || message.includes("No configured form") ? 404 : 400;
    return NextResponse.json({ error: message === "partner_product_not_approved" ? "This partner is not approved for that product" : message === "product_not_enabled" ? "That product is disabled for this tenant" : message }, { status });
  }
}
