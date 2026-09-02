import { NextResponse } from "next/server";
import { z } from "zod";
import { requireFeatureRole } from "@/lib/tenantAuth/requireFeatureRole";
import { getQueueSlaSettings, updateQueueSlaSettings } from "@/lib/queueSla/service";

const schema = z.object({ warn: z.number().int().min(1).max(604798), escalate: z.number().int().min(2).max(604799), partner: z.number().int().min(3).max(604800), expire: z.number().int().min(4).max(604800) }).strict();

export async function GET() {
  const auth = await requireFeatureRole("book_of_business", ["owner"]);
  if (auth instanceof NextResponse) return auth;
  try { return NextResponse.json({ settings: await getQueueSlaSettings(auth.context.tenantId) }); }
  catch (error) { console.error("Queue SLA settings load failed", error); return NextResponse.json({ error: "Queue SLA settings are temporarily unavailable." }, { status: 503 }); }
}

export async function PATCH(request: Request) {
  const auth = await requireFeatureRole("book_of_business", ["owner"], { write: true });
  if (auth instanceof NextResponse) return auth;
  const parsed = schema.safeParse(await request.json().catch(() => null));
  if (!parsed.success || !(parsed.data.warn < parsed.data.escalate && parsed.data.escalate < parsed.data.partner && parsed.data.partner < parsed.data.expire)) return NextResponse.json({ error: "Use increasing times: warn, escalate, partner notice, then expiry." }, { status: 400 });
  try { return NextResponse.json({ settings: await updateQueueSlaSettings({ tenantId: auth.context.tenantId, actorId: auth.context.userId, ...parsed.data }) }); }
  catch (error) { const message = error instanceof Error ? error.message : "Could not save queue SLA settings."; return NextResponse.json({ error: message.includes("INVALID_SLA") ? "Use increasing times: warn, escalate, partner notice, then expiry." : "Could not save queue SLA settings." }, { status: message.includes("ROLE_NOT_ALLOWED") ? 403 : 400 }); }
}
