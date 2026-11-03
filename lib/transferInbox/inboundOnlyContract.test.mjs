import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const read = (name) => readFile(new URL(`../../supabase/migrations/${name}`, import.meta.url), "utf8");
const previous = await read("20260917130000_la_1_inbox_market_display.sql");
const migration = await read("20260924160000_transfer_inbox_is_for_inbound_transfers_only.sql");

// From `create or replace function` through the grant: the whole definition and its rights.
function definition(sql) {
  const start = sql.indexOf("create or replace function public.list_transfer_inbox(");
  const grant = "to service_role;";
  const end = sql.indexOf(grant, start);
  assert.ok(start >= 0 && end > start, "list_transfer_inbox definition not found");
  return sql.slice(start, end + grant.length);
}

const PREDICATE = [
  "    -- Inbound transfers only: a dialer lead is served by the dialer, not claimed from the inbox.",
  "    and q.partner_id is not null",
].join("\n");

test("the inbox is 20260917130000's definition plus the inbound-only predicate, nothing else", () => {
  const before = definition(previous).replace(/\r\n/g, "\n");
  const after = definition(migration).replace(/\r\n/g, "\n");
  const anchor = "  where q.tenant_id = p_tenant_id\n";
  assert.ok(before.includes(anchor));
  assert.equal(after, before.replace(anchor, `${anchor}${PREDICATE}\n`));
});

test("the dialer's rows are kept off the inbox's index path", () => {
  assert.match(migration, /create index if not exists lead_queue_inbox_inbound_idx\s+on public\.lead_queue \(tenant_id, status, queued_at asc\)\s+where partner_id is not null;/);
  // The index has to exist before the function that relies on it, and the migration must refuse
  // to finish if either change did not land.
  assert.ok(migration.indexOf("lead_queue_inbox_inbound_idx") < migration.indexOf("create or replace function"));
  assert.match(migration, /raise exception 'list_transfer_inbox still lists the dialer queue'/);
  assert.match(migration, /raise exception 'lead_queue_inbox_inbound_idx is missing'/);
});
