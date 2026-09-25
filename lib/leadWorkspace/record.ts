import "server-only";

import { getWorkspaceTimezone } from "@/lib/agencyProfile/timezone";
import { DEFAULT_CADENCE, DEFAULT_CEILING } from "@/lib/cadence/engine";
import { humanInterval } from "@/lib/cadence/service";
import { callbackWindowFacts, type CallbackWindowFacts } from "@/lib/callbacks/windowFacts";
import { customerTimezone, stateFromLeadValues } from "@/lib/callbacks/timezone";
import { getCallingWindows } from "@/lib/callingWindow/service";
import { loadRecycleFacts, type RecycleFacts } from "@/lib/nurture/record";
import { getSupabaseServiceClient } from "@/lib/supabase/service";

/**
 * The lead's record tabs (p-lead-attempts, p-lead-callbacks, p-lead-nurture): every dial and who
 * placed it, every callback the customer asked for in their own time, and where the cadence puts
 * them next. Loaded when a tab opens, not with the page — a lead with forty attempts should not
 * make the lead page slower for the agent who only wanted its details.
 *
 * Refusals come from audit_log (lib/leadWorkspace/refusals.ts): a dial screening refused and a
 * callback time the picker refused never become rows of their own, so they are kept against the
 * lead there and merged in here. Refusals from before that recording existed are not recoverable.
 *
 * What the product does not measure is left out, not guessed: a call's length. Calls leave through
 * the agent's own phone (a `tel:` link), so nothing times them, and LA-2.9 forbids showing a
 * talk-time figure that is not one.
 */
export type RecordAttempt = { id: string; number: number | null; at: string; by: string; slot: string | null; screening: "passed" | "refused"; outcome: string | null; dialled: boolean };
export type RecordCallback = {
  id: string; scheduledAtUtc: string | null; requestedLocal: string | null; customerTimezone: string; status: string; bookedBy: string | null; completedAt: string | null; refusedBecause: string | null;
  /** What the customer asked for, in the agent's words. */
  note: string | null;
  /** 'call' when a contact on the call kept it, 'manual' when Mark done closed it (20260925708500). */
  completedVia: "call" | "manual" | null;
  /** Whether the customer's window closed on the due day with no kept call — kept after a rebook. */
  missed: boolean;
};
export type LadderRow = { attempt: number; delay: string; preferred: string | null };
export type RecordNurture = {
  leadState: string;
  attemptsMade: number;
  ceiling: number;
  nextDialAfter: string | null;
  nextPreferredSlot: string | null;
  recycleCount: number;
  enteredNurtureAt: string | null;
  openCallbackAt: string | null;
  cadenceSource: "campaign" | "agency" | "default";
  reactivations: Array<{ id: string; recycleNumber: number; status: string; screeningOutcome: string | null; reactivatedAt: string; completedAt: string | null }>;
  ladder: LadderRow[];
  /** Recycling facts (lib/nurture/record.ts): the pass's ceiling, its angle, why it is in nurture. */
  recycle: RecycleFacts;
};
export type LeadRecord = {
  attempts: RecordAttempt[];
  callbacks: RecordCallback[];
  zones: { customer: string; agent: string; state: string | null; window: CallbackWindowFacts | null };
  nurture: RecordNurture;
};

type Result = PromiseLike<{ data: unknown; error: { message: string } | null }>;
type Loose = { from(table: string): { select(columns: string): Chain } };
type Chain = Result & {
  eq(column: string, value: unknown): Chain;
  in(column: string, values: string[]): Chain;
  is(column: string, value: null): Chain;
  order(column: string, options: { ascending: boolean }): Chain;
  limit(count: number): Chain;
  maybeSingle(): Result;
};

// The scheduler's own fallback table (schedule_next_attempt, 20260924230300), for attempts no stored
// rule covers: attempt 1 is two hours after arrival, and past the sixth every gap is five days.
function defaultRule(attempt: number): { delay: string; preferred: string | null } {
  const row = DEFAULT_CADENCE.find((entry) => entry.attemptNumber === attempt);
  return row ? { delay: row.delayInterval, preferred: row.preferredSlot ?? null } : { delay: "5 days", preferred: null };
}

// The callbacks tab's read. The lifecycle columns arrive with 20260925708500; before it the same
// read runs without them (42703), and the tab shows what it did.
const CALLBACK_COLUMNS = "id, scheduled_at_utc, customer_timezone, status, created_by, completed_at, note";
async function leadCallbacks(db: Loose, tenantId: string, leadId: string): Promise<{ data: unknown; error: { message: string } | null }> {
  const read = (columns: string) => db.from("tenant_callbacks").select(columns).eq("tenant_id", tenantId).eq("lead_id", leadId).order("scheduled_at_utc", { ascending: false });
  const full = await read(`${CALLBACK_COLUMNS}, completed_via, missed_at`);
  if (full.error && /completed_via|missed_at|42703/.test(`${(full.error as { code?: string }).code ?? ""} ${full.error.message}`)) return read(CALLBACK_COLUMNS);
  return full;
}

export async function getLeadRecord(tenantId: string, leadId: string): Promise<LeadRecord> {
  const db = getSupabaseServiceClient() as unknown as Loose;
  const [lead, attempts, callbacks, reactivations, dispositions, refusals, workspaceZone] = await Promise.all([
    db.from("agent_leads").select("id, values, campaign_id, lead_state, attempts_made, next_dial_after, next_preferred_slot, recycle_count, nurture_entered_at").eq("tenant_id", tenantId).eq("id", leadId).maybeSingle(),
    db.from("tenant_call_attempts").select("id, attempt_number, attempted_at, slot, disposition, agent_id, dial_clicked_at").eq("tenant_id", tenantId).eq("lead_id", leadId).order("attempted_at", { ascending: false }),
    leadCallbacks(db, tenantId, leadId),
    db.from("tenant_nurture_reactivations").select("id, recycle_number, status, screening_outcome, reactivated_at, completed_at").eq("tenant_id", tenantId).eq("lead_id", leadId).order("recycle_number", { ascending: false }),
    db.from("dispositions").select("disposition_key, label").eq("tenant_id", tenantId),
    db.from("audit_log").select("id, action, actor_id, ts, metadata").eq("target_type", "lead").eq("target_id", leadId).in("action", ["tenant.dial_refused", "tenant.callback_refused"]).order("ts", { ascending: false }).limit(100),
    getWorkspaceTimezone(tenantId).catch(() => null),
  ]);
  if (lead.error) throw new Error(`Could not load the lead: ${lead.error.message}`);
  if (!lead.data) throw new Error("Lead not found");
  if (attempts.error) throw new Error(`Could not load attempts: ${attempts.error.message}`);
  if (callbacks.error) throw new Error(`Could not load callbacks: ${callbacks.error.message}`);

  type LeadRow = { values: Record<string, unknown> | null; campaign_id: string | null; lead_state: string | null; attempts_made: number | null; next_dial_after: string | null; next_preferred_slot: string | null; recycle_count: number | null; nurture_entered_at: string | null };
  type AttemptRow = { id: string; attempt_number: number; attempted_at: string; slot: string; disposition: string | null; agent_id: string | null; dial_clicked_at: string | null };
  type CallbackRow = { id: string; scheduled_at_utc: string; customer_timezone: string; status: string; created_by: string | null; completed_at: string | null; note?: string | null; completed_via?: string | null; missed_at?: string | null };
  type RefusalRow = { id: string; action: string; actor_id: string | null; ts: string; metadata: Record<string, unknown> | null };
  const leadRow = lead.data as LeadRow;
  const attemptRows = (attempts.data ?? []) as AttemptRow[];
  const callbackRows = (callbacks.data ?? []) as CallbackRow[];
  // The lead id is already this tenant's; the metadata check is a second lock on the same door.
  const refusalRows = ((refusals.error ? [] : refusals.data ?? []) as RefusalRow[]).filter((row) => row.metadata?.tenantId === tenantId);
  const str = (value: unknown) => (typeof value === "string" && value ? value : null);

  // The ladder the lead actually walks: a campaign with rules of its own replaces the agency's
  // entirely (never merged), and an attempt no rule covers falls to the scheduler's defaults.
  const scoped = (query: Chain) => query.is("disposition_scope", null).order("attempt_number", { ascending: true });
  const rulesQuery = (campaignId: string | null) => scoped(campaignId ? db.from("tenant_cadence_rules").select("attempt_number, delay_interval, preferred_slot").eq("tenant_id", tenantId).eq("campaign_id", campaignId) : db.from("tenant_cadence_rules").select("attempt_number, delay_interval, preferred_slot").eq("tenant_id", tenantId).is("campaign_id", null));
  type RuleRow = { attempt_number: number; delay_interval: string; preferred_slot: string | null };
  const campaignRules = leadRow.campaign_id ? await rulesQuery(leadRow.campaign_id) : { data: [], error: null };
  const campaignOwns = !campaignRules.error && ((campaignRules.data ?? []) as RuleRow[]).length > 0;
  const agencyRules = campaignOwns ? { data: [], error: null } : await rulesQuery(null);
  const rules = ((campaignOwns ? campaignRules.data : agencyRules.error ? [] : agencyRules.data) ?? []) as RuleRow[];
  const ruleFor = new Map(rules.map((row) => [row.attempt_number, row]));
  // A recycled lead's pass stops at its batch's ceiling (schedule_next_attempt, 20260925706600).
  const recycle = await loadRecycleFacts(tenantId, leadId, { leadState: leadRow.lead_state, nextDialAfter: leadRow.next_dial_after });
  const ceiling = recycle.attemptCeiling ?? DEFAULT_CEILING;
  const ladder: LadderRow[] = Array.from({ length: ceiling }, (_, index) => {
    const attempt = index + 1;
    const rule = ruleFor.get(attempt);
    return rule ? { attempt, delay: humanInterval(rule.delay_interval), preferred: rule.preferred_slot } : { attempt, ...defaultRule(attempt) };
  });

  const userIds = [...new Set([...attemptRows.map((row) => row.agent_id), ...callbackRows.map((row) => row.created_by), ...refusalRows.map((row) => row.actor_id)].filter((id): id is string => Boolean(id)))];
  const users = userIds.length ? await db.from("users").select("id, name").in("id", userIds) : { data: [], error: null };
  const nameOf = new Map(((users.error ? [] : users.data ?? []) as Array<{ id: string; name: string }>).map((row) => [row.id, row.name]));
  const labelOf = new Map(((dispositions.error ? [] : dispositions.data ?? []) as Array<{ disposition_key: string; label: string }>).map((row) => [row.disposition_key, row.label]));

  const values = leadRow.values ?? {};
  const state = stateFromLeadValues(values);
  let window: CallbackWindowFacts | null = null;
  if (state) {
    try {
      const settings = await getCallingWindows(tenantId);
      window = callbackWindowFacts(state, settings.federal, settings.stateRules, settings.tenant);
    } catch {
      window = null;
    }
  }
  const open = callbackRows.filter((row) => ["scheduled", "due"].includes(row.status) && Date.parse(row.scheduled_at_utc) > Date.now()).sort((a, b) => a.scheduled_at_utc.localeCompare(b.scheduled_at_utc))[0];

  // Every stored attempt passed screening: startDialAttempt runs the eligibility gate (state, phone,
  // licence, suppression, window, DNC) before the row exists, and a refusal never inserts one.
  const placed: RecordAttempt[] = attemptRows.map((row) => ({
    id: row.id,
    number: row.attempt_number,
    at: row.attempted_at,
    by: row.agent_id ? nameOf.get(row.agent_id) ?? "A teammate" : "Auto · cadence",
    slot: row.slot,
    screening: "passed",
    outcome: row.disposition ? labelOf.get(row.disposition) ?? row.disposition.replace(/_/g, " ") : null,
    dialled: Boolean(row.dial_clicked_at),
  }));
  const refusedDials: RecordAttempt[] = refusalRows.filter((row) => row.action === "tenant.dial_refused").map((row) => ({
    id: row.id,
    number: null,
    at: row.ts,
    by: row.actor_id ? nameOf.get(row.actor_id) ?? "A teammate" : "Auto · cadence",
    slot: null,
    screening: "refused",
    outcome: str(row.metadata?.message),
    dialled: false,
  }));
  const refusedCallbacks: RecordCallback[] = refusalRows.filter((row) => row.action === "tenant.callback_refused").map((row) => ({
    id: row.id,
    scheduledAtUtc: str(row.metadata?.requestedAtUtc),
    requestedLocal: str(row.metadata?.requestedLocal),
    customerTimezone: str(row.metadata?.timezone) ?? customerTimezone(values),
    status: "refused",
    bookedBy: row.actor_id ? nameOf.get(row.actor_id) ?? null : null,
    completedAt: null,
    refusedBecause: str(row.metadata?.message),
    note: null,
    completedVia: null,
    missed: false,
  }));
  const byTimeDesc = <T,>(at: (row: T) => string | null) => (a: T, b: T) => (at(b) ?? "").localeCompare(at(a) ?? "");

  return {
    attempts: [...placed, ...refusedDials].sort(byTimeDesc((row) => row.at)),
    callbacks: [
      ...callbackRows.map((row) => ({ id: row.id, scheduledAtUtc: row.scheduled_at_utc, requestedLocal: null, customerTimezone: row.customer_timezone, status: row.status, bookedBy: row.created_by ? nameOf.get(row.created_by) ?? null : null, completedAt: row.completed_at, refusedBecause: null, note: row.note ?? null, completedVia: (row.completed_via === "call" || row.completed_via === "manual" ? row.completed_via : null) as RecordCallback["completedVia"], missed: row.status === "missed" || (row.status !== "completed" && Boolean(row.missed_at)) })),
      ...refusedCallbacks,
    ].sort(byTimeDesc((row) => row.scheduledAtUtc)),
    zones: {
      customer: callbackRows[0]?.customer_timezone ?? customerTimezone(values),
      agent: workspaceZone ?? "UTC",
      state,
      window,
    },
    nurture: {
      leadState: leadRow.lead_state ?? "fresh",
      attemptsMade: leadRow.attempts_made ?? attemptRows.length,
      ceiling,
      nextDialAfter: leadRow.next_dial_after,
      nextPreferredSlot: leadRow.next_preferred_slot,
      recycleCount: leadRow.recycle_count ?? 0,
      enteredNurtureAt: leadRow.nurture_entered_at,
      openCallbackAt: open?.scheduled_at_utc ?? null,
      cadenceSource: campaignOwns ? "campaign" : rules.length ? "agency" : "default",
      reactivations: (reactivations.error ? [] : (reactivations.data ?? []) as Array<{ id: string; recycle_number: number; status: string; screening_outcome: string | null; reactivated_at: string; completed_at: string | null }>).map((row) => ({ id: row.id, recycleNumber: row.recycle_number, status: row.status, screeningOutcome: row.screening_outcome, reactivatedAt: row.reactivated_at, completedAt: row.completed_at })),
      ladder,
      recycle,
    },
  };
}
