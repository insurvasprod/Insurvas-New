import "server-only";
import { after } from "next/server";

import { audit } from "@/lib/audit/log";
import { getSupabaseServiceClient } from "@/lib/supabase/service";
import { postAgentReadyCards } from "@/lib/partnerChat/service";
import { listDueCallbacks } from "@/lib/callbacks/service";
import { getQueueSlaSettings } from "@/lib/queueSla/service";
import { isOpenTransfer } from "@/lib/transferInbox/constants";
import { notifyAgentUser, notifyTenantAgents } from "@/lib/agentAlerts/service";
import { productLineLabel } from "@/lib/format/productLine";
import { languageFromLeadValues, phoneFromLeadValues } from "./leadFacts";

export type AgentAvailability = "ready" | "on_break" | "off";

export type FloorMember = {
  id: string;
  name: string;
  role: string;
  /**
   * Unchanged vocabulary: scripts/verify-agent-floor.mjs asserts a stale heartbeat reads "offline".
   * An open active_calls row still wins ("on_call"); whether anybody is at the desk is `away`.
   */
  availability: AgentAvailability | "offline" | "on_call";
  /** On a call (an open active_calls row) but no heartbeat for over 60s: a held lead, nobody at the desk. */
  away: boolean;
  lastSeenAt: string | null;
  /** When the saved status last changed. Null until 20260924328000 is applied, or for no row. */
  statusChangedAt: string | null;
  /** The open call, when there is one. */
  call: { workItemId: string; leadId: string; customer: string; partnerName: string | null; startedAt: string } | null;
  /** The latest call this member finished (last 12 hours), for "After {customer}" and idle time. */
  lastCall: { customer: string; endedAt: string } | null;
  /** Languages recorded on their capacity row (agent_capacity.languages). Empty when none. */
  languages: string[];
};

export type FloorLead = {
  id: string;
  leadId: string;
  customer: string;
  age: string;
  state: string;
  partnerName: string;
  productLine: string;
  screeningOutcome: string;
  screeningWarning: string | null;
  duplicateWarning: boolean;
  preflightStatus: string;
  preflight: unknown;
  queuedAt: string;
  ownerName: string | null;
  /** From the lead's values (language / preferred_language / language_code). Null when none is recorded. */
  language: string | null;
  /** The lead's phone as recorded. Null when none is recorded. */
  phone: string | null;
  /** When run_unclaimed_sla escalated it (still unclaimed past the escalate threshold). */
  escalatedAt: string | null;
};

export type FloorCall = FloorLead & {
  activeCallId: string;
  agentId: string;
  agentName: string;
  agentRole: string;
  startedAt: string;
  /** The open verification session's progress; null when none is open. */
  verificationPercent: number | null;
};

/** A floor action refused for a reason the person can act on. `status` is the HTTP status. */
export class FloorActionError extends Error {
  constructor(message: string, readonly status: number) {
    super(message);
  }
}

const HEARTBEAT_STALE_MS = 60_000;

function isStale(lastSeenAt: string | null, now: number) {
  if (!lastSeenAt) return true;
  return now - new Date(lastSeenAt).getTime() > HEARTBEAT_STALE_MS;
}

function isMissingSchema(error: { code?: string } | null | undefined) {
  return Boolean(error && ["42703", "42P01", "42883", "PGRST202", "PGRST204", "PGRST205"].includes(error.code ?? ""));
}

// Some reads below touch tables and columns the generated types do not carry yet (or embed shapes
// they cannot express). One narrow escape hatch, used only for reads.
type LooseResult = { data: unknown; error: { code?: string; message: string } | null; count?: number | null };
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function loose(): any {
  return getSupabaseServiceClient();
}

/* ── presence ──────────────────────────────────────────────────────────── */

type PresenceRow = { user_id: string; status: string; last_seen_at: string | null; status_changed_at?: string | null };
/** Flipped once, on the first 42703, until 20260924328000 is applied and the process restarts. */
let statusChangedColumn: "unknown" | "present" | "absent" = "unknown";

async function readPresence(tenantId: string): Promise<PresenceRow[]> {
  const read = (columns: string) => loose().from("agent_presence").select(columns).eq("tenant_id", tenantId) as Promise<LooseResult>;
  let result = await read(statusChangedColumn === "absent" ? "user_id, status, last_seen_at" : "user_id, status, last_seen_at, status_changed_at");
  if (result.error && statusChangedColumn !== "absent" && isMissingSchema(result.error)) {
    statusChangedColumn = "absent";
    console.warn("[agentFloor] agent_presence.status_changed_at is missing; idle and wrap-up durations are hidden until 20260924328000 is applied.");
    result = await read("user_id, status, last_seen_at");
  }
  if (result.error) throw new Error(`Could not load floor presence: ${result.error.message}`);
  if (statusChangedColumn === "unknown") statusChangedColumn = "present";
  return (result.data ?? []) as PresenceRow[];
}

/* ── lead facts (language, phone, name), cached per lead ────────────────── */

type LeadFacts = { customer: string; language: string | null; phone: string | null };
const LEAD_FACTS_TTL_MS = 60_000;
const leadFactsCache = new Map<string, { at: number; facts: LeadFacts }>();

function customerName(values: Record<string, unknown>) {
  const pick = (value: unknown) => (typeof value === "string" || typeof value === "number" ? String(value).trim() : "");
  const composed = [values.first_name, values.last_name].filter((part) => part != null).map((part) => String(part)).join(" ").trim();
  return pick(values.full_name) || pick(values.name) || composed || "Unnamed customer";
}

/**
 * The floor is polled every second, so a lead's values are read once a minute at most. Language and
 * phone are read here rather than by list_transfer_inbox, whose definition other work owns.
 */
async function leadFacts(tenantId: string, leadIds: string[]): Promise<Map<string, LeadFacts>> {
  const now = Date.now();
  const out = new Map<string, LeadFacts>();
  const missing: string[] = [];
  for (const id of new Set(leadIds)) {
    const hit = leadFactsCache.get(`${tenantId}:${id}`);
    if (hit && now - hit.at < LEAD_FACTS_TTL_MS) out.set(id, hit.facts);
    else missing.push(id);
  }
  if (missing.length) {
    const result = (await loose().from("agent_leads").select("id, values").eq("tenant_id", tenantId).in("id", missing.slice(0, 200))) as LooseResult;
    // A failed read leaves the facts unknown ("Not recorded"), never the floor down.
    if (result.error) console.error("[agentFloor] could not read lead facts", result.error.message);
    for (const row of (result.error ? [] : (result.data ?? [])) as Array<{ id: string; values: unknown }>) {
      const values = (row.values && typeof row.values === "object" && !Array.isArray(row.values) ? row.values : {}) as Record<string, unknown>;
      const facts = { customer: customerName(values), language: languageFromLeadValues(values), phone: phoneFromLeadValues(values) };
      out.set(row.id, facts);
      leadFactsCache.set(`${tenantId}:${row.id}`, { at: now, facts });
    }
    if (leadFactsCache.size > 5000) {
      for (const [key, value] of leadFactsCache) if (now - value.at >= LEAD_FACTS_TTL_MS) leadFactsCache.delete(key);
    }
  }
  return out;
}

/* ── the slower half: closed transfers and last calls, cached per tenant ── */

type SlowFloor = {
  /** Inbound transfers (partner_id not null) dispositioned in the last hour, and the hour before. Null when unreadable. */
  closedThisHour: number | null;
  closedPreviousHour: number | null;
  lastCallByUser: Map<string, { leadId: string; endedAt: string }>;
};
const SLOW_TTL_MS = 30_000;
const slowCache = new Map<string, { at: number; openCalls: string; value: SlowFloor }>();

async function readSlowFloor(tenantId: string, openCallsSignature: string): Promise<SlowFloor> {
  const now = Date.now();
  const hit = slowCache.get(tenantId);
  // A call ending changes both halves ("After {customer}" and, once dispositioned, the count), so a
  // change in the set of open calls refreshes early rather than waiting out the 30 seconds.
  if (hit && now - hit.at < SLOW_TTL_MS && hit.openCalls === openCallsSignature) return hit.value;
  const hourAgo = new Date(now - 3_600_000).toISOString();
  const twoHoursAgo = new Date(now - 7_200_000).toISOString();
  const closed = (from: string, to: string | null) => {
    let query = loose().from("lead_queue").select("id", { count: "exact", head: true }).eq("tenant_id", tenantId).not("partner_id", "is", null).gte("disposition_at", from);
    if (to) query = query.lt("disposition_at", to);
    return query as Promise<LooseResult>;
  };
  const [thisHour, previousHour, ended] = await Promise.all([
    closed(hourAgo, null),
    closed(twoHoursAgo, hourAgo),
    loose().from("active_calls").select("user_id, lead_id, ended_at").eq("tenant_id", tenantId).not("ended_at", "is", null).gte("ended_at", new Date(now - 12 * 3_600_000).toISOString()).order("ended_at", { ascending: false }).limit(300) as Promise<LooseResult>,
  ]);
  if (thisHour.error) console.error("[agentFloor] could not count closed transfers", thisHour.error.message);
  if (ended.error) console.error("[agentFloor] could not read ended calls", ended.error.message);
  const lastCallByUser = new Map<string, { leadId: string; endedAt: string }>();
  for (const row of (ended.error ? [] : (ended.data ?? [])) as Array<{ user_id: string; lead_id: string; ended_at: string }>) {
    if (!lastCallByUser.has(row.user_id)) lastCallByUser.set(row.user_id, { leadId: row.lead_id, endedAt: row.ended_at });
  }
  const value: SlowFloor = {
    closedThisHour: thisHour.error ? null : thisHour.count ?? 0,
    closedPreviousHour: thisHour.error || previousHour.error ? null : previousHour.count ?? 0,
    lastCallByUser,
  };
  slowCache.set(tenantId, { at: now, openCalls: openCallsSignature, value });
  return value;
}

/* ── the Floor concept board's extra facts ──────────────────────────────── */

type FloorExtras = {
  /** work item → open verification progress. */
  progress: Map<string, number>;
  /** unclaimed work item → when run_unclaimed_sla escalated it. */
  escalated: Map<string, string>;
  /** member → recorded languages. */
  languages: Map<string, string[]>;
  /** verification session → required, visible fields still outstanding. */
  fieldsLeft: Map<string, number>;
};

/**
 * Four small reads the floor adds for the concept board. Each is independent and a failure (or a
 * column not there yet) leaves its fact empty, never the floor down.
 */
async function readFloorExtras(tenantId: string, callWorkItems: string[], handoffSessions: string[]): Promise<FloorExtras> {
  const empty = Promise.resolve({ data: [], error: null } as LooseResult);
  const [progress, escalated, capacity, fields] = await Promise.all([
    callWorkItems.length ? loose().from("tenant_verification_sessions").select("work_item_id, progress_percentage").eq("tenant_id", tenantId).is("ended_at", null).in("work_item_id", callWorkItems.slice(0, 200)) as Promise<LooseResult> : empty,
    loose().from("lead_queue").select("id, sla_escalated_at").eq("tenant_id", tenantId).eq("status", "unclaimed").not("sla_escalated_at", "is", null).limit(1000) as Promise<LooseResult>,
    loose().from("agent_capacity").select("user_id, languages").eq("tenant_id", tenantId) as Promise<LooseResult>,
    handoffSessions.length ? loose().from("verification_fields").select("session_id").in("session_id", handoffSessions.slice(0, 100)).eq("state", "outstanding").eq("is_required", true).eq("is_visible", true) as Promise<LooseResult> : empty,
  ]);
  const extras: FloorExtras = { progress: new Map(), escalated: new Map(), languages: new Map(), fieldsLeft: new Map() };
  if (!progress.error) for (const row of (progress.data ?? []) as Array<{ work_item_id: string; progress_percentage: number }>) extras.progress.set(row.work_item_id, row.progress_percentage);
  if (!escalated.error) for (const row of (escalated.data ?? []) as Array<{ id: string; sla_escalated_at: string }>) extras.escalated.set(row.id, row.sla_escalated_at);
  if (!capacity.error) for (const row of (capacity.data ?? []) as Array<{ user_id: string; languages: string[] | null }>) extras.languages.set(row.user_id, (row.languages ?? []).filter(Boolean));
  if (!fields.error) {
    for (const session of handoffSessions) extras.fieldsLeft.set(session, 0);
    for (const row of (fields.data ?? []) as Array<{ session_id: string }>) extras.fieldsLeft.set(row.session_id, (extras.fieldsLeft.get(row.session_id) ?? 0) + 1);
  }
  return extras;
}

/* ── the floor read ─────────────────────────────────────────────────────── */

export async function getAgentFloor(tenantId: string, currentUserId: string, currentRole: string) {
  const supabase = getSupabaseServiceClient();
  // Polled every second by every visible floor tab, and none of these reads depends on another:
  // they used to run as ~7 sequential round trips, now they are one. Users are embedded in the
  // membership read (tenant_users_user_id_fkey) so the old members -> users hop is gone too.
  // `open`, not `all`: the floor shows what is waiting and what is on a call. `all` also returned
  // every completed and expired transfer, and that history filled the 500-row cap (20260924170000).
  const [inbox, callsResult, memberRows, presenceRows, slaSettings, callbacks] = await Promise.all([
    import("@/lib/transferInbox/service").then(({ getTransferInbox }) => getTransferInbox(tenantId, { status: "open" }, currentUserId, currentRole)),
    supabase
      .from("active_calls")
      .select("id, work_item_id, lead_id, user_id, agent_role, started_at")
      .eq("tenant_id", tenantId)
      .is("ended_at", null),
    supabase
      .from("tenant_users")
      .select("user_id, role, users!tenant_users_user_id_fkey(id, name, status)")
      .eq("tenant_id", tenantId)
      .in("role", ["owner", "producer", "assistant"]),
    readPresence(tenantId),
    getQueueSlaSettings(tenantId),
    listDueCallbacks(tenantId),
  ]);
  const { data: calls, error: callsError } = callsResult;
  if (callsError) throw new Error(`Could not load active calls: ${callsError.message}`);
  if (memberRows.error) throw new Error(`Could not load floor members: ${memberRows.error.message}`);

  const openCalls = calls ?? [];
  const [slow, extras] = await Promise.all([
    readSlowFloor(tenantId, openCalls.map((call) => call.id).sort().join(",")),
    readFloorExtras(tenantId, openCalls.map((call) => call.work_item_id), currentRole === "assistant" ? [] : inbox.handoffs.map((handoff) => handoff.verificationSessionId)),
  ]);
  const byId = new Map(inbox.items.map((item) => [item.id, item]));
  const waitingItems = inbox.items.filter((item) => item.status === "unclaimed");
  const facts = await leadFacts(tenantId, [
    ...waitingItems.map((item) => item.leadId),
    ...openCalls.filter((call) => !byId.has(call.work_item_id)).map((call) => call.lead_id),
    ...[...slow.lastCallByUser.values()].map((call) => call.leadId),
  ]);

  // Same filter the separate users read applied: only active accounts appear on the floor.
  const users = new Map(
    (memberRows.data ?? []).flatMap((row) => (row.users && row.users.status === "active" ? [[row.user_id, row.users] as const] : [])),
  );
  const presence = new Map(presenceRows.map((row) => [row.user_id, row]));
  const callByUser = new Map(openCalls.map((call) => [call.user_id, call]));
  const now = Date.now();
  const members: FloorMember[] = (memberRows.data ?? [])
    .filter((row) => users.has(row.user_id))
    .map((row) => {
      const user = users.get(row.user_id)!;
      const seen = presence.get(row.user_id);
      const stale = isStale(seen?.last_seen_at ?? null, now);
      const call = callByUser.get(row.user_id);
      const availability: FloorMember["availability"] = call
        ? "on_call"
        : stale ? "offline" : ((seen?.status as AgentAvailability | undefined) ?? "off");
      const item = call ? byId.get(call.work_item_id) : undefined;
      const last = slow.lastCallByUser.get(row.user_id);
      return {
        id: row.user_id,
        name: user.name,
        role: row.role,
        availability,
        away: Boolean(call) && stale,
        lastSeenAt: seen?.last_seen_at ?? null,
        statusChangedAt: seen?.status_changed_at ?? null,
        call: call
          ? { workItemId: call.work_item_id, leadId: call.lead_id, customer: item?.customer ?? facts.get(call.lead_id)?.customer ?? "Customer", partnerName: item?.partnerName ?? null, startedAt: call.started_at }
          : null,
        lastCall: last ? { customer: facts.get(last.leadId)?.customer ?? "a customer", endedAt: last.endedAt } : null,
        languages: extras.languages.get(row.user_id) ?? [],
      };
    });

  const toLead = (item: (typeof inbox.items)[number]): FloorLead => ({
    id: item.id,
    leadId: item.leadId,
    customer: item.customer,
    age: item.age,
    state: item.state,
    partnerName: item.partnerName,
    productLine: item.productLine,
    screeningOutcome: item.screeningOutcome,
    screeningWarning: item.screeningWarning,
    duplicateWarning: item.duplicateWarning,
    preflightStatus: item.preflightStatus,
    preflight: item.preflight,
    queuedAt: item.queuedAt,
    ownerName: item.ownerName,
    language: facts.get(item.leadId)?.language ?? null,
    phone: facts.get(item.leadId)?.phone ?? null,
    escalatedAt: extras.escalated.get(item.id) ?? null,
  });

  const onCalls: FloorCall[] = openCalls.flatMap((call) => {
    const item = byId.get(call.work_item_id);
    const user = users.get(call.user_id);
    if (!item || !user) return [];
    return [{ ...toLead(item), activeCallId: call.id, agentId: call.user_id, agentName: user.name, agentRole: call.agent_role, startedAt: call.started_at, verificationPercent: extras.progress.get(call.work_item_id) ?? null }];
  });

  // The inbox bundle RPC already ran list_buffer_handoffs(tenant, currentUserId) for owners and
  // producers (p_licensed_agent_id) and maps it to the same shape, so a second call was a duplicate
  // round trip. Assistants never receive handoffs, as before. Each carries what is left to confirm.
  const pendingHandoffs = currentRole === "assistant" ? [] : inbox.handoffs.map((handoff) => ({ ...handoff, fieldsLeft: extras.fieldsLeft.get(handoff.verificationSessionId) ?? null }));
  const own = presence.get(currentUserId)?.status;

  return {
    waiting: waitingItems.map(toLead),
    // More than 500 open transfers: the newest 500 are shown and the floor says so.
    truncated: inbox.truncated,
    onCalls,
    available: members.filter((member) => member.availability !== "on_call"),
    members,
    /**
     * Your saved status. The floor starts from it rather than assuming "ready", so opening or
     * reloading the page never announces you to partners; pressing Available does.
     */
    ownStatus: (own === "ready" || own === "on_break" || own === "off" ? own : "off") as AgentAvailability,
    pendingHandoffs,
    waitThresholds: { amberSeconds: slaSettings.warn_after_seconds, redSeconds: slaSettings.escalate_after_seconds },
    closedTransfers: { thisHour: slow.closedThisHour, previousHour: slow.closedPreviousHour },
    realtimeTopic: `agent-floor:${tenantId}`,
    callbacks,
    generatedAt: new Date().toISOString(),
  };
}

export async function updateAgentPresence(params: { tenantId: string; userId: string; status: AgentAvailability; request: Request }) {
  const supabase = getSupabaseServiceClient();
  const previous = await supabase
    .from("agent_presence")
    .select("status, updated_at")
    .eq("tenant_id", params.tenantId)
    .eq("user_id", params.userId)
    .maybeSingle();
  if (previous.error) throw new Error(`Could not read current availability: ${previous.error.message}`);
  const { data, error } = await supabase
    .from("agent_presence")
    .upsert({ tenant_id: params.tenantId, user_id: params.userId, status: params.status, last_seen_at: new Date().toISOString() }, { onConflict: "tenant_id,user_id" })
    .select("user_id, status, last_seen_at, updated_at")
    .single();
  if (error) throw new Error(`Could not update availability: ${error.message}`);
  // The heartbeat re-sends the same status every 20 seconds per agent. Only a real change (or the
  // first row) is an auditable event; the rest are liveness pings that bloated audit_log and cost
  // an extra insert each time. Still awaited: an audit row for a real change must not be lost.
  if (!previous.data || previous.data.status !== params.status) {
    await audit({ actorType: "tenant", actorId: params.userId, action: "tenant.agent_presence_updated", targetType: "agent_presence", targetId: `${params.tenantId}:${params.userId}`, metadata: { status: params.status }, request: params.request });
  }
  // The floor heartbeat re-sends the saved status every 20 seconds. Only announce a transition into
  // ready; otherwise every partner channel is flooded with duplicate presence cards. The
  // previous row's timestamp makes concurrent transitions share one event key while still
  // allowing a later off/on-break -> ready transition to announce again.
  if (params.status === "ready" && previous.data?.status !== "ready") {
    const transitionKey = previous.data?.updated_at ?? "initial";
    // after() keeps the platform alive until the cards are posted; a bare `void` could be cut off
    // once the response is sent on serverless. Only caller is the agent-floor route handler.
    after(() => postAgentReadyCards(params.tenantId, params.userId, `agent-ready:${params.tenantId}:${params.userId}:${transitionKey}`).catch((error) => console.error("Partner ready cards failed", error)));
  }
  return data;
}

/**
 * A nudge: "please pick up this waiting transfer". With a target it is the owner's "Ask to pick up"
 * from the roster, addressed to one agent; without one it goes to everybody who can claim. Either
 * way it is recorded in agent_floor_nudges (idempotent on the key) AND delivered to the top-bar bell
 * through agent_notifications. Nobody is claimed on anyone's behalf.
 *
 * The notification kind is `handoff_offered` on purpose: it is the bell's live-offer event (it drops
 * after ten minutes unread, which is right for a caller on the line), each person's "Handoffs offered
 * to me" preference gates it, and an unknown kind would be dropped by the feed.
 */
export async function createAgentFloorNudge(params: { tenantId: string; userId: string; role: string; workItemId: string; targetUserId?: string | null; idempotencyKey: string; message: string; request: Request }) {
  const supabase = getSupabaseServiceClient();
  if (params.targetUserId && params.role !== "owner") throw new FloorActionError("Only the account owner can ask a teammate to pick up a transfer.", 403);
  if (params.targetUserId && params.targetUserId === params.userId) throw new FloorActionError("Choose a teammate other than yourself.", 400);

  const item = await supabase.from("lead_queue").select("id, status, lead_id, product_line, partner_id").eq("tenant_id", params.tenantId).eq("id", params.workItemId).maybeSingle();
  if (item.error) throw new Error(`Could not validate the transfer: ${item.error.message}`);
  if (!item.data || !isOpenTransfer(item.data.status)) throw new FloorActionError("That transfer is no longer active.", 409);
  const queue = item.data;

  let targetName: string | null = null;
  if (params.targetUserId) {
    const target = (await loose().from("tenant_users").select("user_id, users!tenant_users_user_id_fkey(name, status)").eq("tenant_id", params.tenantId).eq("user_id", params.targetUserId).in("role", ["owner", "producer", "assistant"]).maybeSingle()) as LooseResult;
    if (target.error) throw new Error(`Could not validate the target agent: ${target.error.message}`);
    const targetUser = (target.data as { users: { name: string; status: string } | null } | null)?.users;
    if (!target.data || (targetUser && targetUser.status !== "active")) throw new FloorActionError("Choose an active agent in this tenant.", 400);
    targetName = targetUser?.name ?? null;
  }

  const { data, error } = await supabase
    .from("agent_floor_nudges")
    .insert({ tenant_id: params.tenantId, work_item_id: params.workItemId, target_user_id: params.targetUserId ?? null, created_by: params.userId, idempotency_key: params.idempotencyKey, message: params.message })
    .select("id, created_at")
    .maybeSingle();
  if (error && error.code !== "23505") throw new Error(`Could not send the nudge: ${error.message}`);
  if (!data) return { alreadySent: true };

  // Delivery. A failure here leaves the nudge recorded and says it was not delivered, rather than
  // failing a request whose row already exists (a retry with the same key would be "already sent").
  let delivered = false;
  let recipients = 0;
  try {
    const [sender, lead, partner] = await Promise.all([
      loose().from("users").select("name").eq("id", params.userId).maybeSingle() as Promise<LooseResult>,
      loose().from("agent_leads").select("values").eq("tenant_id", params.tenantId).eq("id", queue.lead_id).maybeSingle() as Promise<LooseResult>,
      queue.partner_id ? loose().from("partners").select("name").eq("tenant_id", params.tenantId).eq("id", queue.partner_id).maybeSingle() as Promise<LooseResult> : Promise.resolve({ data: null, error: null } as LooseResult),
    ]);
    const senderName = (sender.data as { name?: string } | null)?.name ?? "A teammate";
    const values = ((lead.data as { values?: unknown } | null)?.values ?? {}) as Record<string, unknown>;
    const customer = customerName(values && typeof values === "object" && !Array.isArray(values) ? values : {});
    const partnerName = (partner.data as { name?: string } | null)?.name ?? null;
    const what = [productLineLabel(queue.product_line) === "—" ? null : productLineLabel(queue.product_line), partnerName ? `from ${partnerName}` : null].filter(Boolean).join(", ");
    const body = `${customer}${what ? ` (${what})` : ""} is waiting in the transfer queue. Open the lead or the Agent Floor to pick it up.`;
    const link = `/app/leads/${queue.lead_id}`;
    const sourceKey = `floor-nudge:${data.id}`;
    if (params.targetUserId) {
      await notifyAgentUser({ tenantId: params.tenantId, userId: params.targetUserId, kind: "handoff_offered", title: `${senderName} asks you to pick up ${customer}`, body, link, sourceKey });
      recipients = 1;
    } else {
      const result = await notifyTenantAgents({ tenantId: params.tenantId, kind: "handoff_offered", title: `${senderName} asks the team to pick up ${customer}`, body, link, sourceKey, roles: ["owner", "producer", "assistant"], excludeUserId: params.userId });
      recipients = result.notified;
    }
    delivered = recipients > 0;
  } catch (deliveryError) {
    console.error("[agentFloor] nudge was recorded but not delivered", deliveryError);
  }

  await audit({ actorType: "tenant", actorId: params.userId, action: "tenant.agent_floor_nudged", targetType: "lead_queue", targetId: params.workItemId, metadata: { nudgeId: data.id, targetUserId: params.targetUserId ?? null, message: params.message, delivered, recipients }, request: params.request });
  return { alreadySent: false, nudgeId: data.id, createdAt: data.created_at, delivered, recipients, targetName };
}
