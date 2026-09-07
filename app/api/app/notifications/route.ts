import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";

import { audit } from "@/lib/audit/log";
import { requireTenant } from "@/lib/tenantAuth/requireTenant";
import { AGENT_ALERT_EVENTS } from "@/lib/agentAlerts/presentation";
import { listAgentAlerts, saveAgentAlertSettings } from "@/lib/agentAlerts/service";

const events = z.object(Object.fromEntries(AGENT_ALERT_EVENTS.map((event) => [event, z.boolean()])) as Record<(typeof AGENT_ALERT_EVENTS)[number], z.ZodBoolean>).strict();
const settingsSchema = z.object({ enabled_events: events, do_not_disturb: z.boolean(), sound_muted: z.boolean(), sound_volume: z.number().int().min(0).max(100) }).strict();

export async function GET() {
  const auth = await requireTenant();
  if (auth instanceof NextResponse) return auth;
  try { return NextResponse.json(await listAgentAlerts(auth.context.tenantId, auth.context.userId), { headers: { "Cache-Control": "no-store" } }); }
  catch { return NextResponse.json({ error: "Could not load agent alerts" }, { status: 503 }); }
}

export async function PATCH(request: NextRequest) {
  const auth = await requireTenant();
  if (auth instanceof NextResponse) return auth;
  const parsed = settingsSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Use valid alert toggles, volume, and do-not-disturb settings." }, { status: 400 });
  try {
    const settings = await saveAgentAlertSettings(auth.context.tenantId, auth.context.userId, parsed.data);
    await audit({ actorType: "tenant", actorId: auth.context.userId, action: "tenant.agent_notification_settings_updated", targetType: "agent_notification_settings", targetId: `${auth.context.tenantId}:${auth.context.userId}`, metadata: { enabledEvents: settings.enabled_events, doNotDisturb: settings.do_not_disturb, soundMuted: settings.sound_muted, soundVolume: settings.sound_volume }, request });
    return NextResponse.json({ settings });
  } catch { return NextResponse.json({ error: "Could not save alert settings" }, { status: 503 }); }
}
