import "server-only";

import { getSupabaseServiceClient } from "@/lib/supabase/service";
import { recordProviderCall } from "@/lib/payments/logging";
import { recordUsage, checkMeterCapacity, consumeMeterCapacity } from "@/lib/metering/enforce";
import { decryptVendorCredentials } from "./crypto";
import { getUsPhone10Digits, maskDialPhone } from "./scrub";
import type { ComplianceVendorType } from "./constants";
import { parseTypedScreeningResponse } from "./screening-contract";
import { demoScreeningEnabled, demoScreeningListed, demoScreeningResponse, demoScreeningVendor } from "./demo";
import {
  runProviderType as runProviderTypeWith,
  runScreening,
  SCREENING_RESULT_VERSION,
  type JsonObject,
  type ProviderDeps,
  type ScreeningAuditEntry,
  type ScreeningClaim,
  type ScreeningDecision,
  type ScreeningDeps,
  type ScreeningOutcome,
  type ScreeningProvider,
  type ScreeningResultRow,
  type VendorCheck,
} from "./screeningCore";

export {
  KNOWN_SCREENING_VERSIONS,
  isKnownScreeningVersion,
  rankScreeningOutcome,
  SCREENING_CACHE_TTL_SECONDS,
  SCREENING_RESULT_VERSION,
} from "./screeningCore";
export type { ScreeningDecision, ScreeningOutcome, ScreeningProvider, ScreeningWarning } from "./screeningCore";

type ScreeningVendor = { id: string; endpoint: string; credentials: string | null; vendorType: ComplianceVendorType };

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

async function loadVendors(vendorType: "dnc_scrub" | "litigator_scrub"): Promise<ScreeningVendor[]> {
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

function providerDeps(tenantId: string, fetcher: typeof fetch): ProviderDeps {
  return {
    providers: async (vendorType) => (await loadVendors(vendorType)).map((vendor) => makeProvider(vendor, fetcher)),
    recordProviderCall: (entry) => recordProviderCall({ tenantId, ...entry }),
    maskPhone: maskDialPhone,
    clock: () => performance.now(),
  };
}

async function runProviderType(
  tenantId: string,
  vendorType: "dnc_scrub" | "litigator_scrub",
  phoneDigits: string,
  fetcher: typeof fetch,
): Promise<VendorCheck> {
  return runProviderTypeWith(providerDeps(tenantId, fetcher), vendorType, phoneDigits);
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

async function waitForClaim(tenantId: string, phoneDigits: string): Promise<ScreeningClaim | null> {
  const startedAt = Date.now();
  while (Date.now() - startedAt < 10_000) {
    const { data, error } = await getSupabaseServiceClient().rpc("claim_screening_cache", { p_tenant_id: tenantId, p_phone_digits: phoneDigits, p_version: SCREENING_RESULT_VERSION, p_claim_seconds: 30 });
    if (error) throw new Error(`Could not claim screening cache: ${error.message}`);
    const row = (Array.isArray(data) ? data[0] : data) as ScreeningClaim | null;
    if (row?.state !== "in_flight") return row;
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  return null;
}

/** The production bindings for lib/compliance/screeningCore.ts. */
function screeningDeps(input: { tenantId: string; partnerId: string | null; userId: string | null; fetcher: typeof fetch }): ScreeningDeps {
  const db = getSupabaseServiceClient();
  const { tenantId } = input;
  return {
    ...providerDeps(tenantId, input.fetcher),
    async tenantSuppressed(phoneDigits) {
      const { data, error } = await db.rpc("is_tenant_phone_suppressed", { p_tenant_id: tenantId, p_phone_digits: phoneDigits });
      if (error) throw new Error(`Could not check tenant do-not-call list: ${error.message}`);
      return Boolean(data);
    },
    claim: (phoneDigits) => waitForClaim(tenantId, phoneDigits),
    async loadCached(resultId) {
      const { data, error } = await db.from("screening_results").select("id, phone_digits, outcome, vendor, raw_response, version, checked_at").eq("id", resultId).single<ScreeningResultRow>();
      return error || !data ? null : data;
    },
    async release(phoneDigits, claimToken) {
      await db.rpc("release_screening_cache", { p_tenant_id: tenantId, p_phone_digits: phoneDigits, p_version: SCREENING_RESULT_VERSION, p_claim_token: claimToken });
    },
    checkTcpaCapacity: () => checkMeterCapacity(tenantId, "tcpa_checks"),
    consumeDncCapacity: (idempotencyKey, ref) => consumeMeterCapacity({ tenantId, meterKey: "dnc_lookups", qty: 1, idempotencyKey, ref }),
    async recordTcpaUsage(idempotencyKey, ref) {
      await recordUsage({ tenantId, meterKey: "tcpa_checks", qty: 1, idempotencyKey, ref });
    },
    async hasExistingLead(phoneDigits) {
      const { data, error } = await db.rpc("has_existing_lead_phone", { p_tenant_id: tenantId, p_phone_digits: phoneDigits });
      if (error) throw new Error(`Could not complete internal duplicate screening: ${error.message}`);
      return Boolean(data);
    },
    async complete(params) {
      const { data, error } = await db.rpc("complete_screening_cache", {
        p_tenant_id: tenantId,
        p_phone_digits: params.phoneDigits,
        p_version: SCREENING_RESULT_VERSION,
        p_claim_token: params.claimToken,
        p_outcome: params.outcome,
        p_vendor: params.vendor,
        p_raw_response: params.rawResponse,
        p_warnings: params.warnings,
        p_checked_at: params.checkedAt,
        p_expires_at: params.expiresAt,
      });
      if (error || !data) throw new Error(error?.message ?? "Could not persist screening result");
      return data as string;
    },
    audit: (entry: ScreeningAuditEntry) => writeAudit({ tenantId, partnerId: input.partnerId, userId: input.userId, ...entry }),
  };
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
  // Tenant do-not-call list, the 24-hour vendor cache, metering, vendor fallback, internal DQ and
  // the precedence between them: lib/compliance/screeningCore.ts (tested with injected vendors).
  return runScreening(screeningDeps({ tenantId: input.tenantId, partnerId: input.partnerId, userId: input.userId, fetcher: input.fetcher ?? fetch }), phoneDigits);
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