import test from "node:test";
import assert from "node:assert/strict";
import { customerTimezone, formatInTimezone, stateFromLeadValues } from "./timezone.ts";

test("callback timezone is derived from the lead state", () => {
  assert.equal(stateFromLeadValues({ resident_state: "az" }), "AZ");
  assert.equal(customerTimezone({ state: "AZ" }), "America/Phoenix");
  assert.equal(customerTimezone({ state: "NY" }), "America/New_York");
  assert.equal(customerTimezone({}), "America/New_York");
});

test("the same customer-local time becomes different UTC instants across a zone boundary", () => {
  const local = "2026-09-10T14:00";
  const phoenix = new Date(`${local}-07:00`).toISOString();
  const newYork = new Date(`${local}-04:00`).toISOString();
  assert.equal(phoenix, "2026-09-10T21:00:00.000Z");
  assert.equal(newYork, "2026-09-10T18:00:00.000Z");
  assert.notEqual(phoenix, newYork);
  assert.match(formatInTimezone(phoenix, "America/Phoenix"), /Sep 10, 2026/);
});
