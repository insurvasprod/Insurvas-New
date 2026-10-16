import "server-only";

import { NextResponse } from "next/server";

import { getSupabaseServiceClient } from "@/lib/supabase/service";
import { getEntitlement } from "@/lib/entitlements/get";
import { canWrite, hasFeature } from "@/lib/entitlements/types";
import { callerIp, claim, retryAfterSeconds, type RateLimitRule } from "@/lib/rateLimit";
import { API_ROUTES, API_SCOPE_FEATURE, bearerApiKey, decideKey, hashApiKey, stripSensitive, type ApiRoute } from "./rules";

/**
 * LA-8.7 · the gate every /api/v1 route goes through.
 *
 *   const auth = await authenticateApiKey(request, "GET /api/v1/policies");
 *   if (auth instanceof NextResponse) return auth;
 *   const { tenantId, keyId } = auth;
 *
 * The key's row is read on every request, so a revocation or an expiry takes effect on the next
 * request (store-checked, never inferred from the key). Then: the route's scope, the plan feature
 * behind the scope, the agency's access (a paused or cancelled agency reads but does not write), and
 * a per-key rate limit. Last use and its address are recorded at most once a minute per key.
 */

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function db() { return getSupabaseServiceClient() as any; }

export const API_PER_KEY: RateLimitRule = { name: "api_key", max: 120, windowSeconds: 60 };

export type ApiCaller = { tenantId: string; keyId: string; scopes: string[] };

const refuse = (status: number, code: string, message: string, headers: Record<string, string> = {}) =>
  NextResponse.json({ error: { code, message } }, { status, headers: { "Cache-Control": "no-store", ...headers } });

export async function authenticateApiKey(request: Request, route: ApiRoute): Promise<ApiCaller | NextResponse> {
  const key = bearerApiKey(request.headers.get("authorization"));
  if (!key) return refuse(401, "invalid_key", "Send your API key as Authorization: Bearer isk_…", { "www-authenticate": "Bearer" });

  const read = await db().from("api_key").select("id, tenant_id, scopes, revoked_at, expires_at, last_used_at, last_used_ip").eq("key_hash", hashApiKey(key)).maybeSingle();
  if (read.error) {
    console.error("[api-key] lookup failed", read.error.message);
    return refuse(503, "unavailable", "The key could not be checked. Retry shortly.");
  }
  const row = read.data as { id: string; tenant_id: string; scopes: string[]; revoked_at: string | null; expires_at: string | null; last_used_at: string | null; last_used_ip: string | null } | null;
  const decision = decideKey(row, route, Date.now());
  if (!decision.ok) return refuse(decision.status, decision.code, decision.message);
  const caller = row as NonNullable<typeof row>;

  const limited = await claim(API_PER_KEY, caller.id);
  if (!limited.allowed) return refuse(429, "rate_limited", "Too many requests on this key. Slow down and retry.", { "retry-after": String(retryAfterSeconds(limited.rule)) });

  const entitlement = await getEntitlement(caller.tenant_id);
  if (entitlement.access === "none") return refuse(403, "account_inactive", "This agency's account has no access.");
  const feature = API_SCOPE_FEATURE[API_ROUTES[route]];
  if (feature && !hasFeature(entitlement, feature)) return refuse(403, "feature_not_in_plan", "The agency's plan does not include what this scope reads or writes.");
  if (route.startsWith("POST ") || route.startsWith("DELETE ")) {
    if (!canWrite(entitlement)) return refuse(403, "read_only", "This agency's account is read-only right now.");
  }

  // Last used, and from where: the quiet safety feature. Throttled so a busy key is not a write per request.
  const ip = callerIp(request.headers).slice(0, 64);
  if (!caller.last_used_at || Date.now() - Date.parse(caller.last_used_at) > 60_000 || caller.last_used_ip !== ip) {
    void db().from("api_key").update({ last_used_at: new Date().toISOString(), last_used_ip: ip }).eq("id", caller.id)
      .then(({ error }: { error: { message: string } | null }) => { if (error) console.error("[api-key] could not record last use", error.message); });
  }
  return { tenantId: caller.tenant_id, keyId: caller.id, scopes: caller.scopes };
}

/**
 * Every /api/v1 response goes out through this. No scope ever returns an SSN, a bank account or a
 * card number: a field that would carry one is stripped (an SSN-shaped string masked) and logged
 * here, so a later change to a query cannot leak one quietly — and one stray field does not turn
 * the whole response into an error.
 */
export function apiJson(body: unknown, init: { status?: number } = {}): NextResponse {
  const clean = stripSensitive(body);
  if (clean.removed.length) console.error("[api-v1] stripped sensitive fields from a response", clean.removed.slice(0, 5));
  return NextResponse.json(clean.value, { status: init.status ?? 200, headers: { "Cache-Control": "no-store" } });
}

export const apiError = (status: number, code: string, message: string) => refuse(status, code, message);
