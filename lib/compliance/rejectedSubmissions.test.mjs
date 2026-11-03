import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const { maskLastFour, NEUTRAL_END_CALL_SCRIPT, TCPA_REJECTION_REASON } = await import("./rejectionContract.ts");
const migration = await readFile(new URL("../../supabase/migrations/20260914140000_la_1_5_rejected_partner_submissions.sql", import.meta.url), "utf8");

test("LA-1.5 masks rejected phone evidence and uses a neutral close", () => {
  assert.equal(maskLastFour("6025550001"), "••••0001");
  assert.equal(maskLastFour(null), null);
  assert.equal(maskLastFour("60255501"), null);
  assert.equal(TCPA_REJECTION_REASON, "tcpa_block");
  assert.match(NEUTRAL_END_CALL_SCRIPT, /cannot continue/i);
});

test("LA-1.5 rejected submissions are append-only, idempotent, and partner-scoped", () => {
  assert.match(migration, /unique \(tenant_id, partner_id, submission_id, reason\)/i);
  assert.match(migration, /phone_last4 text[\s\S]*\^\[0-9\]\{4\}\$/i);
  assert.match(migration, /alter table public\.partner_rejected_submissions enable row level security/i);
  assert.match(migration, /partner_id = nullif\(\(select current_setting\('app\.partner_id', true\)\), ''\)::uuid/i);
  assert.match(migration, /grant select, insert on public\.partner_rejected_submissions to service_role/i);
  assert.match(migration, /revoke all on public\.partner_rejected_submissions from public, anon, authenticated, tenant_app/i);
});
