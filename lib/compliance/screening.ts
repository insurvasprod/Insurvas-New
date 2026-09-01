import "server-only";

import { getSupabaseServiceClient } from "@/lib/supabase/service";
import { recordProviderCall } from "@/lib/payments/logging";
import { recordUsage, checkMeterCapacity } from "@/lib/metering/enforce";
import type { Json } from "@/lib/supabase/database.types";
import { decryptVendorCredentials } from "./crypto";
import { getUsPhone10Digits, maskDialPhone } from "./scrub";
import type { ComplianceVendorType } from "./constants";
import { parseTypedScreeningResponse } from "./screening-contract";

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
  partnerId: string;
  userId: string;
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

async function cachedDecision(row: ScreeningResultRow, input: { tenantId: string; partnerId: string; userId: string }): Promise<ScreeningDecision> {
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
  partnerId: string;
  userId: string;
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
    const [tcpaCapacity, dncCapacity] = await Promise.all([
      checkMeterCapacity(input.tenantId, "tcpa_checks"),
      checkMeterCapacity(input.tenantId, "dnc_lookups"),
    ]);
    if (!tcpaCapacity.allowed || !dncCapacity.allowed) {
      await release();
      await writeAudit({ ...input, phoneDigits, outcome: "unavailable", vendor: null, rawResponse: { error: "screening_meter_cap" }, resultId: null, cached: false });
      return { allowed: false, phoneDigits, outcome: "unavailable", warning: null, resultId: null, version: SCREENING_RESULT_VERSION, checkedAt: null, cached: false, message: "Screening could not be completed because the plan's screening allowance is exhausted. Do not treat this number as safe." };
    }

    const idempotencyBase = `screening:${claimToken}`;
    await Promise.all([
      recordUsage({ tenantId: input.tenantId, meterKey: "tcpa_checks", qty: 1, idempotencyKey: `${idempotencyBase}:tcpa`, ref: idempotencyBase }),
      recordUsage({ tenantId: input.tenantId, meterKey: "dnc_lookups", qty: 1, idempotencyKey: `${idempotencyBase}:dnc`, ref: idempotencyBase }),
    ]);

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
