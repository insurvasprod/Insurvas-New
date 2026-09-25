/**
 * LA-1.5 screening decision, with every database and vendor call injected.
 *
 * `screening.ts` binds these dependencies to Supabase, the metering RPCs and the configured vendors;
 * tests bind them to fakes. Nothing here imports at runtime, so `node --test` can load the file
 * directly and prove the vendor-failure, fallback, allowance and precedence rules without disabling
 * a real vendor.
 *
 * Precedence (spec LA-1.5-5): TCPA litigator > invalid phone > DNC > internal DQ > clear. An invalid
 * number never reaches a vendor, so in practice it is decided first; a litigator hit outranks every
 * list below it, including the tenant's own do-not-call list, and is never also reported as DNC.
 */
import type { Json } from "@/lib/supabase/database.types";

export const SCREENING_RESULT_VERSION = 1;
/** Every version this build can read. A stored result with any other version is refused. */
export const KNOWN_SCREENING_VERSIONS: readonly number[] = [1];
export const SCREENING_CACHE_TTL_SECONDS = 24 * 60 * 60;

export const SCREENING_UNAVAILABLE_MESSAGE = "Screening could not be completed. Do not treat this number as safe.";
export const SCREENING_TCPA_ALLOWANCE_MESSAGE = "Screening could not be completed because the plan's screening allowance is exhausted. Do not treat this number as safe.";
export const SCREENING_DNC_ALLOWANCE_MESSAGE = "Screening could not be completed because the plan's DNC lookup allowance is exhausted. Do not treat this number as safe.";
export const SCREENING_TCPA_BLOCK_MESSAGE = "This number matched a TCPA litigator list. The lead was not submitted.";
export const SCREENING_TENANT_DNC_MESSAGE = "This number is on your do-not-call list. Confirm before submitting.";
export const SCREENING_DNC_MESSAGE = "This number appears on a DNC list. The lead was accepted with a compliance warning.";
export const SCREENING_INTERNAL_DQ_MESSAGE = "This number matches an existing lead. Review it before contacting the consumer.";

export type ScreeningOutcome = "clear" | "dnc" | "internal_dq" | "tcpa_litigator" | "invalid_phone" | "unavailable";
export type ScreeningWarning = { code: "dnc" | "internal_dq"; message: string };
export type JsonObject = { [key: string]: Json };

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

export type VendorCheck = { vendorId: string; listed: boolean; rawResponse: JsonObject };

export type ScreeningResultRow = {
  id: string;
  phone_digits: string;
  outcome: string;
  vendor: string;
  raw_response: JsonObject;
  version: number;
  checked_at: string;
};

export type ScreeningClaim = { state: "cached" | "claimed" | "in_flight"; result_id: string | null; claim_token: string | null };

export type ScreeningAuditEntry = {
  phoneDigits: string | null;
  outcome: ScreeningOutcome;
  vendor: string | null;
  rawResponse: JsonObject;
  resultId: string | null;
  cached: boolean;
};

export type ProviderCallEntry = {
  provider: string;
  method: string;
  request: JsonObject;
  response: JsonObject;
  status: "ok" | "error" | "timeout";
  durationMs: number;
};

export type ProviderDeps = {
  providers(vendorType: "dnc_scrub" | "litigator_scrub"): Promise<ScreeningProvider[]>;
  recordProviderCall(entry: ProviderCallEntry): Promise<void>;
  maskPhone(phoneDigits: string): string;
  clock?(): number;
};

export type ScreeningDeps = ProviderDeps & {
  /** The tenant's own do-not-call list, read fresh on every screen (never cached). */
  tenantSuppressed(phoneDigits: string): Promise<boolean>;
  /** Waits out another request's in-flight claim; null when it never resolved. */
  claim(phoneDigits: string): Promise<ScreeningClaim | null>;
  loadCached(resultId: string): Promise<ScreeningResultRow | null>;
  release(phoneDigits: string, claimToken: string): Promise<void>;
  checkTcpaCapacity(): Promise<{ allowed: boolean }>;
  consumeDncCapacity(idempotencyKey: string, ref: string): Promise<{ allowed: boolean }>;
  recordTcpaUsage(idempotencyKey: string, ref: string): Promise<void>;
  /** Internal DQ: the number is already on a lead in this tenant. Read fresh, never cached. */
  hasExistingLead(phoneDigits: string): Promise<boolean>;
  complete(params: {
    phoneDigits: string;
    claimToken: string;
    outcome: Exclude<ScreeningOutcome, "invalid_phone" | "unavailable">;
    vendor: string;
    rawResponse: JsonObject;
    warnings: ScreeningWarning[];
    checkedAt: string;
    expiresAt: string;
  }): Promise<string>;
  audit(entry: ScreeningAuditEntry): Promise<void>;
  now?(): Date;
};

export function isKnownScreeningVersion(version: unknown): version is number {
  return typeof version === "number" && KNOWN_SCREENING_VERSIONS.includes(version);
}

/** The one ranking every screen uses. Invalid phones are decided before any list is consulted. */
export function rankScreeningOutcome(flags: { tcpa: boolean; dnc: boolean; internalDq: boolean }): "tcpa_litigator" | "dnc" | "internal_dq" | "clear" {
  if (flags.tcpa) return "tcpa_litigator";
  if (flags.dnc) return "dnc";
  if (flags.internalDq) return "internal_dq";
  return "clear";
}

function warningFor(outcome: ScreeningOutcome): ScreeningWarning | null {
  if (outcome === "dnc") return { code: "dnc", message: SCREENING_DNC_MESSAGE };
  if (outcome === "internal_dq") return { code: "internal_dq", message: SCREENING_INTERNAL_DQ_MESSAGE };
  return null;
}

function providerErrorCategory(error: unknown): string {
  if (error instanceof Error && error.name === "TimeoutError") return "timeout";
  if (error instanceof Error && error.message.startsWith("Vendor answered with HTTP")) return "http";
  if (error instanceof Error && error.message.includes("typed screening decision")) return "invalid_response";
  return "network";
}

/** Tries each enabled vendor of one type in priority order; every attempt and fallback is logged. */
export async function runProviderType(deps: ProviderDeps, vendorType: "dnc_scrub" | "litigator_scrub", phoneDigits: string): Promise<VendorCheck> {
  const clock = deps.clock ?? (() => Date.now());
  const vendors = await deps.providers(vendorType);
  if (!vendors.length) throw new Error(`No enabled ${vendorType} vendor is available`);
  let lastError: unknown = new Error(`No ${vendorType} vendor responded`);
  for (let index = 0; index < vendors.length; index++) {
    const vendor = vendors[index];
    const startedAt = clock();
    try {
      const result = await vendor.check(phoneDigits);
      await deps.recordProviderCall({
        provider: `compliance_vendor:${vendor.vendorId}`,
        method: vendorType,
        request: { phone: deps.maskPhone(phoneDigits) },
        response: result.rawResponse,
        status: "ok",
        durationMs: Math.round(clock() - startedAt),
      });
      return { vendorId: vendor.vendorId, listed: result.listed, rawResponse: result.rawResponse };
    } catch (error) {
      lastError = error;
      const category = providerErrorCategory(error);
      await deps.recordProviderCall({
        provider: `compliance_vendor:${vendor.vendorId}`,
        method: vendorType,
        request: { phone: deps.maskPhone(phoneDigits) },
        response: { category },
        status: category === "timeout" ? "timeout" : "error",
        durationMs: Math.round(clock() - startedAt),
      });
      const next = vendors[index + 1];
      if (next) await deps.recordProviderCall({
        provider: `compliance_vendor:${vendor.vendorId}`,
        method: "fallback",
        request: { fromVendorId: vendor.vendorId, toVendorId: next.vendorId, vendorType },
        response: { reason: "primary vendor failed" },
        status: "error",
        durationMs: 0,
      });
    }
  }
  throw lastError instanceof Error ? lastError : new Error("Screening vendor failed");
}

type Screened = { decision: ScreeningDecision; audit: ScreeningAuditEntry };

function unavailable(phoneDigits: string, error: string, message = SCREENING_UNAVAILABLE_MESSAGE): Screened {
  return {
    decision: { allowed: false, phoneDigits, outcome: "unavailable", warning: null, resultId: null, version: SCREENING_RESULT_VERSION, checkedAt: null, cached: false, message },
    audit: { phoneDigits, outcome: "unavailable", vendor: null, rawResponse: { error }, resultId: null, cached: false },
  };
}

function decided(
  phoneDigits: string,
  outcome: Exclude<ScreeningOutcome, "invalid_phone" | "unavailable">,
  fields: { resultId: string; version: number; checkedAt: string; cached: boolean; vendor: string; rawResponse: JsonObject },
): Screened {
  const warning = warningFor(outcome);
  return {
    decision: {
      allowed: outcome !== "tcpa_litigator",
      phoneDigits,
      outcome,
      warning,
      resultId: fields.resultId,
      version: fields.version,
      checkedAt: fields.checkedAt,
      cached: fields.cached,
      message: outcome === "tcpa_litigator" ? SCREENING_TCPA_BLOCK_MESSAGE : warning?.message ?? "Screening passed.",
    },
    audit: { phoneDigits, outcome, vendor: fields.vendor, rawResponse: fields.rawResponse, resultId: fields.resultId, cached: fields.cached },
  };
}

/** Vendor lists (through the shared 24-hour cache) plus the fresh internal-DQ read. */
async function screenAgainstLists(deps: ScreeningDeps, phoneDigits: string): Promise<Screened> {
  const claim = await deps.claim(phoneDigits);
  if (claim?.state === "cached" && claim.result_id) {
    const row = await deps.loadCached(claim.result_id);
    if (!row) throw new Error("Cached screening result could not be replayed");
    // LA-1.5-10: a stored result from a version this build does not know is not replayed.
    if (!isKnownScreeningVersion(row.version)) return unavailable(phoneDigits, "unknown_screening_version");
    const cachedOutcome = row.outcome as ScreeningOutcome;
    if (cachedOutcome !== "tcpa_litigator" && cachedOutcome !== "dnc" && cachedOutcome !== "internal_dq" && cachedOutcome !== "clear")
      return unavailable(phoneDigits, "unknown_screening_outcome");
    // The vendor answers are cached for 24 hours; whether the number is already on one of this
    // tenant's leads is not. A number first screened clear becomes an internal DQ the moment a
    // lead with it exists.
    const internalDq = cachedOutcome === "clear" ? await deps.hasExistingLead(phoneDigits) : false;
    const outcome = internalDq ? "internal_dq" : cachedOutcome;
    return decided(phoneDigits, outcome, {
      resultId: row.id,
      version: row.version,
      checkedAt: row.checked_at,
      cached: true,
      vendor: row.vendor,
      rawResponse: internalDq ? { ...row.raw_response, internal_dq_now: true } : row.raw_response,
    });
  }
  if (claim?.state !== "claimed" || !claim.claim_token) return unavailable(phoneDigits, "screening_in_flight_timeout");

  const claimToken = claim.claim_token;
  const release = () => deps.release(phoneDigits, claimToken);
  try {
    // One charge per claimed lookup: the claim token is the idempotency key, so a retry of the same
    // claim never bills twice and a cached replay never bills at all.
    const idempotencyBase = `screening:${claimToken}`;
    const tcpaCapacity = await deps.checkTcpaCapacity();
    if (!tcpaCapacity.allowed) {
      await release();
      return unavailable(phoneDigits, "screening_meter_cap", SCREENING_TCPA_ALLOWANCE_MESSAGE);
    }
    const dncCapacity = await deps.consumeDncCapacity(`${idempotencyBase}:dnc`, idempotencyBase);
    if (!dncCapacity.allowed) {
      await release();
      return unavailable(phoneDigits, "screening_meter_cap", SCREENING_DNC_ALLOWANCE_MESSAGE);
    }
    await deps.recordTcpaUsage(`${idempotencyBase}:tcpa`, idempotencyBase);

    const [tcpa, dnc] = await Promise.all([
      runProviderType(deps, "litigator_scrub", phoneDigits),
      runProviderType(deps, "dnc_scrub", phoneDigits),
    ]);
    const internalDq = await deps.hasExistingLead(phoneDigits);
    const outcome = rankScreeningOutcome({ tcpa: tcpa.listed, dnc: dnc.listed, internalDq });
    const warning = warningFor(outcome);
    const checkedAt = (deps.now ?? (() => new Date()))();
    const expiresAt = new Date(checkedAt.getTime() + SCREENING_CACHE_TTL_SECONDS * 1000);
    const vendor = `litigator:${tcpa.vendorId},dnc:${dnc.vendorId}`;
    const rawResponse: JsonObject = { litigator: tcpa.rawResponse, dnc: dnc.rawResponse, internal_dq: internalDq };
    const resultId = await deps.complete({
      phoneDigits,
      claimToken,
      outcome,
      vendor,
      rawResponse,
      warnings: warning ? [warning] : [],
      checkedAt: checkedAt.toISOString(),
      expiresAt: expiresAt.toISOString(),
    });
    return decided(phoneDigits, outcome, { resultId, version: SCREENING_RESULT_VERSION, checkedAt: checkedAt.toISOString(), cached: false, vendor, rawResponse });
  } catch {
    await release().catch(() => undefined);
    return unavailable(phoneDigits, "screening_unavailable");
  }
}

/**
 * Screens one valid 10-digit number. The caller has already turned an invalid phone into
 * `invalid_phone`. Exactly one audit row is written per screen.
 */
export async function runScreening(deps: ScreeningDeps, phoneDigits: string): Promise<ScreeningDecision> {
  // The tenant's own list is read before the cache so a number added after a previous vendor
  // result still warns on the very next intake. It no longer ends the screen: the litigator
  // list still runs, because a TCPA hit outranks DNC.
  const tenantSuppressed = await deps.tenantSuppressed(phoneDigits);
  let screened: Screened;
  try {
    screened = await screenAgainstLists(deps, phoneDigits);
  } catch {
    screened = unavailable(phoneDigits, "screening_unavailable");
  }
  if (tenantSuppressed && screened.decision.allowed) {
    // Clear, vendor DNC or internal DQ: the tenant's list ranks at DNC, above internal DQ.
    screened = {
      decision: { ...screened.decision, outcome: "dnc", warning: { code: "dnc", message: SCREENING_TENANT_DNC_MESSAGE }, message: SCREENING_TENANT_DNC_MESSAGE },
      audit: {
        ...screened.audit,
        outcome: "dnc",
        vendor: "tenant_suppression",
        rawResponse: { source: "tenant_do_not_call", lists: { vendor: screened.audit.vendor, outcome: screened.audit.outcome, raw: screened.audit.rawResponse } },
      },
    };
  } else if (tenantSuppressed) {
    // A litigator hit or an incomplete screen stands. The audit still records the tenant list hit.
    screened = { ...screened, audit: { ...screened.audit, rawResponse: { ...screened.audit.rawResponse, tenant_do_not_call: true } } };
  }
  try {
    await deps.audit(screened.audit);
  } catch {
    // An unaudited check is not a check: fail closed.
    return unavailable(phoneDigits, "screening_audit_failed").decision;
  }
  return screened.decision;
}
