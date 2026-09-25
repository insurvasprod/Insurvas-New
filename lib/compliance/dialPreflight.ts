import "server-only";

import { getSupabaseServiceClient } from "@/lib/supabase/service";
import { isPendingSchema } from "@/lib/appointments/pendingSchema";
import { stateFromLeadValues } from "@/lib/callbacks/timezone";
import { providerName, windowClosedLabel, zoneShort } from "@/lib/dialerScripts/display";
import { checkLitigatorForDialPreflight } from "./screening";
import { getDncDialingStatus, performDncVendorLookup } from "./service";
import { getUsPhone10Digits, maskDialPhone } from "./scrub";
import { answerAge, daysAge, longDate, windowHoursLabel, type PreflightCheck } from "./preflightChecks";

type Row = Record<string, unknown>;
type Result<T> = { data: T; error: { message: string; code?: string } | null };
type Query = PromiseLike<Result<unknown>> & {
  select(columns: string): Query;
  eq(column: string, value: unknown): Query;
  or(filter: string): Query;
  order(column: string, options?: { ascending?: boolean }): Query;
  limit(value: number): Query;
  maybeSingle<T = unknown>(): Promise<Result<T | null>>;
};
type Db = { from(table: string): Query; rpc(name: string, args: Record<string, unknown>): Promise<Result<unknown>> };

function text(value: unknown) { return typeof value === "string" ? value : ""; }

export type DialPreflightReport = {
  phone: string;
  checks: PreflightCheck[];
  suppression: { reason: string; created_at: string } | null;
  lead: { id: string; state: string | null } | null;
  /** The state the window was checked for (the lead's, else the one the agent picked). */
  state: string | null;
  outcome: {
    suppression: "clear" | "listed" | "unavailable";
    dnc: "clear" | "listed" | "no_vendor" | "unverified";
    litigator: "clear" | "listed" | "unavailable";
    window: "inside" | "outside" | "unavailable" | "no_state";
  };
};

/**
 * The lead this number belongs to, if any: the same ten-digit expression the importer and
 * has_existing_lead_phone use (import_existing_lead_phones, 20260924330000, index-backed). Before
 * that function exists, a filter on the stored phone in its common written forms.
 */
async function findLead(db: Db, tenantId: string, digits: string): Promise<Row | null> {
  const mapped = await db.rpc("import_existing_lead_phones", { p_tenant_id: tenantId, p_phones: [digits] });
  let leadId: string | null = null;
  if (!mapped.error) {
    const map = (mapped.data && typeof mapped.data === "object" ? mapped.data : {}) as Row;
    leadId = text(map[digits]) || null;
    if (!leadId) return null;
  } else if (!isPendingSchema(mapped.error)) {
    throw new Error(`Could not look up a lead for this number: ${mapped.error.message}`);
  }
  if (leadId) {
    const lead = await db.from("agent_leads").select("id, values, campaign_id").eq("tenant_id", tenantId).eq("id", leadId).maybeSingle<Row>();
    if (lead.error) throw new Error(`Could not load the lead for this number: ${lead.error.message}`);
    return lead.data;
  }
  const [a, b, c] = [digits.slice(0, 3), digits.slice(3, 6), digits.slice(6)];
  const forms = [digits, `1${digits}`, `+1${digits}`, `(${a}) ${b}-${c}`, `${a}-${b}-${c}`, `${a}.${b}.${c}`, `+1 ${a}-${b}-${c}`, `(${a}) ${b}–${c}`];
  const list = forms.map((form) => `"${form}"`).join(",");
  const fallback = await db.from("agent_leads").select("id, values, campaign_id").eq("tenant_id", tenantId)
    .or(`values->>phone.in.(${list}),values->>phone_number.in.(${list})`)
    .order("created_at", { ascending: true }).limit(1).maybeSingle<Row>();
  if (fallback.error) throw new Error(`Could not look up a lead for this number: ${fallback.error.message}`);
  return fallback.data;
}

async function suppressionCheck(db: Db, tenantId: string, digits: string) {
  // The gate's own function decides; the table read only supplies the reason and the date.
  const [decided, detail] = await Promise.all([
    db.rpc("is_tenant_phone_suppressed", { p_tenant_id: tenantId, p_phone_digits: digits }),
    db.from("tenant_do_not_call").select("reason, created_at").eq("tenant_id", tenantId).eq("phone_digits", digits).eq("is_active", true).order("created_at", { ascending: false }).limit(1).maybeSingle<Row>(),
  ]);
  if (decided.error) return { status: "unavailable" as const, detail: null };
  const row = detail.error ? null : detail.data;
  return {
    status: decided.data === true ? ("listed" as const) : ("clear" as const),
    detail: decided.data === true && row ? { reason: text(row.reason), created_at: text(row.created_at) } : null,
  };
}

async function windowCheck(db: Db, tenantId: string, state: string, campaignId: string | null) {
  const at = new Date().toISOString();
  const explained = await db.rpc("tenant_dial_window", { p_tenant_id: tenantId, p_state: state, p_campaign_id: campaignId, p_at: at });
  if (!explained.error) {
    const rows = (Array.isArray(explained.data) ? explained.data : explained.data ? [explained.data] : []) as Row[];
    const row = rows[0];
    if (row) {
      const start = row.start_minute === null || row.start_minute === undefined ? null : Number(row.start_minute);
      const end = row.end_minute === null || row.end_minute === undefined ? null : Number(row.end_minute);
      const zone = text(row.zone) || null;
      return { allowed: row.allowed === true, hours: windowHoursLabel(start, end, zoneShort(zone)), reason: text(row.reason), start, zone, explained: true };
    }
  } else if (!isPendingSchema(explained.error)) {
    console.error(`[dial-preflight] tenant_dial_window failed: ${explained.error.message}`);
  }
  // Before 20260924323200 (or if the explainer fails): the enforcement function's yes/no alone.
  const decided = await db.rpc("tenant_can_dial_now", { p_tenant_id: tenantId, p_state: state, p_campaign_id: campaignId, p_at: at });
  if (decided.error) return null;
  return { allowed: decided.data === true, hours: null, reason: "", start: null, zone: null, explained: false };
}

/**
 * The DNC registry row. "No vendor available" is read from the gate's own structured status
 * (getDncDialingStatus().blocked), never from an error's wording; any other failure of the lookup
 * is "no vendor answered". Both refuse.
 */
async function dncRow(normalizedPhone: string, tenantId: string, fetcher?: typeof fetch) {
  const status = await getDncDialingStatus().catch(() => null);
  if (status?.blocked) return { status: "no_vendor" as const, vendorName: "" };
  try {
    const decision = await performDncVendorLookup(normalizedPhone, tenantId, fetcher);
    return { status: decision.allowed ? ("clear" as const) : ("listed" as const), vendorName: decision.vendorName };
  } catch {
    return { status: "unverified" as const, vendorName: "" };
  }
}

/**
 * Every check the "Check a number" dialog shows, run read-only for one number. The only writes are
 * the evidence the lookups already write (provider-call logs, and the litigator row's screening
 * audit + meter charge on a fresh lookup). Nothing is suppressed, dialled or scheduled.
 */
export async function runDialPreflightChecks(input: { tenantId: string; userId: string; normalizedPhone: string; state?: string | null; fetcher?: typeof fetch }): Promise<DialPreflightReport> {
  const db = getSupabaseServiceClient() as unknown as Db;
  let digits: string | null = null;
  try { digits = getUsPhone10Digits(input.normalizedPhone); } catch { digits = null; }
  // The suppression list and the screening cache store ten US digits. A number that is not a US
  // ten-digit number cannot be matched against them, which is itself an unanswered check.
  const key = digits ?? input.normalizedPhone.replace(/\D/g, "");

  const [lead, suppression, dnc, litigator] = await Promise.all([
    digits ? findLead(db, input.tenantId, digits).catch((error: unknown) => { console.error(`[dial-preflight] ${error instanceof Error ? error.message : "lead lookup failed"}`); return undefined; }) : Promise.resolve(null),
    suppressionCheck(db, input.tenantId, key),
    dncRow(input.normalizedPhone, input.tenantId, input.fetcher),
    digits
      ? checkLitigatorForDialPreflight({ tenantId: input.tenantId, userId: input.userId, phoneDigits: digits, fetcher: input.fetcher })
      : Promise.resolve({ result: "unavailable" as const, vendorName: null, checkedAt: null, cached: false, message: "It needs a ten-digit US number." }),
  ]);

  const leadRow = lead ?? null;
  const values = (leadRow?.values && typeof leadRow.values === "object" ? leadRow.values : {}) as Row;
  const leadState = leadRow ? stateFromLeadValues(values) : null;
  const picked = typeof input.state === "string" && /^[A-Z]{2}$/.test(input.state) ? input.state : null;
  const state = leadState ?? picked;

  const [window, consent] = await Promise.all([
    state ? windowCheck(db, input.tenantId, state, text(leadRow?.campaign_id) || null) : Promise.resolve(undefined),
    leadRow
      ? db.from("tenant_consent_artefacts").select("provider, certificate_id, certificate_url, captured_at, consent_timestamp, capture_status").eq("tenant_id", input.tenantId).eq("lead_id", text(leadRow.id)).order("captured_at", { ascending: false }).limit(1).maybeSingle<Row>()
      : Promise.resolve(null),
  ]);

  const checks: PreflightCheck[] = [];

  // 1 · the agency's own list
  const added = suppression.detail ? longDate(suppression.detail.created_at) : "";
  checks.push(suppression.status === "listed"
    ? { key: "suppression", label: "Your suppression list", result: "Listed", tone: "error", source: "Your own list", age: "live", refuses: true, refusal: `It is on your own suppression list${added ? `, added ${added}` : ""}${suppression.detail?.reason ? ` (“${suppression.detail.reason}”)` : ""}.` }
    : suppression.status === "clear"
      ? { key: "suppression", label: "Your suppression list", result: "Clear", tone: "success", source: "Your own list", age: "live", refuses: false }
      : { key: "suppression", label: "Your suppression list", result: "Unavailable", tone: "warning", source: "Your own list", age: "live", refuses: true, refusal: "Your own suppression list could not be read." });

  // 2 · the DNC registry, one row: the vendor answers one yes/no, not federal and state separately
  checks.push(dnc.status === "clear"
    ? { key: "dnc", label: "DNC registry", result: "Clear", tone: "success", source: dnc.vendorName || "DNC vendor", age: "live", refuses: false }
    : dnc.status === "listed"
      ? { key: "dnc", label: "DNC registry", result: "Listed", tone: "error", source: dnc.vendorName || "DNC vendor", age: "live", refuses: true, refusal: `${dnc.vendorName || "The DNC vendor"} lists it on a do-not-call registry.` }
      : { key: "dnc", label: "DNC registry", result: "Unavailable", tone: "warning", source: dnc.status === "no_vendor" ? "No DNC vendor available" : "No vendor answered", age: "live", refuses: true, refusal: dnc.status === "no_vendor" ? "No DNC vendor is available, so the registry could not be checked." : "No DNC vendor answered, so the registry could not be checked." });

  // 3 · known litigators
  const litigatorSource = litigator.vendorName ?? (litigator.result === "unavailable" ? litigator.message ?? "No feed answered" : "Litigator feed");
  const litigatorAge = litigator.cached ? answerAge(litigator.checkedAt) : "live";
  checks.push(litigator.result === "clear"
    ? { key: "litigator", label: "Known litigators", result: "Clear", tone: "success", source: litigatorSource, age: litigatorAge, refuses: false }
    : litigator.result === "listed"
      ? { key: "litigator", label: "Known litigators", result: "Listed", tone: "error", source: litigatorSource, age: litigatorAge, refuses: true, refusal: "It matches a known TCPA litigator." }
      : { key: "litigator", label: "Known litigators", result: "Unavailable", tone: "warning", source: litigatorSource, age: "live", refuses: true, refusal: `The litigator check could not be completed${litigator.message ? `: ${litigator.message.charAt(0).toLowerCase()}${litigator.message.slice(1)}` : "."}` });

  // 4 · the calling window, for the lead's state or the one the agent picked
  let windowOutcome: DialPreflightReport["outcome"]["window"];
  if (!state) {
    windowOutcome = "no_state";
    checks.push({ key: "window", label: "Calling window", result: "Needs a state", tone: "warning", source: "Pick the customer's state", age: "live", refuses: true, refusal: "The customer's state is not known, so their calling window could not be checked. Pick the state and check again." });
  } else if (!window) {
    windowOutcome = "unavailable";
    checks.push({ key: "window", label: "Calling window", result: "Unavailable", tone: "warning", source: `${state} · could not be verified`, age: "live", refuses: true, refusal: "The calling-window policy could not be verified." });
  } else {
    windowOutcome = window.allowed ? "inside" : "outside";
    const source = window.hours ?? (window.explained ? (window.allowed ? `${state} · ${zoneShort(window.zone)}` : windowClosedLabel(window.reason, window.start, window.zone)) : "window hours unavailable");
    checks.push(window.allowed
      ? { key: "window", label: "Calling window", result: "Inside", tone: "success", source, age: "live", refuses: false }
      : { key: "window", label: "Calling window", result: window.reason === "rules_stale" ? "Refused" : "Outside", tone: "error", source, age: "live", refuses: true, refusal: window.reason === "rules_stale" ? "The calling rules are out of date, so every dial is refused until they are refreshed." : `It is outside the customer's calling window right now${window.hours ? ` (${window.hours})` : ""}.` });
  }

  // 5 · consent: evidence on the matched lead. Shown, never a refusal on its own — the dial gate
  // does not require a certificate, and this screen must not refuse what the dialer would place.
  if (lead === undefined) {
    checks.push({ key: "consent", label: "Consent on file", result: "Unavailable", tone: "warning", source: "The lead lookup failed", age: "—", refuses: false });
  } else if (!leadRow) {
    checks.push({ key: "consent", label: "Consent on file", result: "No lead", tone: "neutral", source: "No lead with this number", age: "—", refuses: false });
  } else if (!consent || consent.error) {
    checks.push({ key: "consent", label: "Consent on file", result: consent?.error ? "Unavailable" : "None on file", tone: "warning", source: consent?.error ? "Could not be read" : "No consent record", age: "—", refuses: false });
  } else if (!consent.data) {
    checks.push({ key: "consent", label: "Consent on file", result: "None on file", tone: "warning", source: "No consent record", age: "—", refuses: false });
  } else {
    const status = text(consent.data.capture_status);
    const provider = text(consent.data.provider);
    checks.push({
      key: "consent",
      label: "Consent on file",
      result: status === "claimed" ? "Claimed" : status ? `${status.charAt(0).toUpperCase()}${status.slice(1)}` : "Recorded",
      tone: status === "claimed" ? "success" : "warning",
      source: provider ? providerName(provider) : "Consent record",
      age: daysAge(text(consent.data.consent_timestamp) || text(consent.data.captured_at)),
      refuses: false,
    });
  }

  return {
    phone: maskDialPhone(input.normalizedPhone),
    checks,
    suppression: suppression.detail,
    lead: leadRow ? { id: text(leadRow.id), state: leadState } : null,
    state,
    outcome: { suppression: suppression.status, dnc: dnc.status, litigator: litigator.result, window: windowOutcome },
  };
}
