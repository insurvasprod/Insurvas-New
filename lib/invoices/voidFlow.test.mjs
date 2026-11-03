// Run with: node --experimental-strip-types --test lib/invoices/voidFlow.test.mjs
//
// Voiding used to change our row only and leave Whop's pay page live. The provider is a test
// double here — these never reach a real API.
import { test } from "node:test";
import assert from "node:assert/strict";

import { voidInvoiceWith } from "./voidFlow.ts";

const base = { id: "i1", number: "INV-1", status: "issued", tenant_id: "t1", total_cents: 1000, provider_invoice_id: "inv_1", pay_online_url: "https://whop.com/pay/1" };

function deps({ paid = 0, providerFails = null, rowsChanged = 1, noProvider = false } = {}) {
  const calls = { provider: [], marked: [] };
  return {
    calls,
    deps: {
      paidCents: async () => paid,
      voidProviderInvoice: noProvider
        ? undefined
        : async (providerId, tenantId) => {
            calls.provider.push({ providerId, tenantId });
            if (providerFails) throw new Error(providerFails);
          },
      markVoid: async (input) => {
        calls.marked.push(input);
        return rowsChanged;
      },
    },
  };
}

test("the provider invoice is voided first, then ours, conditional on the status that was checked", async () => {
  const { calls, deps: d } = deps();
  const outcome = await voidInvoiceWith(base, "duplicate invoice", d);
  assert.deepEqual(outcome, { ok: true, providerVoided: true });
  assert.deepEqual(calls.provider, [{ providerId: "inv_1", tenantId: "t1" }]);
  assert.equal(calls.marked.length, 1);
  assert.equal(calls.marked[0].expectedStatus, "issued");
});

test("if the provider refuses (say, it was just paid), nothing is voided here", async () => {
  const { calls, deps: d } = deps({ providerFails: "Whop POST /invoices/inv_1/void failed with 400" });
  const outcome = await voidInvoiceWith(base, "duplicate invoice", d);
  assert.equal(outcome.ok, false);
  assert.equal(outcome.status, 502);
  assert.equal(calls.marked.length, 0);
});

test("an invoice paid between the check and the write is not voided over its payment", async () => {
  const { deps: d } = deps({ rowsChanged: 0 });
  const outcome = await voidInvoiceWith(base, "duplicate invoice", d);
  assert.equal(outcome.ok, false);
  assert.equal(outcome.status, 409);
});

test("a part-paid invoice is refused before anything is called", async () => {
  const { calls, deps: d } = deps({ paid: 1 });
  const outcome = await voidInvoiceWith(base, "duplicate invoice", d);
  assert.equal(outcome.status, 409);
  assert.equal(calls.provider.length + calls.marked.length, 0);
});

test("a pay-online invoice is not voided when no provider is configured to kill its link", async () => {
  const { calls, deps: d } = deps({ noProvider: true });
  const outcome = await voidInvoiceWith(base, "duplicate invoice", d);
  assert.equal(outcome.status, 502);
  assert.equal(calls.marked.length, 0);
});

test("an invoice never sent to the provider voids locally only", async () => {
  const { calls, deps: d } = deps();
  const outcome = await voidInvoiceWith({ ...base, provider_invoice_id: null, pay_online_url: null }, "raised in error", d);
  assert.deepEqual(outcome, { ok: true, providerVoided: false });
  assert.equal(calls.provider.length, 0);
});
