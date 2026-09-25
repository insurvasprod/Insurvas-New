import test from "node:test";
import assert from "node:assert/strict";
import { dueExpiryWarnings, expiryWarningFor } from "./warnings.ts";

test("the 90, 60 and 30 day marks are the edges of the severity bands", () => {
  assert.equal(expiryWarningFor("2026-11-29", "2026-08-31"), 90);
  assert.equal(expiryWarningFor("2026-10-30", "2026-08-31"), 60);
  assert.equal(expiryWarningFor("2026-09-30", "2026-08-31"), 30);
});

test("a record inside the window warns every day, not only on the band's first day", () => {
  // 29 days: this used to return null, the day after the 30-day warning.
  assert.equal(expiryWarningFor("2026-09-29", "2026-08-31"), 30);
  assert.equal(expiryWarningFor("2026-08-31", "2026-08-31"), 30, "expiring today is still inside the window");
  assert.equal(expiryWarningFor("2026-11-12", "2026-08-31"), 90, "73 days out is in the 90-day band");
  assert.equal(expiryWarningFor("2026-10-15", "2026-08-31"), 60, "45 days out is in the 60-day band");
  for (let offset = 0; offset <= 90; offset++) {
    const expires = new Date(Date.UTC(2026, 7, 31 + offset)).toISOString().slice(0, 10);
    assert.notEqual(expiryWarningFor(expires, "2026-08-31"), null, `${offset} days out was silent`);
  }
});

test("outside the window there is no warning", () => {
  assert.equal(expiryWarningFor("2026-11-30", "2026-08-31"), null, "91 days out");
  assert.equal(expiryWarningFor("2026-08-30", "2026-08-31"), null, "already expired");
});

test("warnings carry the band and the real day count, soonest first", () => {
  const license = { id: "license", tenant_id: "tenant", state: "AZ", license_number: "1", expires_at: "2026-11-12", created_at: "", updated_at: "" };
  const eo = { id: "eo", tenant_id: "tenant", carrier: "E&O", policy_number: "EO-1", expires_at: "2026-09-10", coverage_amount_cents: 1, created_at: "", updated_at: "" };
  const warnings = dueExpiryWarnings({ licenses: [license], eoPolicies: [eo], ceRecords: [] }, "2026-08-31");
  assert.deepEqual(warnings.map((w) => [w.source, w.days, w.daysLeft]), [["eo_policy", 30, 10], ["license", 90, 73]]);
});

test("renewing a record stops the old warning", () => {
  const rows = { licenses: [{ id: "license", tenant_id: "tenant", state: "AZ", license_number: "1", expires_at: "2026-09-30", created_at: "", updated_at: "" }], eoPolicies: [], ceRecords: [] };
  assert.equal(dueExpiryWarnings(rows, "2026-08-31").length, 1);
  assert.equal(dueExpiryWarnings({ ...rows, licenses: [{ ...rows.licenses[0], expires_at: "2027-09-30" }] }, "2026-08-31").length, 0);
});
