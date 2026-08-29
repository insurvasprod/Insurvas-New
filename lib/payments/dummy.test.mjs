// Run with: npm test
//
// The dummy providers are what SA-3.2 through SA-3.8 will be developed against, so their behaviour
// is worth pinning. In particular: a decline and a timeout must stay categorically different.
import { test } from "node:test";
import assert from "node:assert/strict";

import { DummyStripeProvider, DummyPayPalProvider } from "./dummy.ts";
import { ProviderTimeoutError } from "./types.ts";

const CUSTOMER = "cus_dstripe_test";

test("a successful charge succeeds and carries no failure reason", async () => {
  const provider = new DummyStripeProvider();
  const charge = await provider.createCharge({
    amountCents: 44999,
    providerCustomerId: CUSTOMER,
    idempotencyKey: "inv_1",
  });

  assert.equal(charge.status, "succeeded");
  assert.equal(charge.failureReason, undefined);
});

test("the same idempotency key always produces the same charge id", async () => {
  const provider = new DummyStripeProvider();
  const first = await provider.createCharge({ amountCents: 1000, providerCustomerId: CUSTOMER, idempotencyKey: "inv_7" });
  const second = await provider.createCharge({ amountCents: 1000, providerCustomerId: CUSTOMER, idempotencyKey: "inv_7" });
  const other = await provider.createCharge({ amountCents: 1000, providerCustomerId: CUSTOMER, idempotencyKey: "inv_8" });

  assert.equal(first.id, second.id, "retrying with the same key must not look like a second charge");
  assert.notEqual(first.id, other.id);
});

test("declines report a reason, and keep reporting it — the simulator is sticky", async () => {
  const provider = new DummyStripeProvider({ simulate: "insufficient_funds" });

  for (const key of ["attempt_1", "attempt_2", "attempt_3", "attempt_4", "attempt_5"]) {
    const charge = await provider.createCharge({ amountCents: 24900, providerCustomerId: CUSTOMER, idempotencyKey: key });
    assert.equal(charge.status, "failed");
    assert.equal(charge.failureReason, "insufficient_funds");
  }
});

test("expired_card is a distinct reason from insufficient_funds", async () => {
  const provider = new DummyStripeProvider({ simulate: "expired_card" });
  const charge = await provider.createCharge({ amountCents: 100, providerCustomerId: CUSTOMER, idempotencyKey: "k" });

  assert.equal(charge.failureReason, "expired_card");
});

test("a timeout THROWS rather than returning a failed charge", async () => {
  // The distinction the whole retry story rests on: a decline means no money moved, a timeout
  // means we do not know. Returning `{ status: "failed" }` here would tell callers a lie.
  const provider = new DummyStripeProvider({ simulate: "timeout" });

  await assert.rejects(
    () => provider.createCharge({ amountCents: 100, providerCustomerId: CUSTOMER, idempotencyKey: "k" }),
    (error) => {
      assert.ok(error instanceof ProviderTimeoutError);
      assert.equal(error.method, "createCharge");
      assert.equal(error.idempotencyKey, "k");
      return true;
    },
  );
});

test("a card decline cannot fail a refund — money is going the other way", async () => {
  const provider = new DummyStripeProvider({ simulate: "expired_card" });
  const refund = await provider.refund({ chargeId: "ch_dstripe_ok_abc", amountCents: 500, idempotencyKey: "r1" });

  assert.equal(refund.status, "succeeded");
});

test("getCharge reads the outcome back without any stored state", async () => {
  const provider = new DummyStripeProvider();
  const charge = await provider.createCharge({ amountCents: 100, providerCustomerId: CUSTOMER, idempotencyKey: "k" });

  // Deliberately a different instance: a server restart must not lose the answer.
  const fresh = new DummyStripeProvider();
  assert.equal((await fresh.getCharge(charge.id)).status, "succeeded");

  const declining = new DummyStripeProvider({ simulate: "insufficient_funds" });
  const declined = await declining.createCharge({ amountCents: 100, providerCustomerId: CUSTOMER, idempotencyKey: "k2" });
  assert.equal((await fresh.getCharge(declined.id)).status, "failed");
});

test("one provider does not recognise another's charge ids", async () => {
  const stripe = new DummyStripeProvider();
  const charge = await stripe.createCharge({ amountCents: 100, providerCustomerId: CUSTOMER, idempotencyKey: "k" });

  const paypal = new DummyPayPalProvider();
  assert.equal((await paypal.getCharge(charge.id)).status, "unknown");
});

test("customer ids are derived from the tenant, so they never duplicate", async () => {
  const provider = new DummyStripeProvider();
  const a = await provider.createCustomer({ tenantId: "tenant-1", name: "Acme", email: null });
  const b = await provider.createCustomer({ tenantId: "tenant-1", name: "Acme Renamed", email: "x@y.z" });
  const c = await provider.createCustomer({ tenantId: "tenant-2", name: "Acme", email: null });

  assert.equal(a.providerCustomerId, b.providerCustomerId);
  assert.notEqual(a.providerCustomerId, c.providerCustomerId);
});

test("fractional or negative amounts are refused, not silently rounded", async () => {
  const provider = new DummyStripeProvider();
  const base = { providerCustomerId: CUSTOMER, idempotencyKey: "k" };

  await assert.rejects(() => provider.createCharge({ ...base, amountCents: 10.5 }));
  await assert.rejects(() => provider.createCharge({ ...base, amountCents: 0 }));
  await assert.rejects(() => provider.createCharge({ ...base, amountCents: -100 }));
});

test("both providers satisfy the same interface", async () => {
  for (const provider of [new DummyStripeProvider(), new DummyPayPalProvider()]) {
    for (const method of ["createCustomer", "createCharge", "refund", "getCharge"]) {
      assert.equal(typeof provider[method], "function", `${provider.code} is missing ${method}`);
    }
  }
});
