import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const migration = await readFile(new URL("../../supabase/migrations/20260911100000_live_runtime_compatibility.sql", import.meta.url), "utf8");
const start = migration.indexOf("create or replace function public.list_transfer_inbox(");
const end = migration.indexOf("create or replace function public.list_buffer_handoffs(", start);
const definition = migration.slice(start, end);

test("LA-1.10 runtime compatibility preserves the deployed inbox contract", () => {
  for (const column of ["preflight_status text", "preflight_result jsonb"]) assert.match(definition, new RegExp(column.replace(" ", "\\s+")));
  assert.match(definition, /security definer/);
  assert.match(definition, /set search_path = public, pg_catalog/);

  const stateAt = definition.indexOf("and (p_state is null or");
  const screeningAt = definition.indexOf("and (p_screening_outcome is null or");
  const orderAt = definition.indexOf("order by q.queued_at asc");
  const limitAt = definition.indexOf("limit 500");
  assert.ok(stateAt > 0 && screeningAt > stateAt && orderAt > screeningAt && limitAt > orderAt);
  assert.match(definition, /grant execute on function public\.list_transfer_inbox\([^)]*\) to service_role/);
});
