import "server-only";

import { randomUUID } from "node:crypto";
import { getSupabaseServiceClient } from "@/lib/supabase/service";
import { parsePartnerMessage, type ChatSearchHit, type PartnerCardType, type PartnerMessage, type PartnerMessageAttachment } from "./cards";
import { notifyTenantAgents } from "@/lib/agentAlerts/service";
import { notifyPartnerUsers } from "@/lib/partnerAlerts/service";
import { productLineLabel } from "@/lib/format/productLine";
import { nobodyClaimedKeyFromPartnerEvent } from "@/lib/queueSla/keys";
import type { ProducerScope } from "../agency/visibilityCore";
import { visibleWorkItemIds } from "../transferInbox/scopeCore";
import { canAddPeople, canChangeRole, canManage, canPost, canRemove, nextOwner, type ChannelMember, type ChannelRole } from "./groupRules";
import { conversationStates, membersOf, writeConversationState, writeMembers, type ConversationState } from "./groups";

export const PARTNER_CHAT_BUCKET = "partner-chat-attachments";
export const MAX_ATTACHMENT_BYTES = 10 * 1024 * 1024;
export const ALLOWED_ATTACHMENT_TYPES = [
  "image/jpeg", "image/png", "image/gif", "application/pdf", "text/plain",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
] as const;

export type ChatAttachmentInput = { name: string; contentType: string; size: number; data: Buffer };
export type ChatChannel = { id: string; tenant_id: string; partner_id: string | null; channel_type: "partner" | "direct" | "group"; name: string; status: "active" | "archived"; created_by: string | null; created_at: string; archived_at: string | null };

type CardInput = { tenantId: string; partnerId: string; leadId?: string | null; workItemId?: string | null; userId?: string | null; eventKey: string; cardType: PartnerCardType; message?: string };

function customer(values: unknown) {
  const v = values && typeof values === "object" && !Array.isArray(values) ? values as Record<string, unknown> : {};
  return String(v.full_name || [v.first_name, v.last_name].filter(Boolean).join(" ") || v.name || "Customer").slice(0, 160);
}

function safeFilename(name: string) {
  return name.trim().replace(/[^a-zA-Z0-9._ -]/g, "_").slice(0, 255) || "attachment";
}

async function channelFor(supabase: ReturnType<typeof getSupabaseServiceClient>, tenantId: string, partnerId: string) {
  const { data, error } = await supabase.from("partner_channels").select("id, status").eq("tenant_id", tenantId).eq("partner_id", partnerId).eq("channel_type", "partner").maybeSingle();
  if (error || !data) throw new Error("Partner channel is not available");
  if (data.status !== "active") throw new Error("Partner channel is archived");
  return data.id;
}

async function channelById(supabase: ReturnType<typeof getSupabaseServiceClient>, tenantId: string, channelId: string) {
  const { data, error } = await supabase.from("partner_channels").select("id, tenant_id, partner_id, channel_type, name, status, created_by, created_at, archived_at, direct_key").eq("tenant_id", tenantId).eq("id", channelId).maybeSingle();
  if (error || !data) throw new Error("Chat channel is not available");
  return data as ChatChannel;
}

async function isChannelMember(supabase: ReturnType<typeof getSupabaseServiceClient>, channel: ChatChannel, userId: string) {
  if (channel.channel_type === "partner") {
    if (!channel.partner_id) return false;
    const { data, error } = await supabase.from("partner_users").select("user_id").eq("tenant_id", channel.tenant_id).eq("partner_id", channel.partner_id).eq("user_id", userId).eq("status", "active").maybeSingle();
    if (error) throw new Error("Could not verify partner channel access");
    if (data) return true;
    const tenantMember = await supabase.from("tenant_users").select("user_id").eq("tenant_id", channel.tenant_id).eq("user_id", userId).maybeSingle();
    if (tenantMember.error) throw new Error("Could not verify partner channel access");
    return Boolean(tenantMember.data);
  }
  return Boolean(await memberFor(supabase, channel, userId));
}

/** This person's seat in a direct or group channel (role and switches), or undefined when they are not in it. */
async function memberFor(supabase: ReturnType<typeof getSupabaseServiceClient>, channel: ChatChannel, userId: string): Promise<ChannelMember | undefined> {
  if (channel.channel_type === "partner") return undefined;
  const members = await membersOf(supabase, channel.tenant_id, [channel]).catch(() => { throw new Error("Could not verify channel access"); });
  return members.get(channel.id)?.find((member) => member.userId === userId);
}

async function assertChannelAccess(supabase: ReturnType<typeof getSupabaseServiceClient>, channel: ChatChannel, userId: string, allowArchived = false) {
  if (!allowArchived && channel.status !== "active") throw new Error("Chat channel is archived");
  if (!(await isChannelMember(supabase, channel, userId))) throw new Error("You do not have access to this chat channel");
}

async function signedAttachmentUrl(supabase: ReturnType<typeof getSupabaseServiceClient>, storagePath: string) {
  const { data, error } = await supabase.storage.from(PARTNER_CHAT_BUCKET).createSignedUrl(storagePath, 300);
  if (error) { console.error("Partner attachment URL failed", error); return null; }
  return data.signedUrl;
}

async function attachmentViews(supabase: ReturnType<typeof getSupabaseServiceClient>, messageIds: string[]) {
  if (!messageIds.length) return new Map<string, PartnerMessageAttachment[]>();
  const rows = await supabase.from("partner_message_attachments").select("id, message_id, file_name, content_type, size_bytes, storage_path").in("message_id", messageIds);
  if (rows.error) throw new Error(`Could not load chat attachments: ${rows.error.message}`);
  const map = new Map<string, PartnerMessageAttachment[]>();
  const paths = (rows.data ?? []).map((row) => row.storage_path);
  // One signing request for the whole page instead of one per attachment; a failure still
  // degrades to a null download link rather than failing the chat load.
  const signed = paths.length ? await supabase.storage.from(PARTNER_CHAT_BUCKET).createSignedUrls(paths, 300) : { data: [], error: null };
  if (signed.error) console.error("Partner attachment URL failed", signed.error);
  const urlByPath = new Map<string, string>();
  for (const item of signed.data ?? []) {
    if (item.error) console.error("Partner attachment URL failed", item.error);
    else if (item.path && item.signedUrl) urlByPath.set(item.path, item.signedUrl);
  }
  for (const row of rows.data ?? []) {
    const attachment = { id: row.id, fileName: row.file_name, contentType: row.content_type, sizeBytes: row.size_bytes, downloadUrl: urlByPath.get(row.storage_path) ?? null } satisfies PartnerMessageAttachment;
    map.set(row.message_id, [...(map.get(row.message_id) ?? []), attachment]);
  }
  return map;
}

async function resolvedCard(supabase: ReturnType<typeof getSupabaseServiceClient>, input: CardInput) {
  let name = "Customer";
  let agent = "An agent";
  let product = "lead";
  let disposition = "Call outcome";
  let state: string | null = null;
  if (input.workItemId || input.leadId) {
    // A new_lead card has no work item yet: read the product from the lead itself, so the card says
    // "… is available for term_life" rather than the placeholder "… is available for lead".
    const { data: item } = input.workItemId
      ? await supabase.from("lead_queue").select("lead_id, product_line, disposition").eq("tenant_id", input.tenantId).eq("id", input.workItemId).maybeSingle()
      : { data: { lead_id: input.leadId, product_line: (await supabase.from("agent_leads").select("product_line").eq("tenant_id", input.tenantId).eq("id", input.leadId!).maybeSingle()).data?.product_line ?? "lead", disposition: null } };
    if (item) {
      product = item.product_line;
      if (item.lead_id) {
        const { data: lead } = await supabase.from("agent_leads").select("values").eq("tenant_id", input.tenantId).eq("id", item.lead_id).maybeSingle();
        name = customer(lead?.values);
        const values = lead?.values && typeof lead.values === "object" && !Array.isArray(lead.values) ? lead.values as Record<string, unknown> : {};
        const rawState = values.state ?? values.state_code ?? values.address_state;
        state = typeof rawState === "string" && rawState.trim() ? rawState.trim().slice(0, 40) : null;
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
  // D19(b): the card names the product as the catalog calls it ("Term Life"), never the raw code
  // (term_life) or the placeholder "lead". A code the catalog does not know is spelled out.
  const productCode = product;
  if (product !== "lead") {
    const { data: catalog } = await supabase.from("products").select("name").eq("code", product).maybeSingle<{ name: string | null }>();
    product = catalog?.name?.trim() || productLineLabel(product);
  }
  const text = input.message ?? ({
    new_lead: product === "lead" ? `${name} is available for a new lead` : `${name} is available for ${product}`,
    connected: `${agent} is connected to ${name}`,
    transferred: `${agent} accepted the transfer for ${name}`,
    call_dropped: `The call with ${name} was dropped`,
    agent_ready: `${agent} is ready to take transfers`,
    call_outcome: `${name}: ${disposition}`,
    nobody_claimed: `${name} was not claimed before the threshold`,
  } satisfies Record<PartnerCardType, string>)[input.cardType];
  return { text: text.slice(0, 2000), payload: { customer: name, agent, product, ...(productCode !== "lead" ? { product_code: productCode } : {}), disposition, ...(state ? { state } : {}) } };
}

/**
 * LA-1.16-4: "nobody_claimed → Ray only". The card type decides the destination, so every caller
 * lands on the agency side: an owner-only alert (the same kind as the SLA escalation, so each
 * owner's "unclaimed escalation" preference applies), never a row in the partner's channel. The
 * partner hears about it separately, through the Queue & SLA partner-notice rung and the pipeline
 * row that reads "Nobody claimed it".
 */
export const NOBODY_CLAIMED_ALERT_KIND = "unclaimed_sla_escalation";
export function nobodyClaimedSourceKey(input: { workItemId?: string | null; eventKey: string }) {
  // The SLA partner rung names its wait in the event key (a transfer back in the queue alerts again).
  const fromLadder = nobodyClaimedKeyFromPartnerEvent(input.eventKey);
  if (fromLadder) return fromLadder;
  return input.workItemId ? `unclaimed-sla:${input.workItemId}:nobody-claimed` : `${input.eventKey}:nobody-claimed`;
}

async function alertOwnersNobodyClaimed(supabase: ReturnType<typeof getSupabaseServiceClient>, input: CardInput) {
  const [card, partner] = await Promise.all([
    resolvedCard(supabase, { ...input, message: undefined }),
    supabase.from("partners").select("name").eq("tenant_id", input.tenantId).eq("id", input.partnerId).maybeSingle(),
  ]);
  const name = String(card.payload.customer);
  const partnerName = partner.data?.name ?? "the partner";
  const result = await notifyTenantAgents({
    tenantId: input.tenantId,
    roles: ["owner"],
    kind: NOBODY_CLAIMED_ALERT_KIND,
    title: `Nobody claimed: ${name}`,
    body: `${name} from ${partnerName} was not claimed before the response window.`,
    link: input.leadId ? `/app/leads/${input.leadId}` : "/app/inbound",
    sourceKey: nobodyClaimedSourceKey(input),
  });
  return { alreadyPosted: false, id: null, routedTo: "owners" as const, notified: result.notified };
}

export async function postPartnerSystemCard(input: CardInput) {
  const supabase = getSupabaseServiceClient();
  if (input.cardType === "nobody_claimed") return alertOwnersNobodyClaimed(supabase, input);
  const channelId = await channelFor(supabase, input.tenantId, input.partnerId);
  const card = await resolvedCard(supabase, input);
  const { data, error } = await supabase.from("partner_messages").insert({ tenant_id: input.tenantId, partner_id: input.partnerId, channel_id: channelId, work_item_id: input.workItemId ?? null, message: card.text, message_kind: "system_card", card_type: input.cardType, card_payload: card.payload, event_key: input.eventKey, created_by: input.userId ?? null }).select("id").maybeSingle();
  if (error?.code === "23505") return { alreadyPosted: true, id: null };
  if (error) throw new Error(`Could not post partner system card: ${error.message}`);
  void notifyPartnerUsers({ tenantId: input.tenantId, partnerId: input.partnerId, kind: "lead_status_changed", title: "Lead status updated", body: "A lead in your pipeline has a new operational update.", link: "/partner/pipeline", sourceKey: `partner-system-card:${data?.id ?? input.eventKey}` }).catch((alertError) => console.error("Partner system-card alert failed", alertError));
  return { alreadyPosted: false, id: data?.id ?? null };
}

export async function postChannelText(input: { tenantId: string; channelId: string; userId: string; message: string; mentions?: string[]; attachments?: ChatAttachmentInput[]; notifyAgents?: boolean }) {
  const message = input.message.trim();
  if (message.length < 1 || message.length > 2000) throw new Error("Message must be between 1 and 2,000 characters");
  const supabase = getSupabaseServiceClient();
  const channel = await channelById(supabase, input.tenantId, input.channelId);
  await assertChannelAccess(supabase, channel, input.userId);
  if (channel.channel_type === "group" && !canPost(await memberFor(supabase, channel, input.userId))) throw new Error("You can read this group but not write in it. Ask an admin to change your role.");
  const messageId = randomUUID();
  const uploadedPaths: string[] = [];
  try {
    const attachmentRows: Array<{ id: string; tenant_id: string; message_id: string; file_name: string; storage_path: string; content_type: string; size_bytes: number; created_by: string }> = [];
    for (const inputFile of input.attachments ?? []) {
      const path = `${input.tenantId}/${channel.id}/${messageId}/${randomUUID()}-${safeFilename(inputFile.name)}`;
      const upload = await supabase.storage.from(PARTNER_CHAT_BUCKET).upload(path, inputFile.data, { contentType: inputFile.contentType, upsert: false });
      if (upload.error) throw new Error(`Could not upload attachment: ${upload.error.message}`);
      uploadedPaths.push(path);
      attachmentRows.push({ id: randomUUID(), tenant_id: input.tenantId, message_id: messageId, file_name: safeFilename(inputFile.name), storage_path: path, content_type: inputFile.contentType, size_bytes: inputFile.size, created_by: input.userId });
    }
    const { data, error } = await supabase.from("partner_messages").insert({ id: messageId, tenant_id: input.tenantId, partner_id: channel.partner_id, channel_id: channel.id, work_item_id: null, message, message_kind: "text", card_type: null, card_payload: {}, created_by: input.userId }).select("id, channel_id, partner_id, work_item_id, message, message_kind, card_type, card_payload, created_by, created_at, event_key").single();
    if (error || !data) throw new Error(error?.message ?? "Could not send message");
    if (attachmentRows.length) {
      const attachmentInsert = await supabase.from("partner_message_attachments").insert(attachmentRows);
      if (attachmentInsert.error) throw new Error(`Could not save attachment metadata: ${attachmentInsert.error.message}`);
    }
    const mentions = [...new Set((input.mentions ?? []).filter((id) => /^[0-9a-f-]{36}$/i.test(id)))].slice(0, 20);
    if (mentions.length) {
      const valid = channel.channel_type === "partner"
        ? channel.partner_id ? await supabase.from("partner_users").select("user_id").eq("tenant_id", input.tenantId).eq("partner_id", channel.partner_id).in("user_id", mentions).eq("status", "active") : { data: [], error: new Error("Partner channel is missing its partner") }
        : await supabase.from("partner_channel_members").select("user_id").eq("tenant_id", input.tenantId).eq("channel_id", channel.id).in("user_id", mentions);
      if (valid.error) throw new Error(`Could not resolve mentions: ${valid.error.message}`);
      const allowed = (valid.data ?? []).map((row) => row.user_id);
      if (allowed.length) {
        const result = await supabase.from("partner_message_mentions").insert(allowed.map((mentionedUserId) => ({ tenant_id: input.tenantId, message_id: data.id, mentioned_user_id: mentionedUserId })));
        if (result.error && result.error.code !== "23505") throw new Error(`Could not save mentions: ${result.error.message}`);
      }
    }
    if (input.notifyAgents) void notifyTenantAgents({ tenantId: input.tenantId, roles: ["owner", "producer", "assistant", "bookkeeper"], kind: "partner_message", title: "New partner message", body: message, link: "/app/partner-chat", sourceKey: `partner-message:${data.id}`, excludeUserId: input.userId }).catch((alertError) => console.error("Agent partner-message alert failed", alertError));
    if (channel.partner_id) void notifyPartnerUsers({ tenantId: input.tenantId, partnerId: channel.partner_id, kind: "partner_message", title: input.notifyAgents ? "New partner message" : "New message from your agent", body: "Open Partner Messages to read the latest update.", link: "/partner/messages", sourceKey: `partner-channel-message:${data.id}`, excludeUserId: input.userId }).catch((alertError) => console.error("Partner message alert failed", alertError));
    const views = await attachmentViews(supabase, [data.id]);
    const saved = await supabase.from("partner_message_attachments").select("id, file_name, content_type, size_bytes").eq("message_id", data.id);
    return parsePartnerMessage({ ...data, attachments: (saved.data ?? []).map((row) => ({ ...row, download_url: views.get(data.id)?.find((item) => item.id === row.id)?.downloadUrl ?? null })) });
  } catch (error) {
    if (uploadedPaths.length) await supabase.storage.from(PARTNER_CHAT_BUCKET).remove(uploadedPaths);
    throw error;
  }
}

export async function postPartnerText(input: { tenantId: string; partnerId: string; userId: string; message: string; mentions?: string[]; attachments?: ChatAttachmentInput[]; notifyAgents?: boolean }) {
  const channelId = await channelFor(getSupabaseServiceClient(), input.tenantId, input.partnerId);
  return postChannelText({ ...input, channelId });
}

function mapMessages(rows: unknown[]): PartnerMessage[] { return rows.map(parsePartnerMessage).filter((row): row is PartnerMessage => Boolean(row)); }

async function visibleToPartner(db: ReturnType<typeof getSupabaseServiceClient>, tenantId: string, rows: Array<{ event_key?: string | null }>) {
  const noteIds = rows.map((row) => row.event_key?.startsWith("lead-note:") ? row.event_key.slice("lead-note:".length) : null).filter((id): id is string => Boolean(id));
  if (!noteIds.length) return new Set<string>();
  const notes = await db.from("tenant_lead_notes").select("id, visibility, deleted_at").eq("tenant_id", tenantId).in("id", noteIds);
  if (notes.error) throw new Error(`Could not filter shared notes: ${notes.error.message}`);
  return new Set((notes.data ?? []).filter((note) => note.visibility === "shared" && !note.deleted_at).map((note) => note.id));
}

function filterNoteMessages<T extends { event_key?: string | null }>(rows: T[], visibleNoteIds: Set<string>) { return rows.filter((row) => !row.event_key?.startsWith("lead-note:") || visibleNoteIds.has(row.event_key.slice("lead-note:".length))); }

async function getChatForChannel(tenantId: string, channelId: string, userId: string, allowArchived = false) {
  const supabase = getSupabaseServiceClient();
  return chatForLoadedChannel(supabase, await channelById(supabase, tenantId, channelId), userId, allowArchived);
}

// Takes a channel row the caller already loaded (tenant-scoped), so list fan-outs do not
// re-read partner_channels per channel. Access is still asserted before any message read.
//
// `accessVerified` is for a caller that has already established membership itself — see
// getAgentChatChannels. Everyone else leaves it false and pays for the check.
type MessageRow = { id: string; work_item_id: string | null; card_type: string | null; card_payload: unknown; created_at: string; event_key: string | null; message_kind: string };

/**
 * Facts the stored card does not carry, added as it is read so no write path has to change:
 * - an outcome card says whether it counts as work completed, from the tenant's own disposition
 *   flags (the key is in its event_key, "disposition:<work item>:<key>");
 * - a connected card says how many minutes after the partner's submission the agent picked up.
 * A lookup that fails leaves the card exactly as stored.
 */
async function enrichCards<T extends MessageRow>(supabase: ReturnType<typeof getSupabaseServiceClient>, tenantId: string, rows: T[]): Promise<T[]> {
  const outcomeKey = (row: T) => (row.card_type === "call_outcome" || row.card_type === "call_dropped") && row.event_key?.startsWith("disposition:") ? row.event_key.split(":").slice(2).join(":") || null : null;
  const keys = [...new Set(rows.map(outcomeKey).filter((key): key is string => !!key))];
  const connectedItems = [...new Set(rows.filter((row) => row.card_type === "connected" && row.work_item_id).map((row) => row.work_item_id as string))];
  if (!keys.length && !connectedItems.length) return rows;
  try {
    const [flags, items] = await Promise.all([
      keys.length ? supabase.from("dispositions").select("disposition_key, counts_as_work_completed, closes_as").eq("tenant_id", tenantId).in("disposition_key", keys) : Promise.resolve({ data: [], error: null }),
      connectedItems.length ? supabase.from("lead_queue").select("id, created_at").eq("tenant_id", tenantId).in("id", connectedItems) : Promise.resolve({ data: [], error: null }),
    ]);
    if (flags.error || items.error) return rows;
    const byKey = new Map((flags.data ?? []).map((row) => [row.disposition_key, row]));
    const createdAt = new Map((items.data ?? []).map((row) => [row.id, row.created_at as string]));
    return rows.map((row) => {
      const payload = row.card_payload && typeof row.card_payload === "object" && !Array.isArray(row.card_payload) ? row.card_payload as Record<string, unknown> : {};
      const key = outcomeKey(row);
      const flag = key ? byKey.get(key) : undefined;
      if (flag) return { ...row, card_payload: { ...payload, counts_as_work_completed: flag.counts_as_work_completed, closes_as: flag.closes_as } };
      const submitted = row.card_type === "connected" && row.work_item_id ? createdAt.get(row.work_item_id) : undefined;
      if (submitted) {
        const minutes = Math.round((new Date(row.created_at).getTime() - new Date(submitted).getTime()) / 60000);
        if (minutes >= 0) return { ...row, card_payload: { ...payload, minutes_after_submission: minutes } };
      }
      return row;
    });
  } catch {
    return rows;
  }
}

/**
 * AG-0.5: `scope` (scopeFor, from the session). A partner channel is the agency's, and its system cards
 * (connected, outcome, dropped …) each name one transfer. In an agency a narrow session keeps the
 * messages that name no transfer and the ones about transfers it may see (waiting ones and its
 * producers' — lib/transferInbox/scope.ts); a card about another producer's transfer is left out of the
 * thread and of the unread count. Omitted / null = every message, as before.
 */
type PreloadedChat = { messages: Array<MessageRow & Record<string, unknown>>; readAt: string | null };
const PREPARE_CHUNK = 150;
/** The list's lookups, done once for every channel (2026-10-28): enriched rows, shared notes, attachments. */
type PreparedChat = { enriched: Array<MessageRow & Record<string, unknown>>; visibleNoteIds: Set<string>; attachments: Map<string, PartnerMessageAttachment[]> };

/**
 * The per-channel reads chatForLoadedChannel would make (card facts, shared-note visibility, attachments
 * and their signed links), as three reads for the whole list instead of three per channel. On the demo
 * agency's 33 channels that was ~100 round trips and most of the 2–4 s the list took.
 */
async function prepareChats(supabase: ReturnType<typeof getSupabaseServiceClient>, tenantId: string, channels: ChatChannel[], latest: Map<string, PreloadedChat>): Promise<Map<string, PreparedChat>> {
  const own = channels.map((channel) => {
    const stored = [...(latest.get(channel.id)?.messages ?? [])].reverse();
    return { channel, rows: channel.channel_type === "partner" ? stored.filter((row) => row.card_type !== "nobody_claimed") : stored };
  });
  const all = own.flatMap((item) => item.rows);
  const partnerRows = own.filter((item) => item.channel.channel_type === "partner").flatMap((item) => item.rows);
  // The ids ride in the request URL, so they go in slices of PREPARE_CHUNK rows, the slices in parallel.
  const chunks = <T,>(list: T[]) => Array.from({ length: Math.ceil(list.length / PREPARE_CHUNK) }, (_, i) => list.slice(i * PREPARE_CHUNK, (i + 1) * PREPARE_CHUNK));
  const [enrichedParts, noteParts, attachmentParts] = await Promise.all([
    Promise.all(chunks(all).map((part) => enrichCards(supabase, tenantId, part))),
    Promise.all(chunks(partnerRows).map((part) => visibleToPartner(supabase, tenantId, part))),
    Promise.all(chunks(all).map((part) => attachmentViews(supabase, part.map((row) => row.id)))),
  ]);
  const enriched = enrichedParts.flat();
  const visibleNoteIds = new Set(noteParts.flatMap((part) => [...part]));
  const attachments = new Map(attachmentParts.flatMap((part) => [...part]));
  // enrichCards keeps the order it was given, so each channel takes back its own slice.
  const prepared = new Map<string, PreparedChat>();
  let at = 0;
  for (const item of own) {
    prepared.set(item.channel.id, { enriched: enriched.slice(at, at + item.rows.length), visibleNoteIds, attachments });
    at += item.rows.length;
  }
  return prepared;
}

async function chatForLoadedChannel(supabase: ReturnType<typeof getSupabaseServiceClient>, channel: ChatChannel, userId: string, allowArchived = false, accessVerified = false, scope: ProducerScope = null, preloaded?: PreloadedChat, prepared?: PreparedChat) {
  const tenantId = channel.tenant_id;
  if (!accessVerified) await assertChannelAccess(supabase, channel, userId, allowArchived);
  else if (!allowArchived && channel.status !== "active") throw new Error("Chat channel is archived");
  const [messages, read] = preloaded
    ? [{ data: preloaded.messages, error: null }, { data: preloaded.readAt ? { read_at: preloaded.readAt } : null }]
    : await Promise.all([
      // Newest 200, flipped back to chronological below: ascending + limit returned the OLDEST
      // 200, so a channel past 200 messages never showed anything new.
      supabase.from("partner_messages").select("id, channel_id, partner_id, work_item_id, message, message_kind, card_type, card_payload, created_by, created_at, event_key").eq("tenant_id", tenantId).eq("channel_id", channel.id).order("created_at", { ascending: false }).limit(200),
      supabase.from("partner_message_reads").select("read_at").eq("tenant_id", tenantId).eq("channel_id", channel.id).eq("user_id", userId).maybeSingle(),
    ]);
  if (messages.error) throw new Error(`Could not load chat: ${messages.error.message}`);
  // "nobody_claimed → Ray only" (LA-1.16-4): cards posted to a partner channel before the writer
  // routed them to the owners stay stored, but the channel no longer shows them to anyone.
  const stored = [...(messages.data ?? [])].reverse();
  const enriched = prepared ? prepared.enriched : await enrichCards(supabase, tenantId, channel.channel_type === "partner" ? stored.filter((row) => row.card_type !== "nobody_claimed") : stored);
  const visibleItems = scope === null ? null : await visibleWorkItemIds(tenantId, scope, enriched.map((row) => row.work_item_id).filter((id): id is string => Boolean(id)), userId);
  const rows = visibleItems === null ? enriched : enriched.filter((row) => !row.work_item_id || visibleItems.has(row.work_item_id));
  // Attachments are fetched alongside the note filter; hidden notes' entries are simply never attached below.
  const [visibleNoteIds, attachments] = prepared
    ? [channel.channel_type === "partner" ? prepared.visibleNoteIds : new Set<string>(), prepared.attachments]
    : await Promise.all([
      channel.channel_type === "partner" ? visibleToPartner(supabase, tenantId, rows) : Promise.resolve(new Set<string>()),
      attachmentViews(supabase, rows.map((row) => row.id)),
    ]);
  const visibleMessages = filterNoteMessages(rows, visibleNoteIds);
  const parsed = mapMessages(visibleMessages.map((row) => ({ ...row, attachments: attachments.get(row.id) ?? [] })));
  const readAt = read.data?.read_at ? new Date(read.data.read_at).getTime() : 0;
  return { channel, messages: parsed, unreadCount: visibleMessages.filter((row) => new Date(row.created_at).getTime() > readAt && row.created_by !== userId).length, realtimeTopic: `partner-chat:${channel.id}` };
}

export async function getPartnerChat(tenantId: string, partnerId: string, userId: string) {
  const channelId = await channelFor(getSupabaseServiceClient(), tenantId, partnerId);
  return getChatForChannel(tenantId, channelId, userId);
}

/** Return the partner's shared agent channel plus any internal channels the partner can access. */
export async function getPartnerChatChannels(tenantId: string, partnerId: string, userId: string) {
  const supabase = getSupabaseServiceClient();
  const [channels, memberships] = await Promise.all([
    // Server-side prefilter drops other partners' shared channels; it is a superset of the JS
    // filter below (membership needs the second query), which stays the authority.
    supabase.from("partner_channels").select("id, tenant_id, partner_id, channel_type, name, status, created_by, created_at, archived_at, direct_key").eq("tenant_id", tenantId).or(`and(channel_type.eq.partner,partner_id.eq.${partnerId}),channel_type.neq.partner`).order("created_at", { ascending: false }),
    supabase.from("partner_channel_members").select("channel_id").eq("tenant_id", tenantId).eq("user_id", userId),
  ]);
  if (channels.error || memberships.error) throw new Error("Could not load partner chat channels");
  // A removed member keeps their row (removed_at), so membership is read through membersOf.
  const rowIds = new Set((memberships.data ?? []).map((row) => row.channel_id));
  const candidates = (channels.data ?? []).filter((channel) => channel.channel_type !== "partner" && rowIds.has(channel.id)) as ChatChannel[];
  const seats = await membersOf(supabase, tenantId, candidates);
  const memberIds = new Set(candidates.filter((channel) => seats.get(channel.id)?.some((member) => member.userId === userId)).map((channel) => channel.id));
  const visible = (channels.data ?? []).filter((channel) => channel.channel_type === "partner" ? channel.partner_id === partnerId : memberIds.has(channel.id)) as ChatChannel[];
  const othersRead = await othersReadAtByChannel(supabase, tenantId, userId, visible.map((channel) => channel.id));
  const results = await Promise.all(visible.map((channel) => chatForLoadedChannel(supabase, channel, userId, true).catch(() => null)));
  return results
    .filter((result): result is NonNullable<typeof result> => Boolean(result))
    .map((result) => ({ ...result, othersReadAt: othersRead.get(result.channel.id) ?? null }));
}

/** Directory used by Partner chat. It never includes users from another partner organization. */
export async function getPartnerChatDirectory(tenantId: string, partnerId: string) {
  const supabase = getSupabaseServiceClient();
  const [tenantUsers, partnerUsers] = await Promise.all([
    supabase.from("tenant_users").select("user_id, role, users!inner(id, name, email, status)").eq("tenant_id", tenantId),
    supabase.from("partner_users").select("user_id, role, partner_id, users!partner_users_user_id_fkey!inner(id, name, email, status), partners!inner(name)").eq("tenant_id", tenantId).eq("partner_id", partnerId).eq("status", "active"),
  ]);
  if (tenantUsers.error || partnerUsers.error) throw new Error("Could not load partner chat directory");
  return { tenantUsers: tenantUsers.data ?? [], partnerUsers: partnerUsers.data ?? [] };
}

export async function markChannelRead(tenantId: string, channelId: string, userId: string) {
  const supabase = getSupabaseServiceClient();
  const channel = await channelById(supabase, tenantId, channelId);
  await assertChannelAccess(supabase, channel, userId, true);
  const { error } = await supabase.from("partner_message_reads").upsert({ tenant_id: tenantId, channel_id: channel.id, user_id: userId, read_at: new Date().toISOString() }, { onConflict: "channel_id,user_id" });
  if (error) throw new Error(`Could not mark chat read: ${error.message}`);
}

export async function markPartnerChatRead(tenantId: string, partnerId: string, userId: string) {
  return markChannelRead(tenantId, await channelFor(getSupabaseServiceClient(), tenantId, partnerId), userId);
}

async function allowedPartnerUserIds(supabase: ReturnType<typeof getSupabaseServiceClient>, tenantId: string, partnerId: string, userIds: string[], creatorId: string) {
  const unique = [...new Set(userIds)].filter((id) => id !== creatorId).slice(0, 50);
  if (!unique.length) throw new Error("Choose at least one other participant");
  const [tenantUsers, partnerUsers] = await Promise.all([
    supabase.from("tenant_users").select("user_id").eq("tenant_id", tenantId).in("user_id", unique),
    supabase.from("partner_users").select("user_id").eq("tenant_id", tenantId).eq("partner_id", partnerId).eq("status", "active").in("user_id", unique),
  ]);
  if (tenantUsers.error || partnerUsers.error) throw new Error("Could not resolve channel participants");
  const valid = new Set([...(tenantUsers.data ?? []).map((row) => row.user_id), ...(partnerUsers.data ?? []).map((row) => row.user_id)]);
  if (valid.size !== unique.length) throw new Error("Every participant must belong to your partner organization or the agent team");
  return unique;
}

export async function createPartnerChannel(input: { tenantId: string; partnerId: string; userId: string; name?: string; channelType: "direct" | "group"; userIds: string[] }) {
  const supabase = getSupabaseServiceClient();
  const participants = await allowedPartnerUserIds(supabase, input.tenantId, input.partnerId, input.userIds, input.userId);
  if (input.channelType === "direct" && participants.length !== 1) throw new Error("A direct message must have one recipient");
  const directKey = input.channelType === "direct" ? [input.userId, participants[0]].sort().join(":") : null;
  if (directKey) {
    const existing = await supabase.from("partner_channels").select("id, tenant_id, partner_id, channel_type, name, status, created_by, created_at, archived_at, direct_key").eq("tenant_id", input.tenantId).eq("partner_id", input.partnerId).eq("channel_type", "direct").eq("direct_key", directKey).maybeSingle();
    if (existing.data) return existing.data as ChatChannel;
  }
  const inserted = await supabase.from("partner_channels").insert({ tenant_id: input.tenantId, partner_id: input.partnerId, channel_type: input.channelType, name: (input.name?.trim() || (input.channelType === "direct" ? "Direct message" : "Partner team channel")).slice(0, 160), created_by: input.userId, direct_key: directKey }).select("id, tenant_id, partner_id, channel_type, name, status, created_by, created_at, archived_at, direct_key").single();
  if (inserted.error?.code === "23505" && directKey) {
    const raced = await supabase.from("partner_channels").select("id, tenant_id, partner_id, channel_type, name, status, created_by, created_at, archived_at, direct_key").eq("tenant_id", input.tenantId).eq("partner_id", input.partnerId).eq("channel_type", "direct").eq("direct_key", directKey).maybeSingle();
    if (raced.data) return raced.data as ChatChannel;
  }
  if (inserted.error || !inserted.data) throw new Error(inserted.error?.message ?? "Could not create chat channel");
  const members = await supabase.from("partner_channel_members").insert([input.userId, ...participants].map((userId) => ({ channel_id: inserted.data.id, tenant_id: input.tenantId, user_id: userId })));
  if (members.error) { await supabase.from("partner_channels").delete().eq("id", inserted.data.id); throw new Error(`Could not save channel participants: ${members.error.message}`); }
  return inserted.data as ChatChannel;
}

export class PartnerMixError extends Error {
  constructor() {
    super("A channel can include people from one partner at most. Partners never see each other's messages, so start a separate channel for each partner.");
    this.name = "PartnerMixError";
  }
}

async function allowedUserIds(supabase: ReturnType<typeof getSupabaseServiceClient>, tenantId: string, userIds: string[], creatorId: string) {
  const unique = [...new Set(userIds)].filter((id) => id !== creatorId).slice(0, 50);
  if (!unique.length) throw new Error("Choose at least one other participant");
  const [tenantUsers, partnerUsers] = await Promise.all([
    supabase.from("tenant_users").select("user_id").eq("tenant_id", tenantId).in("user_id", unique),
    supabase.from("partner_users").select("user_id, partner_id").eq("tenant_id", tenantId).in("user_id", unique).eq("status", "active"),
  ]);
  if (tenantUsers.error || partnerUsers.error) throw new Error("Could not resolve channel participants");
  const valid = new Set([...(tenantUsers.data ?? []).map((row) => row.user_id), ...(partnerUsers.data ?? []).map((row) => row.user_id)]);
  if (valid.size !== unique.length) throw new Error("Every participant must belong to this tenant");
  // Partners never see each other: a channel an agent builds may hold people from one partner at
  // most, or every member of it would read the other partner's messages. A tenant user who is also
  // a partner member counts as that partner here.
  const partners = new Set((partnerUsers.data ?? []).map((row) => row.partner_id));
  if (partners.size > 1) throw new PartnerMixError();
  return unique;
}

export async function createAgentChannel(input: { tenantId: string; userId: string; name?: string; channelType: "direct" | "group"; userIds: string[] }) {
  const supabase = getSupabaseServiceClient();
  const participants = await allowedUserIds(supabase, input.tenantId, input.userIds, input.userId);
  if (input.channelType === "direct" && participants.length !== 1) throw new Error("A direct message must have one recipient");
  const directKey = input.channelType === "direct" ? [input.userId, participants[0]].sort().join(":") : null;
  if (directKey) {
    const existing = await supabase.from("partner_channels").select("id, tenant_id, partner_id, channel_type, name, status, created_by, created_at, archived_at, direct_key").eq("tenant_id", input.tenantId).eq("channel_type", "direct").eq("direct_key", directKey).maybeSingle();
    if (existing.data) {
      // Starting a conversation you deleted or archived brings it back into your list.
      await writeConversationState(supabase, { tenantId: input.tenantId, channelId: existing.data.id, userId: input.userId, patch: { deleted_at: null, archived_at: null } }).catch(() => undefined);
      return existing.data as ChatChannel;
    }
  }
  const inserted = await supabase.from("partner_channels").insert({ tenant_id: input.tenantId, partner_id: null, channel_type: input.channelType, name: (input.name?.trim() || (input.channelType === "direct" ? "Direct message" : "Team channel")).slice(0, 160), created_by: input.userId, direct_key: directKey }).select("id, tenant_id, partner_id, channel_type, name, status, created_by, created_at, archived_at, direct_key").single();
  if (inserted.error?.code === "23505" && directKey) {
    const raced = await supabase.from("partner_channels").select("id, tenant_id, partner_id, channel_type, name, status, created_by, created_at, archived_at, direct_key").eq("tenant_id", input.tenantId).eq("channel_type", "direct").eq("direct_key", directKey).maybeSingle();
    if (raced.data) return raced.data as ChatChannel;
  }
  if (inserted.error || !inserted.data) throw new Error(inserted.error?.message ?? "Could not create chat channel");
  const memberRows = [input.userId, ...participants].map((userId) => ({ channel_id: inserted.data.id, tenant_id: input.tenantId, user_id: userId }));
  const members = await supabase.from("partner_channel_members").insert(memberRows);
  if (members.error) { await supabase.from("partner_channels").delete().eq("id", inserted.data.id); throw new Error(`Could not save channel participants: ${members.error.message}`); }
  // The maker owns it (20261028220000); until that migration membersOf still reads the maker as owner.
  await writeMembers(supabase, (db) => db.from("partner_channel_members").update({ role: "owner", added_by: input.userId }).eq("tenant_id", input.tenantId).eq("channel_id", inserted.data.id).eq("user_id", input.userId)).catch(() => undefined);
  return inserted.data as ChatChannel;
}

export async function getAgentChatDirectory(tenantId: string) {
  const supabase = getSupabaseServiceClient();
  // Independent reads: one round trip.
  const [tenantUsers, partnerUsers] = await Promise.all([
    supabase.from("tenant_users").select("user_id, role, users!inner(id, name, email, status)").eq("tenant_id", tenantId),
    // The embed names its foreign key. public.partner_users has TWO relationships to public.users --
    // user_id and the organizations-era invited_by -- so a bare users!inner is ambiguous and PostgREST
    // refuses it with PGRST201, which the route turned into a blanket 503. Naming the constraint is
    // the documented disambiguation and says which person is meant: the member, not the inviter.
    supabase.from("partner_users").select("user_id, role, partner_id, users!partner_users_user_id_fkey!inner(id, name, email, status), partners!inner(name)").eq("tenant_id", tenantId).eq("status", "active"),
  ]);
  if (tenantUsers.error || partnerUsers.error) throw new Error(`Could not load chat directory: ${tenantUsers.error?.message ?? partnerUsers.error?.message}`);
  return { tenantUsers: tenantUsers.data ?? [], partnerUsers: partnerUsers.data ?? [] };
}

/**
 * Archive or restore a direct or team channel. An archived channel stays readable and stops taking
 * messages (assertChannelAccess refuses a send).
 *
 * A partner channel is refused: it is where the automatic lead-update cards land, and posting into
 * an archived partner channel fails — archiving it would silently drop those records. Its lifecycle
 * follows the partner's.
 */
export async function setAgentChannelArchived(input: { tenantId: string; channelId: string; userId: string; archived: boolean }) {
  const supabase = getSupabaseServiceClient();
  const channel = await channelById(supabase, input.tenantId, input.channelId);
  if (channel.channel_type === "partner") throw new Error("A partner channel carries the automatic lead updates, so it follows the partner and cannot be archived here");
  const seat = await memberFor(supabase, channel, input.userId);
  if (!seat) throw new Error("You do not have access to this chat channel");
  if (channel.channel_type === "group" && !canManage(seat)) throw new Error("Only the group's owner and admins can close it");
  const { data, error } = await supabase
    .from("partner_channels")
    .update({ status: input.archived ? "archived" : "active", archived_at: input.archived ? new Date().toISOString() : null })
    .eq("tenant_id", input.tenantId)
    .eq("id", channel.id)
    .select("id, tenant_id, partner_id, channel_type, name, status, created_by, created_at, archived_at, direct_key")
    .single();
  if (error || !data) throw new Error(`Could not ${input.archived ? "archive" : "restore"} the channel`);
  return data as ChatChannel;
}

/**
 * Every channel an agency user can open: all of the agency's partner channels, and the direct and group
 * channels they hold a current seat in (a removed member keeps their row with removed_at, so membership
 * is read through membersOf). The caller reached here through requireFeatureRole, which resolved their
 * tenant_users membership — exactly what isChannelMember accepts for a partner channel.
 */
async function agentVisibleChannels(supabase: ReturnType<typeof getSupabaseServiceClient>, tenantId: string, userId: string) {
  // The channel list and this user's memberships are independent, so they go out together.
  const [channels, memberships] = await Promise.all([
    supabase.from("partner_channels").select("id, tenant_id, partner_id, channel_type, name, status, created_by, created_at, archived_at, direct_key").eq("tenant_id", tenantId).order("created_at", { ascending: false }),
    supabase.from("partner_channel_members").select("channel_id").eq("tenant_id", tenantId).eq("user_id", userId),
  ]);
  if (channels.error || memberships.error) throw new Error("Could not load partner channels");
  const rowIds = new Set((memberships.data ?? []).map((row) => row.channel_id));
  const candidates = (channels.data ?? []).filter((channel) => channel.channel_type !== "partner" && rowIds.has(channel.id)) as ChatChannel[];
  const seats = await membersOf(supabase, tenantId, candidates);
  const memberIds = new Set(candidates.filter((channel) => seats.get(channel.id)?.some((member) => member.userId === userId)).map((channel) => channel.id));
  const visible = (channels.data ?? []).filter((channel) => channel.channel_type === "partner" || memberIds.has(channel.id)) as ChatChannel[];
  return { visible, seats };
}

export async function getAgentChatChannels(tenantId: string, userId: string, scope: ProducerScope = null) {
  const supabase = getSupabaseServiceClient();
  // Each visible channel then reuses the row already loaded instead of re-reading it.
  const { visible, seats } = await agentVisibleChannels(supabase, tenantId, userId);
  // Access is already proven for every channel in `visible`, so the per-channel check (two serial
  // queries for a partner channel) is skipped: the caller reached here through requireFeatureRole,
  // which resolved their tenant_users membership for this tenant — exactly what isChannelMember
  // accepts for a partner channel — and an internal channel is in `visible` only because
  // `memberIds` holds this user's partner_channel_members row for it.
  const [latest, othersRead, states] = await Promise.all([
    latestMessagesByChannel(supabase, tenantId, userId, visible.map((channel) => channel.id)),
    othersReadAtByChannel(supabase, tenantId, userId, visible.map((channel) => channel.id)),
    conversationStates(supabase, tenantId, userId, visible.map((channel) => channel.id)),
  ]);
  // With every channel's messages in hand, the remaining lookups run once for the list; if that fails,
  // each channel falls back to its own reads, as before.
  const prepared = latest ? await prepareChats(supabase, tenantId, visible, latest).catch(() => null) : null;
  const results = await Promise.all(visible.map(async (channel) => {
    try {
      const chat = await chatForLoadedChannel(supabase, channel, userId, true, true, scope, latest?.get(channel.id), prepared?.get(channel.id));
      const state = states.get(channel.id) ?? { pinnedAt: null, archivedAt: null, deletedAt: null };
      const shown = afterDelete(chat.messages, state);
      // Deleted and nothing new since: gone from this person's list until someone writes again.
      if (state.deletedAt && shown.length === 0) return null;
      return { ...chat, messages: shown, unreadCount: Math.min(chat.unreadCount, shown.length), othersReadAt: othersRead.get(channel.id) ?? null, members: seats.get(channel.id) ?? [], state };
    } catch { return null; }
  }));
  return results.filter(Boolean);
}

/** A conversation this person deleted shows only what was written after. */
function afterDelete(messages: PartnerMessage[], state: ConversationState) {
  if (!state.deletedAt) return messages;
  const cut = new Date(state.deletedAt).getTime();
  return messages.filter((message) => new Date(message.createdAt).getTime() > cut);
}

const MESSAGE_COLUMNS = "id, channel_id, partner_id, work_item_id, message, message_kind, card_type, card_payload, created_by, created_at, event_key";
type SearchRow = MessageRow & { channel_id: string; message: string; created_by: string | null };

/** A search term as an ILIKE pattern: its own %, _ and \ match themselves. */
export function likePattern(query: string) {
  return `%${query.replace(/[\\%_]/g, (char) => `\\${char}`)}%`;
}

/**
 * Search the messages this person can read (owner, 2026-10-29): the text, and the names of attached
 * files. `channelId` keeps it to one conversation. The same rules as the thread: only channels they
 * can open, nothing before their own delete, no "nobody claimed" card in a partner channel, a partner
 * channel's lead notes only while shared, and with a `scope` no card about a transfer they may not see.
 * Newest first; `truncated` when there were more than `limit`.
 */
export async function searchAgentChat(input: { tenantId: string; userId: string; query: string; channelId?: string; scope?: ProducerScope; limit?: number }): Promise<{ hits: ChatSearchHit[]; truncated: boolean }> {
  const supabase = getSupabaseServiceClient();
  const limit = Math.min(Math.max(input.limit ?? 50, 1), 200);
  const { visible } = await agentVisibleChannels(supabase, input.tenantId, input.userId);
  const channels = input.channelId ? visible.filter((channel) => channel.id === input.channelId) : visible;
  if (input.channelId && !channels.length) throw new Error("You do not have access to this chat channel");
  if (!channels.length) return { hits: [], truncated: false };
  const byId = new Map(channels.map((channel) => [channel.id, channel]));
  const pattern = likePattern(input.query);
  // Each read asks for more than the limit: rows the rules below drop must not leave the page short.
  const fetchCount = limit * 2 + 1;
  // Channel ids ride in the request URL, so they go in slices, the slices in parallel.
  const ids = [...byId.keys()];
  const slices = Array.from({ length: Math.ceil(ids.length / PREPARE_CHUNK) }, (_, i) => ids.slice(i * PREPARE_CHUNK, (i + 1) * PREPARE_CHUNK));
  const [textParts, files, states] = await Promise.all([
    Promise.all(slices.map((slice) => supabase.from("partner_messages").select(MESSAGE_COLUMNS).eq("tenant_id", input.tenantId).in("channel_id", slice).ilike("message", pattern).order("created_at", { ascending: false }).limit(fetchCount))),
    supabase.from("partner_message_attachments").select(`file_name, partner_messages!inner(${MESSAGE_COLUMNS})`).eq("tenant_id", input.tenantId).ilike("file_name", pattern).limit(fetchCount),
    conversationStates(supabase, input.tenantId, input.userId, ids),
  ]);
  const failed = textParts.find((part) => part.error)?.error ?? files.error;
  if (failed) throw new Error(`Could not search the chat: ${failed.message}`);
  const rows = new Map<string, SearchRow & { fileName: string | null }>();
  for (const part of textParts) for (const row of (part.data ?? []) as SearchRow[]) rows.set(row.id, { ...row, fileName: null });
  for (const item of (files.data ?? []) as unknown as Array<{ file_name: string; partner_messages: SearchRow | SearchRow[] }>) {
    const message = Array.isArray(item.partner_messages) ? item.partner_messages[0] : item.partner_messages;
    if (!message || !byId.has(message.channel_id)) continue;
    // A message whose text matched keeps its text hit; the file name is the hit only when the text did not match.
    if (!rows.has(message.id)) rows.set(message.id, { ...message, fileName: item.file_name });
  }
  const kept = [...rows.values()].filter((row) => {
    const channel = byId.get(row.channel_id);
    if (!channel) return false;
    if (channel.channel_type === "partner" && row.card_type === "nobody_claimed") return false;
    const deletedAt = states.get(row.channel_id)?.deletedAt;
    return !deletedAt || new Date(row.created_at).getTime() > new Date(deletedAt).getTime();
  });
  const partnerRows = kept.filter((row) => byId.get(row.channel_id)?.channel_type === "partner");
  const [visibleNoteIds, visibleItems] = await Promise.all([
    visibleToPartner(supabase, input.tenantId, partnerRows),
    input.scope ? visibleWorkItemIds(input.tenantId, input.scope, kept.map((row) => row.work_item_id).filter((id): id is string => Boolean(id)), input.userId) : Promise.resolve(null),
  ]);
  const allowed = kept.filter((row) => (!row.event_key?.startsWith("lead-note:") || byId.get(row.channel_id)?.channel_type !== "partner" || visibleNoteIds.has(row.event_key.slice("lead-note:".length)))
    && (visibleItems === null || !row.work_item_id || visibleItems.has(row.work_item_id)));
  allowed.sort((a, b) => b.created_at.localeCompare(a.created_at));
  const hits = allowed.slice(0, limit).map((row) => ({ messageId: row.id, channelId: row.channel_id, createdAt: row.created_at, createdBy: row.created_by, message: row.message, messageKind: row.message_kind === "system_card" ? "system_card" as const : "text" as const, cardType: row.card_type, fileName: row.fileName }));
  return { hits, truncated: allowed.length > limit || textParts.some((part) => (part.data?.length ?? 0) >= fetchCount) || (files.data?.length ?? 0) >= fetchCount };
}

const HISTORY_PAGE = 300;

/**
 * Older messages of one conversation, for a search match beyond the newest 200 the list loads: the
 * page before `before`, oldest first, read under the same rules as the thread. `more` while older ones remain.
 */
export async function getAgentChannelHistory(input: { tenantId: string; userId: string; channelId: string; before: string; scope?: ProducerScope }): Promise<{ messages: PartnerMessage[]; more: boolean }> {
  const supabase = getSupabaseServiceClient();
  const { visible } = await agentVisibleChannels(supabase, input.tenantId, input.userId);
  const channel = visible.find((item) => item.id === input.channelId);
  if (!channel) throw new Error("You do not have access to this chat channel");
  const [page, states] = await Promise.all([
    supabase.from("partner_messages").select(MESSAGE_COLUMNS).eq("tenant_id", input.tenantId).eq("channel_id", channel.id).lt("created_at", input.before).order("created_at", { ascending: false }).limit(HISTORY_PAGE + 1),
    conversationStates(supabase, input.tenantId, input.userId, [channel.id]),
  ]);
  if (page.error) throw new Error(`Could not load earlier messages: ${page.error.message}`);
  const rows = (page.data ?? []) as Array<MessageRow & Record<string, unknown>>;
  const chat = await chatForLoadedChannel(supabase, channel, input.userId, true, true, input.scope ?? null, { messages: rows.slice(0, HISTORY_PAGE), readAt: null });
  const state = states.get(channel.id) ?? { pinnedAt: null, archivedAt: null, deletedAt: null };
  const messages = afterDelete(chat.messages, state);
  // Nothing before the person's own delete is theirs to page back to.
  const reachedDelete = Boolean(state.deletedAt) && messages.length < chat.messages.length;
  return { messages, more: rows.length > HISTORY_PAGE && !reachedDelete };
}

/**
 * Pin, archive or delete a conversation for the person asking; nobody else's list changes. Delete
 * hides the conversation and what was in it (history is kept, 20261028220000); a later message brings
 * it back with only what is new. Any conversation the person can open, partner channels included.
 */
export async function setConversationState(input: { tenantId: string; channelId: string; userId: string; pinned?: boolean; archived?: boolean; deleted?: boolean }) {
  const supabase = getSupabaseServiceClient();
  const channel = await channelById(supabase, input.tenantId, input.channelId);
  await assertChannelAccess(supabase, channel, input.userId, true);
  const now = new Date().toISOString();
  const patch: Partial<{ pinned_at: string | null; archived_at: string | null; deleted_at: string | null }> = {};
  if (input.pinned !== undefined) patch.pinned_at = input.pinned ? now : null;
  if (input.archived !== undefined) patch.archived_at = input.archived ? now : null;
  if (input.deleted) Object.assign(patch, { deleted_at: now, pinned_at: null, archived_at: null });
  await writeConversationState(supabase, { tenantId: input.tenantId, channelId: channel.id, userId: input.userId, patch });
  if (input.deleted) await markChannelRead(input.tenantId, channel.id, input.userId).catch(() => undefined);
  return channel;
}

/** The asking person's seat in a group, with the group; refuses anything that is not a group they are in. */
async function groupSeat(supabase: ReturnType<typeof getSupabaseServiceClient>, tenantId: string, channelId: string, userId: string) {
  const channel = await channelById(supabase, tenantId, channelId);
  if (channel.channel_type !== "group") throw new Error("Only a group has members to manage");
  if (channel.status !== "active") throw new Error("This group is closed. Reopen it first.");
  const members = (await membersOf(supabase, tenantId, [channel])).get(channel.id) ?? [];
  const actor = members.find((member) => member.userId === userId);
  if (!actor) throw new Error("You do not have access to this chat channel");
  return { channel, members, actor };
}

/** Add people to a group, as members or another role an admin may give. The one-partner rule still holds. */
export async function addChannelMembers(input: { tenantId: string; channelId: string; userId: string; userIds: string[]; role?: ChannelRole }) {
  const supabase = getSupabaseServiceClient();
  const { channel, members, actor } = await groupSeat(supabase, input.tenantId, input.channelId, input.userId);
  if (!canAddPeople(actor)) throw new Error("Only the group's owner and admins, or someone they allowed, can add people");
  const role: ChannelRole = input.role ?? "member";
  if (role === "owner" || (role === "admin" && actor.role !== "owner") || (role !== "member" && !canManage(actor))) throw new Error("You cannot give that role");
  const current = new Set(members.map((member) => member.userId));
  const adding = [...new Set(input.userIds)].filter((id) => !current.has(id));
  if (!adding.length) throw new Error("Everyone you chose is already in the group");
  if (members.length + adding.length > 50) throw new Error("A group holds up to 50 people");
  // allowedUserIds checks tenancy and the one-partner rule; the people already in the group count towards it.
  await allowedUserIds(supabase, input.tenantId, [...members.map((member) => member.userId), ...adding], input.userId);
  const now = new Date().toISOString();
  await writeMembers(supabase, (db) => db.from("partner_channel_members").upsert(adding.map((userId) => ({ channel_id: channel.id, tenant_id: input.tenantId, user_id: userId, role, can_add_members: false, added_by: input.userId, removed_at: null, created_at: now })), { onConflict: "channel_id,user_id" }));
  await postMembershipNote(supabase, channel, input.userId, `added ${await namesOf(supabase, adding)}`);
  return adding;
}

/** Remove someone from a group, or leave it. When the owner leaves, the longest-standing admin (else member) takes over. */
export async function removeChannelMember(input: { tenantId: string; channelId: string; userId: string; memberId: string }) {
  const supabase = getSupabaseServiceClient();
  const { channel, members, actor } = await groupSeat(supabase, input.tenantId, input.channelId, input.userId);
  const target = members.find((member) => member.userId === input.memberId);
  if (!target) throw new Error("That person is not in the group");
  const leaving = target.userId === actor.userId;
  if (leaving && target.role === "owner") {
    const heir = nextOwner(members, actor.userId);
    if (heir) await writeMembers(supabase, (db) => db.from("partner_channel_members").update({ role: "owner", can_add_members: false }).eq("tenant_id", input.tenantId).eq("channel_id", channel.id).eq("user_id", heir.userId));
    else await supabase.from("partner_channels").update({ status: "archived", archived_at: new Date().toISOString() }).eq("tenant_id", input.tenantId).eq("id", channel.id);
  } else if (!canRemove(actor, target)) {
    throw new Error(target.role === "owner" ? "The group's owner cannot be removed" : "Only the group's owner and admins can remove people");
  }
  // The note goes in first: the person leaving can still write it.
  await postMembershipNote(supabase, channel, input.userId, leaving ? "left the group" : `removed ${await namesOf(supabase, [target.userId])}`);
  await writeMembers(supabase, (db) => db.from("partner_channel_members").update({ removed_at: new Date().toISOString() }).eq("tenant_id", input.tenantId).eq("channel_id", channel.id).eq("user_id", target.userId));
}

/** Change a member's role, or whether a member may add people. */
export async function setChannelMember(input: { tenantId: string; channelId: string; userId: string; memberId: string; role: ChannelRole; canAddMembers: boolean }) {
  const supabase = getSupabaseServiceClient();
  const { channel, members, actor } = await groupSeat(supabase, input.tenantId, input.channelId, input.userId);
  const target = members.find((member) => member.userId === input.memberId);
  if (!target) throw new Error("That person is not in the group");
  if (target.role === "owner") throw new Error("The owner's role cannot be changed. To hand the group over, the owner leaves it and the longest-standing admin takes over.");
  if (target.userId === actor.userId) throw new Error("You cannot change your own role");
  if (!canChangeRole(actor, target, input.role)) throw new Error(input.role === "admin" || target.role === "admin" ?"Only the group's owner can make or unmake admins" : "Only the group's owner and admins can change roles");
  await writeMembers(supabase, (db) => db.from("partner_channel_members").update({ role: input.role, can_add_members: input.role === "member" && input.canAddMembers }).eq("tenant_id", input.tenantId).eq("channel_id", channel.id).eq("user_id", target.userId));
}

/** Rename a group: its owner and admins. */
export async function renameChannel(input: { tenantId: string; channelId: string; userId: string; name: string }) {
  const supabase = getSupabaseServiceClient();
  const { channel, actor } = await groupSeat(supabase, input.tenantId, input.channelId, input.userId);
  if (!canManage(actor)) throw new Error("Only the group's owner and admins can rename it");
  const name = input.name.trim().slice(0, 160);
  if (!name) throw new Error("Give the group a name");
  const { error } = await supabase.from("partner_channels").update({ name }).eq("tenant_id", input.tenantId).eq("id", channel.id);
  if (error) throw new Error(`Could not rename the group: ${error.message}`);
}

async function namesOf(supabase: ReturnType<typeof getSupabaseServiceClient>, userIds: string[]) {
  const { data } = await supabase.from("users").select("id, name").in("id", userIds);
  const names = userIds.map((id) => data?.find((user) => user.id === id)?.name ?? "someone");
  return names.length <= 2 ? names.join(" and ") : `${names.slice(0, -1).join(", ")} and ${names.at(-1)}`;
}

/** "Rinor added Ana and Ben": a line in the group, written as the person who did it and marked so the thread sets it apart. */
async function postMembershipNote(supabase: ReturnType<typeof getSupabaseServiceClient>, channel: ChatChannel, userId: string, what: string) {
  const { error } = await supabase.from("partner_messages").insert({ tenant_id: channel.tenant_id, partner_id: channel.partner_id, channel_id: channel.id, work_item_id: null, message: `${await namesOf(supabase, [userId])} ${what}`.slice(0, 2000), message_kind: "text", card_type: null, card_payload: { membership: true }, created_by: userId });
  if (error) console.error("[partner-chat] membership note failed", error);
}

/**
 * When anyone else in each channel last read it: a message of this user's sent before then shows "Read",
 * after it "Delivered" (owner, 2026-10-27). One read for every channel; a failure only hides the marks.
 */
async function othersReadAtByChannel(supabase: ReturnType<typeof getSupabaseServiceClient>, tenantId: string, userId: string, channelIds: string[]): Promise<Map<string, string>> {
  const latest = new Map<string, string>();
  if (!channelIds.length) return latest;
  const { data, error } = await supabase.from("partner_message_reads").select("channel_id, read_at").eq("tenant_id", tenantId).in("channel_id", channelIds).neq("user_id", userId);
  if (error) return latest;
  for (const row of (data ?? []) as { channel_id: string; read_at: string | null }[]) {
    if (row.read_at && (!latest.has(row.channel_id) || row.read_at > (latest.get(row.channel_id) as string))) latest.set(row.channel_id, row.read_at);
  }
  return latest;
}

let latestMessagesMissingAt = -Infinity;

/**
 * Every visible channel's newest 200 messages and this user's read mark in one call
 * (partner_chat_latest_messages, 20261020230000) instead of two reads per channel (66 on the demo tenant).
 * Null — each channel then reads its own, as before — while the function is not applied or the call fails.
 */
async function latestMessagesByChannel(supabase: ReturnType<typeof getSupabaseServiceClient>, tenantId: string, userId: string, channelIds: string[]): Promise<Map<string, PreloadedChat> | null> {
  if (!channelIds.length || Date.now() - latestMessagesMissingAt < 5 * 60_000) return null;
  type LooseRpc = { rpc(name: string, args: Record<string, unknown>): PromiseLike<{ data: unknown; error: { code?: string; message: string } | null }> };
  const { data, error } = await (supabase as unknown as LooseRpc).rpc("partner_chat_latest_messages", { p_tenant_id: tenantId, p_user_id: userId, p_channel_ids: channelIds, p_limit: 200 });
  if (error) {
    if (error.code === "PGRST202" || error.code === "42883" || /could not find the function/i.test(error.message)) latestMessagesMissingAt = Date.now();
    return null;
  }
  if (!data || typeof data !== "object" || Array.isArray(data)) return null;
  const byChannel = data as Record<string, { messages?: PreloadedChat["messages"]; read_at?: string | null }>;
  return new Map(channelIds.map((id) => [id, { messages: byChannel[id]?.messages ?? [], readAt: byChannel[id]?.read_at ?? null }]));
}

/** AG-0.5: with a `scope`, an attachment on a message about a transfer the session may not see is "not found". */
export async function getAttachmentForUser(tenantId: string, attachmentId: string, userId: string, partnerId?: string | null, scope: ProducerScope = null) {
  const supabase = getSupabaseServiceClient();
  const row = await supabase.from("partner_message_attachments").select("id, storage_path, partner_messages!inner(channel_id, partner_id, tenant_id, work_item_id)").eq("tenant_id", tenantId).eq("id", attachmentId).maybeSingle();
  if (row.error || !row.data) throw new Error("Attachment not found");
  const message = row.data.partner_messages as unknown as { channel_id: string; partner_id: string | null; tenant_id: string; work_item_id: string | null };
  if (scope !== null && message.work_item_id && !(await visibleWorkItemIds(tenantId, scope, [message.work_item_id], userId)).has(message.work_item_id)) throw new Error("Attachment not found");
  const channel = await channelById(supabase, tenantId, message.channel_id);
  if (partnerId && (channel.channel_type !== "partner" || message.partner_id !== partnerId)) throw new Error("Attachment not found");
  await assertChannelAccess(supabase, channel, userId, true);
  const url = await signedAttachmentUrl(supabase, row.data.storage_path);
  if (!url) throw new Error("Attachment is temporarily unavailable");
  return url;
}

export async function postAgentReadyCards(tenantId: string, userId: string, eventKey: string) {
  const supabase = getSupabaseServiceClient();
  const { data: channels, error } = await supabase.from("partner_channels").select("partner_id").eq("tenant_id", tenantId).eq("channel_type", "partner").eq("status", "active");
  if (error) throw new Error(error.message);
  await Promise.all((channels ?? []).filter((channel): channel is { partner_id: string } => typeof channel.partner_id === "string").map((channel) => postPartnerSystemCard({ tenantId, partnerId: channel.partner_id, userId, eventKey: `${eventKey}:${channel.partner_id}`, cardType: "agent_ready" }).catch((cardError) => console.error("Partner ready card failed", cardError))));
}
