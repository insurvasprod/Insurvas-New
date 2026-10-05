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
  /** LA-2.3-9: the lead the check was for, when it is already known (a re-scrub, the dial preflight). */
  leadId?: string | null;
}): Promise<string | null> {
  const row = {
    tenant_id: params.tenantId,
    partner_id: params.partnerId,
    user_id: params.userId,
    // Typed `never` in the generated types (the column predates the tenant plane); it exists live.
    lead_id: (params.leadId ?? null) as never,
    phone_digits: params.phoneDigits,
    outcome: params.outcome,
    vendor: params.vendor,
    raw_response: params.rawResponse,
    result_id: params.resultId,
    cached: params.cached,
    version: SCREENING_RESULT_VERSION,
  };
  const insert = (values: typeof row) => getSupabaseServiceClient().from("screening_audit").insert(values).select("id").single<{ id: string }>();
  let { data, error } = await insert(row);
  // Until 20260925709750 repoints screening_audit.lead_id at agent_leads, the live FK still names
  // the legacy `leads` table, so an agent lead id is refused (23503). The check is still audited,
  // without the link: an unaudited check would fail the screening closed.
  if (error?.code === "23503" && params.leadId) ({ data, error } = await insert({ ...row, lead_id: null as never }));
  if (error) throw new Error(`Could not write screening audit: ${error.message}`);
  return data?.id ?? null;
}

/**
 * LA-2.3-9: a check made before its lead existed (partner submit, import, real-time post) is
 * linked to the lead once it is inserted, through the audit row's id (ScreenedDecision.auditId).
 * Best effort by design: the lead is already saved, so a failed link is logged, never thrown.
 */
export async function linkScreeningAuditToLead(input: { tenantId: string; auditId: string | null | undefined; leadId: string | null | undefined }): Promise<void> {
  if (!input.auditId || !input.leadId) return;
  try {
    const { error } = await getSupabaseServiceClient().from("screening_audit")
      .update({ lead_id: input.leadId } as never)
      .eq("tenant_id", input.tenantId).eq("id", input.auditId).is("lead_id", null);
    if (error) console.error(`[screening-audit] could not link check ${input.auditId} to lead ${input.leadId}: ${error.message}`);
  } catch (error) {
    console.error(`[screening-audit] could not link check ${input.auditId} to lead ${input.leadId}: ${error instanceof Error ? error.message : "unknown"}`);
  }
}

/** Links per update when link_screening_audit_leads (20260925709740) is not applied yet. */
const LINK_FALLBACK_CAP = 1000;

/**
 * The bulk form, for an import: one call for every committed lead. Best effort, like the single
 * link: a failure is logged and the import it follows stands.
 */
export async function linkScreeningAuditsToLeads(tenantId: string, links: Array<{ auditId: string | null | undefined; leadId: string | null | undefined }>): Promise<void> {
  const seen = new Set<string>();
  const pairs = links.flatMap((link) => {
    if (!link.auditId || !link.leadId || seen.has(link.auditId)) return [];
    seen.add(link.auditId);
    return [{ audit_id: link.auditId, lead_id: link.leadId }];
  });
  if (!pairs.length) return;
  try {
    const { error } = await getSupabaseServiceClient().rpc("link_screening_audit_leads" as never, { p_tenant_id: tenantId, p_links: pairs } as never) as unknown as { error: { message: string; code?: string } | null };
    if (!error) return;
    if (error.code !== "42883" && error.code !== "PGRST202" && !/could not find the function/i.test(error.message)) {
      console.error(`[screening-audit] could not link ${pairs.length} check(s) to their leads: ${error.message}`);
      return;
    }
  } catch (error) {
    console.error(`[screening-audit] could not link ${pairs.length} check(s) to their leads: ${error instanceof Error ? error.message : "unknown"}`);
    return;
  }
  // Before the bulk function: one update per link, ten at a time, capped so an import is not held.
  const capped = pairs.slice(0, LINK_FALLBACK_CAP);
  if (pairs.length > capped.length) console.error(`[screening-audit] ${pairs.length - capped.length} check(s) left unlinked until 20260925709740 is applied`);
  for (let start = 0; start < capped.length; start += 10) {
    await Promise.all(capped.slice(start, start + 10).map((pair) => linkScreeningAuditToLead({ tenantId, auditId: pair.audit_id, leadId: pair.lead_id })));
  }
}

/** A screening decision plus the audit row it wrote (null only if the check wrote none). */
export type ScreenedDecision = ScreeningDecision & { auditId: string | null };

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
function screeningDeps(input: { tenantId: string; partnerId: string | null; userId: string | null; leadId: string | null; fetcher: typeof fetch; onAudit?: (auditId: string | null) => void }): ScreeningDeps {
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
    async audit(entry: ScreeningAuditEntry) {
      input.onAudit?.(await writeAudit({ tenantId, partnerId: input.partnerId, userId: input.userId, leadId: input.leadId, ...entry }));
    },
  };
}

export async function screenPartnerPhone(input: {
  tenantId: string;
  partnerId: string | null;
  userId: string | null;
  phone: unknown;
  /** LA-2.3-9: set when the check is for a lead that already exists (a campaign re-scrub). */
  leadId?: string | null;
  fetcher?: typeof fetch;
}): Promise<ScreenedDecision> {
  const leadId = input.leadId ?? null;
  let phoneDigits: string;
  try {
    phoneDigits = getUsPhone10Digits(input.phone);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Enter a valid US phone number";
    const auditId = await writeAudit({ tenantId: input.tenantId, partnerId: input.partnerId, userId: input.userId, leadId, phoneDigits: null, outcome: "invalid_phone", vendor: null, rawResponse: { error: "invalid_phone" }, resultId: null, cached: false });
    return { allowed: false, phoneDigits: null, outcome: "invalid_phone", warning: null, resultId: null, version: SCREENING_RESULT_VERSION, checkedAt: null, cached: false, message, auditId };
  }
  // Tenant do-not-call list, the 24-hour vendor cache, metering, vendor fallback, internal DQ and
  // the precedence between them: lib/compliance/screeningCore.ts (tested with injected vendors).
  let auditId: string | null = null;
  const decision = await runScreening(screeningDeps({ tenantId: input.tenantId, partnerId: input.partnerId, userId: input.userId, leadId, fetcher: input.fetcher ?? fetch, onAudit: (id) => { auditId = id; } }), phoneDigits);
  return { ...decision, auditId };
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
  /** LA-2.3-9: the lead this number belongs to, when the dialog found one. */
  leadId?: string | null;
  fetcher?: typeof fetch;
}): Promise<DialPreflightLitigator> {
  const db = getSupabaseServiceClient();
  const audit = { tenantId: input.tenantId, partnerId: null, userId: input.userId, phoneDigits: input.phoneDigits, leadId: input.leadId ?? null };
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