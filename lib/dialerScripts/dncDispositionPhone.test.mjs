import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

// The behaviour (a phone_number-only lead is suppressed by every Do not call path) is rehearsed on
// pg_temp copies of the live functions; these assertions keep the file honest between rehearsals.
const sql = readFileSync(new URL("../../supabase/migrations/20261015540000_m2_dnc_disposition_reads_phone_number.sql", import.meta.url), "utf8");

test("every Do not call path resolves the number the way the dialer does (phone ?? phone_number)", () => {
  assert.doesNotMatch(sql, /\r\n/, "the SQL editor stores what it is given; keep the file LF");
  for (const fn of ["complete_existing_dial_disposition", "apply_lead_disposition_move", "complete_disposition", "complete_dial_disposition"]) {
    assert.match(sql, new RegExp(`'public\\.${fn}\\(`), `${fn} is not patched`);
  }
  // The dialer: lib/dialerScripts/service.ts leadPhone = values.phone ?? values.phone_number.
  const service = readFileSync(new URL("./service.ts", import.meta.url), "utf8");
  assert.match(service, /function leadPhone\(values: Row\) \{\n  return text\(values\.phone \?\? values\.phone_number\);/);
  assert.equal((sql.match(/nullif\(btrim\((v_lead|l)\.values->>''phone''\), ''''\), nullif\(btrim\(\1\.values->>''phone_number''\), ''''\)/g) ?? []).length, 4);
  // In place, CRLF-normalised, one counted anchor each, idempotent, with a self-check.
  assert.match(sql, /replace\(pg_get_functiondef\(v_sig\), E'\\r\\n', E'\\n'\)/);
  assert.match(sql, /if v_count <> 1 then/);
  assert.match(sql, /already reads phone_number/);
  assert.match(sql, /-- ─── self-check/);
});
