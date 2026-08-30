// Run with: npm test
//
// Whop takes decimal dollars; we hold integer cents. That boundary is where a cent goes missing,
// so it gets the same scrutiny as lib/money.ts. The provider itself is exercised with a stubbed
// fetch, so these run offline.
import { test } from "node:test";
import assert from "node:assert/strict";

import { WhopClient, WhopApiError, centsToWhopAmount, whopAmountToCents, extractCheckoutUrl } from "./client.ts";
import { WhopProvider, BILLING_PERIOD_DAYS } from "./provider.ts";
import { ProviderUnsupportedError } from "../types.ts";

const TENANT = "11111111-2222-3333-4444-555555555555";

/** Records what was sent and replies with `body`. */
function stubFetch(body, status = 200) {
  const calls = [];
  const impl = async (url, init) => {
    calls.push({ url, method: init.method, headers: init.headers, body: init.body ? JSON.parse(init.body) : null });
    return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
  };
  return { impl, calls };
}

function providerWith(body, status = 200) {
  const { impl, calls } = stubFetch(body, status);
  const client = new WhopClient({ apiKey: "sk_test", baseUrl: "https://sandbox-api.whop.com/api/v1", fetchImpl: impl });
  return { provider: new WhopProvider(client), calls };
}

test("centsToWhopAmount: the values that break naive division", () => {
  assert.equal(centsToWhopAmount(44999), 449.99);
  assert.equal(centsToWhopAmount(10), 0.1);   // ten cents, not ten dollars
  assert.equal(centsToWhopAmount(1), 0.01);
  assert.equal(centsToWhopAmount(0), 0);
  assert.equal(centsToWhopAmount(100), 1);
  assert.equal(centsToWhopAmount(24900), 249);
});

test("centsToWhopAmount refuses non-integer cents rather than rounding", () => {
  assert.throws(() => centsToWhopAmount(10.5));
  assert.throws(() => centsToWhopAmount(449.99));  // dollars passed by mistake
});

test("whopAmountToCents round-trips exactly", () => {
  for (const cents of [0, 1, 10, 99, 100, 24900, 44999, 123456789]) {
    assert.equal(whopAmountToCents(centsToWhopAmount(cents)), cents, `${cents} did not round-trip`);
  }
});

test("whopAmountToCents reads strings without a float in the middle", () => {
  assert.equal(whopAmountToCents("449.99"), 44999);
  assert.equal(whopAmountToCents("0.1"), 10);
  assert.equal(whopAmountToCents("249"), 24900);
  assert.throws(() => whopAmountToCents("not money"));
});

test("extractCheckoutUrl accepts any of Whop's names and names the keys when it fails", () => {
  assert.equal(extractCheckoutUrl({ purchase_url: "https://whop.com/checkout/plan_1" }), "https://whop.com/checkout/plan_1");
  assert.equal(extractCheckoutUrl({ checkout_url: "https://x" }), "https://x");
  assert.throws(
    () => extractCheckoutUrl({ id: "plan_1", status: "active" }),
    (error) => {
      // The message must say what WAS there, or debugging this means guessing.
      assert.match(error.message, /id, status/);
      return true;
    },
  );
});

test("createCheckoutSession attaches the tenant id as metadata", async () => {
  const { provider, calls } = providerWith({ id: "ch_1", purchase_url: "https://whop.com/checkout/plan_9" });
  const session = await provider.createCheckoutSession({ providerPlanId: "plan_9", tenantId: TENANT });

  assert.equal(session.url, "https://whop.com/checkout/plan_9");
  assert.equal(calls[0].method, "POST");
  assert.match(calls[0].url, /\/checkout_configurations$/);
  // This is the whole tenant-attribution mechanism: it must be on the wire.
  assert.equal(calls[0].body.metadata.tenant_id, TENANT);
  assert.equal(calls[0].body.plan_id, "plan_9");
});

test("checkout sessions carry an idempotency key so a retry opens one checkout", async () => {
  const { provider, calls } = providerWith({ id: "ch_1", purchase_url: "https://x" });
  await provider.createCheckoutSession({ providerPlanId: "plan_9", tenantId: TENANT });

  assert.ok(calls[0].headers["idempotency-key"], "no idempotency-key header was sent");
});

test("createCustomer is refused, not faked", async () => {
  // Whop creates the customer at checkout. Inventing one would create a record Whop never saw.
  const { provider } = providerWith({});
  await assert.rejects(() => provider.createCustomer(), (e) => e instanceof ProviderUnsupportedError);
});

test("getCharge maps Whop's vocabulary and never guesses", async () => {
  for (const [whopStatus, expected] of [
    ["succeeded", "succeeded"],
    ["paid", "succeeded"],
    ["failed", "failed"],
    ["canceled", "failed"],
    ["some_new_status_whop_added", "unknown"],
    [undefined, "unknown"],
  ]) {
    const { provider } = providerWith({ status: whopStatus });
    assert.equal((await provider.getCharge("pay_1")).status, expected, `${whopStatus} mapped wrong`);
  }
});

test("refund sends a decimal amount, not cents", async () => {
  const { provider, calls } = providerWith({ id: "ref_1" });
  await provider.refund({ chargeId: "pay_1", amountCents: 44999, idempotencyKey: "r1" });

  assert.equal(calls[0].body.partial_amount, 449.99);
  assert.match(calls[0].url, /\/payments\/pay_1\/refund$/);
});

test("a charge id is URL-encoded into the path", async () => {
  const { provider, calls } = providerWith({ status: "paid" });
  await provider.getCharge("pay/../../admin");

  assert.ok(!calls[0].url.includes("pay/../../admin"), "path traversal reached the URL");
});

test("createPlan stamps our plan identity as metadata and converts the cycle to days", async () => {
  const { provider, calls } = providerWith({ id: "plan_new", product_id: "prod_1" });
  const result = await provider.createPlan({
    productId: "prod_1",
    priceCents: 44999,
    billingCycle: "yearly",
    ourPlanId: TENANT,
    planCode: "plan_c",
    planVersion: 3,
  });

  assert.equal(result.whopPlanId, "plan_new");
  assert.equal(calls[0].body.initial_price, 449.99);
  assert.equal(calls[0].body.billing_period, BILLING_PERIOD_DAYS.yearly);
  assert.equal(calls[0].body.plan_type, "renewal");
  // Plan metadata is what identifies a RENEWAL, which carries no checkout session.
  assert.equal(calls[0].body.metadata.insurvas_plan_code, "plan_c");
  assert.equal(calls[0].body.metadata.insurvas_plan_version, "3");
});

test("an unknown billing cycle is refused rather than defaulting to monthly", async () => {
  const { provider } = providerWith({ id: "plan_new" });
  await assert.rejects(
    () => provider.createPlan({ productId: "p", priceCents: 100, billingCycle: "weekly", ourPlanId: TENANT, planCode: "x", planVersion: 1 }),
    /No Whop billing period/,
  );
});

test("a non-2xx response throws WhopApiError carrying the status and body", async () => {
  const { provider } = providerWith({ error: "plan not found" }, 404);
  await assert.rejects(
    () => provider.getCharge("pay_missing"),
    (error) => {
      assert.ok(error instanceof WhopApiError);
      assert.equal(error.status, 404);
      assert.deepEqual(error.body, { error: "plan not found" });
      return true;
    },
  );
});

test("the client refuses to start without an API key", () => {
  assert.throws(() => new WhopClient({ apiKey: "", baseUrl: "https://x" }), /WHOP_API_KEY/);
});
