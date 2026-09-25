import "server-only";

import { getSupabaseServiceClient } from "@/lib/supabase/service";
import { recordProviderCall } from "@/lib/payments/logging";
import { recordUsage, checkMeterCapacity, consumeMeterCapacity } from "@/lib/metering/enforce";
import type { Json } from "@/lib/supabase/database.types";
import { decryptVendorCredentials } from "./crypto";
import { getUsPhone10Digits, maskDialPhone } from "./scrub";
import type { ComplianceVendorType } from "./constants";
import { parseTypedScreeningResponse } from "./screening-contract";
import { demoScreeningEnabled, demoScreeningListed, demoScreeningResponse, demoScreeningVendor } from "./demo";

export const SCREENING_RESULT_VERSION = 1;
export const SCREENING_CACHE_TTL_SECONDS = 24 * 60 * 60;

export type ScreeningOutcome = "clear" | "dnc" | "internal_dq" | "tcpa_litigator" | "invalid_phone" | "unavailable";
export type ScreeningWarning = { code: "dnc" | "internal_dq"; message: string };

type JsonObject = { [key: string]: Json };
type ScreeningVendor = { id: string; endpoint: string; credentials: string | null; vendorType: ComplianceVendorType };
type VendorCheck = { vendorId: string; listed: boolean; rawResponse: JsonObject };
type ScreeningResultRow = {
  id: string;
  phone_digits: string;
  outcome: Exclude<ScreeningOutcome, "invalid_phone" | "unavailable"> | "unavailable";
  vendor: string;
  raw_response: JsonObject;
  warnings: Json;
  version: number;
  checked_at: string;
  expires_at: string;
};

export type ScreeningDecision = {
  allowed: boolean;
  phoneDigits: string | null;
  outcome: ScreeningOutcome;
  warning: ScreeningWarning | null;
  resultId: string | null;
  version: number;
  checkedAt: string | null;
  cached: boolean;
  message: string;
};

export type ScreeningProvider = {
  vendorId: string;
  vendorType: "dnc_scrub" | "litigator_scrub";
  check(phoneDigits: string): Promise<{ listed: boolean; rawResponse: JsonObject }>;
};

function makeProvider(vendor: ScreeningVendor, fetcher: typeof fetch): ScreeningProvider {
  if (vendor.vendorType !== "dnc_scrub" && vendor.vendorType !== "litigator_scrub") throw new Error("Unsupported screening vendor type");
  const vendorType = vendor.vendorType;
  if (vendor.endpoint === `demo://${vendorType}`) {
    return {
      vendorId: vendor.id,
      vendorType,
      async check(phoneDigits) {
        const listed = demoScreeningListed(vendorType, phoneDigits);
        return { listed, rawResponse: demoScreeningResponse(vendorType, listed) };
      },
    };
  }
  return {
    vendorId: vendor.id,
    vendorType: vendor.vendorType,
    async check(phoneDigits) {
      const headers: Record<string, string> = { accept: "application/json", "content-type": "application/json" };
      if (vendor.credentials) headers.authorization = `Bearer ${vendor.credentials}`;
      const response = await fetcher(vendor.endpoint, {
        method: "POST",
        headers,
        body: JSON.stringify({ phone: phoneDigits }),
        signal: AbortSignal.timeout(10_000),
      });
      if (!response.ok) throw new Error(`Vendor answered with HTTP ${response.status}`);
      return parseTypedScreeningResponse(await response.json().catch(() => null), vendorType);
    },
  };
}

function providerErrorCategory(error: unknown): string {
  if (error instanceof Error && error.name === "TimeoutError") return "timeout";
  if (error instanceof Error && error.message.startsWith("Vendor answered with HTTP")) return "http";
  if (error instanceof Error && error.message.includes("typed screening decision")) return "invalid_response";
  return "network";
}

async function loadProviders(vendorType: "dnc_scrub" | "litigator_scrub"): Promise<ScreeningVendor[]> {
  if (demoScreeningEnabled()) return [demoScreeningVendor(vendorType)];
  const { data, error } = await getSupabaseServiceClient().from("compliance_vendors")
    .select("id, endpoint, credentials_enc, vendor_type")
    .eq("vendor_type", vendorType)
    .eq("is_enabled", true)
    .order("priority")
    .order("name");
  if (error) throw new Error(`Could not load ${vendorType} vendors: ${error.message}`);
  return (data ?? []).map((row) => ({
    id: row.id,
    endpoint: row.endpoint,
    credentials: row.credentials_enc ? decryptCredentials(row.credentials_enc) : null,
    vendorType,
  } satisfies ScreeningVendor));
}

function decryptCredentials(value: string): string {
  return decryptVendorCredentials(value) ?? "";
}

async function runProviderType(
  tenantId: string,
  vendorType: "dnc_scrub" | "litigator_scrub",
  phoneDigits: string,
  fetcher: typeof fetch,
): Promise<VendorCheck> {
  const vendors = await loadProviders(vendorType);
  if (!vendors.length) throw new Error(`No enabled ${vendorType} vendor is available`);
  let lastError: unknown = new Error(`No ${vendorType} vendor responded`);
  for (let index = 0; index < vendors.length; index++) {
    const vendor = makeProvider(vendors[index], fetcher);
    const startedAt = performance.now();
    try {
      const result = await vendor.check(phoneDigits);
      await recordProviderCall({
        tenantId,
        provider: `compliance_vendor:${vendor.vendorId}`,
        method: vendorType,
        request: { phone: maskDialPhone(phoneDigits) },
        response: result.rawResponse,
        status: "ok",
        durationMs: Math.round(performance.now() - startedAt),
      });
      return { vendorId: vendor.vendorId, listed: result.listed, rawResponse: result.rawResponse };
    } catch (error) {
      lastError = error;
      await recordProviderCall({
        tenantId,
        provider: `compliance_vendor:${vendor.vendorId}`,
        method: vendorType,
        request: { phone: maskDialPhone(phoneDigits) },
        response: { category: providerErrorCategory(error) },
        status: providerErrorCategory(error) === "timeout" ? "timeout" : "error",
        durationMs: Math.round(performance.now() - startedAt),
      });
      const next = vendors[index + 1];
      if (next) await recordProviderCall({
        tenantId,
        provider: `compliance_vendor:${vendor.vendorId}`,
        method: "fallback",
        request: { fromVendorId: vendor.vendorId, toVendorId: next.id, vendorType },
        response: { reason: "primary vendor failed" },
        status: "error",
        durationMs: 0,
      });
    }
  }
  throw lastError instanceof Error ? lastError : new Error("Screening vendor failed");
}

function warningFor(outcome: ScreeningOutcome, internalDq: boolean): ScreeningWarning | null {
  if (outcome === "dnc") return { code: "dnc", message: "This number appears on a DNC list. The lead was accepted with a compliance warning." };
  if (outcome === "internal_dq") return { code: "internal_dq", message: "This number matches an existing lead. Review it before contacting the consumer." };
  if (internalDq) return { code: "internal_dq", message: "This number matches an existing lead. Review it before contacting the consumer." };
  return null;
}

async function writeAudit(params: {
  tenantId: string;
  partnerId: string | null;
  userId: string | null;
  phoneDigits: string | null;
  outcome: ScreeningOutcome;
  vendor: string | null;
  rawResponse: JsonObject;
  resultId: string | null;
  cached: boolean;
}) {
  const { error } = await getSupabaseServiceClient().from("screening_audit").insert({
    tenant_id: params.tenantId,
    partner_id: params.partnerId,
    user_id: params.userId,
    phone_digits: params.phoneDigits,
    outcome: params.outcome,
    vendor: params.vendor,
    raw_response: params.rawResponse,
    result_id: params.resultId,
    cached: params.cached,
    version: SCREENING_RESULT_VERSION,
  });
  if (error) throw new Error(`Could not write screening audit: ${error.message}`);
}

async function cachedDecision(row: ScreeningResultRow, input: { tenantId: string; partnerId: string | null; userId: string | null }): Promise<ScreeningDecision> {
  const outcome = row.outcome as ScreeningOutcome;
  const warning = warningFor(outcome, outcome === "internal_dq");
  await writeAudit({ ...input, phoneDigits: row.phone_digits, outcome, vendor: row.vendor, rawResponse: row.raw_response, resultId: row.id, cached: true });
  return {
    allowed: outcome !== "tcpa_litigator" && outcome !== "unavailable",
    phoneDigits: row.phone_digits,
    outcome,
    warning,
    resultId: row.id,
    version: row.version,
    checkedAt: row.checked_at,
    cached: true,
    message: outcome === "tcpa_litigator" ? "This number matched a TCPA litigator list. The lead was not submitted." : warning?.message ?? "Screening passed.",
  };
}

async function waitForClaim(tenantId: string, phoneDigits: string) {
  const startedAt = Date.now();
  while (Date.now() - startedAt < 10_000) {
    const { data, error } = await getSupabaseServiceClient().rpc("claim_screening_cache", { p_tenant_id: tenantId, p_phone_digits: phoneDigits, p_version: SCREENING_RESULT_VERSION, p_claim_seconds: 30 });
    if (error) throw new Error(`Could not claim screening cache: ${error.message}`);
    const row = (Array.isArray(data) ? data[0] : data) as { state: "cached" | "claimed" | "in_flight"; result_id: string | null; claim_token: string | null } | null;
    if (row?.state !== "in_flight") return row;
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  return null;
}

export async function screenPartnerPhone(input: {
  tenantId: string;
  partnerId: string | null;
  userId: string | null;
  phone: unknown;
  fetcher?: typeof fetch;
}): Promise<ScreeningDecision> {
  let phoneDigits: string;
  try {
    phoneDigits = getUsPhone10Digits(input.phone);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Enter a valid US phone number";
    await writeAudit({ tenantId: input.tenantId, partnerId: input.partnerId, userId: input.userId, phoneDigits: null, outcome: "invalid_phone", vendor: null, rawResponse: { error: "invalid_phone" }, resultId: null, cached: false });
    return { allowed: false, phoneDigits: null, outcome: "invalid_phone", warning: null, resultId: null, version: SCREENING_RESULT_VERSION, checkedAt: null, cached: false, message };
  }

  // The tenant's own suppression list is checked before the shared screening cache. A number
  // that was added after a previous vendor result must warn on the very next intake.
  const { data: tenantSuppressed, error: tenantSuppressionError } = await getSupabaseServiceClient().rpc("is_tenant_phone_suppressed", { p_tenant_id: input.tenantId, p_phone_digits: phoneDigits });
  if (tenantSuppressionError) throw new Error(`Could not check tenant do-not-call list: ${tenantSuppressionError.message}`);
  if (tenantSuppressed) {
    const message = "This number is on your do-not-call list. Confirm before submitting.";
    await writeAudit({ ...input, phoneDigits, outcome: "dnc", vendor: "tenant_suppression", rawResponse: { source: "tenant_do_not_call" }, resultId: null, cached: false });
    return { allowed: true, phoneDigits, outcome: "dnc", warning: { code: "dnc", message }, resultId: null, version: SCREENING_RESULT_VERSION, checkedAt: new Date().toISOString(), cached: false, message };
  }

  const claim = await waitForClaim(input.tenantId, phoneDigits);
  if (claim?.state === "cached" && claim.result_id) {
    const { data, error } = await getSupabaseServiceClient().from("screening_results").select("id, phone_digits, outcome, vendor, raw_response, warnings, version, checked_at, expires_at").eq("id", claim.result_id).single<ScreeningResultRow>();
    if (error || !data) throw new Error("Cached screening result could not be replayed");
    return cachedDecision(data, input);
  }
  if (claim?.state !== "claimed" || !claim.claim_token) {
    await writeAudit({ ...input, phoneDigits, outcome: "unavailable", vendor: null, rawResponse: { error: "screening_in_flight_timeout" }, resultId: null, cached: false });
    return { allowed: false, phoneDigits, outcome: "unavailable", warning: null, resultId: null, version: SCREENING_RESULT_VERSION, checkedAt: null, cached: false, message: "Screening could not be completed. Do not treat this number as safe." };
  }

  const claimToken = claim.claim_token;
  const release = async () => { await getSupabaseServiceClient().rpc("release_screening_cache", { p_tenant_id: input.tenantId, p_phone_digits: phoneDigits, p_version: SCREENING_RESULT_VERSION, p_claim_token: claimToken }); };
  try {
    const idempotencyBase = `screening:${claimToken}`;
    const tcpaCapacity = await checkMeterCapacity(input.tenantId, "tcpa_checks");
    if (!tcpaCapacity.allowed) {
      await release();
      await writeAudit({ ...input, phoneDigits, outcome: "unavailable", vendor: null, rawResponse: { error: "screening_meter_cap" }, resultId: null, cached: false });
      return { allowed: false, phoneDigits, outcome: "unavailable", warning: null, resultId: null, version: SCREENING_RESULT_VERSION, checkedAt: null, cached: false, message: "Screening could not be completed because the plan's screening allowance is exhausted. Do not treat this number as safe." };
    }

    const dncCapacity = await consumeMeterCapacity({ tenantId: input.tenantId, meterKey: "dnc_lookups", qty: 1, idempotencyKey: `${idempotencyBase}:dnc`, ref: idempotencyBase });
    if (!dncCapacity.allowed) {
      await release();
      await writeAudit({ ...input, phoneDigits, outcome: "unavailable", vendor: null, rawResponse: { error: "screening_meter_cap" }, resultId: null, cached: false });
      return { allowed: false, phoneDigits, outcome: "unavailable", warning: null, resultId: null, version: SCREENING_RESULT_VERSION, checkedAt: null, cached: false, message: "Screening could not be completed because the plan's DNC lookup allowance is exhausted. Do not treat this number as safe." };
    }
    await recordUsage({ tenantId: input.tenantId, meterKey: "tcpa_checks", qty: 1, idempotencyKey: `${idempotencyBase}:tcpa`, ref: idempotencyBase });

    const fetcher = input.fetcher ?? fetch;
    const [tcpa, dnc] = await Promise.all([
      runProviderType(input.tenantId, "litigator_scrub", phoneDigits, fetcher),
      runProviderType(input.tenantId, "dnc_scrub", phoneDigits, fetcher),
    ]);
    const { data: internalDq, error: internalDqError } = await getSupabaseServiceClient().rpc("has_existing_lead_phone", { p_tenant_id: input.tenantId, p_phone_digits: phoneDigits });
    if (internalDqError) throw new Error(`Could not complete internal duplicate screening: ${internalDqError.message}`);
    const outcome: Exclude<ScreeningOutcome, "invalid_phone" | "unavailable"> = tcpa.listed ? "tcpa_litigator" : dnc.listed ? "dnc" : internalDq ? "internal_dq" : "clear";
    const warning = warningFor(outcome, Boolean(internalDq));
    const checkedAt = new Date();
    const expiresAt = new Date(checkedAt.getTime() + SCREENING_CACHE_TTL_SECONDS * 1000);
    const supabase = getSupabaseServiceClient();
    const { data: resultId, error: completeError } = await supabase.rpc("complete_screening_cache", {
      p_tenant_id: input.tenantId,
      p_phone_digits: phoneDigits,
      p_version: SCREENING_RESULT_VERSION,
      p_claim_token: claimToken,
      p_outcome: outcome,
      p_vendor: `litigator:${tcpa.vendorId},dnc:${dnc.vendorId}`,
      p_raw_response: { litigator: tcpa.rawResponse, dnc: dnc.rawResponse, internal_dq: Boolean(internalDq) },
      p_warnings: warning ? [warning] : [],
      p_checked_at: checkedAt.toISOString(),
      p_expires_at: expiresAt.toISOString(),
    });
    if (completeError || !resultId) throw new Error(completeError?.message ?? "Could not persist screening result");
    await writeAudit({ ...input, phoneDigits, outcome, vendor: `litigator:${tcpa.vendorId},dnc:${dnc.vendorId}`, rawResponse: { litigator: tcpa.rawResponse, dnc: dnc.rawResponse, internal_dq: Boolean(internalDq) }, resultId, cached: false });
    return { allowed: outcome !== "tcpa_litigator", phoneDigits, outcome, warning, resultId, version: SCREENING_RESULT_VERSION, checkedAt: checkedAt.toISOString(), cached: false, message: outcome === "tcpa_litigator" ? "This number matched a TCPA litigator list. The lead was not submitted." : warning?.message ?? "Screening passed." };
  } catch {
    await release();
    await writeAudit({ ...input, phoneDigits, outcome: "unavailable", vendor: null, rawResponse: { error: "screening_unavailable" }, resultId: null, cached: false });
    return { allowed: false, phoneDigits, outcome: "unavailable", warning: null, resultId: null, version: SCREENING_RESULT_VERSION, checkedAt: null, cached: false, message: "Screening could not be completed. Do not treat this number as safe." };
  }
}

/* ── the dial preflight dialog's litigator row ─────────────────────────────────────────────────── */

export type DialPreflightLitigator = {
  result: "clear" | "listed" | "unavailable";
  vendorName: string | null;
  /** When the answer was obtained: now for a fresh lookup, the cached check's time otherwise. */
  checkedAt: string | null;
  cached: boolean;
  /** Why it is unavailable, in words the dialog can show. */
  message: string | null;
};

const PREFLIGHT_SOURCE = "dial_preflight";

async function litigatorVendorName(vendorId: string | null): Promise<string | null> {
  if (!vendorId) return null;
  if (vendorId.startsWith("demo:")) return "Demo litigator feed";
  const { data, error } = await getSupabaseServiceClient().from("compliance_vendors").select("name").eq("id", vendorId).maybeSingle<{ name: string }>();
  return error ? null : data?.name ?? null;
}

async function auditQuietly(params: Parameters<typeof writeAudit>[0]) {
  // The audit row is evidence, not the decision: a failed insert must not turn a vendor's real
  // answer into "unavailable". It is logged instead.
  try { await writeAudit(params); } catch (error) { console.error(`[dial-preflight] ${error instanceof Error ? error.message : "screening audit failed"}`); }
}

/**
 * "Known litigators" for the dial preflight dialog (user decision 2026-09-24: run it here only; the
 * dial gate itself is unchanged).
 *
 * Billing: a litigator lookup bills the `tcpa_checks` meter, and a result still inside its 24-hour
 * TTL must not bill again.
 *   1. The partner-intake cache is asked through claim_screening_cache, the same tenant-scoped
 *      function intake uses (a direct tenant filter on screening_results would hit the legacy
 *      organizations-plane table of the same name). Its outcome ranks tcpa_litigator first, so any
 *      other completed outcome means the litigator list was clear. A claim this took is released
 *      at once: this check never writes the intake cache.
 *   2. Otherwise a vendor is asked, after the meter says there is capacity, and the meter is charged
 *      only for an answer actually received — once per number per day (the idempotency key), so
 *      checking the same number again in the dialog does not bill twice.
 * Every failure is "unavailable", never "clear".
 */
export async function checkLitigatorForDialPreflight(input: {
  tenantId: string;
  userId: string | null;
  phoneDigits: string;
  fetcher?: typeof fetch;
}): Promise<DialPreflightLitigator> {
  const db = getSupabaseServiceClient();
  const audit = { tenantId: input.tenantId, partnerId: null, userId: input.userId, phoneDigits: input.phoneDigits };
  const now = new Date();

  const claim = await db.rpc("claim_screening_cache", { p_tenant_id: input.tenantId, p_phone_digits: input.phoneDigits, p_version: SCREENING_RESULT_VERSION, p_claim_seconds: 30 });
  const claimRow = (claim.error ? null : Array.isArray(claim.data) ? claim.data[0] : claim.data) as { state: "cached" | "claimed" | "in_flight"; result_id: string | null; claim_token: string | null } | null;
  if (claimRow?.state === "claimed" && claimRow.claim_token) {
    await db.rpc("release_screening_cache", { p_tenant_id: input.tenantId, p_phone_digits: input.phoneDigits, p_version: SCREENING_RESULT_VERSION, p_claim_token: claimRow.claim_token });
  }
  if (claimRow?.state === "cached" && claimRow.result_id) {
    const cached = await db.from("screening_results").select("id, outcome, vendor, checked_at").eq("id", claimRow.result_id)
      .maybeSingle<{ id: string; outcome: string; vendor: string; checked_at: string }>();
    if (!cached.error && cached.data && cached.data.outcome !== "unavailable") {
      const vendorId = /litigator:([^,]+)/.exec(cached.data.vendor)?.[1] ?? null;
      const listed = cached.data.outcome === "tcpa_litigator";
      await auditQuietly({ ...audit, outcome: listed ? "tcpa_litigator" : "clear", vendor: cached.data.vendor, rawResponse: { source: PREFLIGHT_SOURCE, cache: "screening_results" }, resultId: cached.data.id, cached: true });
      return { result: listed ? "listed" : "clear", vendorName: await litigatorVendorName(vendorId), checkedAt: cached.data.checked_at, cached: true, message: null };
    }
  }
  let capacity: Awaited<ReturnType<typeof checkMeterCapacity>>;
  try {
    capacity = await checkMeterCapacity(input.tenantId, "tcpa_checks");
  } catch {
    return { result: "unavailable", vendorName: null, checkedAt: null, cached: false, message: "The screening allowance could not be checked." };
  }
  if (!capacity.allowed) {
    await auditQuietly({ ...audit, outcome: "unavailable", vendor: null, rawResponse: { source: PREFLIGHT_SOURCE, error: "screening_meter_cap" }, resultId: null, cached: false });
    return { result: "unavailable", vendorName: null, checkedAt: null, cached: false, message: "The plan's screening allowance is used up." };
  }

  let check: VendorCheck;
  try {
    check = await runProviderType(input.tenantId, "litigator_scrub", input.phoneDigits, input.fetcher ?? fetch);
  } catch (error) {
    await auditQuietly({ ...audit, outcome: "unavailable", vendor: null, rawResponse: { source: PREFLIGHT_SOURCE, error: "screening_unavailable" }, resultId: null, cached: false });
    const none = error instanceof Error && error.message.startsWith("No enabled");
    return { result: "unavailable", vendorName: null, checkedAt: null, cached: false, message: none ? "No litigator feed is enabled." : "No litigator feed answered." };
  }
  // One charge per number per UTC day: a second check of the same number in the dialog asks the
  // vendor again (the answer is live) but does not bill again.
  const ref = `dial-preflight:${input.tenantId}:${input.phoneDigits}:${now.toISOString().slice(0, 10)}`;
  try {
    await recordUsage({ tenantId: input.tenantId, meterKey: "tcpa_checks", qty: 1, idempotencyKey: `${ref}:tcpa`, ref });
  } catch (error) {
    console.error(`[dial-preflight] could not bill the litigator lookup: ${error instanceof Error ? error.message : "unknown"}`);
  }
  await auditQuietly({ ...audit, outcome: check.listed ? "tcpa_litigator" : "clear", vendor: `litigator:${check.vendorId}`, rawResponse: { source: PREFLIGHT_SOURCE, litigator: check.rawResponse }, resultId: null, cached: false });
  return { result: check.listed ? "listed" : "clear", vendorName: await litigatorVendorName(check.vendorId), checkedAt: now.toISOString(), cached: false, message: null };
}