// SA-3.1 acceptance: the provider adapter's database contract and the dummy providers' behaviour,
// checked against the real database with the same client the app uses.
//
// The UPDATE check below matters most: it runs through supabase-js with the service role key, so
// it proves the running application cannot rewrite its own provider log — not merely that a
// REVOKE statement was typed at some point.
//
// NOT covered here (needs the running app): the withCallLogging decorator and the admin API route.
// Those are verified in the browser pass.
//
// Everything is created under a throwaway tenant and removed at the end.
// Run with: npm run verify:payments
import { createClient } from "@supabase/supabase-js";

import { DummyStripeProvider, DummyPayPalProvider } from "../lib/payments/dummy.ts";
import { ProviderTimeoutError } from "../lib/payments/types.ts";

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!url || !serviceKey) {
  console.error("Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY in .env.local");
  process.exit(1);
}

const supabase = createClient(url, serviceKey, { auth: { persistSession: false } });

let failures = 0;
function check(label, condition, detail = "") {
  if (condition) {
    console.log(`  ok   ${label}`);
  } else {
    console.log(`  FAIL ${label}${detail ? ` — ${detail}` : ""}`);
    failures++;
  }
}

const stamp = Date.now();
const { data: tenant, error: tenantError } = await supabase
  .from("tenants")
  .insert({ name: `Provider check ${stamp}`, status: "active" })
  .select("id")
  .single();

if (tenantError) {
  console.error("Could not create the test tenant:", tenantError.message);
  process.exit(1);
}

const tenantId = tenant.id;

// Whop is now the only provider in the registry, but two are needed to prove that switching a
// tenant between providers keeps exactly one default. This adds a throwaway second one and
// removes it again, rather than weakening the check to fit the registry.
const SECOND_PROVIDER = `zz_test_${stamp}`;
await supabase.from("provider_settings").insert({
  provider: SECOND_PROVIDER,
  display_label: "Test provider",
  is_enabled: true,
  is_default: false,
  sort_order: 99,
});

async function cleanup() {
  await supabase.from("payment_providers").delete().eq("tenant_id", tenantId);
  await supabase.from("provider_settings").delete().eq("provider", SECOND_PROVIDER);
  await supabase.from("provider_calls").delete().eq("tenant_id", tenantId);
  await supabase.from("payment_providers").delete().eq("tenant_id", tenantId);
  await supabase.from("tenants").delete().eq("id", tenantId);
}

try {
  // --- The platform registry -------------------------------------------------
  console.log("Platform registry\n");

  const { data: settings } = await supabase
    .from("provider_settings")
    .select("provider, is_enabled, is_default");

  const defaults = (settings ?? []).filter((s) => s.is_default);
  check("exactly one platform default provider", defaults.length === 1, `found ${defaults.length}`);
  check("the default provider is enabled", defaults[0]?.is_enabled === true);
  check("the default provider is whop", defaults[0]?.provider === "whop", `got ${defaults[0]?.provider}`);

  // --- Assigning and switching ----------------------------------------------
  console.log("\nAssigning a provider\n");

  await supabase.from("payment_providers").insert({
    tenant_id: tenantId,
    provider: "whop",
    is_default: true,
  });

  const { error: badProvider } = await supabase.from("payment_providers").insert({
    tenant_id: tenantId,
    provider: "not_a_real_provider",
    is_default: false,
  });
  check("an unknown provider is refused by the foreign key", badProvider !== null);

  const { error: badOutcome } = await supabase
    .from("payment_providers")
    .update({ simulate_outcome: "explode" })
    .eq("tenant_id", tenantId);
  check("an invalid simulate_outcome is refused by the check constraint", badOutcome !== null);

  // The route stands the old default down before raising the new one; doing it the other way round
  // must be impossible, or a tenant could end up with two "default" payment methods.
  const { error: twoDefaults } = await supabase.from("payment_providers").insert({
    tenant_id: tenantId,
    provider: SECOND_PROVIDER,
    is_default: true,
  });
  check("a second default for the same tenant is refused", twoDefaults !== null);

  await supabase.from("payment_providers").update({ is_default: false }).eq("tenant_id", tenantId);
  const { error: switchError } = await supabase.from("payment_providers").insert({
    tenant_id: tenantId,
    provider: SECOND_PROVIDER,
    is_default: true,
  });
  check("switching provider works once the old default is stood down", switchError === null);

  // --- The call log ----------------------------------------------------------
  console.log("\nProvider call log (as the app's own service-role client)\n");

  const { data: call } = await supabase
    .from("provider_calls")
    .insert({
      tenant_id: tenantId,
      provider: "whop",
      method: "createCheckoutSession",
      request: { amountCents: 44999 },
      response: { status: "succeeded" },
      status: "ok",
      duration_ms: 3,
      idempotency_key: `verify_${stamp}`,
    })
    .select("id")
    .single();

  check("a call can be written", Boolean(call?.id));

  const { error: rewriteError } = await supabase
    .from("provider_calls")
    .update({ status: "declined" })
    .eq("id", call.id);

  check(
    "the app CANNOT rewrite a logged call",
    rewriteError !== null,
    "the update succeeded — the provider log is not trustworthy evidence",
  );

  const { error: purgeError } = await supabase.from("provider_calls").delete().eq("id", call.id);
  check("old calls CAN be purged for retention", purgeError === null, purgeError?.message ?? "");

  // --- The dummy providers ---------------------------------------------------
  console.log("\nDummy provider behaviour\n");

  const succeeding = new DummyStripeProvider();
  const charge = await succeeding.createCharge({
    amountCents: 44999,
    providerCustomerId: "cus_x",
    idempotencyKey: `inv_${stamp}`,
  });
  check("a charge succeeds by default", charge.status === "succeeded");

  const declining = new DummyStripeProvider({ simulate: "insufficient_funds" });
  const attempts = [];
  for (const key of ["a", "b", "c", "d", "e"]) {
    attempts.push(await declining.createCharge({ amountCents: 24900, providerCustomerId: "cus_x", idempotencyKey: key }));
  }
  check(
    "the simulator is sticky across all five dunning attempts",
    attempts.every((a) => a.status === "failed" && a.failureReason === "insufficient_funds"),
    `got ${attempts.map((a) => a.status).join(", ")}`,
  );

  let timedOut = false;
  try {
    await new DummyStripeProvider({ simulate: "timeout" }).createCharge({
      amountCents: 100,
      providerCustomerId: "cus_x",
      idempotencyKey: "t",
    });
  } catch (error) {
    timedOut = error instanceof ProviderTimeoutError;
  }
  check("a timeout throws rather than reporting a decline", timedOut);

  // The headline criterion: swapping the provider changes nothing a caller can observe.
  const input = { amountCents: 44999, providerCustomerId: "cus_x", idempotencyKey: `swap_${stamp}` };
  const viaStripe = await new DummyStripeProvider().createCharge(input);
  const viaPayPal = await new DummyPayPalProvider().createCharge(input);
  check(
    "switching provider changes no field a caller reads",
    viaStripe.status === viaPayPal.status && Object.keys(viaStripe).join() === Object.keys(viaPayPal).join(),
    `${JSON.stringify(viaStripe)} vs ${JSON.stringify(viaPayPal)}`,
  );

  // --- Cascade ---------------------------------------------------------------
  console.log("\nDeleting a tenant\n");

  await supabase.from("provider_calls").insert({
    tenant_id: tenantId,
    provider: "whop",
    method: "getCharge",
    request: { chargeId: "ch_x" },
    status: "ok",
    idempotency_key: `cascade_${stamp}`,
  });

  await supabase.from("tenants").delete().eq("id", tenantId);

  const { count: leftoverProviders } = await supabase
    .from("payment_providers")
    .select("id", { count: "exact", head: true })
    .eq("tenant_id", tenantId);
  check("the tenant's provider rows are removed with it", (leftoverProviders ?? 0) === 0);

  const { data: orphanCalls } = await supabase
    .from("provider_calls")
    .select("id, tenant_id")
    .eq("idempotency_key", `cascade_${stamp}`);
  check(
    "the call log survives the tenant it belonged to",
    (orphanCalls ?? []).every((c) => c.tenant_id === null),
    "provider calls must outlive the tenant — they are the record of money we tried to move",
  );
} finally {
  console.log("\nCleaning up…");
  await cleanup();
  // The cascade nulls tenant_id, so rows from this run are found by their tagged key instead.
  await supabase.from("provider_calls").delete().eq("idempotency_key", `verify_${stamp}`);
  await supabase.from("provider_calls").delete().eq("idempotency_key", `cascade_${stamp}`);
}

console.log(failures === 0 ? "\nAll payment provider checks passed." : `\n${failures} check(s) FAILED.`);
process.exit(failures === 0 ? 0 : 1);
