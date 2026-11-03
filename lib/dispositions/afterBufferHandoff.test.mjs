import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const read = (name) => readFile(new URL(`../../supabase/migrations/${name}`, import.meta.url), "utf8").then((text) => text.replace(/\r\n/g, "\n"));
const migration = await read("20260924335000_inbound_disposition_after_a_buffer_handoff.sql");
const base = await read("20260917131500_la_1_close_verification_on_disposition.sql");
const routing = await read("20260922220000_la_2_disposition_routes_to_its_own_pipeline.sql");
const walk = await read("20260912440000_la_1_12_disposition_correctives.sql");
const callback = await read("20260913160000_la_1_21_22_tenant_notes_callbacks.sql");

const FOUR = ["start_disposition_walk", "record_disposition_answer", "complete_disposition", "complete_disposition_with_callback"];
const GUARD = /status (not )?in \('claimed',\s*'completed',\s*'dropped'\)/;

test("each of the four functions carries the guard this migration rewrites", () => {
  // If a later migration restated one of them without the guard, the patch would raise; this says
  // which source the pattern was written against.
  assert.match(walk, /v_item\.status not in \('claimed','completed','dropped'\)/);
  assert.match(walk, /q\.status in \('claimed','completed','dropped'\)/);
  assert.match(base, /q\.status in \('claimed', 'completed', 'dropped'\)/);
  assert.match(callback, /q\.status in \('claimed', 'completed', 'dropped'\)/);
});

test("the patch is in place, over all four, and adds only la_active", () => {
  for (const name of FOUR) assert.ok(migration.includes(`'${name}'`), `${name} is not patched`);
  assert.match(migration, /pg_get_functiondef\(p\.oid\)/);
  assert.doesNotMatch(migration, /create or replace function/i, "restating a function would drop the patches layered on it");
  assert.match(migration, /'status \(not \)\?in \\\(''claimed'',\\s\*''completed'',\\s\*''dropped''\\\)'/);
  assert.match(migration, /'status \\1in \(''claimed'', ''la_active'', ''completed'', ''dropped''\)'/);
  // Nothing that belongs to the buffer assistant or to a handoff in flight.
  assert.doesNotMatch(migration.replace(/--[^\n]*/g, ""), /''buffer_active''|''handed_pending''/);
  // The rewrite matches exactly what the four sources carry.
  for (const source of [walk, base, callback]) assert.match(source, GUARD);
});

test("the deal row follows the resolved stage, without breaking 20260922220000's own count", () => {
  const anchor = "         pipeline_id = v_item.pipeline_id,\n         stage_id = v_stage_id,";
  assert.ok(base.includes(`         disposition_by = p_user_id,\n${anchor}\n         updated_at = now()\n   where lead_id = v_item.lead_id`), "the deal_flow update moved");
  assert.ok(migration.includes("E'         pipeline_id = v_item.pipeline_id,\\n         stage_id = v_stage_id,'"));
  const replacement = migration.slice(migration.indexOf("-- The deal row follows the resolved stage"), migration.indexOf("stage_id = v_stage_id,'", migration.indexOf("-- The deal row follows the resolved stage")));
  assert.doesNotMatch(replacement, /pipeline_id = coalesce\(/, "a third `pipeline_id = coalesce(` would fail 20260922220000's assertion");
  assert.match(replacement, /select ps\.pipeline_id from public\.tenant_pipeline_stages ps where ps\.id = v_stage_id/);
  assert.match(replacement, /else v_item\.pipeline_id/);
  // 20260922220000's count is still two after this patch.
  assert.match(routing, /regexp_matches\(v_src, 'pipeline_id = coalesce\\\(', 'g'\)\) <> 2/);
});

test("the assertions restate 20260922220000's routing clauses and refuse to pass silently", () => {
  const assertions = migration.slice(migration.indexOf("-- ── assertions"));
  assert.match(assertions, /ps\\\.pipeline_id = v_item\\\.pipeline_id/);
  assert.match(assertions, /regexp_matches\(v_src, 'pipeline_id = coalesce\\\(', 'g'\)\) <> 2/);
  assert.match(assertions, /coalesce\\\(v_stage_id, v_item\\\.stage_id\\\)/);
  assert.match(assertions, /raise exception '% still refuses a work item after a buffer handoff'/);
  assert.match(assertions, /raise exception 'deal_flow still keeps the old pipeline while its stage moves'/);
  assert.match(assertions, /assert_callback_in_window/);
  assert.match(assertions, /owner_user_id/);
});
