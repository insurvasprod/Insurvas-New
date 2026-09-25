import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import { OPEN_TRANSFER_STATUSES } from "./constants.ts";

const read = (path) => readFile(new URL(`../../${path}`, import.meta.url), "utf8").then((text) => text.replace(/\r\n/g, "\n"));
const migration = await read("supabase/migrations/20260924170000_transfer_inbox_cap_keeps_the_newest.sql");
const previousBundle = await read("supabase/migrations/20260915120000_la_1_10_inbox_bundle_empty_handoff_fast_path.sql");
const floorService = await read("lib/agentFloor/service.ts");

function slice(sql, name) {
  const start = sql.indexOf(`create or replace function public.${name}(`);
  const end = sql.indexOf("to service_role;", start);
  assert.ok(start >= 0 && end > start, `${name} definition not found`);
  return sql.slice(start, end + "to service_role;".length);
}

const inbox = slice(migration, "list_transfer_inbox");
const bundle = slice(migration, "list_transfer_inbox_bundle");

test("the cap keeps the newest 500 and still shows them longest-waiting first", () => {
  const inner = inbox.indexOf("order by q.queued_at desc limit 500");
  const outer = inbox.indexOf("order by newest.queued_at asc");
  assert.ok(inner > 0 && outer > inner, "newest-first selection must be inside, oldest-first display outside");
  assert.equal(inbox.match(/limit 500/g)?.length, 1);
  // 20260924160000's rule survives the rewrite.
  assert.match(inbox, /and q\.partner_id is not null/);
});

test("the subquery names every column the function returns", () => {
  const returns = inbox.slice(inbox.indexOf("returns table ("), inbox.indexOf("language sql"));
  const columns = [...returns.matchAll(/(\w+) (?:uuid|text|timestamptz|integer|boolean|jsonb)/g)].map((match) => match[1]);
  assert.equal(columns.length, 19);
  for (const column of columns) assert.match(inbox, new RegExp(`as ${column}[,\\s]`), `inner select is missing "as ${column}"`);
});

test("'open' is the same five live statuses Agent Floor nudges, and the floor asks for it", () => {
  const sqlOpen = inbox.match(/p_status = 'open' and q\.status in \(([^)]*)\)/)?.[1];
  assert.ok(sqlOpen, "open status set not found");
  const normalise = (list) => list.split(",").map((value) => value.trim().replace(/^['"]|['"]$/g, "")).sort();
  assert.deepEqual(normalise(sqlOpen), [...OPEN_TRANSFER_STATUSES].sort());
  // The nudge reads the same constant rather than a copy of the list.
  assert.match(floorService, /!isOpenTransfer\(item\.data\.status\)/);
  assert.match(floorService, /getTransferInbox\(tenantId, \{ status: "open" \}/);
  assert.doesNotMatch(floorService, /getTransferInbox\(tenantId, \{ status: "all" \}/);
});

test("the bundle is 20260915120000's, plus a truncated flag tied to the same 500", () => {
  const before = slice(previousBundle, "list_transfer_inbox_bundle");
  const oldReturn = "  return jsonb_build_object('items', v_items, 'handoffs', v_handoffs);\n";
  assert.ok(before.includes(oldReturn));
  const newReturn = bundle.slice(bundle.indexOf("  -- 500 is list_transfer_inbox's limit."), bundle.indexOf("end;\n$$;"));
  assert.match(newReturn, /'truncated', jsonb_array_length\(v_items\) >= 500\);\n$/);
  assert.equal(bundle, before.replace(oldReturn, newReturn));
});

test("the migration refuses to finish unless both functions changed", () => {
  assert.match(migration, /raise exception 'list_transfer_inbox still keeps the oldest 500 rows'/);
  assert.match(migration, /raise exception 'list_transfer_inbox_bundle does not report when the cap is reached'/);
});
