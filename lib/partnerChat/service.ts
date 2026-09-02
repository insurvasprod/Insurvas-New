import "server-only";

import { getSupabaseServiceClient } from "@/lib/supabase/service";
import { parsePartnerMessage, type PartnerCardType, type PartnerMessage } from "./cards";

type CardInput = { tenantId: string; partnerId: string; leadId?: string | null; workItemId?: string | null; userId?: string | null; eventKey: string; cardType: PartnerCardType; message?: string };

function customer(values: unknown) {
  const v = values && typeof values === "object" && !Array.isArray(values) ? values as Record<string, unknown> : {};
  return String(v.full_name || [v.first_name, v.last_name].filter(Boolean).join(" ") || v.name || "Customer").slice(0, 160);
}

async function channelFor(supabase: ReturnType<typeof getSupabaseServiceClient>, tenantId: string, partnerId: string) {
  const { data, error } = await supabase.from("partner_channels").select("id, status").eq("tenant_id", tenantId).eq("partner_id", partnerId).eq("channel_type", "partner").maybeSingle();
  if (error || !data) throw new Error("Partner channel is not available");
  if (data.status !== "active") throw new Error("Partner channel is archived");
  return data.id;
}

async function resolvedCard(supabase: ReturnType<typeof getSupabaseServiceClient>, input: CardInput) {
  let name = "Customer";
  let agent = "An agent";
  let product = "lead";
  let disposition = "Call outcome";
  if (input.workItemId || input.leadId) {
    const { data: item } = input.workItemId ? await supabase.from("lead_queue").select("lead_id, product_line, disposition").eq("tenant_id", input.tenantId).eq("id", input.workItemId).maybeSingle() : { data: { lead_id: input.leadId, product_line: "lead", disposition: null } };
    if (item) {
      product = item.product_line;
      if (item.lead_id) {
        const { data: lead } = await supabase.from("agent_leads").select("values").eq("tenant_id", input.tenantId).eq("id", item.lead_id).maybeSingle();
        name = customer(lead?.values);
      }
      if (item.disposition) {
        const { data: d } = await supabase.from("dispositions").select("label").eq("tenant_id", input.tenantId).eq("disposition_key", item.disposition).maybeSingle();
        disposition = d?.label ?? item.disposition;
      }
    }
  }
  if (input.userId) {
    const { data: user } = await supabase.from("users").select("name").eq("id", input.userId).maybeSingle();
    agent = user?.name ?? agent;
  }
  const text = input.message ?? ({
    new_lead: `${name} is available for ${product}`,
    connected: `${agent} is connected to ${name}`,
    transferred: `${agent} accepted the transfer for ${name}`,
    call_dropped: `The call with ${name} was dropped`,
    agent_ready: `${agent} is ready to take transfers`,
    call_outcome: `${name}: ${disposition}`,
    nobody_claimed: `${name} was not claimed before the threshold`,
  } satisfies Record<PartnerCardType, string>)[input.cardType];
  return { text: text.slice(0, 2000), payload: { customer: name, agent, product, disposition } };
}

export async function postPartnerSystemCard(input: CardInput) {
  const supabase = getSupabaseServiceClient();
  const channelId = await channelFor(supabase, input.tenantId, input.partnerId);
  const card = await resolvedCard(supabase, input);
  const { data, error } = await supabase.from("partner_messages").insert({ tenant_id: input.tenantId, partner_id: input.partnerId, channel_id: channelId, work_item_id: input.workItemId ?? null, message: card.text, message_kind: "system_card", card_type: input.cardType, card_payload: card.payload, event_key: input.eventKey, created_by: input.userId ?? null }).select("id").maybeSingle();
  if (error?.code === "23505") return { alreadyPosted: true, id: null };
  if (error) throw new Error(`Could not post partner system card: ${error.message}`);
  return { alreadyPosted: false, id: data?.id ?? null };
}

export async function postPartnerText(input: { tenantId: string; partnerId: string; userId: string; message: string; mentions?: string[] }) {
  const message = input.message.trim();
  if (message.length < 1 || message.length > 2000) throw new Error("Message must be between 1 and 2,000 characters");
  const supabase = getSupabaseServiceClient();
  const channelId = await channelFor(supabase, input.tenantId, input.partnerId);
  const { data, error } = await supabase.from("partner_messages").insert({ tenant_id: input.tenantId, partner_id: input.partnerId, channel_id: channelId, work_item_id: null, message, message_kind: "text", card_type: null, card_payload: {}, created_by: input.userId }).select("id, channel_id, partner_id, work_item_id, message, message_kind, card_type, card_payload, created_by, created_at").single();
  if (error || !data) throw new Error(error?.message ?? "Could not send message");
  const mentions = [...new Set((input.mentions ?? []).filter((id) => /^[0-9a-f-]{36}$/i.test(id)))].slice(0, 20);
  if (mentions.length) {
    const valid = await supabase.from("partner_users").select("user_id").eq("tenant_id", input.tenantId).eq("partner_id", input.partnerId).in("user_id", mentions).eq("status", "active");
    if (valid.error) throw new Error(`Could not resolve mentions: ${valid.error.message}`);
    const allowed = (valid.data ?? []).map((row) => row.user_id);
    if (allowed.length) {
      const result = await supabase.from("partner_message_mentions").insert(allowed.map((mentionedUserId) => ({ tenant_id: input.tenantId, message_id: data.id, mentioned_user_id: mentionedUserId })));
      if (result.error && result.error.code !== "23505") throw new Error(`Could not save mentions: ${result.error.message}`);
    }
  }
  return parsePartnerMessage(data);
}

function mapMessages(rows: unknown[]): PartnerMessage[] { return rows.map(parsePartnerMessage).filter((row): row is PartnerMessage => Boolean(row)); }

export async function getPartnerChat(tenantId: string, partnerId: string, userId: string) {
  const supabase = getSupabaseServiceClient();
  const channel = await supabase.from("partner_channels").select("id, partner_id, name, status, created_at, archived_at").eq("tenant_id", tenantId).eq("partner_id", partnerId).eq("channel_type", "partner").maybeSingle();
  if (channel.error || !channel.data) throw new Error("Partner channel is not available");
  const messages = await supabase.from("partner_messages").select("id, channel_id, partner_id, work_item_id, message, message_kind, card_type, card_payload, created_by, created_at").eq("tenant_id", tenantId).eq("channel_id", channel.data.id).order("created_at", { ascending: true }).limit(200);
  if (messages.error) throw new Error(`Could not load chat: ${messages.error.message}`);
  const read = await supabase.from("partner_message_reads").select("read_at").eq("tenant_id", tenantId).eq("channel_id", channel.data.id).eq("user_id", userId).maybeSingle();
  const readAt = read.data?.read_at ? new Date(read.data.read_at).getTime() : 0;
  return { channel: channel.data, messages: mapMessages(messages.data ?? []), unreadCount: (messages.data ?? []).filter((row) => new Date(row.created_at).getTime() > readAt && row.created_by !== userId).length, realtimeTopic: `partner-chat:${channel.data.id}` };
}

export async function markPartnerChatRead(tenantId: string, partnerId: string, userId: string) {
  const supabase = getSupabaseServiceClient();
  const channelId = await channelFor(supabase, tenantId, partnerId);
  const { error } = await supabase.from("partner_message_reads").upsert({ tenant_id: tenantId, channel_id: channelId, user_id: userId, read_at: new Date().toISOString() }, { onConflict: "channel_id,user_id" });
  if (error) throw new Error(`Could not mark chat read: ${error.message}`);
}

export async function postAgentReadyCards(tenantId: string, userId: string, eventKey: string) {
  const supabase = getSupabaseServiceClient();
  const { data: channels, error } = await supabase.from("partner_channels").select("partner_id").eq("tenant_id", tenantId).eq("channel_type", "partner").eq("status", "active");
  if (error) throw new Error(error.message);
  await Promise.all((channels ?? []).map((channel) => postPartnerSystemCard({ tenantId, partnerId: channel.partner_id, userId, eventKey: `${eventKey}:${channel.partner_id}`, cardType: "agent_ready" }).catch((cardError) => console.error("Partner ready card failed", cardError))));
}
