import test from "node:test";
import assert from "node:assert/strict";
import { customerTimezone, formatInTimezone, resolveCustomerTimezone, stateFromLeadValues } from "./timezone.ts";

test("callback timezone is derived from the lead state", () => {
  assert.equal(stateFromLeadValues({ resident_state: "az" }), "AZ");
  assert.equal(customerTimezone({ state: "AZ" }), "America/Phoenix");
  assert.equal(customerTimezone({ state: "NY" }), "America/New_York");
  // Never a guessed default (LA-1 audit): no state means no zone.
  assert.equal(customerTimezone({}), null);
});

test("an unknown state needs an explicit zone, with a code the UI can show", () => {
  const unknown = resolveCustomerTimezone({ state: "ZZ" });
  assert.equal(unknown.ok, false);
  assert.equal(unknown.code, "customer_timezone_unknown");
  assert.deepEqual(resolveCustomerTimezone({ state: "ZZ" }, "America/Chicago"), { ok: true, zone: "America/Chicago", source: "explicit" });
  // Only zones from the picker are accepted.
  assert.equal(resolveCustomerTimezone({}, "Europe/Paris").ok, false);
});

test("a split state uses the zip when it settles the zone, and asks otherwise", () => {
  assert.deepEqual(resolveCustomerTimezone({ state: "FL", zip: "32501" }), { ok: true, zone: "America/Chicago", source: "zip" });
  assert.deepEqual(resolveCustomerTimezone({ state: "FL", zip: "33101" }), { ok: true, zone: "America/New_York", source: "zip" });
  assert.deepEqual(resolveCustomerTimezone({ state: "TX", zip_code: "79901" }), { ok: true, zone: "America/Denver", source: "zip" });
  assert.deepEqual(resolveCustomerTimezone({ state: "TX", zip_code: "75201" }), { ok: true, zone: "America/Chicago", source: "zip" });
  // Straddling prefixes and states with no zip table ask.
  assert.equal(resolveCustomerTimezone({ state: "FL", zip: "32401" }).code, "customer_timezone_ambiguous");
  assert.equal(resolveCustomerTimezone({ state: "TX" }).code, "customer_timezone_ambiguous");
  assert.equal(resolveCustomerTimezone({ state: "KY", zip: "42001" }).code, "customer_timezone_ambiguous");
  assert.equal(customerTimezone({ state: "TN" }), null);
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
