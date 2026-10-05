// LA-1.10-10 (M1 perf, 2026-09-30): the transfer inbox with 500 waiting.
//
// list_transfer_inbox is a SQL function, planned once for any p_status, and its status test is an
// OR over the parameter, so the plan read every inbound row the tenant ever had. 20260929140300 adds
// the same test as one list the (tenant_id, status, queued_at) index can seek on. These pin that it
// is there, that the original test and 709850's age column are kept, and that 'all' names every
// status the table allows.
import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const migration = await readFile("supabase/migrations/20260929140300_m1_transfer_inbox_status_seek.sql", "utf8");
const foundations = await readFile("supabase/migrations/20260925709850_inbound_transfer_foundations.sql", "utf8");
const fnOf = (sql) => sql.slice(sql.indexOf("create or replace function public.list_transfer_inbox("), sql.indexOf("$function$;", sql.indexOf("create or replace function public.list_transfer_inbox(")));
const now = fnOf(migration);
const base = fnOf(foundations);
const SEEK = /      -- The same statuses as the test above[\s\S]*?        else array\[p_status\] end\)\n/;

test("the only change from 709850's list_transfer_inbox is the index-usable status list", () => {
  assert.ok(base.length > 0 && now.length > 0);
  assert.match(now, SEEK);
  assert.equal(now.replace(SEEK, ""), base, "everything else, including the LA-1.10-2 age column, is 709850's text");
  assert.match(now, /coalesce\(public\.lead_values_age\(l\.values\), '—'\) as age/);
  assert.match(now, /or q\.status = p_status\)\n/, "the original status test is kept");
});

test("'all', 'open' and 'claimed' map to the same statuses the original test accepts", () => {
  const list = (key) => (now.match(new RegExp(`when '${key}' then array\\[([^\\]]*)\\]`))?.[1] ?? "").split(",").map((s) => s.trim().replace(/'/g, "")).filter(Boolean);
  assert.deepEqual(list("open"), ["unclaimed", "claimed", "buffer_active", "handed_pending", "la_active"]);
  assert.deepEqual(list("claimed"), ["claimed", "buffer_active", "handed_pending", "la_active"]);
  assert.deepEqual(list("all").sort(), ["buffer_active", "claimed", "closed", "completed", "dropped", "expired", "handed_pending", "la_active", "unclaimed"]);
  assert.match(migration, /lead_queue allows statuses the inbox ''all'' list lacks/, "the file checks the live constraint against 'all'");
});

test("the file is ordered after 709850, refuses to run without it, and checks itself", () => {
  assert.match(migration, /APPLY AFTER 20260925709850/);
  assert.match(migration, /to_regprocedure\('public\.lead_values_age\(jsonb,date\)'\) is null/);
  assert.match(migration, /revoke all on function public\.list_transfer_inbox\([^)]*\) from public, anon, authenticated, tenant_app/);
  assert.match(migration, /has_schema_privilege\(current_user, 'public', 'CREATE'\)/);
  for (const line of migration.split("\n").filter((l) => l.trimStart().startsWith("--"))) assert.ok(!line.includes(";"), `no semicolon in a comment: ${line}`);
});
