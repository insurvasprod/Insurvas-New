import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";

import { audit } from "@/lib/audit/log";
import { PARTNER_ALERT_EVENTS } from "@/lib/partnerAlerts/presentation";
import { listPartnerAlerts, listPartnerWorkspaceAlerts, markPartnerAlertsRead, savePartnerAlertSettings } from "@/lib/partnerAlerts/service";
import { requirePartner } from "@/lib/partnerAuth/requirePartner";

const events = z.object(Object.fromEntries(PARTNER_ALERT_EVENTS.map((event) => [event, z.boolean()])) as Record<(typeof PARTNER_ALERT_EVENTS)[number], z.ZodBoolean>).strict();
const settingsSchema = z.object({ enabled_events: events, do_not_disturb: z.boolean(), sound_muted: z.boolean(), sound_volume: z.number().int().min(0).max(100), sound_opted_in_at: z.string().datetime().nullable() }).strict();

export async function GET() {
  const auth = await requirePartner();
  if (auth instanceof NextResponse) return auth;
  try {
    const { context } = auth;
    const [feed, workspaceAlerts] = await Promise.all([
      listPartnerAlerts(context.tenantId, context.partnerId, context.userId),
      // States wrong with the organisation, read fresh; a failure here must not hide the notifications.
      // This route is NOT gated on pause — a paused partner still reads its notifications, and the
      // "Submissions paused" alert is how it learns why; the service only describes the status.
      listPartnerWorkspaceAlerts(context).catch(() => []),
    ]);
    return NextResponse.json({ ...feed, workspaceAlerts }, { headers: { "Cache-Control": "no-store" } });
  } catch {
    return NextResponse.json({ error: "Could not load partner alerts" }, { status: 503 });
  }
}

const readSchema = z.object({ ids: z.array(z.string().uuid()).min(1).max(100) }).strict();

/** Mark this person's partner notifications read — by id only, and theirs only (taken from the session). */
export async function POST(request: NextRequest) {
  const auth = await requirePartner();
  if (auth instanceof NextResponse) return auth;
  const parsed = readSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Send the notification ids to mark read." }, { status: 400 });
  try {
    return NextResponse.json(await markPartnerAlertsRead(auth.context.tenantId, auth.context.partnerId, auth.context.userId, parsed.data.ids), { headers: { "Cache-Control": "no-store" } });
  } catch {
    return NextResponse.json({ error: "Could not mark notifications read" }, { status: 503 });
  }
}

export async function PATCH(request: NextRequest) {
  const auth = await requirePartner();
  if (auth instanceof NextResponse) return auth;
  const parsed = settingsSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Use valid partner alert preferences." }, { status: 400 });
  try {
    const settings = await savePartnerAlertSettings(auth.context.tenantId, auth.context.partnerId, auth.context.userId, parsed.data);
    await audit({ actorType: "tenant", actorId: auth.context.userId, action: "tenant.partner_notification_settings_updated", targetType: "partner_notification_settings", targetId: `${auth.context.partnerId}:${auth.context.userId}`, metadata: { actorPlane: "partner" }, request });
    return NextResponse.json({ settings });
  } catch {
    return NextResponse.json({ error: "Could not save partner alert preferences" }, { status: 503 });
  }
}
