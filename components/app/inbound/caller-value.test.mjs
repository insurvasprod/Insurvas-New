import assert from "node:assert/strict";
import test from "node:test";

import { callerValue } from "./caller-value.ts";

test("a currency field is stored in cents: a $250,000 hot lead reads $250,000, not $25,000,000", () => {
  // The partner portal stores a typed 250000 as 25000000 cents (partner-portal-workspace.tsx).
  assert.equal(callerValue({ field_key: "coverage_amount", label: "Coverage amount", type: "currency" }, "25000000"), "$250,000");
  assert.equal(callerValue({ field_key: "monthly_premium", label: "Monthly premium", type: "currency" }, "4250"), "$42.50");
  // Any currency field, whatever its name.
  assert.equal(callerValue({ field_key: "budget", label: "Budget", type: "currency" }, "10000"), "$100");
});

test("a plain number named like money is whole dollars, as typed", () => {
  assert.equal(callerValue({ field_key: "annual_income", label: "Annual income", type: "number" }, "55000"), "$55,000");
  assert.equal(callerValue({ field_key: "coverage_amount", label: "Coverage" }, "55000"), "$55,000");
});

test("other values are left alone; ISO dates read as a day", () => {
  assert.equal(callerValue({ field_key: "height", label: "Height", type: "number" }, "70"), "70");
  assert.equal(callerValue({ field_key: "coverage_amount", label: "Coverage", type: "currency" }, "about 50k"), "about 50k");
  assert.equal(callerValue({ field_key: "date_of_birth", label: "Date of birth", type: "date" }, "1961-04-09"), "Apr 9, 1961");
});
