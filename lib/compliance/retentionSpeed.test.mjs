// The retention run's cost must not grow with everyone else's data, nor run a hold check per row
// when the agency holds nothing (2026-10-16: ~1 s on a near-empty agency, a timeout under load).
// Run with: node --test lib/compliance/retentionSpeed.test.mjs

import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const sql = readFileSync(join(process.cwd(), "supabase/migrations/20261016410000_retention_run_speed.sql"), "utf8").replace(/\r\n/g, "\n");
const start = sql.indexOf("CREATE OR REPLACE FUNCTION public.retention_execute");
const body = sql.slice(start, sql.indexOf("\ndo $$", start)); // the function, not the self-check after it

test("one look at legal_hold up front; every per-row hold check is skipped when there is none", () => {
  assert.match(body, /v_any_hold boolean := exists \(select 1 from public\.legal_hold h where h\.tenant_id = p_tenant_id and h\.released_at is null\);/);
  const calls = body.match(/public\.legal_hold_active(?:_for_lead)?\(/g) ?? [];
  const guarded = body.match(/\(v_any_hold and public\.legal_hold_active(?:_for_lead)?\(/g) ?? [];
  assert.equal(calls.length, 15);
  assert.equal(guarded.length, calls.length, "an unguarded hold check is left");
});

test("the verdicts that relied on a consent are read once, not searched per consent", () => {
  assert.doesNotMatch(body, /checks_json @> jsonb_build_array/);
  assert.match(body, /insert into retention_consent_relied\n\s+select ch->>'source_record_id', max\(v\.evaluated_at\)/);
  assert.match(body, /\(select r\.at from retention_consent_relied r where r\.consent_id = c\.id::text\)/);
});

test("screening_audit is read through an index that starts with the agency", () => {
  assert.match(sql, /create index if not exists screening_audit_tenant_ts_idx on public\.screening_audit \(tenant_id, ts\);/);
});
