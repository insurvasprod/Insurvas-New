import { NextResponse } from "next/server";
import { z } from "zod";
import { requireFeatureRole } from "@/lib/tenantAuth/requireFeatureRole";
import { agentTimezones, cancelCallback, completeCallback, listCallbacks, rescheduleCallback } from "@/lib/callbacks/service";
import { callbackWindowFacts, type CallbackWindowFacts } from "@/lib/callbacks/windowFacts";
import { nearestLegalTime } from "@/lib/callbacks/nearest";
import { recentCallbackRefusals } from "@/lib/callbacks/refusals";
import { getCallingWindows } from "@/lib/callingWindow/service";
import { checkCallbackInCallingWindow } from "@/lib/dispositions/callbackWindow";
import { zonedLocalToUtc } from "@/lib/dispositions/callbackTime";
import { getSupabaseServiceClient } from "@/lib/supabase/service";
import { getWorkspaceTimezone } from "@/lib/agencyProfile/timezone";

const uuid = z.string().uuid();
const querySchema = z.object({
  from: z.string().datetime().optional(),
  to: z.string().datetime().optional(),
  callback_id: uuid.optional(),
  include_history: z.enum(["true", "false"]).optional().transform((value) => value === "true"),
  /** With callback_id: the nearest legal time at or after this customer-local time, as a suggestion. */
  suggest_local: z.string().regex(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/).optional(),
});
const bodySchema = z.object({ action: z.enum(["reschedule", "cancel", "complete"]), callback_id: uuid, callback_local: z.string().regex(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/).optional() }).strict();

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
async function windowsFor(tenantId: string, states: string[]): Promise<Record<string, CallbackWindowFacts>> {
  if (!states.length) return {};
  try {
    const settings = await getCallingWindows(tenantId);
    return Object.fromEntries(states.map((state) => [state, callbackWindowFacts(state, settings.federal, settings.stateRules, settings.tenant)]));
  } catch {
    return {};
  }
}

export async function GET(request: Request) {
  const auth = await requireFeatureRole("callback_calendar", ["owner", "producer", "assistant"]);
  if (auth instanceof NextResponse) return auth;
  const params = Object.fromEntries(new URL(request.url).searchParams.entries());
  const parsed = querySchema.safeParse(params);
  if (!parsed.success) return NextResponse.json({ error: "Choose a valid callback date range." }, { status: 400 });
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
    const callbacks = await listCallbacks(auth.context.tenantId, {
      from: parsed.data.from,
      to: parsed.data.to,
      callbackId: parsed.data.callback_id,
      includeHistory: parsed.data.include_history,
    });
    const states = [...new Set(callbacks.map((callback) => callback.state).filter((state): state is string => Boolean(state)))];
    // A single-callback read (History) needs none of the page's context.
    const pageRead = !parsed.data.callback_id;
    const [windows, agencyTimezone, refusals, ownZone] = await Promise.all([
      windowsFor(auth.context.tenantId, states),
      getWorkspaceTimezone(auth.context.tenantId).catch(() => null),
      pageRead ? recentCallbackRefusals(auth.context.tenantId).catch(() => []) : Promise.resolve([]),
      agentTimezones(auth.context.tenantId, auth.context.userId),
    ]);
    // LA-1.22: the customer's time "with the agent's shown alongside" — the agent's OWN zone, the one
    // saved with their working hours, not the agency's (an agent licensed in 14 states is routinely
    // hours from both). With none saved, the page keeps the browser's zone; agencyTimezone stays in
    // the response for callers that want the agency's clock.
    // The viewer decides the Mine/All default (non-owners start on Mine) and the owner-only source rates.
    const viewerTimezone = ownZone.get(auth.context.userId) ?? null;
    return NextResponse.json({ callbacks, windows, agencyTimezone, viewerTimezone, refusals, viewer: { userId: auth.context.userId, role: auth.context.role } });
  }
  catch (error) { return errorResponse(error); }
}

export async function PATCH(request: Request) {
  const auth = await requireFeatureRole("callback_calendar", ["owner", "producer", "assistant"], { write: true });
  if (auth instanceof NextResponse) return auth;
  const parsed = bodySchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Choose a valid callback action." }, { status: 400 });
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

function suggestion(tenantId: string, context: { leadId: string; timezone: string; local: string }) {
  const requested = zonedLocalToUtc(context.local, context.timezone);
  return nearestLegalTime({ tenantId, leadId: context.leadId, fromUtc: requested ? requested.toISOString() : null, timezone: context.timezone });
}
