import { NextResponse } from "next/server";
import { z } from "zod";
import { requireFeatureRole } from "@/lib/tenantAuth/requireFeatureRole";
import { agentTimezones, bookCallback, callbackAssignees, callbackBookingFacts, cancelCallback, completeCallback, listCallbacks, reassignCallback, releaseCallbackToQueue, rescheduleCallback } from "@/lib/callbacks/service";
import { US_CUSTOMER_TIMEZONES } from "@/lib/callbacks/timezone";
import { guardLead } from "@/lib/agency/guards";
import { callbackWindowFacts, type CallbackWindowFacts } from "@/lib/callbacks/windowFacts";
import { nearestLegalTime } from "@/lib/callbacks/nearest";
import { recentCallbackRefusals } from "@/lib/callbacks/refusals";
import { commitSpread, planSpread } from "@/lib/callbacks/spread";
import { getCallingWindows } from "@/lib/callingWindow/service";
import { checkCallbackInCallingWindow } from "@/lib/dispositions/callbackWindow";
import { zonedLocalToUtc } from "@/lib/dispositions/callbackTime";
import { getSupabaseServiceClient } from "@/lib/supabase/service";
import { getWorkspaceTimezone } from "@/lib/agencyProfile/timezone";
import { rowVisible, scopeFor, type ProducerScope } from "@/lib/agency/visibility";

/**
 * AG-0.5 · one callback by id: in an agency a narrow session may act on a callback assigned to itself or
 * to a producer in its scope (D1: tenant_callbacks.assigned_to); anything else answers exactly as a
 * callback that does not exist. Null scope (solo, owner/admin): no read, unchanged.
 */
async function callbackHidden(tenantId: string, viewerId: string, scope: ProducerScope, callbackId: string): Promise<NextResponse | null> {
  if (scope === null) return null;
  const row = await getSupabaseServiceClient().from("tenant_callbacks").select("assigned_to").eq("tenant_id", tenantId).eq("id", callbackId).maybeSingle<{ assigned_to: string | null }>();
  if (row.error) return NextResponse.json({ error: "The callback could not be checked. Try again." }, { status: 503 });
  if (!row.data) return null;
  return row.data.assigned_to === viewerId || rowVisible(scope, row.data.assigned_to) ? null : NextResponse.json({ error: "That callback was not found." }, { status: 404 });
}

const uuid = z.string().uuid();
const querySchema = z.object({
  from: z.string().datetime().optional(),
  to: z.string().datetime().optional(),
  callback_id: uuid.optional(),
  include_history: z.enum(["true", "false"]).optional().transform((value) => value === "true"),
  /** With callback_id or lead_id: the nearest legal time at or after this customer-local time, as a suggestion. */
  suggest_local: z.string().regex(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/).optional(),
  /** Add callback: what booking one for this lead needs (its timezone, window and open callback). */
  lead_id: uuid.optional(),
  /** With lead_id, when the lead's state spans zones: the customer's zone, as the agent chose it. */
  timezone: z.enum(US_CUSTOMER_TIMEZONES).optional(),
});
const bodySchema = z.object({ action: z.enum(["reschedule", "cancel", "complete"]), callback_id: uuid, callback_local: z.string().regex(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/).optional() }).strict();
const localTime = z.string().regex(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/);
const spreadPlanSchema = z.object({ action: z.literal("spread_plan"), callback_ids: z.array(uuid).min(1).max(100), days: z.number().int().min(1).max(14), per_hour: z.number().int().min(1).max(30) }).strict();
const spreadCommitSchema = z.object({ action: z.literal("spread_commit"), items: z.array(z.object({ callback_id: uuid, callback_local: localTime }).strict()).min(1).max(100) }).strict();
const handOverSchema = z.object({ action: z.literal("hand_over"), callback_ids: z.array(uuid).min(1).max(100), to: z.union([uuid, z.literal("queue")]) }).strict();
const bookSchema = z.object({
  lead_id: uuid,
  callback_local: z.string().regex(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/),
  timezone: z.enum(US_CUSTOMER_TIMEZONES).optional(),
  note: z.string().trim().max(1000).optional(),
  idempotency_key: z.string().min(8).max(120),
}).strict();

/** The database's own refusals of a time (assert_callback_in_window), as the agent should read them. */
const WINDOW_REFUSALS: Record<string, string> = {
  CALLBACK_OUTSIDE_WINDOW: "That callback time is outside when this lead may be called. Choose another time.",
  CALLBACK_NO_STATE: "This lead has no state, so its calling window is unknown and a callback cannot be booked. Add the state to the lead first.",
};

function errorResponse(error: unknown) {
  const message = error instanceof Error ? error.message : "The callback service is unavailable.";
  const code = message.split(" ")[0];
  if (WINDOW_REFUSALS[code]) {
    return NextResponse.json({ error: WINDOW_REFUSALS[code], code: code === "CALLBACK_NO_STATE" ? "no_state" : "outside_calling_window" }, { status: 422 });
  }
  // 20260925711600: a colleague's callback is theirs — the assignee, whoever booked it, an owner or an
  // assistant may change it; another producer may not.
  if (code === "CALLBACK_NOT_YOURS") {
    return NextResponse.json({ error: "Only the agent this callback is assigned to, the person who booked it, an owner or an assistant can change it.", code: "callback_not_yours" }, { status: 403 });
  }
  // Add callback (book_callback, 20261028300000).
  if (code === "CALLBACK_BOOKING_UNAVAILABLE") {
    return NextResponse.json({ error: "Booking a new callback from this page needs database update 20261028300000, which has not been applied yet. Book it from the dialer for now.", code: "callback_booking_unavailable" }, { status: 503 });
  }
  // Hand-over (20261028400000).
  if (code === "CALLBACK_HANDOVER_UNAVAILABLE") {
    return NextResponse.json({ error: "Handing callbacks over needs database update 20261028400000, which has not been applied yet.", code: "callback_handover_unavailable" }, { status: 503 });
  }
  if (code === "CALLBACK_RELEASE_INBOUND") {
    return NextResponse.json({ error: "A partner's transfer stays with an agent; it cannot go to the shared queue. Give it to someone instead.", code: "callback_release_inbound" }, { status: 409 });
  }
  if (code === "CALLBACK_ASSIGNEE_ROLE_INVALID") {
    return NextResponse.json({ error: "That person cannot hold callbacks. Choose an active owner, producer or assistant.", code: "callback_assignee_invalid" }, { status: 400 });
  }
  if (code === "CALLBACK_NO_WORK_ITEM") {
    return NextResponse.json({ error: "This lead has never been in the call queue, so a callback cannot be attached to it yet. Call it from the dialer first.", code: "callback_no_work_item" }, { status: 409 });
  }
  const status = ["CALLBACK_NOT_FOUND"].includes(code) ? 404 : ["CALLBACK_NOT_ACTIVE", "CALLBACK_ALREADY_COMPLETED"].includes(code) ? 409 : ["CALLBACK_DATE_REQUIRED", "CALLBACK_DATE_PAST", "CALLBACK_ACTOR_INVALID"].includes(code) || message.startsWith("Choose a valid callback") ? 400 : 500;
  // A time in the past is refused and says so, rather than reading as a state problem.
  const shown = code === "CALLBACK_DATE_PAST"
    ? "That time has already passed for the customer. Choose a time in the future."
    : message.startsWith("CALLBACK_") ? "That callback cannot be changed in its current state." : message;
  return NextResponse.json({ error: shown, code: message.startsWith("CALLBACK_") ? code.toLowerCase() : "callback_unavailable" }, { status });
}

/**
 * The calling window for each state on the page, so "Book a callback" can say "Inside the Arizona
 * calling window" while the agent picks a time. Advisory: the reschedule below asks the database.
 */
async function windowsFor(settingsRead: Promise<Awaited<ReturnType<typeof getCallingWindows>>>, states: string[]): Promise<Record<string, CallbackWindowFacts>> {
  if (!states.length) return {};
  try {
    const settings = await settingsRead;
    return Object.fromEntries(states.map((state) => [state, callbackWindowFacts(state, settings.federal, settings.stateRules, settings.tenant)]));
  } catch {
    return {};
  }
}

export async function GET(request: Request) {
  const auth = await requireFeatureRole("callback_calendar", ["owner", "producer", "assistant"], { prefetchScope: true });
  if (auth instanceof NextResponse) return auth;
  const params = Object.fromEntries(new URL(request.url).searchParams.entries());
  const parsed = querySchema.safeParse(params);
  if (!parsed.success) return NextResponse.json({ error: "Choose a valid callback date range." }, { status: 400 });
  // AG-0.5: in an agency a producer, manager or assistant reads only the callbacks assigned to the
  // producers in its scope; from the session, never the request. Null = every callback, as before.
  const scope = await scopeFor(auth.context);
  if (parsed.data.callback_id) {
    const hidden = await callbackHidden(auth.context.tenantId, auth.context.userId, scope, parsed.data.callback_id);
    if (hidden) return hidden;
  }
  if (parsed.data.lead_id && !parsed.data.callback_id) {
    // Add callback: the lead must be one this session can see (AG-0.5), else it does not exist.
    const hiddenLead = await guardLead(auth.context, parsed.data.lead_id);
    if (hiddenLead) return hiddenLead;
    try {
      const facts = await callbackBookingFacts(auth.context.tenantId, parsed.data.lead_id);
      if (!facts) return NextResponse.json({ error: "That lead could not be found." }, { status: 404 });
      const timezone = facts.timezone ?? parsed.data.timezone ?? null;
      if (parsed.data.suggest_local) {
        if (!timezone) return NextResponse.json({ nearest: null });
        return NextResponse.json({ nearest: await suggestion(auth.context.tenantId, { leadId: facts.leadId, timezone, local: parsed.data.suggest_local }) });
      }
      const windows = await windowsFor(getCallingWindows(auth.context.tenantId), facts.state ? [facts.state] : []);
      return NextResponse.json({ lead: facts, window: facts.state ? windows[facts.state] ?? null : null, timezones: US_CUSTOMER_TIMEZONES });
    } catch (error) { return errorResponse(error); }
  }
  if (parsed.data.suggest_local) {
    // "Outside the Oregon calling window" while the agent picks — and the next time that is not.
    if (!parsed.data.callback_id) return NextResponse.json({ error: "Choose a callback." }, { status: 400 });
    const callback = await getSupabaseServiceClient().from("tenant_callbacks").select("lead_id, customer_timezone").eq("tenant_id", auth.context.tenantId).eq("id", parsed.data.callback_id).maybeSingle<{ lead_id: string; customer_timezone: string }>();
    if (callback.error) return NextResponse.json({ error: "The callback could not be checked. Try again." }, { status: 503 });
    if (!callback.data) return NextResponse.json({ error: "That callback was not found." }, { status: 404 });
    const nearest = await suggestion(auth.context.tenantId, { leadId: callback.data.lead_id, timezone: callback.data.customer_timezone, local: parsed.data.suggest_local });
    return NextResponse.json({ nearest });
  }
  try {
    // A single-callback read (History) needs none of the page's context.
    const pageRead = !parsed.data.callback_id;
    // None of the page's context depends on the callbacks except which states' windows to describe, so it
    // is read beside the list rather than after it. The calling-window settings are read up front too and
    // used only if a callback has a state. Each carries a handler so a failure the list's own error
    // overtakes is not left unhandled; awaited below, each settles exactly as it did when read after.
    const settingsRead = getCallingWindows(auth.context.tenantId);
    const zoneRead = getWorkspaceTimezone(auth.context.tenantId).catch(() => null);
    const refusalsRead = pageRead ? recentCallbackRefusals(auth.context.tenantId, scope, auth.context.userId).catch(() => []) : Promise.resolve([]);
    const ownZoneRead = agentTimezones(auth.context.tenantId, auth.context.userId);
    // Give to…: who callbacks may go to, inside this session's scope.
    const assigneesRead = pageRead ? callbackAssignees(auth.context.tenantId).then((people) => (scope === null ? people : people.filter((person) => person.id === auth.context.userId || rowVisible(scope, person.id)))).catch(() => []) : Promise.resolve([]);
    for (const read of [settingsRead, ownZoneRead]) read.catch(() => undefined);
    const callbacks = await listCallbacks(auth.context.tenantId, {
      from: parsed.data.from,
      to: parsed.data.to,
      callbackId: parsed.data.callback_id,
      includeHistory: parsed.data.include_history,
      // The session's own callbacks too (an assistant's scope is the producers he assists, not himself).
      scope: scope === null ? null : [...new Set([...scope, auth.context.userId])],
    });
    const states = [...new Set(callbacks.map((callback) => callback.state).filter((state): state is string => Boolean(state)))];
    const [windows, agencyTimezone, refusals, ownZone, assignees] = await Promise.all([
      windowsFor(settingsRead, states),
      zoneRead,
      refusalsRead,
      ownZoneRead,
      assigneesRead,
    ]);
    // LA-1.22: the customer's time "with the agent's shown alongside" — the agent's OWN zone, the one
    // saved with their working hours, not the agency's (an agent licensed in 14 states is routinely
    // hours from both). With none saved, the page keeps the browser's zone; agencyTimezone stays in
    // the response for callers that want the agency's clock.
    // The viewer decides the Mine/All default (non-owners start on Mine) and the owner-only source rates.
    const viewerTimezone = ownZone.get(auth.context.userId) ?? null;
    return NextResponse.json({ callbacks, windows, agencyTimezone, viewerTimezone, refusals, assignees, viewer: { userId: auth.context.userId, role: auth.context.role } });
  }
  catch (error) { return errorResponse(error); }
}

/**
 * Clear the overdue pile (Callbacks A, 2026-10-28): plan first (nothing booked), then book the plan
 * the agent saw. Every callback must be one this session may change (AG-0.5), else the whole request
 * is refused as not found.
 */
async function spread(request: Request, auth: Exclude<Awaited<ReturnType<typeof requireFeatureRole>>, NextResponse>, body: unknown) {
  const plan = spreadPlanSchema.safeParse(body);
  const commit = spreadCommitSchema.safeParse(body);
  if (!plan.success && !commit.success) return NextResponse.json({ error: "Choose the callbacks to spread." }, { status: 400 });
  const ids = plan.success ? plan.data.callback_ids : commit.success ? commit.data.items.map((item) => item.callback_id) : [];
  const scope = await scopeFor(auth.context);
  if (scope !== null) {
    const rows = await getSupabaseServiceClient().from("tenant_callbacks").select("id, assigned_to").eq("tenant_id", auth.context.tenantId).in("id", ids);
    if (rows.error) return NextResponse.json({ error: "The callbacks could not be checked. Try again." }, { status: 503 });
    const allowed = (rows.data ?? []).filter((row) => row.assigned_to === auth.context.userId || rowVisible(scope, row.assigned_to)).length;
    if (allowed !== ids.length) return NextResponse.json({ error: "Some of those callbacks were not found." }, { status: 404 });
  }
  try {
    if (plan.success) return NextResponse.json({ plan: await planSpread({ tenantId: auth.context.tenantId, userId: auth.context.userId, callbackIds: plan.data.callback_ids, days: plan.data.days, perHour: plan.data.per_hour }) });
    if (commit.success) return NextResponse.json({ result: await commitSpread({ tenantId: auth.context.tenantId, userId: auth.context.userId, items: commit.data.items.map((item) => ({ callbackId: item.callback_id, customerLocal: item.callback_local })), request }) });
    return NextResponse.json({ error: "Choose the callbacks to spread." }, { status: 400 });
  } catch (error) { return errorResponse(error); }
}

/**
 * Hand-over (Callbacks A, 2026-10-28): give callbacks to another agent, or put their leads in the shared
 * queue. Each callback must be one this session may change (AG-0.5), and in an agency the person they go
 * to must be in its scope too. One at a time through reassign_callback / release_callback_to_queue; the
 * answer says how many moved and why any did not.
 */
async function handOver(auth: Exclude<Awaited<ReturnType<typeof requireFeatureRole>>, NextResponse>, body: unknown) {
  const parsed = handOverSchema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: "Choose the callbacks and who they go to." }, { status: 400 });
  const { callback_ids: ids, to } = parsed.data;
  const scope = await scopeFor(auth.context);
  if (scope !== null) {
    const rows = await getSupabaseServiceClient().from("tenant_callbacks").select("id, assigned_to").eq("tenant_id", auth.context.tenantId).in("id", ids);
    if (rows.error) return NextResponse.json({ error: "The callbacks could not be checked. Try again." }, { status: 503 });
    const allowed = (rows.data ?? []).filter((row) => row.assigned_to === auth.context.userId || rowVisible(scope, row.assigned_to)).length;
    if (allowed !== ids.length) return NextResponse.json({ error: "Some of those callbacks were not found." }, { status: 404 });
    if (to !== "queue" && to !== auth.context.userId && !rowVisible(scope, to)) return NextResponse.json({ error: "That person was not found." }, { status: 404 });
  }
  let moved = 0;
  const failed: Array<{ callbackId: string; error: string }> = [];
  for (const callbackId of ids) {
    try {
      if (to === "queue") await releaseCallbackToQueue({ tenantId: auth.context.tenantId, userId: auth.context.userId, callbackId });
      else await reassignCallback({ tenantId: auth.context.tenantId, userId: auth.context.userId, callbackId, assigneeId: to });
      moved += 1;
    } catch (error) {
      const response = errorResponse(error);
      // The whole feature is missing: say so once rather than per callback.
      if (response.status === 503) return response;
      failed.push({ callbackId, error: ((await response.json()) as { error?: string }).error ?? "Could not be handed over" });
    }
  }
  return NextResponse.json({ result: { moved, failed } }, { status: moved === 0 && failed.length ? 409 : 200 });
}

export async function PATCH(request: Request) {
  const auth = await requireFeatureRole("callback_calendar", ["owner", "producer", "assistant"], { write: true });
  if (auth instanceof NextResponse) return auth;
  const raw = await request.json().catch(() => null) as { action?: unknown } | null;
  if (raw?.action === "spread_plan" || raw?.action === "spread_commit") return spread(request, auth, raw);
  if (raw?.action === "hand_over") return handOver(auth, raw);
  const parsed = bodySchema.safeParse(raw);
  if (!parsed.success) return NextResponse.json({ error: "Choose a valid callback action." }, { status: 400 });
  // AG-0.5: another producer's callback is "not found" before anything is checked or written.
  const hidden = await callbackHidden(auth.context.tenantId, auth.context.userId, await scopeFor(auth.context), parsed.data.callback_id);
  if (hidden) return hidden;
  let refusalContext: { leadId: string; timezone: string; local: string } | null = null;
  try {
    const params = { tenantId: auth.context.tenantId, userId: auth.context.userId, callbackId: parsed.data.callback_id, request };
    if (parsed.data.action === "reschedule") {
      // The same check the dialer and the outcome wizard make before writing a callback: a time
      // the dialer would refuse to place is refused now, while the agent can still pick another.
      if (!parsed.data.callback_local) return NextResponse.json({ error: "Choose a callback date and time." }, { status: 400 });
      const callback = await getSupabaseServiceClient().from("tenant_callbacks").select("lead_id, customer_timezone").eq("tenant_id", auth.context.tenantId).eq("id", parsed.data.callback_id).maybeSingle<{ lead_id: string; customer_timezone: string }>();
      if (callback.error) return NextResponse.json({ error: "The callback could not be checked. Try again." }, { status: 503 });
      if (!callback.data) return NextResponse.json({ error: "That callback was not found." }, { status: 404 });
      refusalContext = { leadId: callback.data.lead_id, timezone: callback.data.customer_timezone, local: parsed.data.callback_local };
      const window = await checkCallbackInCallingWindow({ tenantId: auth.context.tenantId, leadId: callback.data.lead_id, callbackLocal: parsed.data.callback_local, timezone: callback.data.customer_timezone, actorId: auth.context.userId });
      if (!window.ok) {
        // A refused time comes back with the next time the customer may be called, as a
        // suggestion the agent can take. Nothing is booked for them.
        const nearest = window.status === 422 ? await suggestion(auth.context.tenantId, refusalContext) : null;
        return NextResponse.json({ error: window.message, code: "outside_calling_window", nearest }, { status: window.status });
      }
    }
    const result = parsed.data.action === "reschedule" ? await rescheduleCallback({ ...params, local: parsed.data.callback_local }) : parsed.data.action === "cancel" ? await cancelCallback(params) : await completeCallback(params);
    return NextResponse.json({ result });
  } catch (error) {
    const response = errorResponse(error);
    if (response.status === 422 && refusalContext) {
      const body = await response.json();
      return NextResponse.json({ ...body, nearest: await suggestion(auth.context.tenantId, refusalContext) }, { status: 422 });
    }
    return response;
  }
}

/**
 * Add callback (owner 2026-10-28): a new callback for a lead, from the Callbacks page. The same checks
 * as every other booking path: the lead must be visible to this session, the customer's timezone is
 * derived (or chosen when the state spans zones, never guessed), and the time is checked against the
 * calling window before anything is written; a refused time comes back with the nearest legal one.
 * A lead that already has an open callback has it replaced (tenant_callbacks_replace_open_one).
 */
export async function POST(request: Request) {
  const auth = await requireFeatureRole("callback_calendar", ["owner", "producer", "assistant"], { write: true });
  if (auth instanceof NextResponse) return auth;
  const parsed = bookSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Choose a lead, a date and a time." }, { status: 400 });
  const hidden = await guardLead(auth.context, parsed.data.lead_id);
  if (hidden) return hidden;
  let refusalContext: { leadId: string; timezone: string; local: string } | null = null;
  try {
    const facts = await callbackBookingFacts(auth.context.tenantId, parsed.data.lead_id);
    if (!facts) return NextResponse.json({ error: "That lead could not be found." }, { status: 404 });
    const timezone = facts.timezone ?? parsed.data.timezone;
    if (!timezone) return NextResponse.json({ error: facts.timezoneProblem ?? "Choose the customer's timezone.", code: "customer_timezone_required" }, { status: 400 });
    refusalContext = { leadId: facts.leadId, timezone, local: parsed.data.callback_local };
    const window = await checkCallbackInCallingWindow({ tenantId: auth.context.tenantId, leadId: facts.leadId, callbackLocal: parsed.data.callback_local, timezone, actorId: auth.context.userId });
    if (!window.ok) {
      const nearest = window.status === 422 ? await suggestion(auth.context.tenantId, refusalContext) : null;
      return NextResponse.json({ error: window.message, code: "outside_calling_window", nearest }, { status: window.status });
    }
    const result = await bookCallback({ tenantId: auth.context.tenantId, userId: auth.context.userId, leadId: facts.leadId, local: parsed.data.callback_local, timezone, note: parsed.data.note || null, idempotencyKey: parsed.data.idempotency_key });
    return NextResponse.json({ result });
  } catch (error) {
    const response = errorResponse(error);
    if (response.status === 422 && refusalContext) {
      const body = await response.json();
      return NextResponse.json({ ...body, nearest: await suggestion(auth.context.tenantId, refusalContext) }, { status: 422 });
    }
    return response;
  }
}

function suggestion(tenantId: string, context: { leadId: string; timezone: string; local: string }) {
  const requested = zonedLocalToUtc(context.local, context.timezone);
  return nearestLegalTime({ tenantId, leadId: context.leadId, fromUtc: requested ? requested.toISOString() : null, timezone: context.timezone });
}
