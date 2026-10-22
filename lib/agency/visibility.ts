import "server-only";
import { cache } from "react";

import { getSupabaseServiceClient } from "@/lib/supabase/service";
import { getPlanAudience } from "./audience";
import { keepVisible, NO_PRODUCER, rowVisible, type ProducerScope } from "./visibilityCore";

export { keepVisible, rowVisible, type ProducerScope } from "./visibilityCore";

type LooseRpc = { rpc<T>(name: string, args: Record<string, unknown>): PromiseLike<{ data: T | null; error: { code?: string; message?: string } | null }> };

/**
 * AG-0.4 · place 2 of the one predicate: the application helper.
 *
 * The app reads through the service role, which bypasses RLS, so THIS is the boundary for every app read of
 * a producer-scoped table. It asks the database's agency_visible_user_ids — the same function the RLS
 * policies call — so the application and the database cannot disagree.
 *
 * Tenant and user come from the session context, never from a request parameter: a `producer_id=B` in a
 * query string changes nothing because nothing here reads one.
 *
 * Returns null (no filter) for an individual-plan tenant and for the all-seeing roles. Before migration
 * 20261018130000 is applied the function does not exist and the answer is also null — exactly today's
 * behaviour, since no tenant has producer rows until the agency migrations land.
 */
export const visibleProducerUserIds = cache(async (tenantId: string, userId: string): Promise<ProducerScope> => {
  // Solo agents pay nothing: a tenant known (within the last minute) to be on an individual plan skips the
  // database. A plan change is rare and a minute of staleness only ever errs toward the old plan's rule.
  // When the plan is not known in this process yet, the scope is asked for beside it rather than after it
  // (one trip instead of two): the function itself answers null for a non-agency plan, and the plan check
  // still decides, exactly as before.
  const known = audienceSeen.get(tenantId);
  const fresh = known && Date.now() - known.at < AUDIENCE_TTL_MS;
  if (fresh && known.audience !== "agency") return null;
  const askScope = () => (getSupabaseServiceClient() as unknown as LooseRpc).rpc<string[] | null>("agency_visible_user_ids", {
    p_tenant_id: tenantId,
    p_user_id: userId,
  });
  const [audience, { data, error }] = await Promise.all([fresh ? known.audience : audienceCached(tenantId), askScope()]);
  if (audience !== "agency") return null;
  if (error) {
    const missing = error.code === "PGRST202" || error.code === "42883" || /could not find the function/i.test(error.message ?? "");
    if (missing) return null;
    // A failed read closes the scope rather than opening it.
    console.error(`[agency visibility] ${error.message}`);
    return [];
  }
  return data === null ? null : [...data];
});

const AUDIENCE_TTL_MS = 60_000;
const audienceSeen = new Map<string, { audience: string | null; at: number }>();

async function audienceCached(tenantId: string): Promise<string | null> {
  const hit = audienceSeen.get(tenantId);
  if (hit && Date.now() - hit.at < AUDIENCE_TTL_MS) return hit.audience;
  const audience = await getPlanAudience(tenantId);
  audienceSeen.set(tenantId, { audience, at: Date.now() });
  return audience;
}

/**
 * `maxAgeMs`, for a route polled every few seconds (the alert bell): reuse this person's scope read within
 * that age instead of asking the database on every poll. The scope it may serve is at most that old — a
 * manager who just lost a report keeps seeing alerts about that report's leads for up to `maxAgeMs`. Every
 * other caller omits it and reads the scope fresh, as before.
 */
export async function scopeFor(context: { tenantId: string; userId: string }, options: { maxAgeMs?: number } = {}): Promise<ProducerScope> {
  const maxAge = options.maxAgeMs ?? 0;
  if (maxAge <= 0) {
    // Read in this request's auth round trip (requireFeature `prefetchScope`): the same read, just earlier.
    const early = requestScope.get(context);
    if (early !== undefined) return early === null ? null : [...early];
    return visibleProducerUserIds(context.tenantId, context.userId);
  }
  const key = `${context.tenantId}:${context.userId}`;
  const hit = scopeSeen.get(key);
  if (hit && Date.now() - hit.at < maxAge) return hit.scope === null ? null : [...hit.scope];
  const scope = await visibleProducerUserIds(context.tenantId, context.userId);
  if (scopeSeen.size >= SCOPE_CACHE_LIMIT) scopeSeen.clear();
  scopeSeen.set(key, { scope: scope === null ? null : [...scope], at: Date.now() });
  return scope;
}

/**
 * The scope requireFeature read for one request, keyed by that request's own context object — so it lives
 * exactly as long as the request does and can never be served to another request or session.
 */
const requestScope = new WeakMap<object, ProducerScope>();
export function rememberScope(context: object, scope: ProducerScope) {
  requestScope.set(context, scope === null ? null : [...scope]);
}

const SCOPE_CACHE_LIMIT = 5000;
const scopeSeen = new Map<string, { scope: ProducerScope; at: number }>();

/**
 * Narrows a PostgREST query to the visible producers' rows. `column` is the table's producer column
 * (D1: owner_user_id, agent_user_id, producer_user_id …). No-op when the scope is null.
 */
export function scopeQuery<Q extends { in(column: string, values: readonly string[]): Q }>(query: Q, column: string, scope: ProducerScope): Q {
  if (scope === null) return query;
  return query.in(column, scope.length ? scope : [NO_PRODUCER]);
}

/** For a detail route: may this session open a row attributed to `producerUserId`? */
export async function canSeeProducerRow(context: { tenantId: string; userId: string }, producerUserId: string | null | undefined): Promise<boolean> {
  return rowVisible(await scopeFor(context), producerUserId);
}

/** For aggregates and exports computed in code: drop what the session may not see before summing. */
export async function filterVisible<T>(context: { tenantId: string; userId: string }, rows: readonly T[], producerOf: (row: T) => string | null | undefined): Promise<T[]> {
  return keepVisible(await scopeFor(context), rows, producerOf);
}
