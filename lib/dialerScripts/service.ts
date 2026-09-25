import "server-only";

import { getSupabaseServiceClient } from "@/lib/supabase/service";
import { customerName, formatInTimezone, stateFromLeadValues, STATE_TIMEZONES } from "@/lib/callbacks/timezone";
import { productLineLabel } from "@/lib/format/productLine";
import { pickRefusalMessage, returnWindowLine, suppressionRefusal, type ReturnWindow } from "./display";
import { getDncDialingStatus, performDncDialPreflight } from "@/lib/compliance/service";
import { normalizeDialPhone } from "@/lib/compliance/scrub";
import { getCallingWindows, staleRulesReason } from "@/lib/callingWindow/service";
import { callbackWindowFacts, type CallbackWindowFacts } from "@/lib/callbacks/windowFacts";
import { getWorkspaceTimezone } from "@/lib/agencyProfile/timezone";
import { lastDays, NOT_A_CONTACT } from "@/lib/dashboard/todayMath";
import { recordDialRefused } from "@/lib/leadWorkspace/refusals";
import { isPendingSchema, SchemaPendingError } from "@/lib/appointments/pendingSchema";
import { decideDialLicence, leadStateBeforeServe, type LicenceDecision } from "./licence";
import { checkCallbackInCallingWindow } from "@/lib/dispositions/callbackWindow";

type Row = Record<string, unknown>;
type Result<T> = { data: T; error: { message: string; code?: string } | null };
type Query = PromiseLike<Result<unknown>> & {
  select(columns: string, options?: unknown): Query;
  eq(column: string, value: unknown): Query;
  lte(column: string, value: unknown): Query;
  gte(column: string, value: unknown): Query;
  not(column: string, operator: string, value: unknown): Query;
  is(column: string, value: null): Query;
  order(column: string, options?: { ascending?: boolean }): Query;
  limit(value: number): Query;
  maybeSingle<T = unknown>(): Promise<Result<T | null>>;
  single<T = unknown>(): Promise<Result<T>>;
  insert(value: unknown): Query;
  update(value: unknown): Query;
  upsert(value: unknown, options?: unknown): Query;
};
type Db = { from(table: string): Query; rpc(name: string, args: Record<string, unknown>): Promise<Result<unknown>> };

export type DialerEligibility = {
  allowed: boolean;
  // "list_suppressed" (20260925700200): a stored scrub hit — litigator, federal or state DNC, invalid.
  reason: "ready" | "no_state" | "invalid_phone" | "not_licensed" | "internal_suppressed" | "list_suppressed" | "outside_window" | "dnc_unavailable" | "policy_unavailable";
  message: string;
  checkedAt: string;
  timezone: string | null;
  customerLocalTime: string | null;
  /**
   * Whether a DNC VENDOR is configured and answering — not whether this number was looked up. The
   * number is looked up only at the click (markDialClicked), and that result is logged in
   * tenant_dial_dnc_checks. "clear" here used to be rendered as "DNC status: clear", which claimed a
   * lookup that had not happened.
   */
  dncCheck: "pending" | "clear" | "suppressed" | "unavailable";
  /** The agency's own suppression list, checked for this number on every read — its own result. */
  suppression: "clear" | "suppressed" | "unavailable" | "not_checked";
  /**
   * Every stored list this number is on (tenant_phone_suppression_hits, 20260925700200): the
   * agency's own list plus the litigator, federal and state DNC scrub hits. Null when the lists
   * could not be read one by one — before that migration only the agency's list is known.
   */
  suppressionHits?: Array<{ listType: string; reason: string; addedAt: string | null }> | null;
  /** The licence the dial is judged on, for the card's Licence row. Null when it was never reached. */
  licence?: { status: "live" | "refused" | "unavailable"; state: string; expiresAt: string | null; message: string | null } | null;
};

export class DialGateError extends Error {
  constructor(public readonly code: DialerEligibility["reason"], public readonly status: number, message: string) {
    super(message);
    this.name = "DialGateError";
  }
}

export class DialerWorkflowError extends Error {
  constructor(public readonly status: number, message: string) {
    super(message);
    this.name = "DialerWorkflowError";
  }
}

const DEFAULT_SECTIONS = {
  opening: "Hi {{first_name}}, this is a licensed insurance agent calling about options available in {{state}}.",
  qualifying_questions: "What would you like your coverage to do for your family? What amount of protection are you considering?",
  transition_to_quote: "Thank you. Based on what you shared, I can walk through a quote that fits your priorities.",
  close: "Would you like to review the next step together now?",
};

const DEFAULT_REBUTTALS = [
  ["too_expensive", "Too expensive", "I understand. We can look at a smaller amount of coverage and compare the monthly cost before you decide."],
  ["already_covered", "Already covered", "That is good to hear. Many people still compare whether the existing coverage fits today's needs; may I ask what you currently have?"],
  ["send_me_something", "Send me something", "Absolutely. A quick question first helps me send something relevant rather than a generic quote: what coverage amount are you considering?"],
  ["not_interested", "Not interested", "Understood. Is that because the timing is not right, or because you already have the protection you want?"],
  ["call_me_later", "Call me later", "Of course. What day and time works best in your local time? I will record that callback request."],
  ["how_did_you_get_my_number", "How did you get my number", "Your contact information came with the lead submission for this insurance inquiry. I can also stop the call if you would prefer not to be contacted."],
] as const;

function text(value: unknown) { return typeof value === "string" ? value : ""; }
function numberOrNull(value: unknown) { const n = typeof value === "number" ? value : typeof value === "string" && value.trim() ? Number(value) : NaN; return Number.isFinite(n) ? n : null; }

function ageFrom(value: unknown) {
  if (typeof value === "number" && Number.isFinite(value)) return String(Math.floor(value));
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return "";
  const birth = new Date(`${value}T00:00:00Z`);
  const now = new Date();
  let age = now.getUTCFullYear() - birth.getUTCFullYear();
  if (now.getUTCMonth() < birth.getUTCMonth() || (now.getUTCMonth() === birth.getUTCMonth() && now.getUTCDate() < birth.getUTCDate())) age -= 1;
  return age >= 0 ? String(age) : "";
}

function resolve(value: unknown, variables: Record<string, string>): unknown {
  if (typeof value === "string") return value.replace(/\{\{\s*([a-zA-Z0-9_.]+)\s*\}\}/g, (_, key: string) => variables[key] ?? "");
  if (Array.isArray(value)) return value.map((item) => resolve(item, variables));
  if (value && typeof value === "object") return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, resolve(item, variables)]));
  return value;
}

/**
 * The plain-language reason the queue chose this lead, or null when there genuinely is not one yet.
 *
 * A missing relation is tolerated because the dialer panel is compliance-gated and has to open even
 * on a snapshot where LA-2.13 has not been applied. Every other failure is raised: the previous
 * version treated *any* error as "no explanation available", which is exactly how a query against
 * the wrong table went unnoticed for a whole module.
 */
function selectionReason(result: { data?: Row | null; error: { code?: string; message: string } | null }) {
  if (result.error) {
    const missingRelation = result.error.code === "PGRST205" || /Could not find the table/i.test(result.error.message);
    if (!missingRelation) throw new Error(`Could not load the selection reason: ${result.error.message}`);
    return null;
  }
  return text(result.data?.selection_reason) || null;
}

/** `{{consent_date}}` as a script reads it aloud: "12 September". */
function consentDay(value: string | null) {
  const at = new Date(String(value ?? ""));
  if (Number.isNaN(at.getTime())) return "";
  return new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "long", timeZone: "UTC" }).format(at);
}

function mapRebuttals(rows: Row[]) {
  return rows.map((row) => ({ id: text(row.id), objectionKey: text(row.objection_key), label: text(row.label), body: text(row.body), sortOrder: Number(row.sort_order ?? 0) })).sort((a, b) => a.sortOrder - b.sortOrder);
}

function leadPhone(values: Row) {
  return text(values.phone ?? values.phone_number);
}

function localTime(now: string, values: Row) {
  const state = stateFromLeadValues(values);
  const timezone = state ? STATE_TIMEZONES[state] ?? null : null;
  return { state, timezone, customerLocalTime: timezone ? formatInTimezone(now, timezone) : null };
}

type LicenceContext = { role: string | null; agencyLicences: Array<{ state: string; expires_at: string | null }>; agentStates: string[] | null };

/**
 * What decideDialLicence needs about one agent: their role, the agency's licences and their own
 * licensed states. The per-agent table arrives with migration 20260924110000; until then
 * `agentStates` is null and the agent is judged on the agency's licences, which the refusal says.
 * A read that fails for any other reason throws — the dialer refuses rather than guessing.
 */
async function loadLicenceContext(db: Db, tenantId: string, agentId: string): Promise<LicenceContext> {
  const agentStatesRead = async () => {
    // 20260925702000: an agent's own licence in a state can lapse (expires_on). An expired row is not
    // held — agent_may_work_state already reads it that way (expires_on >= current_date, a UTC date,
    // the same "today" licenceFor uses). Before that migration the column is absent (42703) and the
    // states are read without it, as before.
    const withExpiry = await db.from("tenant_user_licensed_states").select("state, expires_on").eq("tenant_id", tenantId).eq("user_id", agentId);
    if (!withExpiry.error || !isPendingSchema(withExpiry.error)) return withExpiry;
    return db.from("tenant_user_licensed_states").select("state").eq("tenant_id", tenantId).eq("user_id", agentId);
  };
  const [member, licences, states] = await Promise.all([
    db.from("tenant_users").select("role").eq("tenant_id", tenantId).eq("user_id", agentId).maybeSingle<Row>(),
    db.from("licenses").select("state, expires_at").eq("tenant_id", tenantId),
    agentStatesRead(),
  ]);
  if (member.error) throw new DialerWorkflowError(503, `Could not verify your role for the licence check: ${member.error.message}`);
  if (licences.error) throw new DialerWorkflowError(503, `Could not read the agency's licences: ${licences.error.message}`);
  if (states.error && !isPendingSchema(states.error)) throw new DialerWorkflowError(503, `Could not read your licensed states: ${states.error.message}`);
  const today = new Date().toISOString().slice(0, 10);
  return {
    role: text(member.data?.role) || null,
    agencyLicences: (Array.isArray(licences.data) ? (licences.data as Row[]) : []).map((row) => ({ state: text(row.state), expires_at: text(row.expires_at) || null })),
    agentStates: states.error
      ? null
      : (Array.isArray(states.data) ? (states.data as Row[]) : [])
          .filter((row) => !text(row.expires_on) || text(row.expires_on).slice(0, 10) >= today)
          .map((row) => text(row.state)),
  };
}

function licenceFor(context: LicenceContext, state: string | null): LicenceDecision {
  return decideDialLicence({ ...context, state, today: new Date().toISOString().slice(0, 10) });
}

/**
 * Read-only explanation for the dialer and the server-side preflight used before an attempt is
 * prepared. The final click still performs a fresh provider DNC lookup; this function must never
 * turn a cached/diagnostic result into permission to dial.
 */
async function getDialerEligibility(db: Db, tenantId: string, values: Row, campaignId: string | null, agentId?: string): Promise<DialerEligibility> {
  const checkedAt = new Date().toISOString();
  const { state, timezone, customerLocalTime } = localTime(checkedAt, values);
  const phone = leadPhone(values);
  let normalizedPhone: string | null = null;
  try {
    normalizedPhone = normalizeDialPhone(phone);
  } catch {
    normalizedPhone = null;
  }
  // The stored lists are read for their own sake, so the panel can report them even when an earlier
  // gate (no state, the window, the licence) is what refuses the dial. It used to say "Checked"
  // whenever the reason was anything else, including when the check had never run.
  //
  // 20260925700200: every stored list, not only the agency's own — the litigator, federal and state
  // DNC scrub hits too, one row per list (user decision 2026-09-25). Before that migration the
  // agency's list is read alone, as it always was, and `suppressionHits` is null.
  const suppressedRead = normalizedPhone ? readSuppressionHits(db, tenantId, normalizedPhone) : null;
  let suppression: DialerEligibility["suppression"] = "not_checked";
  let suppressionHits: DialerEligibility["suppressionHits"] = null;
  let licenceView: DialerEligibility["licence"] = null;
  const blocked = (reason: DialerEligibility["reason"], message: string, dncCheck: DialerEligibility["dncCheck"] = "pending"): DialerEligibility => ({
    allowed: false, reason, message, checkedAt, timezone, customerLocalTime, dncCheck, suppression, suppressionHits, licence: licenceView,
  });

  if (!state) {
    if (suppressedRead) {
      const own = await suppressedRead;
      suppression = own.internal;
      suppressionHits = own.hits;
    }
    return blocked("no_state", "Dialing is blocked because this lead has no state and its local calling time cannot be determined.");
  }
  if (!normalizedPhone || !suppressedRead) {
    return blocked("invalid_phone", "Dialing is blocked because this lead does not have a valid phone number.");
  }

  // The three reads are independent and side-effect free, so they are fetched together; the
  // decisions below still run in the original order, so the first blocking reason is unchanged.
  const [licence, window, suppressed, dncResult] = await Promise.all([
    // "Refused by the dialer": the agent must be licensed in the lead's state (Settings › States &
    // licences, and their own states on Team & access). Only known for a named agent.
    agentId
      ? loadLicenceContext(db, tenantId, agentId).then(
          (context) => ({ ...licenceFor(context, state), expiresAt: context.agencyLicences.find((row) => row.state.toUpperCase() === state)?.expires_at ?? null }),
          (error: unknown) => ({ unavailable: error instanceof Error ? error.message : "The licence check could not be completed." }),
        )
      : null,
    db.rpc("tenant_can_dial_now", {
      p_tenant_id: tenantId,
      p_state: state,
      p_campaign_id: campaignId,
      p_at: checkedAt,
    }),
    suppressedRead,
    // Settled here so a DNC failure is evaluated in its own turn below, never short-circuiting the earlier checks.
    getDncDialingStatus().then((status) => ({ ok: true as const, status }), () => ({ ok: false as const })),
  ]);
  suppression = suppressed.internal;
  suppressionHits = suppressed.hits;
  if (licence) {
    licenceView = "unavailable" in licence
      ? { status: "unavailable", state, expiresAt: null, message: licence.unavailable }
      : { status: licence.allowed ? "live" : "refused", state, expiresAt: licence.expiresAt, message: licence.allowed ? null : licence.message };
  }
  if (licence && "unavailable" in licence) return blocked("policy_unavailable", `Dialing is blocked because the licence check could not be completed. ${licence.unavailable}`);
  if (licence && !licence.allowed) return blocked("not_licensed", licence.message);
  if (window.error) return blocked("policy_unavailable", "Dialing is blocked because the calling-window policy could not be verified.");
  if (window.data !== true) {
    // 20260924230100: a stale state-rules feed refuses every dial. Say that, not "outside the window".
    const stale = await staleRulesReason().catch(() => null);
    if (stale) return blocked("policy_unavailable", stale);
    return blocked("outside_window", `Dialing is blocked by the server calling-window policy. Customer local time: ${customerLocalTime ?? "unknown"}.`);
  }

  if (suppressed.internal === "unavailable") return blocked("policy_unavailable", "Dialing is blocked because the tenant suppression policy could not be verified.");
  // A stored scrub hit refuses the dial with the list named — the litigator list first.
  const scrubHits = (suppressionHits ?? []).filter((hit) => hit.listType !== "internal");
  if (scrubHits.length) return blocked("list_suppressed", suppressionRefusal(scrubHits.map((hit) => hit.listType)), "suppressed");
  if (suppressed.internal === "suppressed") return blocked("internal_suppressed", "Dialing is blocked because this number is on the tenant do-not-call list.", "suppressed");

  if (!dncResult.ok) return blocked("dnc_unavailable", "Dialing is blocked because DNC availability could not be verified.", "unavailable");
  if (dncResult.status.blocked) return blocked("dnc_unavailable", dncResult.status.reason ?? "Dialing is blocked until an enabled DNC vendor is available.", "unavailable");

  return {
    allowed: true,
    reason: "ready",
    message: "The calling window and tenant suppression checks passed. A fresh DNC lookup is required immediately before dialing.",
    checkedAt,
    timezone,
    customerLocalTime,
    dncCheck: "clear",
    suppression,
    suppressionHits,
    licence: licenceView,
  };
}

type SuppressionRead = { internal: "clear" | "suppressed" | "unavailable"; hits: DialerEligibility["suppressionHits"] };

/**
 * One row per stored list the number is on (tenant_phone_suppression_hits, 20260925700200). Before
 * that migration: the agency's own list alone, through is_tenant_phone_suppressed, exactly as the
 * dial read it before, with `hits` null so the panel says the other lists were not read here.
 */
async function readSuppressionHits(db: Db, tenantId: string, normalizedPhone: string): Promise<SuppressionRead> {
  const hits = await db.rpc("tenant_phone_suppression_hits", { p_tenant_id: tenantId, p_phone: normalizedPhone });
  if (!hits.error) {
    const rows = (Array.isArray(hits.data) ? hits.data : []) as Row[];
    const view = rows.map((row) => ({ listType: text(row.list_type), reason: text(row.reason), addedAt: text(row.added_at) || null }));
    return { internal: view.some((hit) => hit.listType === "internal") ? "suppressed" : "clear", hits: view };
  }
  if (!isPendingSchema(hits.error)) return { internal: "unavailable", hits: null };
  const own = await db.rpc("is_tenant_phone_suppressed", { p_tenant_id: tenantId, p_phone_digits: normalizedPhone });
  return { internal: own.error ? "unavailable" : own.data === true ? "suppressed" : "clear", hits: null };
}

function consentView(row: Row | null) {
  if (!row) return { available: true, hasCertificate: false, provider: null, status: null, capturedAt: null, consentTimestamp: null, ageDays: null };
  const capturedAt = text(row.captured_at) || null;
  const consentTimestamp = text(row.consent_timestamp) || capturedAt;
  const timestamp = Date.parse(consentTimestamp ?? "");
  const ageDays = Number.isFinite(timestamp) ? Math.max(0, Math.floor((Date.now() - timestamp) / 86_400_000)) : null;
  return {
    available: true,
    hasCertificate: Boolean(row.certificate_id || row.certificate_url),
    provider: text(row.provider) || null,
    status: text(row.capture_status) || null,
    capturedAt,
    consentTimestamp,
    ageDays,
  };
}

/**
 * The campaign row the card reads. Cost per record (LA-2.1, generated columns) and the scrub date
 * (LA-2.3) are asked for first; a database without them falls back to the name / vendor / lead
 * type the card always showed rather than losing the campaign altogether.
 */
async function readPanelCampaign(db: Db, tenantId: string, campaignId: string): Promise<Row | null> {
  const full = await db.from("tenant_campaigns").select("name, lead_type, cost_per_record_cents, effective_cost_per_record_cents, scrub_status, scrubbed_at, vendor:tenant_lead_vendors(name)").eq("tenant_id", tenantId).eq("id", campaignId).maybeSingle<Row>();
  if (!full.error) return full.data;
  if (!isPendingSchema(full.error)) return null;
  const plain = await db.from("tenant_campaigns").select("name, lead_type, vendor:tenant_lead_vendors(name)").eq("tenant_id", tenantId).eq("id", campaignId).maybeSingle<Row>();
  return plain.error ? null : plain.data;
}

/**
 * The lead row the panel reads. `attempt_ceiling` (20260925706500, a recycle batch's per-lead
 * ceiling) is asked for first; before that migration (42703) the row is read without it and the
 * default ceiling applies.
 */
async function readPanelLead(db: Db, tenantId: string, leadId: string): Promise<Result<Row | null>> {
  const columns = "id, values, campaign_id, product_line, attempts_made, lead_state, next_dial_after, next_preferred_slot";
  const withCeiling = await db.from("agent_leads").select(`${columns}, attempt_ceiling`).eq("tenant_id", tenantId).eq("id", leadId).maybeSingle<Row>();
  if (!withCeiling.error || !isPendingSchema(withCeiling.error)) return withCeiling;
  return db.from("agent_leads").select(columns).eq("tenant_id", tenantId).eq("id", leadId).maybeSingle<Row>();
}

export type RecycleContext = { angle: string; script: string | null; attemptCeiling: number | null; recycledAt: string | null };

/**
 * The recycle pass this lead is on (lead_recycle_context, 20260925706500): its angle and optional
 * script, only while that pass is `current`. Null before the migration (42883), when the lead was
 * never recycled, or when the read fails — the card simply shows nothing.
 */
async function readRecycleContext(db: Db, tenantId: string, leadId: string): Promise<RecycleContext | null> {
  const result = await db.rpc("lead_recycle_context", { p_tenant_id: tenantId, p_lead_id: leadId });
  if (result.error) {
    if (!isPendingSchema(result.error)) console.error(`[dialer] lead_recycle_context failed: ${result.error.message}`);
    return null;
  }
  const row = (result.data && typeof result.data === "object" && !Array.isArray(result.data) ? result.data : null) as Row | null;
  if (!row || row.current !== true || !text(row.angle)) return null;
  return { angle: text(row.angle), script: text(row.script) || null, attemptCeiling: numberOrNull(row.attempt_ceiling), recycledAt: text(row.recycled_at) || null };
}

/** lead_return_window (20260925700100), or null before it exists or when the read fails. */
async function readReturnWindow(db: Db, tenantId: string, leadId: string): Promise<ReturnWindow | null> {
  const result = await db.rpc("lead_return_window", { p_tenant_id: tenantId, p_lead_id: leadId });
  if (result.error) {
    if (!isPendingSchema(result.error)) console.error(`[dialer] lead_return_window failed: ${result.error.message}`);
    return null;
  }
  const row = ((Array.isArray(result.data) ? result.data[0] : result.data) ?? null) as Row | null;
  if (!row) return null;
  const days = row.days_remaining === null || row.days_remaining === undefined ? null : Number(row.days_remaining);
  return { vendorName: text(row.vendor_name) || null, campaignName: text(row.campaign_name) || null, daysRemaining: days, claimableUntil: text(row.claimable_until) || null, claimable: row.claimable === true, reason: text(row.reason) || null };
}

/** The published calling-window layers for the lead's state (the Callbacks page's facts). Advisory. */
async function readCallbackWindow(tenantId: string, state: string): Promise<CallbackWindowFacts | null> {
  if (!state) return null;
  try {
    const settings = await getCallingWindows(tenantId);
    return callbackWindowFacts(state, settings.federal, settings.stateRules, settings.tenant);
  } catch {
    return null;
  }
}

export async function getDialerPanel(input: { tenantId: string; agentId?: string; leadId: string; campaignId?: string | null; productCode?: string | null; includeCost?: boolean }) {
  const db = getSupabaseServiceClient() as unknown as Db;
  let queueQuery = db.from("lead_queue").select("id, status, claimed_by").eq("tenant_id", input.tenantId).eq("lead_id", input.leadId).eq("status", "claimed").order("claimed_at", { ascending: false }).limit(1);
  if (input.agentId) queueQuery = queueQuery.eq("claimed_by", input.agentId);
  // Round 1: the lead plus every read keyed only by tenant/lead id. Errors are still raised below in
  // the original order (lead, script, disclosure, rebuttals, consent, history, assignment).
  const [leadResult, rebuttals, consentResult, attemptsResult, queueResult, selectionResult] = await Promise.all([
    readPanelLead(db, input.tenantId, input.leadId),
    db.from("tenant_rebuttals").select("id, objection_key, label, body, sort_order").eq("tenant_id", input.tenantId).eq("is_active", true).order("sort_order"),
    db.from("tenant_consent_artefacts").select("provider, certificate_id, certificate_url, captured_at, consent_timestamp, capture_status").eq("tenant_id", input.tenantId).eq("lead_id", input.leadId).order("captured_at", { ascending: false }).limit(1).maybeSingle<Row>(),
    db.from("tenant_call_attempts").select("id, attempt_number, attempted_at, slot, disposition, dial_clicked_at, disclosure_confirmed_at").eq("tenant_id", input.tenantId).eq("lead_id", input.leadId).order("attempt_number", { ascending: false }).limit(20),
    queueQuery.maybeSingle<Row>(),
    // LA-2.13 criterion 1: "every served lead carries the reason it was chosen, in plain language".
    //
    // This read named `outbound_scoring_decisions` — the LEGACY CRM's table, on the organizations
    // plane. It is keyed by `organization_id` and `prospect_id`; it has no `tenant_id` and no
    // `lead_id`, so both filters below referenced columns that do not exist and the query failed on
    // every call. The failure was then swallowed into `null` and rendered as "No selection
    // explanation is available for this lead", so the "Why this lead?" card was permanently empty
    // and looked like a lead that simply had no explanation.
    //
    // The table this product writes is `tenant_scoring_decisions`, written inside `serve_next_lead`.
    db.from("tenant_scoring_decisions").select("selection_reason, served_at").eq("tenant_id", input.tenantId).eq("lead_id", input.leadId).order("served_at", { ascending: false }).limit(1).maybeSingle<Row>(),
  ]);
  // Round 1b: display context, every read tolerant — a missing name or log must not close the
  // compliance panel. The agent's and agency's names feed the script variables; the DNC log is the
  // last number lookup actually made for this lead (migration 20260924323200).
  const [agentResult, tenantResult, agencyResult, dncLogResult] = await Promise.all([
    input.agentId ? db.from("users").select("name").eq("id", input.agentId).maybeSingle<Row>() : null,
    db.from("tenants").select("name").eq("id", input.tenantId).maybeSingle<Row>(),
    db.from("agency_profiles").select("legal_name, dba").eq("tenant_id", input.tenantId).maybeSingle<Row>(),
    db.from("tenant_dial_dnc_checks").select("result, checked_at").eq("tenant_id", input.tenantId).eq("lead_id", input.leadId).order("checked_at", { ascending: false }).limit(1).maybeSingle<Row>(),
  ]);
  if (leadResult.error) throw new Error(`Could not load lead: ${leadResult.error.message}`);
  if (!leadResult.data) throw new Error("Lead not found");
  const values = (leadResult.data.values && typeof leadResult.data.values === "object" ? leadResult.data.values : {}) as Row;
  const campaignId = (input.campaignId ?? text(leadResult.data.campaign_id)) || null;
  const productCode = (input.productCode ?? text(leadResult.data.product_line)) || "term_life";
  const state = text(values.state).toUpperCase();

  // Round 2: everything that needs the lead. The default script is fetched alongside the campaign
  // one rather than after it; it is only used (and its error only raised) when the campaign has none.
  const [campaignScript, defaultScript, disclosure, eligibility, campaign, windowResult, returnWindow, callbackWindow, recycle] = await Promise.all([
    campaignId
      ? db.from("tenant_scripts").select("id, campaign_id, product_code, version, sections").eq("tenant_id", input.tenantId).eq("campaign_id", campaignId).eq("product_code", productCode).eq("is_active", true).order("version", { ascending: false }).limit(1).maybeSingle<Row>()
      : null,
    db.from("tenant_scripts").select("id, campaign_id, product_code, version, sections").eq("tenant_id", input.tenantId).is("campaign_id", null).eq("product_code", productCode).eq("is_active", true).order("version", { ascending: false }).limit(1).maybeSingle<Row>(),
    db.from("state_disclosures").select("id, state, product_code, required_text, effective_from").eq("state", state).eq("product_code", productCode).lte("effective_from", new Date().toISOString().slice(0, 10)).order("effective_from", { ascending: false }).limit(1).maybeSingle<Row>(),
    getDialerEligibility(db, input.tenantId, values, campaignId, input.agentId),
    // The board's Campaign / Vendor / Source row. Most leads carry no campaign today; they read "—".
    campaignId ? readPanelCampaign(db, input.tenantId, campaignId) : null,
    // "Open until 8:00 PM CT": the explainer beside tenant_can_dial_now (migration 20260924323200).
    // It only words the answer; the gate above is still tenant_can_dial_now's.
    state ? db.rpc("tenant_dial_window", { p_tenant_id: input.tenantId, p_state: state, p_campaign_id: campaignId, p_at: new Date().toISOString() }) : null,
    // Wrong number / Disconnected: can this lead go back to its vendor, and for how long.
    readReturnWindow(db, input.tenantId, input.leadId),
    // The callback panel's window chip ("Inside the Arizona calling window · 8am–9pm federal …").
    readCallbackWindow(input.tenantId, state),
    // "Recycled · angle: …" on the card, while the lead is on a recycle pass.
    readRecycleContext(db, input.tenantId, input.leadId),
  ]);

  let script: Row | null = null;
  if (campaignScript) {
    if (campaignScript.error) throw new Error(`Could not load campaign script: ${campaignScript.error.message}`);
    script = campaignScript.data;
  }
  if (!script) {
    if (defaultScript.error) throw new Error(`Could not load default script: ${defaultScript.error.message}`);
    script = defaultScript.data;
  }
  if (disclosure.error) throw new Error(`Could not load required disclosure: ${disclosure.error.message}`);
  if (rebuttals.error && rebuttals.error.code !== "PGRST116") throw new Error(`Could not load rebuttals: ${rebuttals.error.message}`);
  if (consentResult.error) throw new Error(`Could not load consent evidence: ${consentResult.error.message}`);
  if (attemptsResult.error) throw new Error(`Could not load call history: ${attemptsResult.error.message}`);
  if (queueResult.error) throw new Error(`Could not load lead assignment: ${queueResult.error.message}`);

  const consent = consentView(consentResult.data as Row | null);
  const agencyProfile = agencyResult.error ? null : agencyResult.data;
  const agencyName = text(agencyProfile?.dba) || text(agencyProfile?.legal_name) || (tenantResult.error ? "" : text(tenantResult.data?.name));
  const agentName = agentResult && !agentResult.error ? text(agentResult.data?.name) : "";
  const variables = {
    first_name: text(values.first_name ?? values.firstName ?? values.full_name).split(/\s+/)[0] || "there",
    state,
    age: ageFrom(values.age ?? values.date_of_birth ?? values.dob),
    // The four the board's script implies ("this is Ray with Northline … final expense … on the
    // 12th"), each from data the product holds: users.name, the agency profile's trading name (else
    // the workspace name), the product label, and the consent timestamp on file.
    agent_name: agentName.split(/\s+/)[0] || "",
    agency_name: agencyName,
    product: productCode ? productLineLabel(productCode).toLowerCase() : "",
    consent_date: consent.hasCertificate || consent.consentTimestamp ? consentDay(consent.consentTimestamp) : "",
    "lead.first_name": text(values.first_name ?? values.firstName ?? values.full_name).split(/\s+/)[0] || "there",
    "lead.state": state,
    "lead.age": ageFrom(values.age ?? values.date_of_birth ?? values.dob),
  };
  const sections = resolve(script?.sections ?? DEFAULT_SECTIONS, variables) as Record<string, unknown>;
  const defaultRows = DEFAULT_REBUTTALS.map(([objectionKey, label, body], index) => ({ id: `default-${objectionKey}`, objectionKey, label, body, sortOrder: index }));
  const vendorEmbed = campaign ? (Array.isArray(campaign.vendor) ? campaign.vendor[0] : campaign.vendor) as Row | null | undefined : null;
  const windowRows = windowResult && !windowResult.error ? (Array.isArray(windowResult.data) ? windowResult.data : windowResult.data ? [windowResult.data] : []) as Row[] : [];
  if (windowResult?.error && !isPendingSchema(windowResult.error)) console.error(`[dialer] tenant_dial_window failed: ${windowResult.error.message}`);
  const windowRow = windowRows[0] ?? null;
  const lastDnc = dncLogResult.error ? null : dncLogResult.data;
  if (dncLogResult.error && !isPendingSchema(dncLogResult.error)) console.error(`[dialer] could not read the DNC check log: ${dncLogResult.error.message}`);
  return {
    lead: {
      id: input.leadId,
      firstName: variables.first_name,
      fullName: customerName(values),
      state,
      age: variables.age,
      phone: leadPhone(values),
      campaignId,
      productCode,
      workItemId: text(queueResult.data?.id) || null,
      // Outbound attempts so far (the inbound return call does not count, by design).
      attemptsMade: Number(leadResult.data.attempts_made ?? 0) || 0,
      // The scheduler's next move (schedule_next_attempt): when, and in which slot.
      leadState: text(leadResult.data.lead_state) || null,
      nextDialAfter: text(leadResult.data.next_dial_after) || null,
      nextSlot: text(leadResult.data.next_preferred_slot) || null,
      // The lead's own ceiling (a recycle pass), or null for the default seven.
      attemptCeiling: numberOrNull(leadResult.data.attempt_ceiling),
    },
    recycle,
    // Who is looking: the booking and callback panels compare against this agent's own calendar.
    viewerUserId: input.agentId ?? null,
    // "—" on the board when absent, which is most leads today: nothing in the import path sets
    // campaign_id unless the list was attached to a campaign.
    campaign: campaign
      ? {
          name: text(campaign.name) || null,
          vendorName: text(vendorEmbed?.name) || null,
          leadType: text(campaign.lead_type) || null,
          // Money: owners and producers only (user decision 2026-09-25). Effective = after credits.
          costPerLeadCents: input.includeCost ? numberOrNull(campaign.effective_cost_per_record_cents ?? campaign.cost_per_record_cents) : null,
          scrubStatus: text(campaign.scrub_status) || null,
          scrubbedAt: text(campaign.scrubbed_at) || null,
        }
      : null,
    returnWindow,
    callbackWindow,
    // null before migration 20260924323200: the screen then words the window from `eligibility`.
    window: windowRow
      ? { allowed: windowRow.allowed === true, startMinute: windowRow.start_minute === null ? null : Number(windowRow.start_minute), endMinute: windowRow.end_minute === null ? null : Number(windowRow.end_minute), zone: text(windowRow.zone) || null, reason: text(windowRow.reason) }
      : null,
    // The last DNC lookup actually made (at a click), not a guess from vendor health.
    lastDncCheck: lastDnc ? { result: text(lastDnc.result), checkedAt: text(lastDnc.checked_at) } : null,
    script: { id: script ? text(script.id) : null, version: script ? Number(script.version) : 0, campaignId: script?.campaign_id ?? null, productCode, sections },
    rebuttals: mapRebuttals(Array.isArray(rebuttals.data) && rebuttals.data.length ? rebuttals.data as Row[] : defaultRows as unknown as Row[]),
    disclosure: disclosure.data ? { id: text(disclosure.data.id), state, productCode, requiredText: text(disclosure.data.required_text), effectiveFrom: text(disclosure.data.effective_from), configured: true, blocking: false } : { id: null, state, productCode, requiredText: `No approved disclosure is configured for ${state || "this lead state"}. Dialing is blocked until Compliance publishes one.`, effectiveFrom: null, configured: false, blocking: true },
    eligibility,
    // Reported, not swallowed — with one deliberate exception. A lead that has never been served
    // has no decision row, and that is a real "no explanation yet"; a query that FAILED is not, and
    // rendering it as one is how the wrong table name above survived. Only a genuinely absent
    // relation is tolerated, because the panel is compliance-gated and must still open.
    selectionReason: selectionReason(selectionResult),
    consent,
    attemptHistory: (Array.isArray(attemptsResult.data) ? attemptsResult.data as Row[] : []).map((row) => ({
      id: text(row.id), attemptNumber: Number(row.attempt_number ?? 0), attemptedAt: text(row.attempted_at), slot: text(row.slot), disposition: text(row.disposition) || null, dialClicked: Boolean(row.dial_clicked_at), disclosureConfirmed: Boolean(row.disclosure_confirmed_at),
    })),
  };
}

/**
 * The time-of-day slot this attempt is actually happening in.
 *
 * It used to be the literal `"late_morning"` on every attempt ever created, and that one literal
 * disabled the whole of LA-2.7. `schedule_next_attempt` builds the "slots this lead has failed in"
 * set from `tenant_call_attempts.slot`, and the serving query refuses a retry whose current slot
 * appears there — so with every attempt stamped late_morning, a lead was recorded as having been
 * tried in exactly one slot no matter when it was really dialled. Criterion 1, "never retried into
 * a slot it has already failed in", was true of a history that was not true.
 *
 * The database decides, because `current_slot_for_state` already owns the mapping — including the
 * rule that Saturday at 10am is the weekend slot rather than late morning, which is the gap
 * rotation exists to close. Recomputing that in TypeScript would be a second opinion nobody asked
 * for.
 */
async function resolveAttemptSlot(db: Db, values: Row): Promise<string> {
  const state = text(values.state) || null;
  const slot = await db.rpc("current_slot_for_state", { p_state: state, p_at: new Date().toISOString() });
  // A lead with no state has no timezone, so it has no slot either. Falling back keeps the attempt
  // recordable; such a lead is already refused at the calling-window gate, so it cannot be dialled
  // through this path anyway.
  if (slot.error || typeof slot.data !== "string" || !slot.data) return "late_morning";
  return slot.data;
}

export async function startDialAttempt(input: { tenantId: string; agentId: string; leadId: string; scriptId?: string | null; scriptVersion?: number; disclosureState: string; disclosureProductCode: string; inbound?: boolean }) {
  const db = getSupabaseServiceClient() as unknown as Db;
  const lead = await db.from("agent_leads").select("id, values, campaign_id").eq("tenant_id", input.tenantId).eq("id", input.leadId).maybeSingle<Row>();
  if (lead.error) throw new Error(`Could not verify lead: ${lead.error.message}`);
  if (!lead.data) throw new Error("Lead not found for this tenant");
  // All four are reads (current_slot_for_state is a pure STABLE function), so they are fetched
  // together; the throws below keep their original order, eligibility first.
  const [eligibility, queue, latest, slot] = await Promise.all([
    getDialerEligibility(db, input.tenantId, (lead.data.values ?? {}) as Row, text(lead.data.campaign_id) || null, input.agentId),
    db.from("lead_queue").select("id, status, claimed_by").eq("tenant_id", input.tenantId).eq("lead_id", input.leadId).eq("status", "claimed").eq("claimed_by", input.agentId).order("claimed_at", { ascending: false }).limit(1).maybeSingle<Row>(),
    db.from("tenant_call_attempts").select("attempt_number").eq("tenant_id", input.tenantId).eq("lead_id", input.leadId).order("attempt_number", { ascending: false }).limit(1).maybeSingle<Row>(),
    resolveAttemptSlot(db, (lead.data.values ?? {}) as Row),
  ]);
  if (!eligibility.allowed) throw new DialGateError(eligibility.reason, eligibility.reason === "dnc_unavailable" || eligibility.reason === "policy_unavailable" ? 503 : 422, eligibility.message);
  if (queue.error) throw new DialerWorkflowError(503, `Could not verify lead assignment: ${queue.error.message}`);
  // An inbound return call has no claim to check. Decision 1: the customer rang Ray, so nothing was
  // served and nothing was claimed — requiring a claim here is what made the disposition
  // unreachable from the search screen. Every outbound attempt still requires one.
  if (!queue.data && !input.inbound) throw new DialerWorkflowError(409, "Claim this lead before preparing a dial attempt.");
  if (latest.error) throw new Error(`Could not load call history: ${latest.error.message}`);
  const attemptNumber = Number(latest.data?.attempt_number ?? 0) + 1;
  const inserted = await db.from("tenant_call_attempts").insert({ tenant_id: input.tenantId, lead_id: input.leadId, work_item_id: queue.data ? text(queue.data.id) : null, attempt_number: attemptNumber, slot, agent_id: input.agentId, script_id: input.scriptId ?? null, script_version: input.scriptVersion ?? null, disclosure_state: input.disclosureState, disclosure_product_code: input.disclosureProductCode }).select("id, attempt_number, attempted_at").single<Row>();
  if (inserted.error || !inserted.data) throw new Error(inserted.error?.message ?? "Could not start call attempt");
  return inserted.data;
}

export async function confirmDisclosure(input: { tenantId: string; agentId: string; attemptId: string; state: string; productCode: string }) {
  const db = getSupabaseServiceClient() as unknown as Db;
  const result = await db.rpc("confirm_call_disclosure", { p_tenant_id: input.tenantId, p_attempt_id: input.attemptId, p_agent_user_id: input.agentId, p_state: input.state, p_product_code: input.productCode, p_confirmed_at: new Date().toISOString() });
  if (result.error) throw new Error(result.error.message);
  return result.data;
}

/**
 * One row per DNC lookup made at the click (tenant_dial_dnc_checks, migration 20260924323200).
 * Evidence for the panel, not a gate: the gate is the lookup itself, so a log that cannot be
 * written (the table not there yet, or a failed insert) never changes whether the dial proceeds.
 */
async function logDncCheck(db: Db, input: { tenantId: string; leadId: string; attemptId: string; agentId: string; result: "clear" | "listed" | "unavailable" }) {
  const written = await db.from("tenant_dial_dnc_checks").insert({ tenant_id: input.tenantId, lead_id: input.leadId, attempt_id: input.attemptId, checked_by: input.agentId, result: input.result });
  if (written.error && !isPendingSchema(written.error)) console.error(`[dialer] could not log the DNC check: ${written.error.message}`);
}

/**
 * A refusal at the click is never placed, so it leaves no dialled attempt; it is kept as a
 * tenant.dial_refused audit row against the lead, in the same shape the attempt route writes
 * (lib/leadWorkspace/refusals.ts), so the lead's record and the Activity log can say why. Then the
 * refusal is thrown on, unchanged.
 */
async function refuseAtClick(input: { tenantId: string; agentId: string }, leadId: string, inbound: boolean, error: DialGateError): Promise<never> {
  await recordDialRefused({ tenantId: input.tenantId, leadId, actorId: input.agentId, reason: error.code, message: error.message, inbound });
  throw error;
}

export async function markDialClicked(input: { tenantId: string; agentId: string; attemptId: string }) {
  const db = getSupabaseServiceClient() as unknown as Db;
  // The lead rides along on the attempt read (FK tenant_call_attempts_lead_id_fkey) instead of a
  // second round trip; the tenant match the separate query filtered on is checked explicitly below.
  const attempt = await db.from("tenant_call_attempts").select("id, lead_id, work_item_id, disclosure_confirmed_at, lead:agent_leads!tenant_call_attempts_lead_id_fkey(id, tenant_id, values, campaign_id)").eq("id", input.attemptId).eq("tenant_id", input.tenantId).eq("agent_id", input.agentId).maybeSingle<Row>();
  if (attempt.error) throw new Error(attempt.error.message);
  if (!attempt.data) throw new Error("Call attempt not found");
  if (!attempt.data.disclosure_confirmed_at) throw new Error("Read and confirm the required disclosure before dialing");
  const embedded = Array.isArray(attempt.data.lead) ? attempt.data.lead[0] : attempt.data.lead;
  const lead = (embedded && typeof embedded === "object" ? embedded : null) as Row | null;
  if (!lead || text(lead.tenant_id) !== input.tenantId) throw new Error("Lead not found for this tenant");
  const values = (lead.values ?? {}) as Row;
  const refuse = (error: DialGateError) => refuseAtClick(input, text(lead.id), !text(attempt.data?.work_item_id), error);
  const eligibility = await getDialerEligibility(db, input.tenantId, values, text(lead.campaign_id) || null, input.agentId);
  if (!eligibility.allowed) await refuse(new DialGateError(eligibility.reason, eligibility.reason === "dnc_unavailable" || eligibility.reason === "policy_unavailable" ? 503 : 422, eligibility.message));
  const phone = leadPhone(values);
  let dncResult: "clear" | "listed" | "unavailable";
  try {
    const dnc = await performDncDialPreflight(phone, input.tenantId);
    dncResult = dnc.allowed ? "clear" : "listed";
  } catch {
    dncResult = "unavailable";
  }
  // Written whatever the answer, so the panel can say what the last real lookup found.
  await logDncCheck(db, { tenantId: input.tenantId, leadId: text(lead.id), attemptId: input.attemptId, agentId: input.agentId, result: dncResult });
  if (dncResult === "listed") await refuse(new DialGateError("internal_suppressed", 422, "Dialing is blocked because this number is on a DNC list."));
  if (dncResult === "unavailable") await refuse(new DialGateError("dnc_unavailable", 503, "Dialing is blocked because the number could not be verified by the DNC vendors."));
  const result = await db.from("tenant_call_attempts").update({ dial_clicked_at: new Date().toISOString() }).eq("id", input.attemptId).eq("tenant_id", input.tenantId).eq("agent_id", input.agentId).select("id, dial_clicked_at").single<Row>();
  if (result.error || !result.data) throw new Error(result.error?.message ?? "Call attempt not found");
  return result.data;
}

/**
 * The work item a call attempt belongs to (this agent's, this tenant's), or null. The dialer's
 * disposition route asks it before an application outcome, because verification is kept per work
 * item (the same session the inbound wizard checks).
 */
export async function attemptWorkItemId(input: { tenantId: string; agentId: string; attemptId: string }): Promise<string | null> {
  const db = getSupabaseServiceClient() as unknown as Db;
  const attempt = await db.from("tenant_call_attempts").select("work_item_id").eq("id", input.attemptId).eq("tenant_id", input.tenantId).eq("agent_id", input.agentId).maybeSingle<Row>();
  if (attempt.error) throw new DialerWorkflowError(503, `Could not read this call attempt: ${attempt.error.message}`);
  return text(attempt.data?.work_item_id) || null;
}

export async function recordDisposition(input: { tenantId: string; agentId: string; attemptId: string; disposition: string }) {
  const db = getSupabaseServiceClient() as unknown as Db;
  const attempt = await db.from("tenant_call_attempts").select("id, work_item_id, disclosure_confirmed_at, dial_clicked_at, disposition, attempted_at").eq("id", input.attemptId).eq("tenant_id", input.tenantId).eq("agent_id", input.agentId).maybeSingle<Row>();
  if (attempt.error) throw new Error(attempt.error.message);
  if (!attempt.data) throw new Error("Call attempt not found");
  if (!attempt.data.disclosure_confirmed_at) throw new Error("Read and confirm the required disclosure before recording a disposition");
  if (!attempt.data.dial_clicked_at) throw new DialerWorkflowError(409, "Record the dial attempt before choosing a disposition.");
  // The inbound return call is the one outcome with no work item by design (decision 1): the
  // customer rang back, nothing was served or claimed. complete_existing_dial_disposition already
  // admits it without one; this check used to refuse it first, so the search path could never
  // finish a call it had started.
  if (!text(attempt.data.work_item_id) && input.disposition !== "inbound_return_call") throw new DialerWorkflowError(409, "This attempt is not attached to a claimed lead and cannot be completed safely.");
  const result = await db.rpc("complete_existing_dial_disposition", { p_tenant_id: input.tenantId, p_attempt_id: input.attemptId, p_agent_user_id: input.agentId, p_disposition: input.disposition, p_dial_clicked_at: text(attempt.data.dial_clicked_at), p_provider_call_id: null });
  if (result.error) throw new DialerWorkflowError(503, `Dial disposition workflow is unavailable: ${result.error.message}`);
  // Wrong number / Disconnected: the SQL says "flagged for a vendor credit claim" whether or not
  // the lead can actually go back. Recording the outcome is what makes it claimable
  // (vendor_claimable_leads reads the attempt), so the sentence is replaced with the return
  // window's own answer — the one the confirm line showed — when that can be read.
  if (RETURNABLE_OUTCOMES.has(input.disposition)) {
    const rows = (Array.isArray(result.data) ? result.data : result.data ? [result.data] : []) as Row[];
    const leadId = await db.from("tenant_call_attempts").select("lead_id").eq("id", input.attemptId).eq("tenant_id", input.tenantId).maybeSingle<Row>();
    const window = leadId.data ? await readReturnWindow(db, input.tenantId, text(leadId.data.lead_id)) : null;
    if (window && rows[0] && text(rows[0].lead_state) === "closed") {
      return [{ ...rows[0], reason: `Closed. ${returnWindowLine(window)}` }, ...rows.slice(1)];
    }
  }
  return result.data;
}

/** The two outcomes that can send a lead back to its vendor (vendor_claimable_leads, 20260913440000). */
const RETURNABLE_OUTCOMES = new Set(["wrong_number", "disconnected"]);

/**
 * `callback_scheduled`, with a callback that actually exists.
 *
 * The plain `recordDisposition` path accepted this key, set the lead to `working`, completed the
 * work item — and wrote no callback. The lead then matched no serving tier and had no row on the
 * Callbacks screen, so nothing would surface it again, while the call history said "Callback
 * scheduled". This routes to a function that records the call AND books the callback in one
 * transaction, using the same validation the disposition wizard applies.
 *
 * The preconditions below are checked here as well as in SQL on purpose: they produce a sentence
 * an agent can act on, where the function would raise a code.
 */
export async function recordCallbackDisposition(input: {
  tenantId: string;
  agentId: string;
  attemptId: string;
  callbackLocal: string;
  customerTimezone: string;
  callbackNote: string | null;
  assignedTo: string | null;
  idempotencyKey: string;
}) {
  const db = getSupabaseServiceClient() as unknown as Db;
  const attempt = await db
    .from("tenant_call_attempts")
    .select("id, lead_id, work_item_id, disclosure_confirmed_at, dial_clicked_at, disposition")
    .eq("id", input.attemptId)
    .eq("tenant_id", input.tenantId)
    .eq("agent_id", input.agentId)
    .maybeSingle<Row>();
  if (attempt.error) throw new Error(attempt.error.message);
  if (!attempt.data) throw new Error("Call attempt not found");
  if (!attempt.data.disclosure_confirmed_at) throw new Error("Read and confirm the required disclosure before recording a disposition");
  if (!attempt.data.dial_clicked_at) throw new DialerWorkflowError(409, "Record the dial attempt before choosing a disposition.");
  if (!text(attempt.data.work_item_id)) throw new DialerWorkflowError(409, "This attempt is not attached to a claimed lead and cannot be completed safely.");

  // Settings → Dispositions: the callback time is checked against the customer's calling window
  // before the disposition is written (lib/dispositions/callbackWindow.ts).
  const window = await checkCallbackInCallingWindow({ tenantId: input.tenantId, leadId: text(attempt.data.lead_id), callbackLocal: input.callbackLocal, timezone: input.customerTimezone, actorId: input.agentId });
  if (!window.ok) throw new DialerWorkflowError(window.status, window.message);

  const result = await db.rpc("complete_dial_disposition_with_callback", {
    p_tenant_id: input.tenantId,
    p_attempt_id: input.attemptId,
    p_agent_user_id: input.agentId,
    p_callback_local: input.callbackLocal,
    p_customer_timezone: input.customerTimezone,
    p_assigned_to: input.assignedTo,
    p_callback_note: input.callbackNote,
    p_idempotency_key: input.idempotencyKey,
    p_dial_clicked_at: text(attempt.data.dial_clicked_at),
    p_provider_call_id: null,
  });
  if (result.error) {
    // The function raises bare codes so it can be called from anywhere; they are turned into
    // sentences here rather than shown to an agent as-is.
    const message = result.error.message;
    if (message.includes("CALLBACK_DATE_PAST"))
      throw new DialerWorkflowError(400, "That callback time has already passed in the customer's timezone. Choose a later one.");
    if (message.includes("CALLBACK_TIMEZONE_INVALID"))
      throw new DialerWorkflowError(400, "That is not a timezone this server recognises, so the callback time cannot be pinned to a real moment.");
    if (message.includes("CALLBACK_ASSIGNEE_INVALID"))
      throw new DialerWorkflowError(400, "That person is not an active member of this agency, so the callback cannot be assigned to them.");
    if (message.includes("CALLBACK_DATE_REQUIRED"))
      throw new DialerWorkflowError(400, "Choose when to call back.");
    // 20260925700300: the function now checks the calling window itself (assert_callback_in_window).
    if (message.includes("CALLBACK_OUTSIDE_WINDOW"))
      throw new DialerWorkflowError(422, "That time is outside the customer's calling window. Choose a time inside it, in their timezone.");
    if (message.includes("CALLBACK_NO_STATE"))
      throw new DialerWorkflowError(422, "This lead has no state, so there is no calling window to book against. Add the state on the lead first.");
    throw new DialerWorkflowError(503, `Dial disposition workflow is unavailable: ${message}`);
  }
  return result.data;
}

export async function saveScript(input: { tenantId: string; userId: string; campaignId?: string | null; productCode: string; sections: Record<string, string> }) {
  const sections = Object.fromEntries(Object.entries(input.sections).map(([key, value]) => [key, value.trim()]));
  if (!["opening", "qualifying_questions", "transition_to_quote", "close"].every((key) => typeof sections[key] === "string" && sections[key].length > 0 && sections[key].length <= 8000)) throw new Error("Opening, qualifying questions, transition to quote and close are required");
  const db = getSupabaseServiceClient() as unknown as Db;
  const existing = db.from("tenant_scripts").select("version").eq("tenant_id", input.tenantId).eq("product_code", input.productCode).eq("is_active", true);
  const scoped = input.campaignId ? existing.eq("campaign_id", input.campaignId) : existing.is("campaign_id", null);
  const latest = await scoped.order("version", { ascending: false }).limit(1).maybeSingle<Row>();
  if (latest.error) throw new Error(`Could not load script version: ${latest.error.message}`);
  const version = Number(latest.data?.version ?? 0) + 1;
  const inserted = await db.from("tenant_scripts").insert({ tenant_id: input.tenantId, campaign_id: input.campaignId ?? null, product_code: input.productCode, version, sections, is_active: true, created_by: input.userId }).select("id, campaign_id, product_code, version, sections, is_active").single<Row>();
  if (inserted.error || !inserted.data) throw new Error(inserted.error?.message ?? "Could not save script");
  return inserted.data;
}

export async function saveRebuttal(input: { tenantId: string; objectionKey: string; label: string; body: string; sortOrder: number }) {
  if (!input.label.trim() || !input.body.trim()) throw new Error("Rebuttal label and body are required");
  const result = await (getSupabaseServiceClient() as unknown as Db).from("tenant_rebuttals").upsert({ tenant_id: input.tenantId, objection_key: input.objectionKey, label: input.label.trim(), body: input.body.trim(), sort_order: input.sortOrder, is_active: true, updated_at: new Date().toISOString() }, { onConflict: "tenant_id,objection_key" }).select("id, objection_key, label, body, sort_order").single<Row>();
  if (result.error || !result.data) throw new Error(result.error?.message ?? "Could not save rebuttal");
  return result.data;
}

/**
 * LA-2.8 · serve exactly one lead — the call the product never made.
 *
 * `serve_next_lead` has been correct and deployed for weeks, and nothing called it. Of the 152 RPCs
 * this application invokes, it was not one, and neither were `score_lead` nor
 * `next_campaign_for_serving`. The dialer read `/api/app/leads?limit=100` and let the agent pick
 * from the list.
 *
 * That is the one thing LA-2.8 says must not happen, and it says why in a sentence worth keeping:
 *
 *   "He does not pick from a list. The system decides, he dials. That is what makes cadence,
 *    scoring and window enforcement mean anything — the moment he can browse, all three become
 *    suggestions."
 *
 * Everything downstream followed from that. Browsing meant the priority tiers never ran, so a
 * real-time lead had no way to jump the queue; the cadence timer and slot rotation were written on
 * every disposition and read by nobody; two agents could open the same lead because the atomic
 * claim was never executed; and campaign mixing weights decided nothing. Each of those was
 * implemented, tested, and inert.
 *
 * This is the missing call. It returns null when the queue has nothing servable, which is a normal
 * state several times a day and not an error.
 */
/** At most this many leads are refused and handed back in one press of Next before it gives up. */
const MAX_REFUSED_PER_SERVE = 4;

/**
 * Puts a lead the dialer refused back exactly as the queue would find it: unclaimed, in the
 * lead_state it was served from, and with first_dial_at cleared if this serve was what set it
 * (serve_next_lead stamps it on claim, but no call was made).
 */
async function returnRefusedLead(db: Db, tenantId: string, agentId: string, served: Row) {
  const workItemId = text(served.work_item_id);
  const leadId = text(served.lead_id);
  const [queue, lead] = await Promise.all([
    db.from("lead_queue").select("claimed_at").eq("tenant_id", tenantId).eq("id", workItemId).maybeSingle<Row>(),
    db.from("agent_leads").select("first_dial_at").eq("tenant_id", tenantId).eq("id", leadId).maybeSingle<Row>(),
  ]);
  const claimedAt = text(queue.data?.claimed_at);
  const firstDialAt = text(lead.data?.first_dial_at);
  const neverDialled = Boolean(claimedAt && firstDialAt && new Date(claimedAt).getTime() === new Date(firstDialAt).getTime());
  const released = await db
    .from("lead_queue")
    .update({ status: "unclaimed", claimed_by: null, owner_user_id: null, locked_until: null, updated_at: new Date().toISOString() })
    .eq("tenant_id", tenantId)
    .eq("id", workItemId)
    .eq("claimed_by", agentId)
    .eq("status", "claimed");
  if (released.error) console.error(`[dialer] could not return a refused lead to the queue: ${released.error.message}`);
  const restoredState = neverDialled ? "fresh" : leadStateBeforeServe(Number(served.tier ?? 0));
  const leadPatch: Row = {};
  if (restoredState) leadPatch.lead_state = restoredState;
  if (neverDialled) leadPatch.first_dial_at = null;
  if (Object.keys(leadPatch).length) {
    const restored = await db.from("agent_leads").update(leadPatch).eq("tenant_id", tenantId).eq("id", leadId).eq("lead_state", "working");
    if (restored.error) console.error(`[dialer] could not restore a refused lead's state: ${restored.error.message}`);
  }
}

export type ServeResult = {
  served: ReturnType<typeof servedView> | null;
  /** Leads the queue offered and the dialer refused because this agent may not sell there. */
  refused: Array<{ state: string | null; message: string }>;
  /**
   * When nothing was served and the agent is at their open-lead ceiling (agent_open_lead_load,
   * 20260925700000): the count and the ceiling, so the empty queue can say that is why.
   */
  atCapacity?: { open: number; max: number } | null;
};

/** The agent's open-lead count against their ceiling, or null (no ceiling, or before 20260925700000). */
async function readOpenLeadLoad(db: Db, tenantId: string, agentId: string): Promise<{ open: number; max: number } | null> {
  const result = await db.rpc("agent_open_lead_load", { p_tenant_id: tenantId, p_user_id: agentId });
  if (result.error) {
    if (!isPendingSchema(result.error)) console.error(`[dialer] agent_open_lead_load failed: ${result.error.message}`);
    return null;
  }
  const row = ((Array.isArray(result.data) ? result.data[0] : result.data) ?? null) as Row | null;
  if (!row || row.max_open_leads === null || row.max_open_leads === undefined) return null;
  return { open: Number(row.open_leads ?? 0) || 0, max: Number(row.max_open_leads) };
}

/**
 * Serves the next lead the agent may work.
 *
 * Migration 20260924220200 makes serve_next_lead skip leads in states the agent is not licensed
 * in. Until it is applied — or if the queue and this check ever disagree — a served lead is checked
 * here: one the agent may not sell to is handed straight back to the queue and the next is tried,
 * up to MAX_REFUSED_PER_SERVE. The refused leads are released only after the loop, so the loop
 * cannot be handed the same lead twice.
 */
export async function serveNextLead(input: { tenantId: string; agentId: string }): Promise<ServeResult> {
  const db = getSupabaseServiceClient() as unknown as Db;
  const refused: Array<{ row: Row; state: string | null; message: string }> = [];
  let licence: LicenceContext | null = null;
  let chosen: Row | null = null;
  try {
    for (let attempt = 0; attempt <= MAX_REFUSED_PER_SERVE; attempt += 1) {
      const result = await db.rpc("serve_next_lead", {
        p_tenant_id: input.tenantId,
        p_agent_user_id: input.agentId,
      });
      if (result.error)
        throw new DialerWorkflowError(503, `The lead queue could not be read: ${result.error.message}`);

      // A set-returning function comes back as an array. Empty means nothing was servable.
      const rows = Array.isArray(result.data) ? result.data : result.data ? [result.data] : [];
      const served = rows[0] as Row | undefined;
      if (!served) break;

      if (!licence) {
        try {
          licence = await loadLicenceContext(db, input.tenantId, input.agentId);
        } catch (error) {
          // No licence answer, no lead: hand this one back rather than leave it claimed by an agent
          // the dialer cannot clear.
          refused.push({ row: served, state: null, message: "" });
          throw error;
        }
      }
      const lead = await db.from("agent_leads").select("values").eq("tenant_id", input.tenantId).eq("id", text(served.lead_id)).maybeSingle<Row>();
      const state = stateFromLeadValues(((lead.data?.values ?? {}) as Row));
      const decision = licenceFor(licence, state);
      if (decision.allowed) {
        chosen = served;
        break;
      }
      refused.push({ row: served, state, message: decision.message });
      if (attempt === MAX_REFUSED_PER_SERVE) break;
    }
  } finally {
    for (const item of refused) await returnRefusedLead(db, input.tenantId, input.agentId, item.row);
  }
  let atCapacity: ServeResult["atCapacity"] = null;
  if (!chosen) {
    const load = await readOpenLeadLoad(db, input.tenantId, input.agentId);
    atCapacity = load && load.open >= load.max ? load : null;
  }
  return { served: chosen ? servedView(chosen) : null, refused: refused.map(({ state, message }) => ({ state, message })), atCapacity };
}

export type PickResult =
  | { served: ReturnType<typeof servedView>; refusal: null }
  | { served: null; refusal: { code: string; message: string } };

/**
 * The agent picked a row from the Priority queue (user decision, 2026-09-24, reversing LA-2.8's
 * "served, not browsed"). The pick is a SERVE of that one lead: serve_lead_by_id locks the queue
 * row and applies every predicate serve_next_lead applies — pool or assigned-to-you, campaign,
 * suppression, calling window, exhaustion, agent_may_work_state, a due tier — then claims it the
 * same way. A refusal comes back as a code and is worded here.
 *
 * The licence is checked again in TypeScript afterwards, exactly as serveNextLead does, so the
 * two paths refuse the same leads; a lead the check refuses is handed straight back.
 *
 * Throws SchemaPendingError before migration 20260924323100.
 */
export async function serveLeadById(input: { tenantId: string; agentId: string; workItemId: string }): Promise<PickResult> {
  const db = getSupabaseServiceClient() as unknown as Db;
  const result = await db.rpc("serve_lead_by_id", { p_tenant_id: input.tenantId, p_agent_user_id: input.agentId, p_work_item_id: input.workItemId });
  if (result.error) {
    if (isPendingSchema(result.error)) throw new SchemaPendingError();
    throw new DialerWorkflowError(503, `The lead queue could not be read: ${result.error.message}`);
  }
  const rows = (Array.isArray(result.data) ? result.data : result.data ? [result.data] : []) as Row[];
  const row = rows[0];
  if (!row) return { served: null, refusal: { code: "not_found", message: pickRefusalMessage("not_found") } };
  const refusal = text(row.refusal);
  if (refusal === "held_by_you") {
    // Already locked to this agent: open it, nothing was claimed twice.
    return { served: servedView({ ...row, tier: 0, tier_name: "", selection_reason: "Already locked to you." }), refusal: null };
  }
  if (refusal) return { served: null, refusal: { code: refusal, message: pickRefusalMessage(refusal) } };

  const [licence, lead] = await Promise.all([
    loadLicenceContext(db, input.tenantId, input.agentId).catch(async (error: unknown) => {
      await returnRefusedLead(db, input.tenantId, input.agentId, row);
      throw error;
    }),
    db.from("agent_leads").select("values").eq("tenant_id", input.tenantId).eq("id", text(row.lead_id)).maybeSingle<Row>(),
  ]);
  const state = stateFromLeadValues(((lead.data?.values ?? {}) as Row));
  const decision = licenceFor(licence, state);
  if (!decision.allowed) {
    await returnRefusedLead(db, input.tenantId, input.agentId, row);
    return { served: null, refusal: { code: "not_licensed", message: decision.message } };
  }
  return { served: servedView(row), refusal: null };
}

/**
 * "Call now" (/app/dialer?lead=…, from Setters, the Calendar and Callbacks): the lead's open work
 * item, picked through serveLeadById — so the calling window, suppression, the licence, the
 * open-lead ceiling and ownership all apply, and a refusal is the pick's own sentence rather than a
 * different lead served in its place. The newest work item that is still in the queue is the one.
 */
export async function serveLeadByLeadId(input: { tenantId: string; agentId: string; leadId: string }): Promise<PickResult> {
  const db = getSupabaseServiceClient() as unknown as Db;
  const item = await db.from("lead_queue").select("id, status").eq("tenant_id", input.tenantId).eq("lead_id", input.leadId).order("queued_at", { ascending: false }).limit(5);
  if (item.error) throw new DialerWorkflowError(503, `The lead queue could not be read: ${item.error.message}`);
  const rows = (Array.isArray(item.data) ? item.data : []) as Row[];
  const open = rows.find((row) => text(row.status) === "unclaimed" || text(row.status) === "claimed");
  if (!open) return { served: null, refusal: { code: "not_found", message: "This lead is not in the dialer queue, so it cannot be called from here. Open it from Leads instead." } };
  return serveLeadById({ tenantId: input.tenantId, agentId: input.agentId, workItemId: text(open.id) });
}

export type QueuePreviewRow = {
  workItemId: string;
  leadId: string;
  tier: number;
  tierName: string;
  name: string | null;
  state: string | null;
  attemptsMade: number;
  assignedToYou: boolean;
  /** The customer's clock now, "10:42", from the lead's state (one zone per state; see STATE_TIMEZONES). */
  localTime: string | null;
};

export type QueuePreview = { available: true; count: number; capped: boolean; cap: number; rows: QueuePreviewRow[] } | { available: false; message: string };

/**
 * The Priority queue list: dialer_queue_preview, read-only and LIMIT-bounded (migration
 * 20260924323100). Everything in it is servable to this agent right now; nothing is claimed by
 * reading it. Before the migration the list is unavailable and says so; Serve next still works.
 */
export async function getQueuePreview(input: { tenantId: string; agentId: string; tiers: number[] | null; limit?: number }): Promise<QueuePreview> {
  const db = getSupabaseServiceClient() as unknown as Db;
  const result = await db.rpc("dialer_queue_preview", { p_tenant_id: input.tenantId, p_agent_user_id: input.agentId, p_tiers: input.tiers, p_limit: input.limit ?? 25, p_cap: 1000 });
  if (result.error) {
    if (isPendingSchema(result.error)) return { available: false, message: "The queue list needs a database update that has not been applied yet. Serve next lead still works." };
    throw new DialerWorkflowError(503, `The lead queue could not be read: ${result.error.message}`);
  }
  const body = (result.data && typeof result.data === "object" ? result.data : {}) as Row;
  const now = new Date().toISOString();
  const rows = (Array.isArray(body.rows) ? body.rows : []) as Row[];
  return {
    available: true,
    count: Number(body.count ?? 0) || 0,
    capped: body.capped === true,
    cap: Number(body.cap ?? 1000) || 1000,
    rows: rows.map((row) => {
      const state = text(row.state) || null;
      const timezone = state ? STATE_TIMEZONES[state] ?? null : null;
      return {
        workItemId: text(row.work_item_id),
        leadId: text(row.lead_id),
        tier: Number(row.tier ?? 0),
        tierName: text(row.tier_name),
        name: text(row.name) || null,
        state,
        attemptsMade: Number(row.attempts_made ?? 0) || 0,
        assignedToYou: row.assigned_to_you === true,
        localTime: timezone ? new Intl.DateTimeFormat("en-GB", { timeZone: timezone, hour: "2-digit", minute: "2-digit", hour12: false }).format(new Date(now)) : null,
      };
    }),
  };
}

function servedView(served: Row) {
  return {
    workItemId: text(served.work_item_id),
    leadId: text(served.lead_id),
    tier: Number(served.tier ?? 0),
    tierName: text(served.tier_name),
    lockedUntil: text(served.locked_until),
    appointmentNotes: text(served.appointment_notes) || null,
    // Shown, unlike the score. LA-2.13's own warning is that a number nobody can explain is worse
    // than no number, so the reason is rendered and the score is not.
    selectionReason: text(served.selection_reason) || null,
    cohort: text(served.cohort) || null,
  };
}

export type DialerStats = { dials: number; contacts: number; contactRate: number | null; since: string; zone: string };

/**
 * The header's Dials today · Contacts · Contact rate: this agent's own attempts since midnight in
 * the AGENCY's timezone (Settings › Agency profile; UTC when none is set). A dial is an attempt
 * whose call was started (dial_clicked_at); a contact is a recorded outcome that is a conversation —
 * NOT_A_CONTACT mirrors SQL is_contact_disposition, the definition the scorecards use.
 */
export async function getDialerStats(input: { tenantId: string; agentId: string }): Promise<DialerStats | null> {
  const db = getSupabaseServiceClient() as unknown as Db;
  const zone = (await getWorkspaceTimezone(input.tenantId).catch(() => null)) ?? "UTC";
  const today = lastDays(Date.now(), zone, 1)[0];
  const result = await db
    .from("tenant_call_attempts")
    .select("disposition, dial_clicked_at")
    .eq("tenant_id", input.tenantId)
    .eq("agent_id", input.agentId)
    .gte("attempted_at", today.start)
    .not("dial_clicked_at", "is", null)
    .limit(5000);
  if (result.error) {
    console.error(`[dialer] could not count today's dials: ${result.error.message}`);
    return null;
  }
  const rows = (Array.isArray(result.data) ? result.data : []) as Row[];
  const notContact = new Set<string>(NOT_A_CONTACT);
  const contacts = rows.filter((row) => text(row.disposition) && !notContact.has(text(row.disposition))).length;
  return { dials: rows.length, contacts, contactRate: rows.length ? (contacts / rows.length) * 100 : null, since: today.start, zone };
}
