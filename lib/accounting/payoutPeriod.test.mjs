import test from "node:test";
import assert from "node:assert/strict";

import { defaultPayoutPeriod, periodHasTerms } from "./payoutPeriod.ts";

test("a new partner defaults to the month its first terms begin, not the prior termless month", () => {
  assert.deepEqual(
    defaultPayoutPeriod("2026-10-29", new Date("2026-10-30T12:00:00.000Z")),
    { from: "2026-10-29", to: "2026-10-31" },
  );
});

test("a partner with established terms defaults to the last complete month", () => {
  assert.deepEqual(
    defaultPayoutPeriod("2026-06-15", new Date("2026-10-30T12:00:00.000Z")),
    { from: "2026-09-01", to: "2026-09-30" },
  );
});

test("a period ending before the first effective term is rejected before draft creation", () => {
  assert.equal(periodHasTerms("2026-10-29", "2026-09-01", "2026-09-30"), false);
  assert.equal(periodHasTerms("2026-10-29", "2026-10-29", "2026-10-31"), true);
  assert.equal(periodHasTerms(null, "2026-10-01", "2026-10-31"), false);
});
