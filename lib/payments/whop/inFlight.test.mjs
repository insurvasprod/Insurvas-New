// Run with: node --experimental-strip-types --test lib/payments/whop/inFlight.test.mjs
//
// Two concurrent deliveries of one webhook-id: the second used to run the handler in parallel and
// die on a unique violation (500). It is now answered as a duplicate while the first is in flight.
import { test } from "node:test";
import assert from "node:assert/strict";

import { isInFlight, IN_FLIGHT_WINDOW_MS } from "./events.ts";

const NOW = Date.parse("2026-10-15T12:00:00Z");
const row = (over = {}) => ({ processed_at: null, process_error: null, attempts: 0, received_at: new Date(NOW - 1_000).toISOString(), ...over });

test("stored a moment ago, unfinished and unfailed: in flight", () => {
  assert.equal(isInFlight(row(), NOW), true);
});

test("processed is a plain duplicate, not in flight", () => {
  assert.equal(isInFlight(row({ processed_at: new Date(NOW).toISOString() }), NOW), false);
});

test("a recorded failure means this delivery is the retry and must run", () => {
  assert.equal(isInFlight(row({ process_error: "boom" }), NOW), false);
  assert.equal(isInFlight(row({ attempts: 1 }), NOW), false);
});

test("an old unfinished row (a crashed handler) is retried, not parked", () => {
  assert.equal(isInFlight(row({ received_at: new Date(NOW - IN_FLIGHT_WINDOW_MS).toISOString() }), NOW), false);
  assert.equal(isInFlight(row({ received_at: null }), NOW), false);
});
