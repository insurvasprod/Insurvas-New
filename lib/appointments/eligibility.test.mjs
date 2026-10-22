import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { addDays, canWriteFromVault, canWriteReasonFromVault, DEFAULT_EO_GRACE_DAYS, effectiveEoGraceDays, eoCoverState } from "./eligibility.ts";

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
  // Sixteen #4: a day after expiry is inside the E&O grace; with no grace it is a block.
  assert.equal(canWriteFromVault({ ...base, eoPolicies: [{ ...base.eoPolicies[0], expires_at: "2026-08-30" }] }, "carrier", "AZ", "2026-08-31"), true);
  assert.equal(canWriteFromVault({ ...base, eoPolicies: [{ ...base.eoPolicies[0], expires_at: "2026-08-30" }] }, "carrier", "AZ", "2026-08-31", { graceDays: 0 }), false);
  assert.equal(canWriteFromVault({ ...base, eoPolicies: [] }, "carrier", "AZ", "2026-08-31"), false);
});

test("canWrite uses appointment effective and termination dates", () => {
  assert.equal(canWriteFromVault(base, "carrier", "AZ", "2025-12-31"), false);
  assert.equal(canWriteFromVault({ ...base, appointments: [{ ...base.appointments[0], terminated_at: "2026-08-31" }] }, "carrier", "AZ", "2026-08-30"), true);
  assert.equal(canWriteFromVault({ ...base, appointments: [{ ...base.appointments[0], terminated_at: "2026-08-31" }] }, "carrier", "AZ", "2026-08-31"), false);
});

// ── Sixteen Open Questions #4: E&O grace, and canWrite returns a reason ──

const eoExpiring = (date) => ({ ...base, eoPolicies: [{ ...base.eoPolicies[0], expires_at: date }] });

test("canWrite says why: each missing piece has its own reason, in the order the rule checks them", () => {
  const reason = (vault, at = "2026-08-31") => canWriteReasonFromVault(vault, "carrier", "AZ", at).reason;
  assert.equal(reason(base), "ok");
  assert.equal(reason({ ...base, tenantCarriers: [] }), "no_contract");
  assert.equal(reason({ ...base, appointments: [] }), "no_appointment");
  assert.equal(reason({ ...base, licenses: [] }), "no_licence");
  assert.equal(reason({ ...base, eoPolicies: [] }), "no_eo");
  assert.equal(reason(eoExpiring("2026-08-01")), "eo_expired");
});

test("the E&O grace: default 7 days, true with reason grace, then eo_expired", () => {
  assert.equal(DEFAULT_EO_GRACE_DAYS, 7);
  const vault = eoExpiring("2026-08-30");
  assert.deepEqual(canWriteReasonFromVault(vault, "carrier", "AZ", "2026-08-30"), { allowed: true, reason: "ok", graceEndsOn: null }, "the expiry day itself is in force");
  assert.deepEqual(canWriteReasonFromVault(vault, "carrier", "AZ", "2026-09-01"), { allowed: true, reason: "grace", graceEndsOn: "2026-09-06" });
  assert.equal(canWriteReasonFromVault(vault, "carrier", "AZ", "2026-09-06").reason, "grace", "the last grace day");
  assert.deepEqual(canWriteReasonFromVault(vault, "carrier", "AZ", "2026-09-07"), { allowed: false, reason: "eo_expired", graceEndsOn: null });
  // A renewal entered later (even backdated) closes the gap: the longest-running policy decides.
  assert.equal(canWriteReasonFromVault({ ...vault, eoPolicies: [...vault.eoPolicies, { ...vault.eoPolicies[0], id: "renewal", expires_at: "2027-08-30" }] }, "carrier", "AZ", "2026-09-07").reason, "ok");
});

test("the grace is configurable, capped by the platform: a tenant can shorten it, never extend it", () => {
  assert.equal(effectiveEoGraceDays(), 7);
  assert.equal(effectiveEoGraceDays({ graceDays: 3 }), 3);
  assert.equal(effectiveEoGraceDays({ graceDays: 99 }), 14, "the registry's max");
  assert.equal(effectiveEoGraceDays({ graceDays: -2 }), 0);
  assert.equal(effectiveEoGraceDays({ graceDays: Number.NaN }), 7, "unreadable is the default");
  assert.equal(effectiveEoGraceDays({ graceDays: 7, tenantGraceDays: 2 }), 2, "shorter: allowed");
  assert.equal(effectiveEoGraceDays({ graceDays: 7, tenantGraceDays: 30 }), 7, "longer: refused");
  assert.equal(canWriteReasonFromVault(eoExpiring("2026-08-30"), "carrier", "AZ", "2026-09-02", { graceDays: 2 }).reason, "eo_expired");
});

test("eoCoverState drives the banner: in force, grace (with both dates), expired, none", () => {
  assert.equal(eoCoverState([], "2026-09-01").state, "none");
  assert.equal(eoCoverState([{ expires_at: "2026-12-31" }], "2026-09-01").state, "in_force");
  assert.deepEqual(eoCoverState([{ expires_at: "2026-08-30" }], "2026-09-01"), { state: "grace", expiredOn: "2026-08-30", graceEndsOn: "2026-09-06" });
  assert.equal(eoCoverState([{ expires_at: "2026-08-30" }], "2026-09-07").state, "expired");
  assert.equal(addDays("2026-12-28", 7), "2027-01-04");
  assert.equal(addDays("2026-03-07", 1), "2026-03-08", "UTC arithmetic: no DST drift");
});

test("the SQL twin: can_write keeps its boolean, honours the same grace, and can_write_reason says why", () => {
  const sql = fs.readFileSync(new URL("../../supabase/migrations/20261015580000_onboarding_audit_fixes.sql", import.meta.url), "utf8");
  assert.match(sql, /create or replace function public\.can_write\(\n  p_carrier_id uuid,\n  p_state text,\n  p_at date default current_date,\n  p_user_id uuid default auth\.uid\(\)\n\)\nreturns boolean/, "same signature, still boolean");
  assert.match(sql, /public\.can_write_with_grace\(p_carrier_id, p_state, p_at, p_user_id, public\.eo_grace_days\(\)\)/);
  assert.match(sql, /return least\(greatest\(coalesce\(v_days, 7\), 0\), 14\);/, "same default and bounds as the TS rule");
  for (const reason of ["ok", "grace", "no_user", "no_contract", "no_appointment", "no_licence", "eo_expired", "no_eo"]) assert.match(sql, new RegExp(`return '${reason}';`));
  assert.match(sql, /revoke all on function public\.can_write_reason\(uuid, text, date, uuid\) from public, anon, authenticated;/);
});
