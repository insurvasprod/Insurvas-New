import test from "node:test";
import assert from "node:assert/strict";
import { canWriteFromVault } from "./eligibility.ts";

const base = {
  tenantCarriers: [{ carrier_id: "carrier", effective_from: "2026-01-01" }],
  appointments: [{ id: "a", tenant_id: "tenant", carrier_id: "carrier", state: "AZ", status: "active", effective_from: "2026-01-01", terminated_at: null }],
  licenses: [{ id: "l", tenant_id: "tenant", state: "AZ", license_number: "AZ-1", expires_at: "2026-12-31" }],
  eoPolicies: [{ id: "e", tenant_id: "tenant", carrier: "E&O", policy_number: "EO-1", expires_at: "2026-12-31", coverage_amount_cents: 100000, created_at: "", updated_at: "" }],
};

test("canWrite requires the carrier contract, appointment, licence and E&O", () => {
  assert.equal(canWriteFromVault(base, "carrier", "az", "2026-08-31"), true);
  assert.equal(canWriteFromVault({ ...base, appointments: [] }, "carrier", "AZ", "2026-08-31"), false);
  assert.equal(canWriteFromVault({ ...base, licenses: [{ ...base.licenses[0], expires_at: "2026-08-30" }] }, "carrier", "AZ", "2026-08-31"), false);
  assert.equal(canWriteFromVault({ ...base, eoPolicies: [{ ...base.eoPolicies[0], expires_at: "2026-08-30" }] }, "carrier", "AZ", "2026-08-31"), false);
});

test("canWrite uses appointment effective and termination dates", () => {
  assert.equal(canWriteFromVault(base, "carrier", "AZ", "2025-12-31"), false);
  assert.equal(canWriteFromVault({ ...base, appointments: [{ ...base.appointments[0], terminated_at: "2026-08-31" }] }, "carrier", "AZ", "2026-08-30"), true);
  assert.equal(canWriteFromVault({ ...base, appointments: [{ ...base.appointments[0], terminated_at: "2026-08-31" }] }, "carrier", "AZ", "2026-08-31"), false);
});
