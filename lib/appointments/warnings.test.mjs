import test from "node:test";
import assert from "node:assert/strict";
import { dueExpiryWarnings, expiryWarningFor } from "./warnings.ts";

test("expiry warnings fire at exactly 90, 60 and 30 days", () => {
  assert.equal(expiryWarningFor("2026-11-29", "2026-08-31"), 90);
  assert.equal(expiryWarningFor("2026-10-30", "2026-08-31"), 60);
  assert.equal(expiryWarningFor("2026-09-30", "2026-08-31"), 30);
  assert.equal(expiryWarningFor("2026-09-29", "2026-08-31"), null);
});

test("renewing a record stops the old warning", () => {
  const rows = { licenses: [{ id: "license", tenant_id: "tenant", state: "AZ", license_number: "1", expires_at: "2026-09-30", created_at: "", updated_at: "" }], eoPolicies: [], ceRecords: [] };
  assert.equal(dueExpiryWarnings(rows, "2026-08-31").length, 1);
  assert.equal(dueExpiryWarnings({ ...rows, licenses: [{ ...rows.licenses[0], expires_at: "2027-09-30" }] }, "2026-08-31").length, 0);
});
