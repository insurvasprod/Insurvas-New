import "server-only";

import { getSupabaseServiceClient } from "@/lib/supabase/service";
import { stateFromLeadValues, STATE_TIMEZONES } from "@/lib/callbacks/timezone";
import { canDialNow, localPartsIn } from "@/lib/callingWindow/engine";
import { recordCallbackRefused } from "@/lib/leadWorkspace/refusals";
import { zonedLocalToUtc } from "./callbackTime";

/**
 * "The time is validated against the customer's calling window before the disposition is written."
 *
 * A callback booked for 7am the customer's time, or on a Sunday in a state that forbids it, is a
 * callback the dialer will refuse to place when it comes due — so it is refused now, while the
 * agent can still pick another time, rather than silently missed then.
 *
 * The answer comes from `tenant_can_dial_now`, the function serve_next_lead enforces, asked about
 * the callback's instant instead of now: every layer (federal, state, holiday, agency, campaign)
 * with no second copy of the rules. The pure engine only explains a refusal in words.
 *
 * Called by both places a callback is written: the outcome wizard (completeDisposition) and the
 * dialer (recordCallbackDisposition).
 */
export type CallbackWindowResult = { ok: true } | { ok: false; status: 400 | 422 | 503; message: string };

export async function checkCallbackInCallingWindow(input: {
  tenantId: string;
  leadId: string;
  callbackLocal: string;
  timezone: string;
  /** Who asked for the time. When given, a refusal is kept on the lead's record (Callbacks tab). */
  actorId?: string | null;
}): Promise<CallbackWindowResult> {
  const supabase = getSupabaseServiceClient();
  const lead = await supabase.from("agent_leads").select("values, campaign_id").eq("tenant_id", input.tenantId).eq("id", input.leadId).maybeSingle();
  if (lead.error) return { ok: false, status: 503, message: "The customer's calling window could not be checked. Try again." };
  if (!lead.data) return { ok: false, status: 422, message: "That lead was not found." };

  const values = (lead.data.values && typeof lead.data.values === "object" && !Array.isArray(lead.data.values) ? lead.data.values : {}) as Record<string, unknown>;
  const state = stateFromLeadValues(values);
  if (!state) {
    return { ok: false, status: 422, message: "This lead has no state, so its calling window is unknown and a callback cannot be booked. Add the state to the lead first." };
  }

  const at = zonedLocalToUtc(input.callbackLocal, input.timezone);
  if (!at) return { ok: false, status: 400, message: "Choose a callback date and time." };

  // Cast: the generated types do not carry this function's timestamp parameter as optional. Bound:
  // rpc reads `this` (the client), and a bare reference throws "reading 'rest'" before any request.
  const rpc = supabase.rpc.bind(supabase) as unknown as (name: string, args: Record<string, unknown>) => PromiseLike<{ data: unknown; error: { message: string } | null }>;
  const allowed = await rpc("tenant_can_dial_now", {
    p_tenant_id: input.tenantId,
    p_state: state,
    p_campaign_id: (lead.data as { campaign_id?: string | null }).campaign_id ?? null,
    p_at: at.toISOString(),
  });
  // Fails closed, like every other calling-window read: an unknown answer is not permission.
  if (allowed.error) return { ok: false, status: 503, message: "The customer's calling window could not be checked, so the callback was not booked. Try again." };
  if (allowed.data === true) return { ok: true };

  const zone = STATE_TIMEZONES[state] ?? input.timezone;
  const { hour } = localPartsIn(at, zone);
  const refuse = async (message: string): Promise<CallbackWindowResult> => {
    if (input.actorId !== undefined) await recordCallbackRefused({ tenantId: input.tenantId, leadId: input.leadId, actorId: input.actorId, requestedLocal: input.callbackLocal, timezone: input.timezone, requestedAtUtc: at.toISOString(), message });
    return { ok: false, status: 422, message };
  };
  const pad = (n: number) => `${String(n).padStart(2, "0")}:00`;
  const federal = canDialNow({ state, at, timezones: STATE_TIMEZONES });
  if (!federal.allowed && federal.reason === "outside_window" && federal.window) {
    return refuse(`That callback time is outside the customer's calling window: it would be ${pad(hour)} for them, and calls are permitted between ${pad(federal.window.startHour)} and ${pad(federal.window.endHour)} their time. Choose another time.`);
  }
  if (!federal.allowed && federal.message) {
    return refuse(`That callback time is outside the customer's calling window. ${federal.message} Choose another time.`);
  }
  return refuse(
    `That callback time (${pad(hour)} for the customer, in ${state}) is outside when this lead may be called — the state's rules, your agency's calling window or the campaign's narrow it there. Choose another time.`,
  );
}
