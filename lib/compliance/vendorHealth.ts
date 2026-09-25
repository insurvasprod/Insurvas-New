/**
 * How a compliance vendor's health is counted from provider_calls. Plain module — no database
 * client, no `server-only` — so the dial gate (service.ts), the admin registry and node:test all
 * read the same rule.
 *
 * One failed lookup writes TWO rows when a next vendor exists: the lookup itself (status error)
 * and a `method: "fallback"` hand-off row (also status error, duration 0) under the vendor that
 * failed. The hand-off is not a second call to the vendor, so it is never counted — not as a call,
 * not as a failure, and not as the vendor's "last check" (user decision on p-adm-compliance: fix
 * the double count everywhere, change nothing else about the gate).
 */

/** The provider_calls method that records a hand-off to the next vendor, not a vendor call. */
export const FALLBACK_METHOD = "fallback";

/** How far back "Last checked" looks for a vendor's latest call (the health window stays 24h). */
export const LAST_CHECK_LOOKBACK_DAYS = 7;

export type VendorCallCounts ={ calls24h: number; failures24h: number };

/**
 * The gate's availability rule, unchanged: no calls means unknown (counted as available), and once
 * calls exist a vendor is unavailable only when every observed call in the window failed.
 */
export function vendorAvailable(counts: VendorCallCounts): boolean {
  return counts.calls24h === 0 || counts.failures24h < counts.calls24h;
}

type CountAnswer = { count: number | null; error: { message: string } | null };
/** The slice of the PostgREST builder the count needs; the Supabase client satisfies it. */
export type CountQuery = PromiseLike<CountAnswer> & {
  eq(column: string, value: unknown): CountQuery;
  neq(column: string, value: unknown): CountQuery;
  gte(column: string, value: unknown): CountQuery;
};
export type CountSource = {
  from(table: "provider_calls"): { select(columns: string, options: { count: "exact"; head: true }): CountQuery };
};

/**
 * Head counts of one vendor's calls since `since`, fallback hand-offs excluded. failures = all - ok,
 * so a null/other status still counts as a failure, exactly as before.
 */
export async function countVendorCalls(db: CountSource, provider: string, since: string): Promise<VendorCallCounts> {
  const calls = () =>
    db.from("provider_calls").select("id", { count: "exact", head: true })
      .eq("provider", provider).gte("ts", since).neq("method", FALLBACK_METHOD);
  const [all, ok] = await Promise.all([calls(), calls().eq("status", "ok")]);
  const error = all.error ?? ok.error;
  if (error) throw new Error(`Could not load compliance vendor health: ${error.message}`);
  const calls24h = all.count ?? 0;
  return { calls24h, failures24h: calls24h - (ok.count ?? 0) };
}
