import "server-only";

import { getSupabaseServiceClient } from "@/lib/supabase/service";
import { appointmentCountsForRouting } from "@/lib/appointments/eligibility";

import {
  LEAD_LIST_ASSIGN_LIMIT,
  LIST_CHANGED_MESSAGE,
  SCHEMA_PENDING_MESSAGE,
  nobodySentence,
  type LeadListAssignMode,
  type LeadListAssignmentPreview,
  type LeadListNobodyRow,
  type LeadListOwnerRow,
  weekStart,
  type AssignmentInsights,
  type AssignmentMember,
  type AssignmentRule,
  type AssignmentWorkspace,
  type LicenceExpiry,
  type MatchType,
  type NoEligibleDetail,
  type PreviewRow,
  type RuleCondition,
  type RuleStrategy,
} from "./constants";

export type { AssignmentMember, AssignmentRule } from "./constants";

type DbError = { message: string; code?: string; details?: string | null; hint?: string | null };
type Result<T = unknown> = { data: T; error: DbError | null };
type Query = PromiseLike<Result> & {
  select(columns: string, options?: unknown): Query;
  eq(column: string, value: unknown): Query;
  in(column: string, values: readonly unknown[]): Query;
  order(column: string, options?: unknown): Query;
  insert(values: unknown): Query;
  update(values: unknown): Query;
  upsert(values: unknown, options?: unknown): Query;
  delete(): Query;
  maybeSingle<T = unknown>(): Promise<Result<T>>;
  single<T = unknown>(): Promise<Result<T>>;
};
type Db = {
  from(table: string): Query;
  rpc(name: string, args: Record<string, unknown>): Promise<Result>;
};

const db = () => getSupabaseServiceClient() as unknown as Db;

/** Thrown when a write needs 20260924300000 and it has not been applied. The route answers 503. */
export class SchemaPendingError extends Error {
  constructor() { super(SCHEMA_PENDING_MESSAGE); this.name = "SchemaPendingError"; }
}

/** A column, table or function this page reads that is not there yet: undefined column/table/function, or PostgREST's schema-cache misses. */
function isMissingSchema(error: DbError | null | undefined) {
  if (!error) return false;
  if (["42703", "42P01", "42883", "PGRST202", "PGRST204", "PGRST205"].includes(error.code ?? "")) return true;
  return /schema cache|does not exist|Could not find the (function|table|column)/i.test(error.message ?? "");
}

function rows<T>(data: unknown): T[] { return Array.isArray(data) ? data as T[] : []; }

const RULE_COLUMNS = "id, priority, match_type, match_values, assignee_ids, is_active, last_assignee_id, created_at, updated_at";
/** strategy and conditions arrive with 20260925702100. */
const RULE_COLUMNS_ROUTER = `${RULE_COLUMNS}, strategy, conditions`;

type CapacityRow = { user_id: string; max_open_leads: number; current_open: number; languages?: string[] | null; weekday_off?: number | null };
type SettingsRow = { rest_days: number; attempts_before_rotate?: number | null; auto_route_posted?: boolean | null; updated_at: string | null };
type ExpiryRow = { user_id: string; state: string; expires_on: string; open_leads: number };

export async function getAssignmentWorkspace(tenantId: string): Promise<AssignmentWorkspace> {
  const client = db();
  const since = weekStart();

  // Reads that name the new columns fall back to the old column lists, so the page keeps working
  // before 20260924300000 and simply shows less.
  const capacityQuery = async () => {
    const full = await client.from("agent_capacity").select("user_id, max_open_leads, current_open, languages, weekday_off").eq("tenant_id", tenantId).order("user_id", { ascending: true });
    if (!isMissingSchema(full.error)) return { ...full, boardSchema: !full.error };
    const old = await client.from("agent_capacity").select("user_id, max_open_leads, current_open").eq("tenant_id", tenantId).order("user_id", { ascending: true });
    return { ...old, boardSchema: false };
  };
  const settingsQuery = async () => {
    const router = await client.from("assignment_settings").select("rest_days, attempts_before_rotate, auto_route_posted, updated_at").eq("tenant_id", tenantId).maybeSingle<SettingsRow>();
    if (!isMissingSchema(router.error)) return { ...router, routerSchema: !router.error };
    const full = await client.from("assignment_settings").select("rest_days, attempts_before_rotate, updated_at").eq("tenant_id", tenantId).maybeSingle<SettingsRow>();
    if (!isMissingSchema(full.error)) return { ...full, routerSchema: false };
    const old = await client.from("assignment_settings").select("rest_days, updated_at").eq("tenant_id", tenantId).maybeSingle<SettingsRow>();
    return { ...old, routerSchema: false };
  };
  const rulesQuery = async () => {
    const full = await client.from("assignment_rules").select(RULE_COLUMNS_ROUTER).eq("tenant_id", tenantId).order("priority", { ascending: true }).order("id", { ascending: true });
    if (!isMissingSchema(full.error)) return full;
    return client.from("assignment_rules").select(RULE_COLUMNS).eq("tenant_id", tenantId).order("priority", { ascending: true }).order("id", { ascending: true });
  };

  const [rules, capacities, settings, memberships, campaigns, insights] = await Promise.all([
    rulesQuery(),
    capacityQuery(),
    settingsQuery(),
    client.from("tenant_users").select("user_id, role, accepted_at").eq("tenant_id", tenantId),
    client.from("tenant_campaigns").select("id, name").eq("tenant_id", tenantId).order("name", { ascending: true }),
    client.rpc("assignment_insights", { p_tenant_id: tenantId, p_since: since.toISOString() }),
  ]);
  const failure = [rules, capacities, settings, memberships].find((item) => item.error);
  if (failure?.error) throw new Error(`Could not load assignment workspace: ${failure.error.message}`);

  const accepted = rows<{ user_id: string; role: string; accepted_at: string | null }>(memberships.data)
    .filter((membership) => membership.accepted_at && ["owner", "producer", "setter"].includes(membership.role));

  // Only the members of this tenant. This read used to fetch every row of `users` in the database
  // and discard all but a handful.
  const memberIds = accepted.map((membership) => membership.user_id);
  const users = memberIds.length
    ? await client.from("users").select("id, name, email, status").in("id", memberIds)
    : { data: [], error: null };
  if (users.error) throw new Error(`Could not load assignment workspace: ${users.error.message}`);

  const insightRow = insights.error ? null : (insights.data as Record<string, unknown> | null);
  const eligibleFromSql = insightRow && typeof insightRow.eligible_states === "object" ? insightRow.eligible_states as Record<string, string[]> : null;
  // Before the migration there is no SQL answer; ask the same tables the gate asks.
  const eligibleStates = eligibleFromSql ?? await eligibleStatesFallback(tenantId, accepted.filter((m) => m.role !== "setter").map((m) => m.user_id));

  const capacityByUser = new Map(rows<CapacityRow>(capacities.data).map((row) => [row.user_id, row]));
  const expiringByUser = new Map<string, LicenceExpiry[]>();
  for (const row of rows<ExpiryRow>(insightRow?.licence_expiring)) {
    if (!row?.user_id || typeof row.state !== "string" || typeof row.expires_on !== "string") continue;
    expiringByUser.set(row.user_id, [...(expiringByUser.get(row.user_id) ?? []), { state: row.state, expiresOn: row.expires_on.slice(0, 10), openLeads: Number(row.open_leads) || 0 }]);
  }
  const userById = new Map(rows<{ id: string; name: string; email: string; status: string }>(users.data).map((row) => [row.id, row]));
  const members: AssignmentMember[] = accepted
    .map((membership) => {
      const user = userById.get(membership.user_id);
      const capacity = capacityByUser.get(membership.user_id);
      return {
        id: membership.user_id,
        name: user?.name ?? "Unknown user",
        email: user?.email ?? "",
        role: membership.role,
        status: user?.status ?? "unknown",
        capacity: capacity?.max_open_leads ?? 25,
        currentOpen: capacity?.current_open ?? 0,
        languages: Array.isArray(capacity?.languages) ? capacity.languages : [],
        weekdayOff: typeof capacity?.weekday_off === "number" ? capacity.weekday_off : null,
        eligibleStates: membership.role === "setter" ? null : eligibleStates?.[membership.user_id] ?? null,
        licenceExpiring: membership.role === "setter" ? [] : expiringByUser.get(membership.user_id) ?? [],
      };
    })
    .sort((a, b) => a.name.localeCompare(b.name));

  const settingsRow = settings.data as SettingsRow | null;
  return {
    rules: rows<AssignmentRule>(rules.data).map((rule) => ({
      ...rule,
      strategy: rule.strategy === "least_loaded" ? "least_loaded" : "round_robin",
      conditions: Array.isArray(rule.conditions) ? rule.conditions : [],
    })),
    members,
    settings: {
      rest_days: settingsRow?.rest_days ?? 0,
      attempts_before_rotate: typeof settingsRow?.attempts_before_rotate === "number" ? settingsRow.attempts_before_rotate : null,
      auto_route_posted: settingsRow?.auto_route_posted === true,
      updated_at: settingsRow?.updated_at ?? null,
    },
    campaigns: campaigns.error ? [] : rows<{ id: string; name: string }>(campaigns.data),
    insights: insightRow ? toInsights(insightRow) : null,
    // Only a missing column or function means "not applied"; an insights call that failed for any
    // other reason just leaves the figures blank.
    boardSchema: capacities.boardSchema && !isMissingSchema(insights.error),
    routerSchema: settings.routerSchema,
    since: since.toISOString(),
  };
}

function toInsights(row: Record<string, unknown>): AssignmentInsights {
  return {
    since: String(row.since ?? ""),
    routed: (row.routed && typeof row.routed === "object" ? row.routed : {}) as Record<string, number>,
    skips: rows<AssignmentInsights["skips"][number]>(row.skips),
    skippedLeads: rows<AssignmentInsights["skippedLeads"][number]>(row.skipped_leads).filter((entry) => Boolean(entry?.user_id)),
    unlicensedLeads: typeof row.unlicensed_leads === "number" ? row.unlicensed_leads : null,
    landed: rows<AssignmentInsights["landed"][number]>(row.landed),
    autoRouted: typeof row.auto_routed === "number" ? row.auto_routed : 0,
  };
}

/**
 * The states each owner or producer may be handed a lead in, worked out from the same tables
 * assignment_candidate_is_eligible reads (20260924110000): an unexpired agency licence AND an
 * active, in-date, unexpired appointment with a carrier the agency still has switched on (the row
 * rule is appointmentCountsForRouting, the same one /app/appointments uses), intersected with the
 * agent's own recorded states when any are recorded. Used only until assignment_insights exists —
 * after that the database answers by calling the gate itself, so the two cannot drift for long.
 * Any read that fails returns null: "unknown" rather than a confident wrong count.
 */
/** expires_at arrives with 20260924310000; before it the appointments are read without it. */
async function appointmentsForRouting(client: Db, tenantId: string): Promise<Result> {
  const columns = "state, status, effective_from, terminated_at, carrier_id";
  const detailed = await client.from("appointments").select(`${columns}, expires_at`).eq("tenant_id", tenantId);
  if (!isMissingSchema(detailed.error)) return detailed;
  return client.from("appointments").select(columns).eq("tenant_id", tenantId);
}

async function eligibleStatesFallback(tenantId: string, userIds: string[]): Promise<Record<string, string[]> | null> {
  if (!userIds.length) return {};
  const client = db();
  const [licenses, appointments, carriers, own] = await Promise.all([
    client.from("licenses").select("state, expires_at").eq("tenant_id", tenantId),
    appointmentsForRouting(client, tenantId),
    client.from("tenant_carriers").select("carrier_id, is_active").eq("tenant_id", tenantId),
    client.from("tenant_user_licensed_states").select("user_id, state").eq("tenant_id", tenantId),
  ]);
  if (licenses.error || appointments.error || carriers.error) return null;
  const today = new Date().toISOString().slice(0, 10);
  const up = (value: unknown) => String(value ?? "").trim().toUpperCase();
  const licensed = new Set(rows<{ state: string; expires_at: string | null }>(licenses.data)
    .filter((l) => up(l.state) && (!l.expires_at || l.expires_at.slice(0, 10) >= today)).map((l) => up(l.state)));
  const activeCarriers = new Set(rows<{ carrier_id: string; is_active: boolean }>(carriers.data).filter((c) => c.is_active).map((c) => c.carrier_id));
  const appointed = new Set(rows<{ state: string; status: string; effective_from: string | null; terminated_at: string | null; expires_at?: string | null; carrier_id: string }>(appointments.data)
    .filter((a) => activeCarriers.has(a.carrier_id) && appointmentCountsForRouting(a, today))
    .map((a) => up(a.state)));
  const agency = [...licensed].filter((state) => appointed.has(state)).sort();
  const ownByUser = new Map<string, Set<string>>();
  for (const row of own.error ? [] : rows<{ user_id: string; state: string }>(own.data)) {
    const set = ownByUser.get(row.user_id) ?? new Set<string>();
    set.add(up(row.state));
    ownByUser.set(row.user_id, set);
  }
  return Object.fromEntries(userIds.map((id) => {
    const mine = ownByUser.get(id);
    return [id, mine && mine.size ? agency.filter((state) => mine.has(state)) : agency];
  }));
}

/** The routing preview: what the next leads would do, run through the real router and rolled back. Null before the migration. */
export async function getAssignmentPreview(tenantId: string, actorId: string, limit = 5): Promise<PreviewRow[] | null> {
  const result = await db().rpc("assignment_preview", { p_tenant_id: tenantId, p_actor_user_id: actorId, p_limit: limit });
  if (isMissingSchema(result.error)) return null;
  if (result.error) throw new Error(explainAssignmentError(result.error));
  return rows<PreviewRow>(result.data).map((row) => ({ ...row, full_user_ids: [...new Set(row.full_user_ids ?? [])] }));
}

export async function saveAssignmentRule(tenantId: string, actorId: string, input: { id?: string; priority: number; matchType: AssignmentRule["match_type"]; matchValues: Record<string, unknown>; assigneeIds: string[]; isActive: boolean }) {
  const payload = { tenant_id: tenantId, priority: input.priority, match_type: input.matchType, match_values: input.matchValues, assignee_ids: input.assigneeIds, is_active: input.isActive, created_by: actorId };
  const query = input.id
    ? clientUpdateRule(tenantId, input.id, payload)
    : db().from("assignment_rules").insert(payload).select(RULE_COLUMNS).single();
  const result = await query;
  if (result.error || !result.data) {
    // A 'realtime' rule before the migration fails the match_type check.
    if (result.error?.code === "23514" && input.matchType === "realtime") throw new SchemaPendingError();
    throw new Error(result.error?.message ?? "Could not save assignment rule");
  }
  return result.data as AssignmentRule;
}

function clientUpdateRule(tenantId: string, id: string, payload: Record<string, unknown>) {
  return db().from("assignment_rules").update(payload).eq("tenant_id", tenantId).eq("id", id).select(RULE_COLUMNS).single();
}

export type PublishedRule = { id?: string; matchType: MatchType; matchValues: Record<string, unknown>; assigneeIds: string[]; isActive: boolean; strategy?: RuleStrategy; conditions?: RuleCondition[] };

/**
 * Publishes the whole draft chain in one transaction (publish_assignment_rules). Before that
 * function exists, falls back to what the page did before — one save per rule — which is not
 * atomic but is today's behaviour; a real-time rule cannot be stored at all until then.
 *
 * A fallback rule always goes last: it matches everything, so a rule after it would only ever see
 * the leads it could not place. The database does the same (20260925702100).
 */
export async function publishAssignmentRules(tenantId: string, actorId: string, input: PublishedRule[]) {
  const rules = [...input.filter((rule) => rule.matchType !== "fallback"), ...input.filter((rule) => rule.matchType === "fallback")];
  // The 20260924300000 publish ignores the strategy and conditions it does not know. Publishing a
  // chain that uses them before 20260925702100 would silently store something weaker: refuse.
  const usesRouter = rules.some((rule) => (rule.strategy ?? "round_robin") !== "round_robin" || (rule.conditions?.length ?? 0) > 0);
  if (usesRouter) {
    const probe = await db().from("assignment_rules").select("strategy, conditions").eq("tenant_id", tenantId).order("id", { ascending: true });
    if (isMissingSchema(probe.error)) throw new SchemaPendingError();
  }
  const payload = rules.map((rule) => ({
    id: rule.id ?? null,
    match_type: rule.matchType,
    match_values: rule.matchValues,
    assignee_ids: rule.assigneeIds,
    is_active: rule.isActive,
    strategy: rule.strategy ?? "round_robin",
    conditions: rule.conditions ?? [],
  }));
  const result = await db().rpc("publish_assignment_rules", { p_tenant_id: tenantId, p_actor_user_id: actorId, p_rules: payload });
  if (!result.error) return rows<AssignmentRule>(result.data);
  if (!isMissingSchema(result.error)) throw new Error(explainAssignmentError(result.error));

  if (rules.some((rule) => rule.matchType === "realtime")) throw new SchemaPendingError();
  const existing = await db().from("assignment_rules").select("id, is_active").eq("tenant_id", tenantId);
  if (existing.error) throw new Error(existing.error.message);
  const kept = new Set<string>();
  for (const [index, rule] of rules.entries()) {
    const saved = await saveAssignmentRule(tenantId, actorId, { id: rule.id, priority: (index + 1) * 10, matchType: rule.matchType, matchValues: rule.matchValues, assigneeIds: rule.assigneeIds, isActive: rule.isActive });
    kept.add(saved.id);
  }
  for (const row of rows<{ id: string; is_active: boolean }>(existing.data)) {
    if (row.is_active && !kept.has(row.id)) {
      const off = await db().from("assignment_rules").update({ is_active: false }).eq("tenant_id", tenantId).eq("id", row.id);
      if (off.error) throw new Error(off.error.message);
    }
  }
  const after = await db().from("assignment_rules").select(RULE_COLUMNS).eq("tenant_id", tenantId).order("priority", { ascending: true }).order("id", { ascending: true });
  return rows<AssignmentRule>(after.data);
}

export async function saveAssignmentSettings(tenantId: string, actorId: string, input: { restDays?: number; attemptsBeforeRotate?: number | null; autoRoutePosted?: boolean }) {
  const payload: Record<string, unknown> = { tenant_id: tenantId, updated_by: actorId };
  if (input.restDays !== undefined) payload.rest_days = input.restDays;
  if (input.attemptsBeforeRotate !== undefined) payload.attempts_before_rotate = input.attemptsBeforeRotate;
  if (input.autoRoutePosted !== undefined) payload.auto_route_posted = input.autoRoutePosted;
  const columns = input.autoRoutePosted !== undefined ? "rest_days, auto_route_posted, updated_at"
    : input.attemptsBeforeRotate !== undefined ? "rest_days, attempts_before_rotate, updated_at" : "rest_days, updated_at";
  const result = await db().from("assignment_settings").upsert(payload, { onConflict: "tenant_id" }).select(columns).single();
  if (result.error || !result.data) {
    if (isMissingSchema(result.error)) throw new SchemaPendingError();
    throw new Error(result.error?.message ?? "Could not save assignment settings");
  }
  return result.data;
}

export async function saveAgentCapacity(tenantId: string, userId: string, input: { maxOpenLeads?: number; languages?: string[]; weekdayOff?: number | null }) {
  const membership = await db().from("tenant_users").select("user_id").eq("tenant_id", tenantId).eq("user_id", userId).maybeSingle();
  if (membership.error || !membership.data) throw new Error("Capacity user is not a member of this tenant");
  const payload: Record<string, unknown> = { tenant_id: tenantId, user_id: userId };
  if (input.maxOpenLeads !== undefined) payload.max_open_leads = input.maxOpenLeads;
  if (input.languages !== undefined) payload.languages = [...new Set(input.languages.map((value) => value.trim().toLowerCase()).filter(Boolean))].slice(0, 12);
  if (input.weekdayOff !== undefined) payload.weekday_off = input.weekdayOff;
  const needsBoard = input.languages !== undefined || input.weekdayOff !== undefined;
  const result = await db().from("agent_capacity").upsert(payload, { onConflict: "tenant_id,user_id" }).select(needsBoard ? "user_id, max_open_leads, current_open, languages, weekday_off" : "user_id, max_open_leads, current_open").single();
  if (result.error || !result.data) {
    if (isMissingSchema(result.error)) throw new SchemaPendingError();
    throw new Error(result.error?.message ?? "Could not save agent capacity");
  }
  return result.data;
}

export async function assignLead(tenantId: string, actorId: string, input: { workItemId?: string | null; targetUserId?: string | null; reason?: string | null }) {
  const result = await db().rpc("assign_lead", { p_tenant_id: tenantId, p_actor_user_id: actorId, p_work_item_id: input.workItemId ?? null, p_target_user_id: input.targetUserId ?? null, p_reason: input.reason ?? null });
  if (result.error || !result.data) {
    // `assign_lead` raises a bare `ASSIGNMENT_TARGET_NOT_ELIGIBLE`, and that string reached the
    // screen verbatim. It is the same refusal whether the agency has no licence in that state, an
    // expired one, no carrier appointment, or the person simply holds a role that cannot work
    // leads — four situations with four different remedies and one indistinguishable message.
    //
    // `assignment_ineligibility_reason` answers the same question the gate answered, in a sentence.
    // It is asked only on the refusal path, so the ordinary assignment still costs one round trip.
    if (result.error?.message?.includes("ASSIGNMENT_TARGET_NOT_ELIGIBLE")) {
      throw new Error(await ineligibilityReason(tenantId, input));
    }
    throw new Error(result.error ? explainAssignmentError(result.error) : "Could not assign lead");
  }
  return result.data;
}

/**
 * Every other refusal assign_lead raises, as a sentence. These codes reached the screen verbatim
 * too ("NO_ELIGIBLE_ASSIGNEE"). An unknown code passes through unchanged rather than being guessed at.
 */
export function explainAssignmentError(error: DbError): string {
  const code = (error.message ?? "").trim();
  switch (code) {
    case "NO_ELIGIBLE_ASSIGNEE": {
      let detail: NoEligibleDetail | null = null;
      try { detail = error.details ? JSON.parse(error.details) as NoEligibleDetail : null; } catch { detail = null; }
      return nobodySentence(detail);
    }
    case "ASSIGNMENT_WORK_ITEM_NOT_FOUND": return "There is no such work item, or nothing is waiting in the pool.";
    case "ASSIGNMENT_LEAD_NOT_FOUND": return "That work item's lead no longer exists.";
    case "ASSIGNMENT_WORK_ITEM_CLOSED": return "That work item is closed, so it cannot be assigned.";
    case "ASSIGNMENT_MANAGER_REQUIRED": return "Only an owner or producer can move a lead someone else owns.";
    case "REASSIGNMENT_REASON_REQUIRED": return "Give a reason to move a lead that someone already owns.";
    case "ASSIGNMENT_TARGET_AT_CAPACITY": return "That person is at their capacity ceiling. Raise it in the capacity table or pick someone else.";
    case "ASSIGNMENT_TARGET_RESTING": return "Another agent had this household inside the rest period. Wait until it has passed, give the lead to that agent, or ask an owner or producer to reassign it with a reason.";
    case "ASSIGNMENT_HOUSEHOLD_OWNED": return "Another agent already holds an open lead in this household. One agent at a time: give it to them, or return theirs to the pool first.";
    case "ASSIGNMENT_ACTOR_INVALID": return "Your account is not an active member of this workspace.";
    case "ASSIGNMENT_NOT_OWNED": return "Nobody owns that lead, so there is nothing to return.";
    case "POOL_RETURN_REASON_REQUIRED": return "Give a reason for returning the lead to the pool.";
    case "ASSIGNMENT_RULE_NOT_FOUND": return "One of those rules no longer exists. Reload and publish again.";
    case "ASSIGNMENT_RULES_INVALID": return "One of those rules is not valid. A rule has at most three conditions, and the fallback has none.";
    case "ASSIGNMENT_LIST_TOO_LARGE": {
      let total: number | null = null;
      try { total = error.details ? Number((JSON.parse(error.details) as { total?: number }).total) || null : null; } catch { total = null; }
      return `${total ? `This list has ${total.toLocaleString("en-US")} unassigned leads, and` : "This list has more unassigned leads than"} one bulk assignment moves at most ${LEAD_LIST_ASSIGN_LIMIT.toLocaleString("en-US")}. Pick leads one by one, or let Assign next work through them.`;
    }
    case "ASSIGNMENT_LIST_CHANGED": return LIST_CHANGED_MESSAGE;
    case "ASSIGNMENT_LIST_NOT_FOUND": return "That list no longer exists in this workspace.";
    case "ASSIGNMENT_LIST_MODE_INVALID": return "Choose how to assign: the published rule chain, one owner, or round robin.";
    case "ASSIGNMENT_LIST_MEMBERS_REQUIRED": return "Choose who gets the leads: one person for One owner, at least one for Round robin.";
    case "ASSIGNMENT_LIST_MEMBER_INVALID": return "One of the people you chose is no longer an active member of this workspace.";
    case "ASSIGNMENT_LIST_REASON_REQUIRED": return "Give a reason for overriding the rule chain. It is recorded with the assignment.";
    case "ASSIGNMENT_LIST_NOTHING_ROUTABLE": return "None of these leads can be assigned right now, so nothing was moved.";
    case "ASSIGNMENT_LIST_EXPECTED_REQUIRED": return "Preview the assignment before confirming it.";
    default: return code || "Could not complete assignment";
  }
}

/**
 * The human half of an eligibility refusal.
 *
 * Falls back to a plain sentence rather than the raised code whenever the explanation cannot be
 * produced: a reason lookup that itself fails must not replace a bad message with a worse one.
 */
async function ineligibilityReason(
  tenantId: string,
  input: { workItemId?: string | null; targetUserId?: string | null },
): Promise<string> {
  const generic = "That person cannot be given this lead. Check their role, and your agency's licence and carrier appointment for the lead's state.";
  if (!input.targetUserId || !input.workItemId) return generic;

  const item = await db()
    .from("lead_queue")
    .select("lead_id")
    .eq("tenant_id", tenantId)
    .eq("id", input.workItemId)
    .maybeSingle<{ lead_id: string }>();
  if (item.error || !item.data) return generic;

  const [lead, member] = await Promise.all([
    db().from("agent_leads").select("values, product_line").eq("tenant_id", tenantId).eq("id", item.data.lead_id).maybeSingle<{ values: Record<string, unknown> | null; product_line: string | null }>(),
    db().from("tenant_users").select("role").eq("tenant_id", tenantId).eq("user_id", input.targetUserId).maybeSingle<{ role: string }>(),
  ]);
  if (lead.error || !lead.data || member.error || !member.data) return generic;

  const state = typeof lead.data.values?.state === "string" ? lead.data.values.state : "";
  const explained = await db().rpc("assignment_ineligibility_reason", {
    p_tenant_id: tenantId,
    p_user_id: input.targetUserId,
    p_role: member.data.role,
    p_product: lead.data.product_line,
    p_state: state,
    // Matches what `assign_lead` passes for a lead with no rule of its own: the strict reading, so
    // the explanation cannot be softer than the refusal it is explaining.
    p_requires_licensed: true,
  });
  const reason = typeof explained.data === "string" ? explained.data.trim() : "";
  return explained.error || !reason ? generic : reason;
}

/** assign_lead_list refused because the list no longer routes as previewed. The route answers 409 and the drawer re-runs the preview. */
export class ListChangedError extends Error {
  constructor() { super(LIST_CHANGED_MESSAGE); this.name = "ListChangedError"; }
}

type LeadListAssignInput = { campaignId: string; mode: LeadListAssignMode; userIds: string[] };

function toListPreview(data: unknown): LeadListAssignmentPreview {
  const row = (data && typeof data === "object" ? data : {}) as Record<string, unknown>;
  const n = (value: unknown) => (typeof value === "number" ? value : Number(value ?? 0) || 0);
  return {
    total: n(row.total),
    routable: n(row.routable),
    nobody_count: n(row.nobody_count),
    per_owner: rows<LeadListOwnerRow>(row.per_owner).map((owner) => ({
      ...owner,
      gets: n(owner.gets),
      capacity_skips: n(owner.capacity_skips),
      states: Array.isArray(owner.states) ? owner.states : [],
      rule_types: Array.isArray(owner.rule_types) ? owner.rule_types : [],
    })),
    nobody: rows<LeadListNobodyRow>(row.nobody).map((entry) => ({ ...entry, count: n(entry.count), detail: entry.detail ?? null })),
  };
}

/**
 * The whole list through the real router, rolled back (assign_lead_list_preview, 20260924342000).
 * Throws SchemaPendingError before that migration — there is no honest fallback: a per-lead guess
 * would be a second router that can disagree with the first.
 */
export async function previewLeadListAssignment(tenantId: string, actorId: string, input: LeadListAssignInput): Promise<LeadListAssignmentPreview> {
  const result = await db().rpc("assign_lead_list_preview", {
    p_tenant_id: tenantId,
    p_actor_user_id: actorId,
    p_campaign_id: input.campaignId,
    p_mode: input.mode,
    p_user_ids: input.mode === "chain" ? null : input.userIds,
  });
  if (isMissingSchema(result.error)) throw new SchemaPendingError();
  if (result.error) throw new Error(explainAssignmentError(result.error));
  return toListPreview(result.data);
}

/**
 * Every routable lead in the list, in one transaction, or none (assign_lead_list). `expected` is
 * the routable count the manager confirmed; a different count raises ListChangedError and writes
 * nothing. The function writes the one audit_log row itself, in the same transaction, so the
 * assignment and its record cannot come apart.
 */
export async function assignLeadList(tenantId: string, actorId: string, input: LeadListAssignInput & { reason: string | null; expected: number }) {
  const result = await db().rpc("assign_lead_list", {
    p_tenant_id: tenantId,
    p_actor_user_id: actorId,
    p_campaign_id: input.campaignId,
    p_mode: input.mode,
    p_user_ids: input.mode === "chain" ? null : input.userIds,
    p_reason: input.reason,
    p_expected: input.expected,
  });
  if (isMissingSchema(result.error)) throw new SchemaPendingError();
  if (result.error?.message?.trim() === "ASSIGNMENT_LIST_CHANGED") throw new ListChangedError();
  if (result.error || !result.data) throw new Error(result.error ? explainAssignmentError(result.error) : "Could not assign the list");
  const data = result.data as Record<string, unknown>;
  return { ...toListPreview(data), batch_id: typeof data.batch_id === "string" ? data.batch_id : null };
}

export async function returnLeadToPool(tenantId: string, actorId: string, workItemId: string, reason: string) {
  const result = await db().rpc("return_lead_to_assignment_pool", { p_tenant_id: tenantId, p_work_item_id: workItemId, p_actor_user_id: actorId, p_reason: reason });
  if (result.error || !result.data) throw new Error(result.error ? explainAssignmentError(result.error) : "Could not return lead to pool");
  return result.data;
}
