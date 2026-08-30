import "server-only";

// SA-3.1 · Storing inbound webhooks and deciding whether one still needs handling.

import { getSupabaseServiceClient } from "@/lib/supabase/service";
import type { Json } from "@/lib/supabase/database.types";
import { extractCustomerIds, type WhopEnvelope } from "./events";

export type StoredEvent = {
  id: string;
  tenantId: string | null;
  alreadyProcessed: boolean;
};

/**
 * Finds which of our tenants a Whop identifier belongs to.
 *
 * Returns null when nothing matches, which is the normal case for dashboard test events and for
 * any Whop account that isn't one of our customers.
 */
async function resolveTenant(customerIds: string[]): Promise<string | null> {
  if (customerIds.length === 0) return null;

  const supabase = getSupabaseServiceClient();
  const { data } = await supabase
    .from("payment_providers")
    .select("tenant_id")
    .in("provider_customer_id", customerIds)
    .limit(2);

  // Two tenants matching one identifier means our mapping is wrong. Attributing the event to
  // whichever row came back first would change the wrong customer's access, so refuse to guess.
  if (!data || data.length !== 1) return null;
  return data[0].tenant_id;
}

/**
 * Records the delivery. Returns `alreadyProcessed: true` only when a previous delivery of this
 * same webhook-id was handled to completion.
 *
 * The distinction matters: Whop retries a failed delivery 12 times reusing the id. Treating any
 * repeat id as a duplicate would mean an event we stored but failed to process is skipped on every
 * retry and lost permanently.
 */
export async function recordWebhookEvent(
  webhookId: string,
  envelope: WhopEnvelope,
): Promise<StoredEvent> {
  const supabase = getSupabaseServiceClient();
  const tenantId = await resolveTenant(extractCustomerIds(envelope));

  const { data: inserted, error } = await supabase
    .from("webhook_events")
    .insert({
      provider: "whop",
      event_id: webhookId,
      event_type: envelope.type,
      occurred_at: envelope.timestamp ?? null,
      payload: envelope as unknown as Json,
      tenant_id: tenantId,
    })
    .select("id, tenant_id, processed_at")
    .single();

  if (!error && inserted) {
    return { id: inserted.id, tenantId: inserted.tenant_id, alreadyProcessed: false };
  }

  // 23505: this webhook-id has been delivered before.
  if (error?.code !== "23505") {
    throw new Error(`Could not record webhook ${webhookId}: ${error?.message ?? "unknown error"}`);
  }

  const { data: existing } = await supabase
    .from("webhook_events")
    .select("id, tenant_id, processed_at")
    .eq("provider", "whop")
    .eq("event_id", webhookId)
    .single();

  if (!existing) throw new Error(`Webhook ${webhookId} conflicted but could not be read back`);

  return {
    id: existing.id,
    tenantId: existing.tenant_id,
    alreadyProcessed: existing.processed_at !== null,
  };
}

export async function markProcessed(id: string): Promise<void> {
  const supabase = getSupabaseServiceClient();
  await supabase
    .from("webhook_events")
    .update({ processed_at: new Date().toISOString(), process_error: null })
    .eq("id", id);
}

export async function markFailed(id: string, message: string): Promise<void> {
  const supabase = getSupabaseServiceClient();
  const { data: current } = await supabase
    .from("webhook_events")
    .select("attempts")
    .eq("id", id)
    .single<{ attempts: number }>();

  await supabase
    .from("webhook_events")
    .update({ process_error: message.slice(0, 500), attempts: (current?.attempts ?? 0) + 1 })
    .eq("id", id);
}
