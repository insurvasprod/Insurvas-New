import "server-only";

import { audit } from "@/lib/audit/log";
import type { Json } from "@/lib/supabase/database.types";
import { getSupabaseServiceClient } from "@/lib/supabase/service";

type IntakeLead = {
  id: string;
  product_line: string;
  pipeline_id: string;
  stage_id: string;
  values: Json;
};

type IntakeActor = {
  tenantId: string;
  partnerId: string;
  userId: string | null;
  partnerTimezone: string;
  submissionId: string;
  lead: IntakeLead;
  affiliateLinkId?: string | null;
  affiliateCampaign?: string | null;
  request: Request;
};

/**
 * Completes the best-effort half of every partner intake. Affiliate submissions call this
 * function too; there must be one queue/deal-flow/notification path for every source.
 */
export async function writePartnerIntakeArtifacts(input: IntakeActor): Promise<void> {
  const values = (input.lead.values ?? {}) as Record<string, unknown>;
  const textValue = (keys: string[]) => keys.map((key) => values[key]).find((value) => typeof value === "string" && value.trim()) as string | undefined;
  const fallbackName = [textValue(["first_name"]), textValue(["last_name"])].filter(Boolean).join(" ") || null;
  const name = textValue(["full_name"]) ?? fallbackName;
  const phone = textValue(["phone", "phone_number"]);
  const quote = textValue(["initial_quote", "quote"]);
  const trackingId = textValue(["tracking_id", "affiliate_tracking_id"]);
  const localDate = new Intl.DateTimeFormat("en-CA", { timeZone: input.partnerTimezone, year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());
  const supabase = getSupabaseServiceClient();
  const attribution = input.affiliateLinkId ? { affiliate_link_id: input.affiliateLinkId, affiliate_campaign: input.affiliateCampaign ?? null } : {};
  const failures: Array<{ step: "work_item" | "deal_flow" | "notification"; error: string }> = [];

  const queue = await supabase.from("lead_queue").insert({
    tenant_id: input.tenantId,
    lead_id: input.lead.id,
    partner_id: input.partnerId,
    product_line: input.lead.product_line,
    pipeline_id: input.lead.pipeline_id,
    stage_id: input.lead.stage_id,
    ...attribution,
  });
  if (queue.error && queue.error.code !== "23505") failures.push({ step: "work_item", error: queue.error.message });

  const deal = await supabase.from("deal_flow").upsert({
    tenant_id: input.tenantId,
    lead_id: input.lead.id,
    partner_id: input.partnerId,
    submission_id: input.submissionId,
    product_line: input.lead.product_line,
    pipeline_id: input.lead.pipeline_id,
    stage_id: input.lead.stage_id,
    insured_name: name,
    phone,
    initial_quote: quote,
    tracking_id: trackingId,
    local_date: localDate,
    ...attribution,
  }, { onConflict: "lead_id" });
  if (deal.error && deal.error.code !== "23505") failures.push({ step: "deal_flow", error: deal.error.message });

  const notification = await supabase.from("lead_notifications").insert({
    tenant_id: input.tenantId,
    lead_id: input.lead.id,
    channel: "internal",
    event_type: "lead_available",
    payload: { productCode: input.lead.product_line, partnerId: input.partnerId, submissionId: input.submissionId, affiliateLinkId: input.affiliateLinkId ?? null, campaign: input.affiliateCampaign ?? null },
  });
  if (notification.error && notification.error.code !== "23505") failures.push({ step: "notification", error: notification.error.message });

  for (const failure of failures) {
    const recorded = await supabase.from("intake_failures").insert({
      tenant_id: input.tenantId,
      lead_id: input.lead.id,
      step: failure.step,
      error_message: failure.error.slice(0, 2000),
      metadata: { submissionId: input.submissionId, productCode: input.lead.product_line, affiliateLinkId: input.affiliateLinkId ?? null },
    }).select("id").single();
    if (recorded.error || !recorded.data) {
      await audit({ actorType: "system", actorId: input.userId, action: "tenant.intake_failure_recording_failed", targetType: "agent_lead", targetId: input.lead.id, reason: failure.error.slice(0, 1000), metadata: { step: failure.step, submissionId: input.submissionId }, request: input.request });
    }
  }
}
