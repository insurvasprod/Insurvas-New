import "server-only";

import { getWorkspaceTimezone } from "@/lib/agencyProfile/timezone";
import { startOfDayIn } from "@/lib/leadPost/board";
import { getSupabaseServiceClient } from "@/lib/supabase/service";

/**
 * GET /api/app/inbound/handoff?mine=1 (route.ts, assistants only) · board B5 (mobile Home · assistant): the handoffs this buffer assistant offered, and today's figures.
 * Read-only. It reads the rows `offer_buffer_handoff` and `accept_buffer_handoff` already write
 * (buffer_handoffs, tenant_verification_sessions, verification_fields), always for the signed-in
 * assistant in their own tenant, never another person's. Days follow the workspace's time zone.
 *
 *   handoffs  today's handoffs, newest first (at most 20): customer → licensed agent, offered/accepted
 *             times, fields checked of the visible ones, the lead's disposition once there is one.
 *   today     calls verified (verification sessions this assistant opened today), handed off today and
 *             yesterday, the average seconds from opening verification to offering, accepted of today's.
 *
 * It never runs expire_buffer_handoffs (a write): a pending handoff past its expiry answers "expired".
 */
type HandoffRow = { id: string; work_item_id: string; licensed_agent_id: string; status: string; offered_at: string; expires_at: string; accepted_at: string | null; returned_at: string | null };
type SessionRow = { id: string; work_item_id: string; started_at: string };
type FieldRow = { session_id: string; state: string; is_visible: boolean };
type QueueRow = { id: string; lead_id: string; disposition: string | null };
type LeadRow = { id: string; values: Record<string, unknown> | null };
type Result<T> = { data: T[] | null; error: { message: string } | null };

// buffer_handoffs and verification_fields are not in the generated types; reads only.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const loose = (): any => getSupabaseServiceClient();

const text = (value: unknown) => (typeof value === "string" ? value.trim() : "");

/** The same name chain list_buffer_handoffs uses (20260912460000), so both sides name a customer alike. */
function customerName(values: Record<string, unknown> | null): string {
  const v = values ?? {};
  return text(v.full_name) || [text(v.first_name), text(v.last_name)].filter(Boolean).join(" ") || text(v.name) || "Unnamed customer";
}

function stateOf(row: HandoffRow, now: number): "waiting" | "accepted" | "returned" | "expired" {
  if (row.status === "accepted") return "accepted";
  if (row.status === "returned") return "returned";
  return Date.parse(row.expires_at) <= now ? "expired" : "waiting";
}

function fail(result: Result<unknown>) {
  if (result.error) throw new Error(result.error.message);
}

/** The signed-in buffer assistant's own handoffs and today's figures (see the header). Throws on a failed read. */
export async function myHandoffs(tenantId: string, userId: string) {
  const zone = (await getWorkspaceTimezone(tenantId).catch(() => null)) ?? "UTC";
  const now = new Date();
  const today = startOfDayIn(zone, now);
  // Yesterday's start: the zone's midnight of a moment 12 hours before today began (safe across DST).
  const yesterday = startOfDayIn(zone, new Date(today.getTime() - 12 * 3_600_000));

  const [handoffs, yesterdays, sessionsToday] = await Promise.all([
    loose().from("buffer_handoffs").select("id, work_item_id, licensed_agent_id, status, offered_at, expires_at, accepted_at, returned_at")
      .eq("tenant_id", tenantId).eq("buffer_user_id", userId).gte("offered_at", today.toISOString()).order("offered_at", { ascending: false }).limit(1000) as Promise<Result<HandoffRow>>,
    loose().from("buffer_handoffs").select("id", { count: "exact", head: true })
      .eq("tenant_id", tenantId).eq("buffer_user_id", userId).gte("offered_at", yesterday.toISOString()).lt("offered_at", today.toISOString()) as Promise<Result<never> & { count: number | null }>,
    loose().from("tenant_verification_sessions").select("id", { count: "exact", head: true })
      .eq("tenant_id", tenantId).eq("user_id", userId).gte("started_at", today.toISOString()) as Promise<Result<never> & { count: number | null }>,
  ]);
  fail(handoffs);
  fail(yesterdays);
  fail(sessionsToday);

  const todays = handoffs.data ?? [];
  const shown = todays.slice(0, 20);
  const workItems = [...new Set(todays.map((h) => h.work_item_id))];

  // This assistant's own verification session on each of today's transfers: when it opened (time to
  // hand off) and, for the rows shown, the fields checked of the visible ones.
  const sessions: Result<SessionRow> = workItems.length
    ? await loose().from("tenant_verification_sessions").select("id, work_item_id, started_at").eq("tenant_id", tenantId).eq("user_id", userId).in("work_item_id", workItems).order("started_at", { ascending: false })
    : { data: [], error: null };
  fail(sessions);
  const sessionOf = new Map<string, SessionRow>();
  for (const s of sessions.data ?? []) if (!sessionOf.has(s.work_item_id)) sessionOf.set(s.work_item_id, s);

  const shownItems = [...new Set(shown.map((h) => h.work_item_id))];
  const shownSessions = shownItems.map((id) => sessionOf.get(id)?.id).filter((id): id is string => Boolean(id));
  const agentIds = [...new Set(shown.map((h) => h.licensed_agent_id))];
  const [fields, queue, agents] = await Promise.all([
    shownSessions.length ? loose().from("verification_fields").select("session_id, state, is_visible").in("session_id", shownSessions) as Promise<Result<FieldRow>> : Promise.resolve({ data: [], error: null } as Result<FieldRow>),
    shownItems.length ? loose().from("lead_queue").select("id, lead_id, disposition").eq("tenant_id", tenantId).in("id", shownItems) as Promise<Result<QueueRow>> : Promise.resolve({ data: [], error: null } as Result<QueueRow>),
    agentIds.length ? getSupabaseServiceClient().from("users").select("id, name").in("id", agentIds) : Promise.resolve({ data: [], error: null }),
  ]);
  fail(fields);
  fail(queue);
  fail(agents as Result<unknown>);
  const leadIds = [...new Set((queue.data ?? []).map((q) => q.lead_id))];
  const leads: Result<LeadRow> = leadIds.length ? await loose().from("agent_leads").select("id, values").eq("tenant_id", tenantId).in("id", leadIds) : { data: [], error: null };
  fail(leads);

  const queueOf = new Map((queue.data ?? []).map((q) => [q.id, q]));
  const leadOf = new Map((leads.data ?? []).map((l) => [l.id, l]));
  const nameOf = new Map(((agents.data ?? []) as { id: string; name: string | null }[]).map((u) => [u.id, u.name]));
  const checked = new Map<string, { checked: number; total: number }>();
  for (const f of fields.data ?? []) {
    if (!f.is_visible) continue;
    const c = checked.get(f.session_id) ?? { checked: 0, total: 0 };
    c.total += 1;
    if (f.state === "confirmed" || f.state === "corrected") c.checked += 1;
    checked.set(f.session_id, c);
  }

  const ms = now.getTime();
  const rows = shown.map((h) => {
    const q = queueOf.get(h.work_item_id);
    const session = sessionOf.get(h.work_item_id);
    const count = session ? checked.get(session.id) : undefined;
    return {
      id: h.id,
      workItemId: h.work_item_id,
      leadId: q?.lead_id ?? null,
      customer: customerName(q ? leadOf.get(q.lead_id)?.values ?? null : null),
      agentName: nameOf.get(h.licensed_agent_id) ?? "Licensed agent",
      state: stateOf(h, ms),
      offeredAt: h.offered_at,
      acceptedAt: h.accepted_at,
      checked: count?.checked ?? null,
      fields: count?.total ?? null,
      disposition: q?.disposition ?? null,
    };
  });

  const waits = todays.flatMap((h) => {
    const s = sessionOf.get(h.work_item_id);
    const gap = s ? (Date.parse(h.offered_at) - Date.parse(s.started_at)) / 1000 : NaN;
    return Number.isFinite(gap) && gap >= 0 ? [gap] : [];
  });
  return {
    timezone: zone,
    handoffs: rows,
    today: {
      verified: sessionsToday.count ?? 0,
      handedOff: todays.length,
      handedOffYesterday: yesterdays.count ?? 0,
      avgSecondsToHandOff: waits.length ? Math.round(waits.reduce((a, b) => a + b, 0) / waits.length) : null,
      accepted: todays.filter((h) => h.status === "accepted").length,
    },
  };
}
