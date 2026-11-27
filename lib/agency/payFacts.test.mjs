// Release 3 boards G1, G2, G4 · the facts the phone names beside a pay figure.
// Run with: node --experimental-strip-types --test lib/agency/payFacts.test.mjs

import test from "node:test";
import assert from "node:assert/strict";

import { advanceMonthsByCarrier, oneValue, policyMonth, teamFacts } from "./payFactsCore.ts";

test("the month of a policy's life an entry lands in", () => {
  assert.equal(policyMonth("2026-07-15", "2026-10-20"), 4);
  assert.equal(policyMonth("2026-07-15", "2026-10-14"), 3);
  assert.equal(policyMonth("2026-07-01", "2026-07-01"), 1);
  assert.equal(policyMonth("2026-07-15", "2026-06-01"), null);
  assert.equal(policyMonth(null, "2026-06-01"), null);
});

test("a fact is named only when every row agrees", () => {
  assert.equal(oneValue([8000, 8000]), 8000);
  assert.equal(oneValue([8000, 7500]), null);
  assert.equal(oneValue([]), null);
  assert.deepEqual(advanceMonthsByCarrier([{ carrierId: "a", advanceMonths: 9 }, { carrierId: "a", advanceMonths: 9 }, { carrierId: "b", advanceMonths: 9 }, { carrierId: "b", advanceMonths: 12 }]), { a: 9 });
});

test("a payout month's facts per person", () => {
  const facts = teamFacts([
    { producerUserId: "u1", entryType: "split_advance", policyNumber: "P1", shareBps: 8000 },
    { producerUserId: "u1", entryType: "split_advance", policyNumber: "P2", shareBps: 8000 },
    { producerUserId: "u1", entryType: "split_chargeback", policyNumber: "P0", shareBps: 8000 },
    { producerUserId: "u2", entryType: "app_bonus", policyNumber: null, shareBps: null },
    { producerUserId: "u2", entryType: "app_bonus", policyNumber: null, shareBps: null },
  ]);
  assert.deepEqual(facts.u1, { shareBps: 8000, policies: 2, chargebacks: 1, applications: 0 });
  assert.deepEqual(facts.u2, { shareBps: null, policies: 0, chargebacks: 0, applications: 2 });
});
