import "server-only";

// SA-4.2 · What the platform is actually pointed at right now.
//
// Read from the running configuration rather than from a stored copy, so the screen cannot
// disagree with what the client is calling. Credentials stay in environment variables — see
// docs/backlog.md for why they were deliberately not moved into the database.

import { getSupabaseServiceClient } from "@/lib/supabase/service";
import { deriveMode, maskSecret, type ProviderMode } from "./statusRules";

export type ProviderHealth = {
  lastSuccessAt: string | null;
  lastFailureAt: string | null;
  failures24h: number;
  totalCalls: number;
};

export type ProviderStatus = {
  mode: ProviderMode;
  baseUrl: string | null;
  apiKeyFingerprint: string | null;
  /** Presence only. The value is never read out of the environment into a response. */
  webhookSecretPresent: boolean;
  productId: string | null;
  accountId: string | null;
  health: ProviderHealth;
};

/**
 * Note what is NOT returned: no API key, no webhook secret, not even truncated beyond a
 * four-character fingerprint. Anything this function returns can end up in an HTTP response and
 * in the HTML of a server-rendered page, so it holds only what is safe in both.
 */
export async function getProviderStatus(): Promise<ProviderStatus> {
  const baseUrl = process.env.WHOP_API_BASE_URL ?? null;

  return {
    mode: deriveMode(baseUrl ?? undefined),
    baseUrl,
    apiKeyFingerprint: maskSecret(process.env.WHOP_API_KEY),
    webhookSecretPresent: Boolean(process.env.WHOP_WEBHOOK_SECRET?.trim()),
    productId: process.env.WHOP_PRODUCT_ID ?? null,
    accountId: process.env.WHOP_ACCOUNT_ID ?? null,
    health: await fetchHealth(),
  };
}

/**
 * Health from provider_calls, which SA-3.1 writes and SA-4.2 made complete.
 *
 * Until SA-4.2 the logging decorator wrapped only the PaymentProvider interface, so the seven call
 * sites using Whop-specific methods reached Whop without logging anything — the table was empty
 * beside real sandbox payments. Logging now happens inside WhopClient.request, so a row exists for
 * every call. Rows written before that change do not exist, which is why an empty table here means
 * "nothing since the fix" rather than "nothing ever happened".
 */
async function fetchHealth(): Promise<ProviderHealth> {
  const supabase = getSupabaseServiceClient();
  const since = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();

  const [lastOk, lastBad, failures, total] = await Promise.all([
    supabase
      .from("provider_calls")
      .select("ts")
      .eq("provider", "whop")
      .eq("status", "ok")
      .order("ts", { ascending: false })
      .limit(1)
      .maybeSingle<{ ts: string }>(),
    supabase
      .from("provider_calls")
      .select("ts")
      .eq("provider", "whop")
      .neq("status", "ok")
      .order("ts", { ascending: false })
      .limit(1)
      .maybeSingle<{ ts: string }>(),
    supabase
      .from("provider_calls")
      .select("id", { count: "exact", head: true })
      .eq("provider", "whop")
      .neq("status", "ok")
      .gte("ts", since),
    supabase.from("provider_calls").select("id", { count: "exact", head: true }).eq("provider", "whop"),
  ]);

  return {
    lastSuccessAt: lastOk.data?.ts ?? null,
    lastFailureAt: lastBad.data?.ts ?? null,
    failures24h: failures.count ?? 0,
    totalCalls: total.count ?? 0,
  };
}
