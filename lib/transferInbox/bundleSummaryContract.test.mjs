import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import { OPEN_TRANSFER_STATUSES, WITH_AGENT_STATUSES } from "./constants.ts";

const read = (path) => readFile(new URL(`../../${path}`, import.meta.url), "utf8").then((text) => text.replace(/\r\n/g, "\n"));
const previous = await read("supabase/migrations/20260924170000_transfer_inbox_cap_keeps_the_newest.sql");
const migration = await read("supabase/migrations/20260924335200_transfer_inbox_bundle_summary.sql");
const service = await read("lib/transferInbox/service.ts");

function bundle(sql) {
  const start = sql.indexOf("create or replace function public.list_transfer_inbox_bundle(");
  const end = sql.indexOf("to service_role;", start);
  assert.ok(start >= 0 && end > start, "list_transfer_inbox_bundle definition not found");
  return sql.slice(start, end + "to service_role;".length);
}

const before = bundle(previous);
const after = bundle(migration);

test("the bundle is 20260924170000's verbatim plus the summary, nothing else", () => {
  const declAnchor = "  v_handoffs jsonb := '[]'::jsonb;\n";
  const summaryAnchor = "  -- 500 is list_transfer_inbox's limit.";
  const oldReturn = "'truncated', jsonb_array_length(v_items) >= 500);\n";
  for (const anchor of [declAnchor, summaryAnchor, oldReturn]) assert.ok(before.includes(anchor), `anchor moved: ${anchor}`);

  const summaryBlock = after.slice(after.indexOf("  -- The KPI tiles read"), after.indexOf(summaryAnchor));
  assert.match(summaryBlock, /\) into v_summary\n/);
  const rebuilt = before
    .replace(declAnchor, `${declAnchor}  v_summary jsonb;\n`)
    .replace(summaryAnchor, `${summaryBlock}${summaryAnchor}`)
    .replace(oldReturn, "'truncated', jsonb_array_length(v_items) >= 500, 'summary', v_summary);\n");
  assert.equal(after, rebuilt);
});

test("the summary counts the tenant's open inbound set, unfiltered and uncapped", () => {
  const block = after.slice(after.indexOf("  -- The KPI tiles read"), after.indexOf("  -- 500 is list_transfer_inbox's limit."));
  // Not a single filter parameter reaches the tiles.
  for (const param of ["p_status", "p_partner_id", "p_product_line", "p_state", "p_screening_outcome", "p_claimed_by"]) {
    assert.doesNotMatch(block, new RegExp(`\\b${param}\\b`), `${param} narrows the KPI tiles`);
  }
  assert.doesNotMatch(block, /limit\s+\d+/);
  assert.match(block, /q\.tenant_id = p_tenant_id/);
  assert.match(block, /q\.partner_id is not null/);

  const list = (sql) => sql.split(",").map((value) => value.trim().replace(/^'|'$/g, "")).sort();
  const open = block.match(/and q\.status in \(([^)]*)\);/)?.[1];
  assert.ok(open, "open set predicate not found");
  assert.deepEqual(list(open), [...OPEN_TRANSFER_STATUSES].sort());
  const claimed = block.match(/'claimed', count\(\*\) filter \(where q\.status in \(([^)]*)\)\)/)?.[1];
  assert.ok(claimed, "claimed predicate not found");
  assert.deepEqual(list(claimed), [...WITH_AGENT_STATUSES].sort());

  // "no open call record" is read from the call record, never inferred from the work item.
  assert.match(block, /not exists \(select 1 from public\.active_calls c where c\.work_item_id = q\.id and c\.tenant_id = q\.tenant_id and c\.ended_at is null\)/);
  assert.match(block, /'needs_review', count\(\*\) filter \(where coalesce\(nullif\(btrim\(q\.screening_outcome\), ''\), nullif\(btrim\(l\.screening_outcome\), ''\), 'not_checked'\) = 'dnc'\)/);
});

test("same signature and service-only grants, and a check that refuses to pass silently", () => {
  assert.match(after, /revoke all on function public\.list_transfer_inbox_bundle\(uuid, text, uuid, text, text, text, uuid, uuid\) from anon, authenticated, tenant_app;/);
  assert.match(after, /grant execute on function public\.list_transfer_inbox_bundle\(uuid, text, uuid, text, text, text, uuid, uuid\) to service_role;/);
  assert.doesNotMatch(migration, /create or replace function public\.list_transfer_inbox\(/, "list_transfer_inbox belongs to 20260924250000");
  assert.match(migration, /raise exception 'list_transfer_inbox_bundle does not return the inbox summary'/);
});

test("the service reads the summary and tolerates a database without it", () => {
  assert.match(service, /payload\.summary/);
  assert.match(service, /summary: .*null/s);
});
