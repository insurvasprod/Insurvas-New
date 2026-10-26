import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { canWriteFromVault, canWriteReasonFromVault } from "./eligibility.ts";

const base = {
  tenantCarriers: [{ carrier_id: "carrier", effective_from: "2026-01-01" }],
  appointments: [{ id: "a", tenant_id: "tenant", carrier_id: "carrier", state: "AZ", status: "active", effective_from: "2026-01-01", terminated_at: null }],
  licenses: [{ id: "l", tenant_id: "tenant", state: "AZ", license_number: "AZ-1", expires_at: "2026-12-31" }],
};

test("canWrite requires the carrier contract, appointment and licence — and nothing else (E&O was removed 2026-10-26)", () => {
  assert.equal(canWriteFromVault(base, "carrier", "az", "2026-08-31"), true);
  assert.equal(canWriteFromVault({ ...base, appointments: [] }, "carrier", "AZ", "2026-08-31"), false);
  assert.equal(canWriteFromVault({ ...base, licenses: [{ ...base.licenses[0], expires_at: "2026-08-30" }] }, "carrier", "AZ", "2026-08-31"), false);
  // A vault that still carries old E&O rows (or none) decides exactly the same way.
  assert.equal(canWriteFromVault({ ...base, eoPolicies: [] }, "carrier", "AZ", "2026-08-31"), true);
  assert.equal(canWriteFromVault({ ...base, eoPolicies: [{ id: "e", expires_at: "2020-01-01" }] }, "carrier", "AZ", "2026-08-31"), true);
});

test("canWrite uses appointment effective and termination dates", () => {
  assert.equal(canWriteFromVault(base, "carrier", "AZ", "2025-12-31"), false);
  assert.equal(canWriteFromVault({ ...base, appointments: [{ ...base.appointments[0], terminated_at: "2026-08-31" }] }, "carrier", "AZ", "2026-08-30"), true);
  assert.equal(canWriteFromVault({ ...base, appointments: [{ ...base.appointments[0], terminated_at: "2026-08-31" }] }, "carrier", "AZ", "2026-08-31"), false);
});

test("canWrite says why: each missing piece has its own reason, in the order the rule checks them", () => {
  const reason = (vault, at = "2026-08-31") => canWriteReasonFromVault(vault, "carrier", "AZ", at).reason;
  assert.equal(reason(base), "ok");
  assert.equal(reason({ ...base, tenantCarriers: [] }), "no_contract");
  assert.equal(reason({ ...base, appointments: [] }), "no_appointment");
  assert.equal(reason({ ...base, licenses: [] }), "no_licence");
  assert.deepEqual(canWriteReasonFromVault(base, "carrier", "AZ", "2026-08-31"), { allowed: true, reason: "ok" });
});

test("the SQL twin: can_write keeps its boolean, reads no E&O, and can_write_reason says why", () => {
  const sql = fs.readFileSync(new URL("../../supabase/migrations/20261026400000_remove_eo_and_ce.sql", import.meta.url), "utf8").replace(/\r\n/g, "\n");
  assert.match(sql, /create or replace function public\.can_write\(\n  p_carrier_id uuid,\n  p_state text,\n  p_at date default current_date,\n  p_user_id uuid default auth\.uid\(\)\n\)\nreturns boolean/, "same signature, still boolean");
  assert.match(sql, /public\.can_write_with_grace\(p_carrier_id, p_state, p_at, p_user_id, 0\)/);
  for (const reason of ["ok", "no_user", "no_contract", "no_appointment", "no_licence"]) assert.match(sql, new RegExp(`return '${reason}';`));
  for (const gone of ["grace", "eo_expired", "no_eo"]) assert.doesNotMatch(sql, new RegExp(`return '${gone}';`));
  // Outside comments and the closing self-check (which names them to look for them), nothing reads the retired tables.
  const code = sql.replace(/--[^\n]*/g, "").replace(/do \$\$[\s\S]*?\$\$;/g, "");
  assert.doesNotMatch(code, /\b(?:agent_)?eo_policies\b|\bce_records\b/);
  assert.match(sql, /revoke all on function public\.can_write_reason\(uuid, text, date, uuid\) from public, anon, authenticated;/);
});
