import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";

import { audit } from "@/lib/audit/log";
import { getPartnerChat, markPartnerChatRead, postPartnerText } from "@/lib/partnerChat/service";
import { requirePartner } from "@/lib/partnerAuth/requirePartner";

const messageSchema = z.object({ message: z.string().trim().min(1, "Write a message").max(2000, "Messages are limited to 2,000 characters"), mentions: z.array(z.string().uuid()).max(20).optional() }).strict();

export async function GET(request: NextRequest) {
  const auth = await requirePartner();
  if (auth instanceof NextResponse) return auth;
  const requestedPartner = request.nextUrl.searchParams.get("partner_id");
  if (requestedPartner && requestedPartner !== auth.context.partnerId) return NextResponse.json({ error: "You cannot access another partner channel" }, { status: 403 });
  try { return NextResponse.json(await getPartnerChat(auth.context.tenantId, auth.context.partnerId, auth.context.userId), { headers: { "Cache-Control": "no-store" } }); }
  catch { return NextResponse.json({ error: "Could not load partner chat" }, { status: 503 }); }
}

export async function POST(request: NextRequest) {
  const auth = await requirePartner();
  if (auth instanceof NextResponse) return auth;
  const parsed = messageSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Write a valid message" }, { status: 400 });
  try {
    const message = await postPartnerText({ tenantId: auth.context.tenantId, partnerId: auth.context.partnerId, userId: auth.context.userId, notifyAgents: true, ...parsed.data });
    await audit({ actorType: "tenant", actorId: auth.context.userId, action: "tenant.partner_chat_message_sent", targetType: "partner_channel", targetId: auth.context.partnerId, metadata: { mentions: parsed.data.mentions?.length ?? 0, actorPlane: "partner" }, request });
    return NextResponse.json({ message }, { status: 201 });
  } catch (error) { return NextResponse.json({ error: error instanceof Error ? error.message : "Could not send message" }, { status: 400 }); }
}

export async function PATCH(request: NextRequest) {
  const auth = await requirePartner();
  if (auth instanceof NextResponse) return auth;
  try {
    await markPartnerChatRead(auth.context.tenantId, auth.context.partnerId, auth.context.userId);
    await audit({ actorType: "tenant", actorId: auth.context.userId, action: "tenant.partner_chat_read", targetType: "partner_channel", targetId: auth.context.partnerId, metadata: { actorPlane: "partner" }, request });
    return NextResponse.json({ ok: true });
  } catch { return NextResponse.json({ error: "Could not update read state" }, { status: 400 }); }
}
