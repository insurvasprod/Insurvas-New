import { after, NextResponse, type NextRequest } from "next/server";
import { z } from "zod";

import { audit } from "@/lib/audit/log";
import { getTenantSession, requireTenant } from "@/lib/tenantAuth/requireTenant";
import { AGENT_ALERT_EVENTS, eventTypeForKind, leadIdFromAlertLink } from "@/lib/agentAlerts/presentation";
import { AUDIBLE } from "@/lib/notify/treatments";
import { listAgentAlerts, markAgentAlertsRead, saveAgentAlertSettings, soundTreatmentsArePersisted } from "@/lib/agentAlerts/service";
import { touchMemberPresence } from "@/lib/tenantTeam/presence";
import { scopeFor } from "@/lib/agency/visibility";
import { rowVisible, type ProducerScope } from "@/lib/agency/visibilityCore";
import { deliveryByKind } from "@/lib/notifications/preferences";
import { getSupabaseServiceClient } from "@/lib/supabase/service";

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

const ALERT_SCOPE_MAX_AGE_MS = 30_000;

/**
 * ?recent=1 (the phone's Inbox, board H1: read alerts stay listed, only unread ones get the dot): the feed as
 * below, plus this person's alerts already read in the last week. The same rules as the feed: their own rows
 * only, kinds the bell knows, the ones Settings › Notifications lets into the app, and (AG-0.5) nothing about
 * a lead now with a producer outside the session's scope; a queue that cannot be read hides every lead row.
 */
const READ_WINDOW_MS = 7 * 24 * 60 * 60_000;
type ReadRow = { id: string; kind: string; title: string; body: string | null; link: string; created_at: string; read_at: string };

async function readAlerts(tenantId: string, userId: string, scope: ProducerScope) {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const db = getSupabaseServiceClient() as any;
  const since = new Date(Date.now() - READ_WINDOW_MS).toISOString();
  const [delivery, result] = await Promise.all([
    deliveryByKind(userId, tenantId),
    db.from("agent_notifications").select("id, kind, title, body, link, created_at, read_at").eq("tenant_id", tenantId).eq("recipient_user_id", userId).not("read_at", "is", null).gte("created_at", since).order("created_at", { ascending: false }).limit(100),
  ]);
  if (result.error) throw new Error(`Could not load read alerts: ${result.error.message}`);
  const rows = ((result.data ?? []) as ReadRow[]).flatMap((row) => {
    const eventType = eventTypeForKind(row.kind);
    return eventType && (delivery.get(row.kind)?.in_app ?? true) ? [{ ...row, event_type: eventType }] : [];
  });
  if (scope === null) return rows;
  const leadIds = [...new Set(rows.map((row) => leadIdFromAlertLink(row.link)).filter((id): id is string => Boolean(id)))];
  if (!leadIds.length) return rows;
  const queue = await db.from("lead_queue").select("lead_id, owner_user_id, queued_at").eq("tenant_id", tenantId).in("lead_id", leadIds).order("queued_at", { ascending: false });
  if (queue.error) return rows.filter((row) => !leadIdFromAlertLink(row.link));
  const owner = new Map<string, string | null>();
  for (const q of (queue.data ?? []) as { lead_id: string; owner_user_id: string | null }[]) if (!owner.has(q.lead_id)) owner.set(q.lead_id, q.owner_user_id);
  return rows.filter((row) => {
    const lead = leadIdFromAlertLink(row.link);
    const who = lead ? owner.get(lead) ?? null : null;
    return !who || who === userId || rowVisible(scope, who);
  });
}

export async function GET(request?: NextRequest) {
  // Polled every 2.5s per tab. The alert read is keyed by the verified session JWT (the same
  // tenant/user requireTenant resolves), so it can start alongside the membership check instead of
  // after it. Settled so a failed read cannot pre-empt a 401/403; nothing is returned until auth
  // passes. Same pattern as requireFeature.
  const session = await getTenantSession();
  const recent = request?.nextUrl?.searchParams.get("recent") === "1";
  // No session: the same 401 requireTenant would give, with no speculative work at all.
  if (!session) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  const [auth, feedSettled] = await Promise.all([
    requireTenant(),
    // AG-0.5: the scope is the verified session's (the same tenant and user requireTenant resolves), so
    // in an agency an alert about another producer's lead is left out. Null scope: the feed as before. The
    // scope is re-read at most every 30s per person, not on every 2.5s poll (see scopeFor).
    scopeFor({ tenantId: session.tenantId, userId: session.sub }, { maxAgeMs: ALERT_SCOPE_MAX_AGE_MS }).then(async (scope) => {
      const feed = await listAgentAlerts(session.tenantId, session.sub, scope);
      return recent ? { ...feed, read: await readAlerts(session.tenantId, session.sub, scope) } : feed;
    }).then(
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
