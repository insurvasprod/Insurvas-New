import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";

import { audit } from "@/lib/audit/log";
import { ALLOWED_ATTACHMENT_TYPES, MAX_ATTACHMENT_BYTES, createPartnerChannel, getPartnerChat, getPartnerChatChannels, getPartnerChatDirectory, markChannelRead, markPartnerChatRead, postChannelText, postPartnerText, type ChatAttachmentInput } from "@/lib/partnerChat/service";
import { requirePartner } from "@/lib/partnerAuth/requirePartner";
import { getSupabaseServiceClient } from "@/lib/supabase/service";
import { PARTNER_CHAT_MESSAGE_MAX } from "@/lib/partnerChat/composer";
import type { SupportContact } from "@/lib/partnerSupport/contact";
import { getSupportContact } from "@/lib/partnerSupport/service";

const messageSchema = z.object({ channel_id: z.string().uuid().optional(), partner_id: z.string().uuid().optional(), message: z.string().trim().min(1, "Write a message").max(PARTNER_CHAT_MESSAGE_MAX, "Messages are limited to 2,000 characters"), mentions: z.array(z.string().uuid()).max(20).optional() }).strict();
const createSchema = z.object({ action: z.literal("create_channel"), channel_type: z.enum(["direct", "group"]), name: z.string().trim().max(160).optional(), user_ids: z.array(z.string().uuid()).min(1).max(50) }).strict();

/**
 * A partner session may only use its own partner channel. The service's membership check also lets
 * in anyone with a tenant_users row (agents share every partner channel), so a partner user who also
 * holds a tenant role could otherwise post to, or mark read, another partner's channel by id.
 * Direct and group channels keep their explicit member check.
 */
async function isOtherPartnersChannel(tenantId: string, partnerId: string, channelId: string) {
  const { data } = await getSupabaseServiceClient().from("partner_channels").select("channel_type, partner_id").eq("tenant_id", tenantId).eq("id", channelId).maybeSingle();
  return Boolean(data && data.channel_type === "partner" && data.partner_id !== partnerId);
}

async function readInput(request: NextRequest) {
  if (request.headers.get("content-type")?.startsWith("multipart/form-data")) {
    const form = await request.formData();
    const mentionsRaw = form.get("mentions");
    let mentions: unknown = undefined;
    if (typeof mentionsRaw === "string" && mentionsRaw) { try { mentions = JSON.parse(mentionsRaw); } catch { throw new Error("Mentions must be valid JSON"); } }
    const attachments: ChatAttachmentInput[] = [];
    for (const value of form.getAll("files")) {
      if (!(value instanceof File)) continue;
      if (attachments.length >= 3) throw new Error("You can attach up to three files");
      if (value.size < 1 || value.size > MAX_ATTACHMENT_BYTES) throw new Error("Each attachment must be smaller than 10 MB");
      if (!(ALLOWED_ATTACHMENT_TYPES as readonly string[]).includes(value.type)) throw new Error("That file type is not supported");
      attachments.push({ name: value.name, contentType: value.type, size: value.size, data: Buffer.from(await value.arrayBuffer()) });
    }
    return { ...(Object.fromEntries(form.entries())), mentions, attachments };
  }
  const body = await request.json().catch(() => null);
  return { ...(body && typeof body === "object" ? body as Record<string, unknown> : {}), attachments: [] as ChatAttachmentInput[] };
}

export async function GET(request: NextRequest) {
  const auth = await requirePartner();
  if (auth instanceof NextResponse) return auth;
  const requestedPartner = request.nextUrl.searchParams.get("partner_id");
  if (requestedPartner && requestedPartner !== auth.context.partnerId) return NextResponse.json({ error: "You cannot access another partner channel" }, { status: 403 });
  try {
    const [channels, directory, agency, support] = await Promise.all([
      getPartnerChatChannels(auth.context.tenantId, auth.context.partnerId, auth.context.userId),
      getPartnerChatDirectory(auth.context.tenantId, auth.context.partnerId),
      // The agency this partner works with, named in the conversation details ("Agent").
      getSupabaseServiceClient().from("tenants").select("name").eq("id", auth.context.tenantId).maybeSingle(),
      // Its "Support" and "Phone" rows — the partner's own agency only (tenant from the session).
      // A failed read hides the rows rather than taking the conversations down with it.
      getSupportContact(auth.context.tenantId).catch((error: unknown) => {
        console.error("[partner-chat] support contact unavailable", error instanceof Error ? error.message : error);
        return { email: null, phone: null, schemaReady: false } satisfies SupportContact;
      }),
    ]);
    const primary = channels.find((item) => item.channel.channel_type === "partner") ?? await getPartnerChat(auth.context.tenantId, auth.context.partnerId, auth.context.userId);
    return NextResponse.json({ ...primary, channels, directory, agencyName: agency.data?.name ?? null, agencySupport: support }, { headers: { "Cache-Control": "no-store" } });
  } catch { return NextResponse.json({ error: "Could not load partner chat" }, { status: 503 }); }
}

export async function POST(request: NextRequest) {
  const auth = await requirePartner();
  if (auth instanceof NextResponse) return auth;
  let input: Record<string, unknown> & { attachments: ChatAttachmentInput[] };
  try { input = await readInput(request) as Record<string, unknown> & { attachments: ChatAttachmentInput[] }; } catch (error) { return NextResponse.json({ error: error instanceof Error ? error.message : "Write a valid chat request" }, { status: 400 }); }
  if (input.action === "create_channel") {
    const parsedCreate = createSchema.safeParse({ action: input.action, channel_type: input.channel_type, name: input.name, user_ids: input.user_ids });
    if (!parsedCreate.success) return NextResponse.json({ error: parsedCreate.error.issues[0]?.message ?? "Write a valid channel" }, { status: 400 });
    try {
      const channel = await createPartnerChannel({ tenantId: auth.context.tenantId, partnerId: auth.context.partnerId, userId: auth.context.userId, channelType: parsedCreate.data.channel_type, name: parsedCreate.data.name, userIds: parsedCreate.data.user_ids });
      await audit({ actorType: "tenant", actorId: auth.context.userId, action: "tenant.partner_chat_channel_created", targetType: "partner_channel", targetId: channel.id, metadata: { channelType: channel.channel_type, actorPlane: "partner" }, request });
      return NextResponse.json({ channel }, { status: 201 });
    } catch (error) { return NextResponse.json({ error: error instanceof Error ? error.message : "Could not create chat channel" }, { status: 400 }); }
  }
  const rawMessage = typeof input.message === "string" ? input.message.trim() : "";
  const attachmentMessage = input.attachments.length === 1 ? "Shared an attachment" : input.attachments.length > 1 ? `Shared ${input.attachments.length} attachments` : "";
  const parsed = messageSchema.safeParse({ channel_id: input.channel_id, partner_id: input.partner_id, message: rawMessage || attachmentMessage, mentions: input.mentions });
  if (!parsed.success) return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Write a valid chat message" }, { status: 400 });
  if (parsed.data.channel_id && await isOtherPartnersChannel(auth.context.tenantId, auth.context.partnerId, parsed.data.channel_id)) return NextResponse.json({ error: "You cannot access another partner channel" }, { status: 403 });
  try {
    const message = parsed.data.channel_id
      ? await postChannelText({ tenantId: auth.context.tenantId, channelId: parsed.data.channel_id, userId: auth.context.userId, message: parsed.data.message, mentions: parsed.data.mentions, attachments: input.attachments })
      : await postPartnerText({ tenantId: auth.context.tenantId, partnerId: auth.context.partnerId, userId: auth.context.userId, message: parsed.data.message, mentions: parsed.data.mentions, attachments: input.attachments, notifyAgents: true });
    await audit({ actorType: "tenant", actorId: auth.context.userId, action: "tenant.partner_chat_message_sent", targetType: "partner_channel", targetId: parsed.data.channel_id ?? auth.context.partnerId, metadata: { mentions: parsed.data.mentions?.length ?? 0, attachmentCount: input.attachments.length, actorPlane: "partner" }, request });
    return NextResponse.json({ message }, { status: 201 });
  } catch (error) { return NextResponse.json({ error: error instanceof Error ? error.message : "Could not send message" }, { status: 400 }); }
}

export async function PATCH(request: NextRequest) {
  const auth = await requirePartner();
  if (auth instanceof NextResponse) return auth;
  const body = await request.json().catch(() => null) as { channel_id?: unknown } | null;
  const channelId = typeof body?.channel_id === "string" && z.string().uuid().safeParse(body.channel_id).success ? body.channel_id : null;
  if (channelId && await isOtherPartnersChannel(auth.context.tenantId, auth.context.partnerId, channelId)) return NextResponse.json({ error: "You cannot access another partner channel" }, { status: 403 });
  try {
    if (channelId) await markChannelRead(auth.context.tenantId, channelId, auth.context.userId);
    else await markPartnerChatRead(auth.context.tenantId, auth.context.partnerId, auth.context.userId);
    // Same shape as the send path: the channel when one was named, else the partner's own channel.
    await audit({ actorType: "tenant", actorId: auth.context.userId, action: "tenant.partner_chat_read", targetType: "partner_channel", targetId: channelId ?? auth.context.partnerId, metadata: { actorPlane: "partner" }, request });
    return NextResponse.json({ ok: true });
  } catch { return NextResponse.json({ error: "Could not update read state" }, { status: 400 }); }
}
