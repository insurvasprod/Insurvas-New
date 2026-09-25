import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";

import { getWorkspaceTimezone } from "@/lib/agencyProfile/timezone";
import { audit } from "@/lib/audit/log";
import { getPartnerChannelFacts } from "@/lib/partnerChat/partnerFacts";
import { ALLOWED_ATTACHMENT_TYPES, MAX_ATTACHMENT_BYTES, createAgentChannel, getAgentChatChannels, getAgentChatDirectory, markChannelRead, markPartnerChatRead, postChannelText, postPartnerText, setAgentChannelArchived, type ChatAttachmentInput } from "@/lib/partnerChat/service";
import { requireFeatureRole } from "@/lib/tenantAuth/requireFeatureRole";

const roles = ["owner", "producer"] as const;
const messageSchema = z.object({ channel_id: z.string().uuid().optional(), partner_id: z.string().uuid().optional(), message: z.string().trim().min(1).max(2000), mentions: z.array(z.string().uuid()).max(20).optional() }).strict().refine((value) => Boolean(value.channel_id || value.partner_id), { message: "Choose a chat channel" });
const createSchema = z.object({ action: z.literal("create_channel"), channel_type: z.enum(["direct", "group"]), name: z.string().trim().max(160).optional(), user_ids: z.array(z.string().uuid()).min(1).max(50) }).strict();

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

export async function GET() {
  const auth = await requireFeatureRole("inbound_transfers", roles);
  if (auth instanceof NextResponse) return auth;
  try {
    // The per-partner facts line is extra: if it cannot be read, the chat still loads without it.
    const facts = getWorkspaceTimezone(auth.context.tenantId).catch(() => null).then((zone) => getPartnerChannelFacts(auth.context.tenantId, zone)).catch((error) => { console.error("[partner-chat] partner facts failed", error); return []; });
    const [channels, directory, partnerFacts] = await Promise.all([getAgentChatChannels(auth.context.tenantId, auth.context.userId), getAgentChatDirectory(auth.context.tenantId), facts]);
    return NextResponse.json({ channels, directory, partnerFacts }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    console.error("[partner-chat] channel or directory load failed", error);
    return NextResponse.json({ error: "Could not load partner channels" }, { status: 503 });
  }
}

export async function POST(request: NextRequest) {
  const auth = await requireFeatureRole("inbound_transfers", roles, { write: true });
  if (auth instanceof NextResponse) return auth;
  let input: Record<string, unknown> & { attachments: ChatAttachmentInput[] };
  try { input = await readInput(request) as Record<string, unknown> & { attachments: ChatAttachmentInput[] }; } catch (error) { return NextResponse.json({ error: error instanceof Error ? error.message : "Write a valid chat request" }, { status: 400 }); }
  if (input.action === "create_channel") {
    const parsedCreate = createSchema.safeParse({ action: input.action, channel_type: input.channel_type, name: input.name, user_ids: input.user_ids });
    if (!parsedCreate.success) return NextResponse.json({ error: parsedCreate.error.issues[0]?.message ?? "Write a valid channel" }, { status: 400 });
    try {
      const channel = await createAgentChannel({ tenantId: auth.context.tenantId, userId: auth.context.userId, channelType: parsedCreate.data.channel_type, name: parsedCreate.data.name, userIds: parsedCreate.data.user_ids });
      await audit({ actorType: "tenant", actorId: auth.context.userId, action: "tenant.partner_chat_channel_created", targetType: "partner_channel", targetId: channel.id, metadata: { channelType: channel.channel_type }, request });
      return NextResponse.json({ channel }, { status: 201 });
    } catch (error) { return NextResponse.json({ error: error instanceof Error ? error.message : "Could not create chat channel" }, { status: 400 }); }
  }
  if (input.action === "archive_channel" || input.action === "restore_channel") {
    const channelId = z.string().uuid().safeParse(input.channel_id);
    if (!channelId.success) return NextResponse.json({ error: "Choose a valid chat channel" }, { status: 400 });
    const archived = input.action === "archive_channel";
    try {
      const channel = await setAgentChannelArchived({ tenantId: auth.context.tenantId, channelId: channelId.data, userId: auth.context.userId, archived });
      await audit({ actorType: "tenant", actorId: auth.context.userId, action: archived ? "tenant.partner_chat_channel_archived" : "tenant.partner_chat_channel_restored", targetType: "partner_channel", targetId: channel.id, metadata: { channelType: channel.channel_type }, request });
      return NextResponse.json({ channel });
    } catch (error) { return NextResponse.json({ error: error instanceof Error ? error.message : "Could not change the channel" }, { status: 400 }); }
  }
  const rawMessage = typeof input.message === "string" ? input.message.trim() : "";
  const attachmentMessage = input.attachments.length === 1 ? "Shared an attachment" : input.attachments.length > 1 ? `Shared ${input.attachments.length} attachments` : "";
  const parsed = messageSchema.safeParse({ channel_id: input.channel_id, partner_id: input.partner_id, message: rawMessage || attachmentMessage, mentions: input.mentions });
  if (!parsed.success) return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Write a valid chat message" }, { status: 400 });
  try {
    const message = parsed.data.channel_id
      ? await postChannelText({ tenantId: auth.context.tenantId, channelId: parsed.data.channel_id, userId: auth.context.userId, message: parsed.data.message, mentions: parsed.data.mentions, attachments: input.attachments })
      : await postPartnerText({ tenantId: auth.context.tenantId, partnerId: parsed.data.partner_id!, userId: auth.context.userId, message: parsed.data.message, mentions: parsed.data.mentions, attachments: input.attachments });
    await audit({ actorType: "tenant", actorId: auth.context.userId, action: "tenant.agent_partner_chat_message_sent", targetType: "partner_channel", targetId: parsed.data.channel_id ?? parsed.data.partner_id!, metadata: { actorPlane: "agent", attachmentCount: input.attachments.length }, request });
    return NextResponse.json({ message }, { status: 201 });
  } catch (error) { return NextResponse.json({ error: error instanceof Error ? error.message : "Could not send message" }, { status: 400 }); }
}

export async function PATCH(request: NextRequest) {
  const auth = await requireFeatureRole("inbound_transfers", roles, { write: true });
  if (auth instanceof NextResponse) return auth;
  const body = await request.json().catch(() => null) as { channel_id?: unknown; partner_id?: unknown } | null;
  try {
    if (typeof body?.channel_id === "string" && z.string().uuid().safeParse(body.channel_id).success) await markChannelRead(auth.context.tenantId, body.channel_id, auth.context.userId);
    else if (typeof body?.partner_id === "string" && z.string().uuid().safeParse(body.partner_id).success) await markPartnerChatRead(auth.context.tenantId, body.partner_id, auth.context.userId);
    else return NextResponse.json({ error: "Choose a valid chat channel" }, { status: 400 });
    return NextResponse.json({ ok: true });
  } catch { return NextResponse.json({ error: "Could not update read state" }, { status: 400 }); }
}
