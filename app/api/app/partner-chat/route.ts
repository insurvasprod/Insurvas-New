import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";

import { audit } from "@/lib/audit/log";
import { getSupabaseServiceClient } from "@/lib/supabase/service";
import { getPartnerChat, markPartnerChatRead, postPartnerText } from "@/lib/partnerChat/service";
import { requireFeatureRole } from "@/lib/tenantAuth/requireFeatureRole";

const roles = ["owner", "producer"] as const;
const schema = z.object({ partner_id: z.string().uuid(), message: z.string().trim().min(1).max(2000), mentions: z.array(z.string().uuid()).max(20).optional() }).strict();

export async function GET() {
  const auth = await requireFeatureRole("inbound_transfers", roles);
  if (auth instanceof NextResponse) return auth;
  const db = getSupabaseServiceClient();
  const channels = await db.from("partner_channels").select("partner_id, name, status").eq("tenant_id", auth.context.tenantId).order("created_at");
  if (channels.error) return NextResponse.json({ error: "Could not load partner channels" }, { status: 503 });
  const results = await Promise.all((channels.data ?? []).map(async (channel) => ({ ...await getPartnerChat(auth.context.tenantId, channel.partner_id, auth.context.userId), partnerId: channel.partner_id })));
  return NextResponse.json({ channels: results });
}

export async function POST(request: NextRequest) {
  const auth = await requireFeatureRole("inbound_transfers", roles, { write: true });
  if (auth instanceof NextResponse) return auth;
  const parsed = schema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Write a valid chat message" }, { status: 400 });
  try {
    const message = await postPartnerText({ tenantId: auth.context.tenantId, partnerId: parsed.data.partner_id, userId: auth.context.userId, message: parsed.data.message, mentions: parsed.data.mentions });
    await audit({ actorType: "tenant", actorId: auth.context.userId, action: "tenant.agent_partner_chat_message_sent", targetType: "partner_channel", targetId: parsed.data.partner_id, metadata: { actorPlane: "agent" }, request });
    return NextResponse.json({ message }, { status: 201 });
  } catch (error) { return NextResponse.json({ error: error instanceof Error ? error.message : "Could not send message" }, { status: 400 }); }
}

export async function PATCH(request: NextRequest) {
  const auth = await requireFeatureRole("inbound_transfers", roles, { write: true });
  if (auth instanceof NextResponse) return auth;
  const body = await request.json().catch(() => null) as { partner_id?: unknown } | null;
  if (typeof body?.partner_id !== "string" || !z.string().uuid().safeParse(body.partner_id).success) return NextResponse.json({ error: "Choose a valid partner" }, { status: 400 });
  try { await markPartnerChatRead(auth.context.tenantId, body.partner_id, auth.context.userId); return NextResponse.json({ ok: true }); }
  catch { return NextResponse.json({ error: "Could not update read state" }, { status: 400 }); }
}
