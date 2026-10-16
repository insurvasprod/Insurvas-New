import "server-only";

import { getSupabaseServiceClient } from "@/lib/supabase/service";
import { isSchemaGap } from "@/lib/supabase/schemaGap";
import { assertPartnerProductApproved } from "@/lib/partnerProducts/service";
import { findExistingCustomer } from "@/lib/existingCustomerPreflight/service";

import { getUsPhone10Digits } from "./scrub";
import { screenPartnerPhone, type ScreenedDecision } from "./screening";
import { SCREENING_TENANT_DNC_MESSAGE } from "./screeningCore";
import { lookupComplianceEvents } from "./recordIndex";
import { consentValidAt } from "./consentValidity";
import { decideTransfer, screenedBeforeTransfer, SOURCE_MODULE, timed, type GateCheck, type GateDecision } from "./transferGateCore";

/**
 * LA-6.2 (Notion sprint, Module 6 — Compliance) · the pre-transfer gate, server side.
 *
 * Runs every check once, each through the module that owns it, and writes ONE transfer_verdict row
 * with every answer and a pointer to the record behind it:
 *
 *   partner approved for product   LA-1.3   assertPartnerProductApproved
 *   litigator, federal/state DNC   LA-1.5   screenPartnerPhone (its cache, vendors and outage rules)
 *   internal do-not-call           LA-2.3   is_tenant_phone_suppressed
 *   consent artefact               LA-2.6   the consent records, found through the LA-6.1 index
 *   existing customer              LA-1.24  findExistingCustomer
 *   inside legal hours             LA-2.4   tenant_dial_window
 *
 * Two evaluations: on phone-number entry (the real gate, before anyone is connected) and again at
 * submit (lists change and minutes pass). The verdict is decided in transferGateCore.ts.
 */

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Loose = any;
const db = (): Loose => getSupabaseServiceClient();

export type GateSettings = {
  consentMissing: "warn" | "block";
  timeoutMs: number;
  federalDnc: boolean;
  consent: boolean;
  existingCustomer: boolean;
  callingHours: boolean;
};

export const DEFAULT_GATE_SETTINGS: GateSettings = { consentMissing: "warn", timeoutMs: 2000, federalDnc: true, consent: true, existingCustomer: true, callingHours: true };

/** The tenant's gate settings (LA-6.8); the defaults until the row or the table exists. */
export async function loadGateSettings(tenantId: string): Promise<GateSettings> {
  const { data, error } = await db()
    .from("compliance_settings")
    .select("gate_consent_missing, gate_timeout_ms, gate_check_federal_dnc, gate_check_consent, gate_check_existing_customer, gate_check_calling_hours")
    .eq("tenant_id", tenantId)
    .maybeSingle();
  if (error || !data) return DEFAULT_GATE_SETTINGS;
  return {
    consentMissing: data.gate_consent_missing === "block" ? "block" : "warn",
    timeoutMs: Number(data.gate_timeout_ms) || DEFAULT_GATE_SETTINGS.timeoutMs,
    federalDnc: data.gate_check_federal_dnc !== false,
    consent: data.gate_check_consent !== false,
    existingCustomer: data.gate_check_existing_customer !== false,
    callingHours: data.gate_check_calling_hours !== false,
  };
}

/**
 * The verdict could not be recorded. The spec keeps one verdict row per attempt, so an attempt with
 * no record does not proceed: the gate fails closed and the caller answers "could not be completed".
 */
export class TransferGateUnrecorded extends Error {
  readonly status = 503;
  constructor(readonly cause: string) {
    super("Screening could not be completed. Do not treat this number as safe.");
    this.name = "TransferGateUnrecorded";
  }
}

export type TransferEvaluation = {
  verdictId: string | null;
  decision: GateDecision;
  /** LA-1.5's decision, for the lead record (null when approval failed and screening never ran). */
  screening: ScreenedDecision | null;
  phoneDigits: string | null;
  screenedBeforeTransfer: boolean;
  totalDurationMs: number;
};

type EvaluateInput = {
  tenantId: string;
  partnerId: string;
  partnerUserId: string | null;
  productCode: string;
  phone: unknown;
  carrierState: string | null;
  submissionId: string | null;
  stage: "number_entry" | "submit";
  /** The form's values so far (name, date of birth, address help the existing-customer match). */
  values?: Record<string, unknown>;
};

const skipped = (check: GateCheck["check"], detail: string, module: string): GateCheck => ({ check, result: "skipped", detail, source_module: module, source_record_id: null, duration_ms: 0 });

const PRODUCT_REASONS: Record<string, string> = {
  partner_product_not_approved: "This partner is not approved for that product.",
  product_not_enabled: "That product is disabled for this tenant.",
  product_not_found: "That product does not exist.",
};

async function productCheck(input: EvaluateInput, budget: number) {
  return timed("partner_product_approved", budget, async () => {
    try {
      await assertPartnerProductApproved(input.tenantId, input.partnerId, input.productCode);
      return { result: "pass", detail: `Approved for ${input.productCode}.`, source_record_id: null };
    } catch (error) {
      const code = error instanceof Error ? error.message : "";
      if (PRODUCT_REASONS[code]) return { result: "hit", detail: PRODUCT_REASONS[code], source_record_id: null };
      throw error;
    }
  });
}

async function internalDncCheck(tenantId: string, phoneDigits: string): Promise<GateCheck> {
  // Not on the time budget: our own list is absolute, so it waits for its answer.
  return timed("internal_dnc", 60_000, async () => {
    const { data, error } = await db().rpc("is_tenant_phone_suppressed", { p_tenant_id: tenantId, p_phone_digits: phoneDigits });
    if (error) throw new Error(error.message);
    if (!data) return { result: "pass", detail: "Not on your do-not-call list.", source_record_id: null };
    const { data: row } = await db().from("tenant_do_not_call").select("id").eq("tenant_id", tenantId).eq("phone_digits", phoneDigits).eq("is_active", true).maybeSingle();
    return { result: "hit", detail: "On your do-not-call list.", source_record_id: (row?.id as string | undefined) ?? null };
  });
}

async function consentCheck(tenantId: string, phoneDigits: string, budget: number): Promise<GateCheck> {
  return timed("consent_artefact", budget, async () => {
    const events = (await lookupComplianceEvents(tenantId, { phoneDigits })).filter((e) => e.eventType === "consent" && e.sourceTable === "tenant_consent_artefacts");
    if (!events.length) return { result: "hit", detail: "No consent artefact on file for this number.", source_record_id: null };
    const { data, error } = await db()
      .from("tenant_consent_artefacts")
      .select("id, provider, capture_status, consent_timestamp, captured_at")
      .eq("tenant_id", tenantId)
      .in("id", events.map((e) => e.sourceId))
      .order("captured_at", { ascending: false });
    if (error) throw new Error(error.message);
    // The same rule the evidence report's gap checks apply (consentValidity.ts and its SQL twin): a
    // pending certificate whose claim window has closed covers nothing, and neither does consent
    // given after now.
    const at = new Date();
    const valid = ((data ?? []) as Loose[]).find((a) => consentValidAt(a, at));
    if (!valid) return { result: "hit", detail: "No consent artefact on file is valid now (expired, failed, or its claim window has closed).", source_record_id: (data?.[0]?.id as string | undefined) ?? null };
    return { result: "pass", detail: `${valid.provider} certificate, ${valid.capture_status}.`, source_record_id: valid.id as string };
  });
}

async function existingCustomerCheck(input: EvaluateInput, phoneDigits: string, budget: number): Promise<GateCheck> {
  return timed("existing_customer", budget, async () => {
    const { status, matches } = await findExistingCustomer({ tenantId: input.tenantId, values: { ...(input.values ?? {}), phone: phoneDigits } });
    const first = matches[0];
    const pointer = first?.contactId ?? first?.leadId ?? null;
    if (status === "already_customer") return { result: "hit", detail: `Already a customer (${matches.length} match${matches.length === 1 ? "" : "es"}).`, source_record_id: pointer };
    if (status === "spoken_before") return { result: "pass", detail: "Spoken to before; not a customer.", source_record_id: pointer };
    return { result: "pass", detail: "New household.", source_record_id: null };
  });
}

const WINDOW_INCOMPLETE: Record<string, string> = {
  no_state: "No state was given, so the window could not be checked.",
  rules_stale: "The calling-window rules are out of date.",
  no_zone: "No time zone is known for that state.",
};

async function hoursCheck(tenantId: string, state: string | null, budget: number): Promise<GateCheck> {
  return timed("calling_hours", budget, async () => {
    const { data, error } = await db().rpc("tenant_dial_window", { p_tenant_id: tenantId, p_state: state, p_campaign_id: null, p_at: new Date().toISOString() });
    if (error) throw new Error(error.message);
    const row = (Array.isArray(data) ? data[0] : data) as Loose;
    if (!row) throw new Error("no answer");
    if (row.allowed) return { result: "pass", detail: `Inside the ${state} window.`, source_record_id: null };
    if (WINDOW_INCOMPLETE[row.reason]) return { result: "incomplete", detail: WINDOW_INCOMPLETE[row.reason], source_record_id: null };
    const hhmm = (m: number | null) => (m == null ? "?" : `${String(Math.floor(m / 60)).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`);
    return { result: "hit", detail: `Outside the ${state} window (${hhmm(row.start_minute)}–${hhmm(row.end_minute)} local, it is ${hhmm(row.local_minute)}; ${String(row.reason ?? "closed").replace(/_/g, " ")}).`, source_record_id: null };
  });
}

function screeningChecks(screening: ScreenedDecision, settings: GateSettings): GateCheck[] {
  const pointer = screening.auditId ?? screening.resultId;
  const litigator: GateCheck = { check: "tcpa_litigator", result: "pass", detail: "Not a known litigator.", source_module: "LA-1.5", source_record_id: pointer, duration_ms: 0 };
  const federal: GateCheck = { check: "federal_state_dnc", result: "pass", detail: "Not on a federal or state list.", source_module: "LA-2.3", source_record_id: pointer, duration_ms: 0 };
  if (screening.outcome === "tcpa_litigator") {
    litigator.result = "hit";
    litigator.detail = "Matched a TCPA litigator list.";
  } else if (screening.outcome === "unavailable") {
    litigator.result = "incomplete";
    litigator.detail = screening.message;
    federal.result = "incomplete";
    federal.detail = screening.message;
  } else if (screening.outcome === "dnc" && screening.message !== SCREENING_TENANT_DNC_MESSAGE) {
    federal.result = "hit";
    federal.detail = "On a federal or state do-not-call list.";
  } else if (screening.outcome === "dnc") {
    federal.detail = "On your own list (see the internal do-not-call check); the vendor answer is in the screening record.";
  }
  return [litigator, settings.federalDnc ? federal : skipped("federal_state_dnc", "Switched off in compliance settings.", "LA-2.3")];
}

/** Evaluate one transfer attempt and record the verdict. */
export async function evaluateTransfer(input: EvaluateInput): Promise<TransferEvaluation> {
  const started = Date.now();
  const settings = await loadGateSettings(input.tenantId);
  const budget = settings.timeoutMs;

  let phoneDigits: string | null = null;
  try {
    phoneDigits = getUsPhone10Digits(input.phone);
  } catch {
    phoneDigits = null;
  }

  // Approval first: a partner not approved for the product never costs a vendor lookup.
  const product = await productCheck(input, budget);
  if (product.result !== "pass") {
    const notRun = "Not run: the partner is not cleared for this product.";
    const decision = decideTransfer({
      invalidPhone: false,
      checks: [product, ...(["tcpa_litigator", "internal_dnc", "federal_state_dnc", "consent_artefact", "existing_customer", "calling_hours"] as const).map((c) => skipped(c, notRun, SOURCE_MODULE[c]))],
      consentMissingAction: settings.consentMissing,
    });
    const before = screenedBeforeTransfer(input.stage, false);
    const verdictId = await recordVerdict(input, phoneDigits, decision, before, Date.now() - started);
    return { verdictId, decision, screening: null, phoneDigits, screenedBeforeTransfer: before, totalDurationMs: Date.now() - started };
  }

  const t0 = Date.now();
  const [screening, internalDnc, consent, existing, hours] = await Promise.all([
    // LA-1.5 decides an invalid number itself and writes its own audit row.
    screenPartnerPhone({ tenantId: input.tenantId, partnerId: input.partnerId, userId: input.partnerUserId, phone: input.phone }),
    phoneDigits ? internalDncCheck(input.tenantId, phoneDigits) : Promise.resolve(skipped("internal_dnc", "Not a valid US number.", "LA-2.3")),
    phoneDigits && settings.consent ? consentCheck(input.tenantId, phoneDigits, budget) : Promise.resolve(skipped("consent_artefact", phoneDigits ? "Switched off in compliance settings." : "Not a valid US number.", "LA-2.6")),
    phoneDigits && settings.existingCustomer ? existingCustomerCheck(input, phoneDigits, budget) : Promise.resolve(skipped("existing_customer", phoneDigits ? "Switched off in compliance settings." : "Not a valid US number.", "LA-1.24")),
    settings.callingHours ? hoursCheck(input.tenantId, input.carrierState, budget) : Promise.resolve(skipped("calling_hours", "Switched off in compliance settings.", "LA-2.4")),
  ]);
  const screeningMs = Date.now() - t0;
  const [litigator, federal] = screeningChecks(screening, settings);
  litigator.duration_ms = screeningMs;
  federal.duration_ms = screeningMs;

  const decision = decideTransfer({
    invalidPhone: screening.outcome === "invalid_phone",
    checks: [product, litigator, internalDnc, federal, consent, existing, hours],
    consentMissingAction: settings.consentMissing,
  });

  let earlierAccept = false;
  if (input.stage === "submit" && input.submissionId && phoneDigits) {
    const { data } = await db()
      .from("transfer_verdict")
      .select("id")
      .eq("tenant_id", input.tenantId)
      .eq("submission_id", input.submissionId)
      .eq("stage", "number_entry")
      .eq("phone_digits", phoneDigits)
      .neq("verdict", "reject")
      .limit(1);
    earlierAccept = Boolean(data?.length);
  }
  const before = screenedBeforeTransfer(input.stage, earlierAccept);
  const totalDurationMs = Date.now() - started;

  const verdictId = await recordVerdict(input, phoneDigits, decision, before, totalDurationMs);
  return { verdictId, decision, screening, phoneDigits, screenedBeforeTransfer: before, totalDurationMs };
}

async function recordVerdict(input: EvaluateInput, phoneDigits: string | null, decision: GateDecision, before: boolean, totalDurationMs: number): Promise<string> {
  const { data: row, error } = await db()
    .from("transfer_verdict")
    .insert({
      tenant_id: input.tenantId,
      partner_id: input.partnerId,
      partner_user_id: input.partnerUserId,
      submission_id: input.submissionId,
      phone_digits: phoneDigits,
      product_code: input.productCode,
      carrier_state: input.carrierState && /^[A-Z]{2}$/.test(input.carrierState) ? input.carrierState : null,
      stage: input.stage,
      verdict: decision.verdict,
      checks_json: decision.checks,
      blocking_reason: decision.blockingReason,
      warnings_json: decision.warnings,
      total_duration_ms: totalDurationMs,
      screened_before_transfer: before,
    })
    .select("id")
    .single();
  if (error || !row?.id) {
    // Fail closed: an attempt with no verdict row is an attempt nobody can later prove was screened.
    const why = error ? (isSchemaGap(error) ? `the verdict table is missing (${error.message})` : error.message) : "no row came back";
    console.error(`[transfer-gate] the verdict could not be recorded; the transfer is refused: ${why}`);
    throw new TransferGateUnrecorded(why);
  }
  return row.id as string;
}

/** The accepted verdict points at the lead it became. */
export async function linkVerdictToLead(tenantId: string, verdictId: string | null, leadId: string) {
  if (!verdictId) return;
  const { error } = await db().from("transfer_verdict").update({ lead_id: leadId }).eq("tenant_id", tenantId).eq("id", verdictId).is("lead_id", null);
  if (error) console.error(`[transfer-gate] could not link verdict ${verdictId} to lead ${leadId}: ${error.message}`);
}
