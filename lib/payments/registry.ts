import "server-only";

// SA-3.1 · Turning "this tenant" into a ready-to-use PaymentProvider.
//
// Every caller in SA-3.2 / 3.4 / 3.5 / 3.8 goes through getPaymentProviderForTenant(). None of them
// ever names a provider, which is what makes the swap-in-a-real-provider criterion true.

import { getSupabaseServiceClient } from "@/lib/supabase/service";
import { DummyPayPalProvider, DummyStripeProvider } from "./dummy";
import { withCallLogging } from "./logging";
import { isProviderCode, type ProviderCode, type SimulatedOutcome, type TenantPaymentProvider } from "./constants";
import type { PaymentProvider } from "./types";

/**
 * The only place a provider code maps to a class. Adding real Stripe is one line here plus the new
 * class — no billing code is touched, which is the acceptance criterion this file exists to meet.
 */
export function buildProvider(code: ProviderCode, options: { simulate?: SimulatedOutcome } = {}): PaymentProvider {
  switch (code) {
    case "dummy_stripe":
      return new DummyStripeProvider(options);
    case "dummy_paypal":
      return new DummyPayPalProvider(options);
  }
}

/** The platform-wide fallback, used by any tenant with no provider of their own. SA-4.2 edits it. */
export async function getPlatformDefaultProviderCode(): Promise<ProviderCode> {
  const supabase = getSupabaseServiceClient();
  const { data } = await supabase
    .from("provider_settings")
    .select("provider")
    .eq("is_default", true)
    .eq("is_enabled", true)
    .maybeSingle<{ provider: string }>();

  if (data && isProviderCode(data.provider)) return data.provider;

  // No default configured, or it names a provider this build doesn't implement. Falling back
  // silently to a working provider would hide a real misconfiguration behind charges that appear
  // to work, so this refuses instead.
  throw new Error(
    "No enabled default payment provider is configured. Set is_default on a row in provider_settings.",
  );
}

export async function fetchTenantProviderRecord(tenantId: string): Promise<TenantPaymentProvider | null> {
  const supabase = getSupabaseServiceClient();
  const { data } = await supabase
    .from("payment_providers")
    .select("id, provider, provider_customer_id, payment_method_label, is_default, simulate_outcome")
    .eq("tenant_id", tenantId)
    .eq("is_default", true)
    .maybeSingle<TenantPaymentProvider>();

  return data ?? null;
}

export type ResolvedProvider = {
  provider: PaymentProvider;
  code: ProviderCode;
  /** Null when the tenant has never been assigned one and is running on the platform default. */
  record: TenantPaymentProvider | null;
};

/**
 * Note what this does NOT do: if a tenant sits on a provider that has since been disabled
 * platform-wide, it keeps using it rather than silently moving them. Disabling a provider is meant
 * to stop new checkouts (SA-4.2), not to reroute money for customers already paying through it.
 */
export async function getPaymentProviderForTenant(tenantId: string): Promise<ResolvedProvider> {
  const record = await fetchTenantProviderRecord(tenantId);

  const code = record && isProviderCode(record.provider) ? record.provider : await getPlatformDefaultProviderCode();

  const inner = buildProvider(code, { simulate: record?.simulate_outcome });

  return { provider: withCallLogging(inner, { tenantId }), code, record };
}

/**
 * Gives a tenant a customer record at their provider, if they don't already have one. Safe to call
 * repeatedly — the dummy providers derive the id from the tenant id, and real providers are asked
 * only when the column is empty.
 */
export async function ensureProviderCustomer(
  tenantId: string,
  tenantName: string,
  ownerEmail: string | null,
): Promise<string> {
  const { provider, record } = await getPaymentProviderForTenant(tenantId);
  if (record?.provider_customer_id) return record.provider_customer_id;

  const { providerCustomerId } = await provider.createCustomer({
    tenantId,
    name: tenantName,
    email: ownerEmail,
  });

  const supabase = getSupabaseServiceClient();
  await supabase
    .from("payment_providers")
    .update({ provider_customer_id: providerCustomerId, updated_at: new Date().toISOString() })
    .eq("tenant_id", tenantId)
    .eq("is_default", true);

  return providerCustomerId;
}
