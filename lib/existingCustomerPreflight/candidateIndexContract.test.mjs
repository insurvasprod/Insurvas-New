import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

test("LA-1.24 preflight indexes and candidate filters preserve the scored match boundary", async () => {
  const migration = await readFile("supabase/migrations/20260915130000_la_1_24_preflight_candidate_indexes.sql", "utf8");

  for (const indexName of [
    "contacts_preflight_phone_digits_idx",
    "contacts_preflight_dob_idx",
    "contact_phones_preflight_phone_digits_idx",
    "households_preflight_address_trgm_idx",
  ]) {
    assert.match(migration, new RegExp(`create\\s+index\\s+if\\s+not\\s+exists\\s+${indexName}`, "i"));
  }

  assert.match(migration, /set\s+pg_trgm\.similarity_threshold\s*=\s*0\.3/i);
  assert.match(migration, /c\.name_search\s+%\s+i\.name_key/i);
  assert.match(migration, /address_search[^\n]*%\s+i\.address_key/i);
  assert.match(migration, /raw_score\s+>=\s*\.45/i);
  assert.doesNotMatch(migration, /delete\s+from|truncate\s+table|drop\s+table/i);
  assert.doesNotMatch(migration, /^\s*grant\s+(?!execute)/im);
});
