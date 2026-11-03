import "server-only";

import { getSupabaseServiceClient } from "@/lib/supabase/service";

/**
 * The workspace timezone (Settings › Agency profile), for the server code that needs "the agency's
 * clock": the agency-side time on every callback, and — in SQL, deal_local_date (migration
 * 20260924220000) — the day a deal is filed under when the agent has no timezone of their own.
 *
 * Null when none is set, when it is not a zone this runtime knows, or before migration
 * 20260924100000 (no agency_profiles): callers then keep the behaviour they had. Cached per tenant
 * for a minute, because callbacks are read on every dashboard and floor refresh.
 */
const cache = new Map<string, { zone: string | null; at: number }>();
const TTL_MS = 60_000;

function knownZone(value: unknown): string | null {
  if (typeof value !== "string" || !value) return null;
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: value });
    return value;
  } catch {
    return null;
  }
}

// The read in flight per tenant, so two callers in the same render (the dashboard asks for the zone
// in the page and again in its streamed "today" section) share one round trip instead of both
// missing the cache while the first is still on the wire.
const pending = new Map<string, Promise<string | null>>();

export async function getWorkspaceTimezone(tenantId: string): Promise<string | null> {
  const hit = cache.get(tenantId);
  if (hit && Date.now() - hit.at < TTL_MS) return hit.zone;
  const inFlight = pending.get(tenantId);
  if (inFlight) return inFlight;
  const read = (async () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- agency_profiles is not in the shared generated types yet
    const { data, error } = await (getSupabaseServiceClient() as any).from("agency_profiles").select("timezone").eq("tenant_id", tenantId).maybeSingle();
    const zone = error ? null : knownZone((data as { timezone?: string | null } | null)?.timezone);
    cache.set(tenantId, { zone, at: Date.now() });
    if (cache.size > 2000) cache.clear();
    return zone;
  })().finally(() => pending.delete(tenantId));
  pending.set(tenantId, read);
  return read;
}
