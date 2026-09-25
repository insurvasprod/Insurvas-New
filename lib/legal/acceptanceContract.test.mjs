// Run with: npm test
//
// Required signup documents are one legal fact. Keep the service and migration on the atomic
// batch contract so a partial Terms/Privacy write cannot be introduced by a future refactor.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const service = readFileSync(new URL("./acceptance.ts", import.meta.url), "utf8");
const migration = readFileSync(
  new URL("../../supabase/migrations/20260914183000_sa_5_4_atomic_legal_acceptances.sql", import.meta.url),
  "utf8",
);

test("SA-5.4 records required legal acceptances through one atomic batch RPC", () => {
  assert.match(service, /rpc\("record_legal_acceptances"/);
  assert.doesNotMatch(service, /rpc\("record_legal_acceptance"/);
  assert.match(migration, /returns void/i);
  assert.match(migration, /set search_path\s*=\s*''/i);
  assert.match(migration, /on conflict \(user_id, document_id\) do nothing/i);
  assert.match(migration, /rolls back the whole batch/i);
});
