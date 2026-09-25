import { after, NextResponse, type NextRequest } from "next/server";
import { z } from "zod";

import { audit } from "@/lib/audit/log";
import { getTenantSession, requireTenant } from "@/lib/tenantAuth/requireTenant";
import { AGENT_ALERT_EVENTS } from "@/lib/agentAlerts/presentation";
import { AUDIBLE } from "@/lib/notify/treatments";
import { listAgentAlerts, markAgentAlertsRead, saveAgentAlertSettings, soundTreatmentsArePersisted } from "@/lib/agentAlerts/service";
import { touchMemberPresence } from "@/lib/tenantTeam/presence";

const events = z.object(Object.fromEntries(AGENT_ALERT_EVENTS.map((event) => [event, z.boolean()])) as Record<(typeof AGENT_ALERT_EVENTS)[number], z.ZodBoolean>).strict();
// Only the four audible treatments, each optional: a missing key means "no opinion, use the
// default", which is not the same as `false` and must survive the round trip as itself. `.strict()`
// so a request cannot smuggle in `done` or `fail` and imply a control that does not exist — the
// column has a check constraint saying the same thing, and this is the half that returns a 400
// instead of a 500.
const soundTreatments = z
  .object(Object.fromEntries(AUDIBLE.map((treatment) => [treatment, z.boolean().optional()])) as Record<string, z.ZodOptional<z.ZodBoolean>>)
  .strict();

const settingsSchema = z
  .object({
    enabled_events: events,
    do_not_disturb: z.boolean(),
    sound_muted: z.boolean(),
    sound_volume: z.number().int().min(0).max(100),
    // Optional so a client that predates this field still saves successfully rather than 400ing.
    sound_treatments: soundTreatments.optional(),
  })
  .strict();

export async function GET() {
  // Polled every 2.5s per tab. The alert read is keyed by the verified session JWT (the same
  // tenant/user requireTenant resolves), so it can start alongside the membership check instead of
  // after it. Settled so a failed read cannot pre-empt a 401/403; nothing is returned until auth
  // passes. Same pattern as requireFeature.
  const session = await getTenantSession();
  // No session: the same 401 requireTenant would give, with no speculative work at all.
  if (!session) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  const [auth, feedSettled] = await Promise.all([
    requireTenant(),
    listAgentAlerts(session.tenantId, session.sub).then(
      (value) => ({ ok: true as const, value }),
      (error: unknown) => ({ ok: false as const, error }),
    ),
  ]);
  if (auth instanceof NextResponse) return auth;
  // "Last seen" on Settings › Team & access. This poll is what every signed-in agent tab already
  // makes, so it is the presence signal; the write is throttled to one a minute and runs after the
  // response, so the feed never waits on it.
  after(() => touchMemberPresence(auth.context.tenantId, auth.context.userId).catch(() => undefined));
  try {
    if (!feedSettled.ok) throw feedSettled.error;
    const feed = feedSettled.value;
    // Read AFTER the query, which is what establishes whether the column is there. Sent so the
    // panel can say the choices will not stick, rather than letting the toggles snap back and look
    // broken — a control that silently forgets is worse than one that admits it cannot save yet.
    return NextResponse.json({ ...feed, soundTreatmentsPersisted: soundTreatmentsArePersisted() }, { headers: { "Cache-Control": "no-store" } });
  }
  catch { return NextResponse.json({ error: "Could not load agent alerts" }, { status: 503 }); }
}

export async function PATCH(request: NextRequest) {
  const auth = await requireTenant();
  if (auth instanceof NextResponse) return auth;
  const parsed = settingsSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Use valid alert toggles, volume, and do-not-disturb settings." }, { status: 400 });
  try {
    const settings = await saveAgentAlertSettings(auth.context.tenantId, auth.context.userId, { ...parsed.data, sound_treatments: parsed.data.sound_treatments ?? {} });
    await audit({ actorType: "tenant", actorId: auth.context.userId, action: "tenant.agent_notification_settings_updated", targetType: "agent_notification_settings", targetId: `${auth.context.tenantId}:${auth.context.userId}`, metadata: { enabledEvents: settings.enabled_events, doNotDisturb: settings.do_not_disturb, soundMuted: settings.sound_muted, soundVolume: settings.sound_volume, soundTreatments: settings.sound_treatments }, request });
    return NextResponse.json({ settings });
  } catch { return NextResponse.json({ error: "Could not save alert settings" }, { status: 503 }); }
}

const readSchema = z.object({ ids: z.array(z.string().uuid()).max(100).optional() }).strict();

/** Mark this person's alerts read. Theirs only — the recipient is taken from the session. */
export async function POST(request: NextRequest) {
  const auth = await requireTenant();
  if (auth instanceof NextResponse) return auth;
  const parsed = readSchema.safeParse(await request.json().catch(() => ({})));
  if (!parsed.success) return NextResponse.json({ error: "Send the alert ids to mark read, or nothing to mark them all." }, { status: 400 });
  try {
    const result = await markAgentAlertsRead(auth.context.tenantId, auth.context.userId, parsed.data.ids);
    return NextResponse.json(result, { headers: { "Cache-Control": "no-store" } });
  } catch { return NextResponse.json({ error: "Could not mark alerts read" }, { status: 503 }); }
}
