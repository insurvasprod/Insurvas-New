import "server-only";

import { getSupabaseServiceClient } from "@/lib/supabase/service";
import { recordProviderCall } from "@/lib/payments/logging";
import type { Database, Json } from "@/lib/supabase/database.types";
import { decryptVendorCredentials, encryptVendorCredentials } from "./crypto";
import { DNC_BLOCK_MESSAGE, type ComplianceVendor, type ComplianceVendorType } from "./constants";
import { runOrderedFallback } from "./fallback";
import { maskDialPhone, normalizeDialPhone, parseDncScrubDecision, type DncScrubDecision } from "./scrub";
import { demoDncAllowed, demoScreeningEnabled } from "./demo";
import { FALLBACK_METHOD, LAST_CHECK_LOOKBACK_DAYS, countVendorCalls, vendorAvailable, type CountSource } from "./vendorHealth";

type VendorRow = {
  id: string; name: string; vendor_type: ComplianceVendorType; endpoint: string; credentials_enc: string | null;
  is_enabled: boolean; priority: number; cost_per_lookup_cents: number; last_success_at: string | null;
  failure_count_24h: number;
};

function providerCode(id: string) { return `compliance_vendor:${id}`; }

// Head counts, not row fetches: downloading every 24h row grew with dial volume and silently
// undercounted past PostgREST's 1000-row cap. Fallback hand-off rows are excluded (vendorHealth.ts):
// one failed lookup used to count as two failures. This is the gate's count as well as the page's.
function callCounts(id: string, since: string) {
  return countVendorCalls(getSupabaseServiceClient() as unknown as CountSource, providerCode(id), since);
}

async function health(id: string) {
  const since = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
  const db = getSupabaseServiceClient();
  const [counts, latestOk, latestAny] = await Promise.all([
    callCounts(id, since),
    db.from("provider_calls").select("ts").eq("provider", providerCode(id)).gte("ts", since).eq("status", "ok")
      .neq("method", FALLBACK_METHOD).order("ts", { ascending: false }).limit(1).maybeSingle<{ ts: string }>(),
    // "Last checked": the latest call of any outcome over a longer look-back than the health window,
    // so a vendor that has gone quiet still shows when it was last asked. Bounded because
    // provider_calls has no (provider, ts) index: an unbounded newest-first search for a vendor that
    // was never called would walk the whole table.
    db.from("provider_calls").select("ts, status, duration_ms").eq("provider", providerCode(id))
      .gte("ts", new Date(Date.now() - LAST_CHECK_LOOKBACK_DAYS * 24 * 60 * 60 * 1000).toISOString())
      .neq("method", FALLBACK_METHOD).order("ts", { ascending: false }).limit(1)
      .maybeSingle<{ ts: string; status: string; duration_ms: number | null }>(),
  ]);
  if (latestOk.error) throw new Error(`Could not load compliance vendor health: ${latestOk.error.message}`);
  if (latestAny.error) throw new Error(`Could not load compliance vendor health: ${latestAny.error.message}`);
  const { calls24h, failures24h } = counts;
  return {
    calls24h, failures24h, failureRate24h: calls24h ? Math.round((failures24h / calls24h) * 100) : 0,
    latestSuccess: latestOk.data?.ts ?? null,
    lastCheckedAt: latestAny.data?.ts ?? null,
    lastLatencyMs: latestAny.data?.status === "ok" ? latestAny.data.duration_ms ?? null : null,
  };
}

function safe(row: VendorRow, stats: Awaited<ReturnType<typeof health>>): ComplianceVendor {
  return {
    id: row.id, name: row.name, vendor_type: row.vendor_type, endpoint: row.endpoint,
    is_enabled: row.is_enabled, priority: row.priority, cost_per_lookup_cents: row.cost_per_lookup_cents,
    credentials_present: Boolean(row.credentials_enc),
    // No calls means health is unknown, not down. Once calls exist, a vendor is unavailable
    // only when every observed call in the rolling window failed.
    available: vendorAvailable({ calls24h: stats.calls24h, failures24h: stats.failures24h }),
    last_success_at: stats.latestSuccess ?? row.last_success_at,
    last_checked_at: stats.lastCheckedAt,
    last_latency_ms: stats.lastLatencyMs,
    calls_24h: stats.calls24h, failures_24h: stats.failures24h, failure_rate_24h: stats.failureRate24h,
  };
}

export async function listComplianceVendors(): Promise<ComplianceVendor[]> {
  const { data, error } = await getSupabaseServiceClient().from("compliance_vendors")
    .select("id, name, vendor_type, endpoint, credentials_enc, is_enabled, priority, cost_per_lookup_cents, last_success_at, failure_count_24h")
    .order("vendor_type").order("priority").order("name");
  if (error) throw new Error(`Could not load compliance vendors: ${error.message}`);
  return Promise.all(((data ?? []) as VendorRow[]).map(async (row) => safe(row, await health(row.id))));
}

export async function createComplianceVendor(input: {
  name: string; vendor_type: ComplianceVendorType; endpoint: string; credentials?: string | null;
  is_enabled: boolean; priority: number; cost_per_lookup_cents: number;
}) {
  const { data, error } = await getSupabaseServiceClient().from("compliance_vendors").insert({
    name: input.name, vendor_type: input.vendor_type, endpoint: input.endpoint,
    credentials_enc: input.credentials ? encryptVendorCredentials(input.credentials) : null,
    is_enabled: input.is_enabled, priority: input.priority, cost_per_lookup_cents: input.cost_per_lookup_cents,
  }).select("id, name, vendor_type, endpoint, is_enabled, priority, cost_per_lookup_cents, last_success_at, failure_count_24h").single();
  if (error) throw new Error(error.code === "23505" ? "A vendor with that identity already exists" : error.message);
  return data;
}

export async function updateComplianceVendor(id: string, input: {
  name?: string; vendor_type?: ComplianceVendorType; endpoint?: string; credentials?: string | null;
  is_enabled?: boolean; priority?: number; cost_per_lookup_cents?: number;
}) {
  const patch: Database["public"]["Tables"]["compliance_vendors"]["Update"] = {};
  for (const key of ["name", "vendor_type", "endpoint", "is_enabled", "priority", "cost_per_lookup_cents"] as const) {
    if (key in input) patch[key] = input[key] as never;
  }
  if ("credentials" in input) patch.credentials_enc = input.credentials ? encryptVendorCredentials(input.credentials ?? "") : null;
  const { data, error } = await getSupabaseServiceClient().from("compliance_vendors").update(patch).eq("id", id)
    .select("id, name, vendor_type, endpoint, is_enabled, priority, cost_per_lookup_cents, last_success_at, failure_count_24h").single();
  if (error) throw new Error(error.code === "PGRST116" ? "Vendor not found" : error.message);
  return data;
}

export async function getDncDialingStatus() {
  if (demoScreeningEnabled()) return { blocked: false, reason: null };
  const { data, error } = await getSupabaseServiceClient().from("compliance_vendors")
    .select("id").eq("vendor_type", "dnc_scrub").eq("is_enabled", true);
  if (error) throw new Error(`Could not determine DNC availability: ${error.message}`);
  const vendors = (data ?? []) as Array<{ id: string }>;
  // The gate only needs the counts; latestSuccess is display data for the admin list.
  const since = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
  const healthResults = await Promise.all(vendors.map((vendor) => callCounts(vendor.id, since)));
  const available = healthResults.some(vendorAvailable);
  return { blocked: vendors.length === 0 || !available, reason: vendors.length === 0 || !available ? DNC_BLOCK_MESSAGE : null };
}

/**
 * The registry screen's data: the vendors, plus the DNC verdict from the real gate (which honours
 * demo mode) rather than one recomputed in the browser.
 */
export async function getComplianceRegistry(): Promise<{ vendors: ComplianceVendor[]; dialing: { demo: boolean; dncBlocked: boolean }; readAt: string }> {
  const [vendors, dnc] = await Promise.all([listComplianceVendors(), getDncDialingStatus()]);
  return { vendors, dialing: { demo: demoScreeningEnabled(), dncBlocked: dnc.blocked }, readAt: new Date().toISOString() };
}

export async function getComplianceVendorState(id: string): Promise<{ name: string; vendor_type: ComplianceVendorType; is_enabled: boolean } | null> {
  const { data, error } = await getSupabaseServiceClient().from("compliance_vendors")
    .select("name, vendor_type, is_enabled").eq("id", id)
    .maybeSingle<{ name: string; vendor_type: ComplianceVendorType; is_enabled: boolean }>();
  if (error) throw new Error(`Could not load compliance vendor: ${error.message}`);
  return data ?? null;
}

/**
 * What taking vendor `id` out of the DNC pool would leave: how many OTHER enabled DNC vendors there
 * are, and how many of them the gate counts as available (the gate's own rule and counts). Zero
 * available means the change blocks dialing platform-wide.
 */
export async function otherDncVendorsAfterRemoving(id: string): Promise<{ enabled: number; available: number }> {
  const { data, error } = await getSupabaseServiceClient().from("compliance_vendors")
    .select("id").eq("vendor_type", "dnc_scrub").eq("is_enabled", true).neq("id", id);
  if (error) throw new Error(`Could not determine DNC availability: ${error.message}`);
  const others = (data ?? []) as Array<{ id: string }>;
  const since = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
  const counts = await Promise.all(others.map((vendor) => callCounts(vendor.id, since)));
  return { enabled: others.length, available: counts.filter(vendorAvailable).length };
}

/** Every outbound dialer must call this gate immediately before dialing. */
export async function assertDncVendorAvailable(): Promise<void> {
  const status = await getDncDialingStatus();
  if (status.blocked) throw new Error(DNC_BLOCK_MESSAGE);
}

type SafeJson = { [key: string]: Json };

async function logCall(id: string, status: "ok" | "error" | "timeout", startedAt: number, response: SafeJson | null, errorCategory?: string) {
  await recordProviderCall({
    tenantId: null, provider: providerCode(id), method: "test_connection",
    request: { vendorId: id }, response: response ?? (errorCategory ? { errorCategory } : null), status,
    durationMs: Math.round(performance.now() - startedAt),
  });
}

function errorCategory(error: unknown): string {
  if (error instanceof Error && error.name === "TimeoutError") return "timeout";
  if (error instanceof Error && error.message.startsWith("Vendor answered with HTTP")) return "http";
  if (error instanceof Error && error.message.includes("invalid response")) return "invalid_response";
  if (error instanceof Error && error.message.includes("did not include")) return "invalid_response";
  return "network";
}

export async function testComplianceVendor(id: string, fetcher: typeof fetch = fetch) {
  const { data, error } = await getSupabaseServiceClient().from("compliance_vendors")
    .select("id, endpoint, credentials_enc").eq("id", id).maybeSingle<{ id: string; endpoint: string; credentials_enc: string | null }>();
  if (error || !data) throw new Error("Vendor not found");
  const startedAt = performance.now();
  try {
    const credential = decryptVendorCredentials(data.credentials_enc);
    const headers: Record<string, string> = { accept: "application/json" };
    if (credential) headers.authorization = `Bearer ${credential}`;
    const response = await fetcher(data.endpoint, { method: "GET", headers, signal: AbortSignal.timeout(10000) });
    if (!response.ok) {
      const category = response.status === 401 || response.status === 403 ? "authentication" : response.status >= 500 ? "provider" : "http";
      await logCall(id, "error", startedAt, { status: response.status, category }, category);
      return { ok: false, category, message: `Vendor answered with HTTP ${response.status}.` };
    }
    await logCall(id, "ok", startedAt, { status: response.status });
    return { ok: true, category: "success", message: "Vendor answered successfully." };
  } catch (error) {
    const category = error instanceof Error && error.name === "TimeoutError" ? "timeout" : "network";
    await logCall(id, category === "timeout" ? "timeout" : "error", startedAt, null, category);
    return { ok: false, category, message: error instanceof Error ? error.message : "Vendor request failed." };
  }
}

export async function runWithComplianceFallback<T>(
  vendorType: ComplianceVendorType,
  operation: (vendor: { id: string; name: string; endpoint: string; credentials: string | null }) => Promise<T>,
  options: {
    tenantId?: string | null;
    method?: string;
    request?: SafeJson;
    response?: (result: T) => SafeJson;
  } = {},
) {
  const { data, error } = await getSupabaseServiceClient().from("compliance_vendors")
    .select("id, name, endpoint, credentials_enc").eq("vendor_type", vendorType).eq("is_enabled", true).order("priority").order("name");
  if (error) throw new Error(`Could not load ${vendorType} vendors: ${error.message}`);
  const vendors = (data ?? []).map((row) => {
    const item = row as { id: string; name: string; endpoint: string; credentials_enc: string | null };
    return { id: item.id, endpoint: item.endpoint, credentials: decryptVendorCredentials(item.credentials_enc) };
  });
  // The vendor's display name rides beside the fallback loop (which only knows id/endpoint/credentials),
  // so a caller can say which vendor answered — the dial preflight dialog names it.
  const names = new Map((data ?? []).map((row) => [(row as { id: string }).id, (row as { name: string }).name]));
  const method = options.method ?? "compliance_lookup";
  const request = options.request ?? { vendorType };
  return runOrderedFallback(vendors, async (vendor) => {
    const startedAt = performance.now();
    try {
      const result = await operation({ ...vendor, name: names.get(vendor.id) ?? "" });
      await recordProviderCall({
        tenantId: options.tenantId ?? null,
        provider: providerCode(vendor.id),
        method,
        request,
        response: options.response?.(result) ?? { ok: true },
        status: "ok",
        durationMs: Math.round(performance.now() - startedAt),
      });
      return result;
    } catch (error) {
      await recordProviderCall({
        tenantId: options.tenantId ?? null,
        provider: providerCode(vendor.id),
        method,
        request,
        response: { category: errorCategory(error) },
        status: errorCategory(error) === "timeout" ? "timeout" : "error",
        durationMs: Math.round(performance.now() - startedAt),
      });
      throw error;
    }
  }, async (from, to) => {
    await recordProviderCall({
      tenantId: options.tenantId ?? null,
      provider: providerCode(from.id),
      method: "fallback",
      request: { fromVendorId: from.id, toVendorId: to.id, vendorType },
      response: { reason: "primary vendor failed" },
      status: "error",
      durationMs: 0,
    });
  });
}

export async function performDncDialPreflight(
  phone: string,
  tenantId: string,
  fetcher: typeof fetch = fetch,
): Promise<{ allowed: boolean; phone: string }> {
  const normalized = normalizeDialPhone(phone);
  const { data: tenantSuppressed, error: suppressionError } = await getSupabaseServiceClient().rpc("is_tenant_phone_suppressed", { p_tenant_id: tenantId, p_phone_digits: normalized });
  if (suppressionError) throw new Error(`Could not check tenant do-not-call list: ${suppressionError.message}`);
  if (tenantSuppressed) return { allowed: false, phone: maskDialPhone(normalized) };
  const decision = await performDncVendorLookup(normalized, tenantId, fetcher);
  return { allowed: decision.allowed, phone: maskDialPhone(normalized) };
}

/**
 * The vendor half of the preflight: the demo shortcut, the fail-closed availability gate, then the
 * ordered vendor lookup. Split out of performDncDialPreflight unchanged so the dial preflight dialog
 * can run it even when the tenant list already refuses (it shows every check), and say which vendor
 * answered. Throws DNC_BLOCK_MESSAGE when no vendor is available, as before.
 */
export async function performDncVendorLookup(
  normalized: string,
  tenantId: string,
  fetcher: typeof fetch = fetch,
): Promise<{ allowed: boolean; vendorName: string }> {
  if (demoScreeningEnabled()) {
    const allowed = demoDncAllowed(normalized);
    await recordProviderCall({
      tenantId,
      provider: providerCode("demo:dnc_scrub"),
      method: "dnc_scrub",
      request: { phone: maskDialPhone(normalized) },
      response: { demo: true, allowed },
      status: "ok",
      durationMs: 0,
    });
    return { allowed, vendorName: "Demo DNC screening" };
  }
  await assertDncVendorAvailable();
  let vendorName = "";
  const decision = await runWithComplianceFallback<DncScrubDecision>(
    "dnc_scrub",
    async (vendor) => {
      const headers: Record<string, string> = { accept: "application/json", "content-type": "application/json" };
      if (vendor.credentials) headers.authorization = `Bearer ${vendor.credentials}`;
      const response = await fetcher(vendor.endpoint, {
        method: "POST",
        headers,
        body: JSON.stringify({ phone: normalized }),
        signal: AbortSignal.timeout(10000),
      });
      if (!response.ok) throw new Error(`Vendor answered with HTTP ${response.status}`);
      const payload = await response.json().catch(() => null);
      const parsed = parseDncScrubDecision(payload);
      vendorName = vendor.name;
      return parsed;
    },
    {
      tenantId,
      method: "dnc_scrub",
      request: { phone: maskDialPhone(normalized) },
      response: (result) => ({ allowed: result.allowed }),
    },
  );
  return { allowed: decision.allowed, vendorName };
}
