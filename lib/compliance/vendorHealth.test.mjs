// Run with: npm test
//
// User decision (p-adm-compliance): a fallback hand-off row is not a vendor call. One failed lookup
// writes the failed call AND, when a next vendor exists, a `method: "fallback"` row under the same
// vendor — which used to count as a second failure on the admin page and in the dial gate.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { FALLBACK_METHOD, countVendorCalls, vendorAvailable } from "./vendorHealth.ts";

/** An in-memory provider_calls that evaluates the filters the count applies, like PostgREST would. */
function fakeDb(rows) {
  return {
    from(table) {
      assert.equal(table, "provider_calls");
      return {
        select(_columns, options) {
          assert.deepEqual(options, { count: "exact", head: true });
          const filters = [];
          const query = {
            eq(column, value) { filters.push((row) => row[column] === value); return query; },
            neq(column, value) { filters.push((row) => row[column] !== value); return query; },
            gte(column, value) { filters.push((row) => row[column] >= value); return query; },
            then(resolve, reject) {
              return Promise.resolve({ count: rows.filter((row) => filters.every((keep) => keep(row))).length, error: null }).then(resolve, reject);
            },
          };
          return query;
        },
      };
    },
  };
}

const since = "2026-09-24T00:00:00.000Z";
const at = "2026-09-24T08:00:00.000Z";
const provider = "compliance_vendor:primary";

test("a single failed lookup counts once, not twice with its fallback hand-off", async () => {
  // Exactly what runWithComplianceFallback / runProviderType write for one failed primary lookup.
  const rows = [
    { provider, ts: at, method: "dnc_scrub", status: "error" },
    { provider, ts: at, method: FALLBACK_METHOD, status: "error" },
  ];
  assert.deepEqual(await countVendorCalls(fakeDb(rows), provider, since), { calls24h: 1, failures24h: 1 });
});

test("a litigator lookup's hand-off is excluded the same way", async () => {
  const rows = [
    { provider, ts: at, method: "litigator_scrub", status: "timeout" },
    { provider, ts: at, method: FALLBACK_METHOD, status: "error" },
    { provider, ts: at, method: "litigator_scrub", status: "ok" },
  ];
  assert.deepEqual(await countVendorCalls(fakeDb(rows), provider, since), { calls24h: 2, failures24h: 1 });
});

test("the window and the vendor still bound the count", async () => {
  const rows = [
    { provider, ts: "2026-09-23T08:00:00.000Z", method: "dnc_scrub", status: "error" },
    { provider: "compliance_vendor:other", ts: at, method: "dnc_scrub", status: "error" },
    { provider, ts: at, method: "test_connection", status: "ok" },
  ];
  assert.deepEqual(await countVendorCalls(fakeDb(rows), provider, since), { calls24h: 1, failures24h: 0 });
});

test("the availability rule itself is unchanged: unchecked is available, all-failed is not", () => {
  assert.equal(vendorAvailable({ calls24h: 0, failures24h: 0 }), true);
  assert.equal(vendorAvailable({ calls24h: 3, failures24h: 2 }), true);
  assert.equal(vendorAvailable({ calls24h: 3, failures24h: 3 }), false);
});

test("before the fix, the same rows made a vendor with one success look unavailable", async () => {
  // One ok lookup, one failed lookup + its hand-off: 3 rows, 2 "failures" under the old count.
  const rows = [
    { provider, ts: at, method: "dnc_scrub", status: "ok" },
    { provider, ts: at, method: "dnc_scrub", status: "error" },
    { provider, ts: at, method: FALLBACK_METHOD, status: "error" },
  ];
  const counts = await countVendorCalls(fakeDb(rows), provider, since);
  assert.deepEqual(counts, { calls24h: 2, failures24h: 1 });
  assert.equal(vendorAvailable(counts), true);
});

test("the gate and the admin list both count through countVendorCalls", () => {
  const service = readFileSync(join(process.cwd(), "lib/compliance/service.ts"), "utf8");
  assert.match(service, /function callCounts[\s\S]{0,200}countVendorCalls\(/);
  assert.match(service, /getDncDialingStatus[\s\S]{0,700}callCounts\(/);
  // No second, hand-written count of provider_calls may creep back in beside it.
  assert.equal((service.match(/count: "exact", head: true \}\)\.eq\("provider"/g) ?? []).length, 0);
});
