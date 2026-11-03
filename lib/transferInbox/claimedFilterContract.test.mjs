import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import { HELD_STATUSES } from "../partnerLeads/lanes.ts";
import { OPEN_TRANSFER_STATUSES, WITH_AGENT_STATUSES, isOpenTransfer, isWithAgent } from "./constants.ts";

const read = (name) => readFile(new URL(`../../supabase/migrations/${name}`, import.meta.url), "utf8").then((text) => text.replace(/\r\n/g, "\n"));
const previous = await read("20260924170000_transfer_inbox_cap_keeps_the_newest.sql");
const migration = await read("20260924250000_transfer_inbox_claimed_means_with_an_agent.sql");

function definition(sql) {
  const start = sql.indexOf("create or replace function public.list_transfer_inbox(");
  const grant = "grant execute on function public.list_transfer_inbox(uuid, text, uuid, text, text, text, uuid) to service_role;\n";
  const end = sql.indexOf(grant, start);
  assert.ok(start >= 0 && end > start, "list_transfer_inbox definition not found");
  return sql.slice(start, end + grant.length);
}

const statusList = (sql, status) => {
  const list = sql.match(new RegExp(`p_status = '${status}' and q\\.status in \\(([^)]*)\\)`))?.[1];
  assert.ok(list, `${status} status set not found`);
  return list.split(",").map((value) => value.trim().replace(/^'|'$/g, "")).sort();
};

test("'claimed' matches every status in which an agent has the transfer", () => {
  assert.deepEqual(statusList(migration, "claimed"), [...WITH_AGENT_STATUSES].sort());
  // The partner pipeline's "Claimed" lane already meant these four; the inbox now agrees with it.
  assert.deepEqual([...WITH_AGENT_STATUSES].sort(), [...HELD_STATUSES].sort());
  // Open is exactly waiting plus with an agent, in SQL and in TypeScript.
  assert.deepEqual(statusList(migration, "open"), ["unclaimed", ...WITH_AGENT_STATUSES].sort());
  assert.deepEqual([...OPEN_TRANSFER_STATUSES].sort(), ["unclaimed", ...WITH_AGENT_STATUSES].sort());
});

test("the function is 20260924170000's plus the one clause, and the explicit match stays first", () => {
  const clause = [
    "        -- \"Claimed\" in the inbox means with an agent, at whichever stage: a buffer assistant, a",
    "        -- handoff in flight, or the licensed agent. Only the first of those is status 'claimed'.",
    "        or (p_status = 'claimed' and q.status in ('claimed', 'buffer_active', 'handed_pending', 'la_active'))",
    "",
  ].join("\n");
  const anchor = "        or (p_status = 'open' and q.status in ('unclaimed', 'claimed', 'buffer_active', 'handed_pending', 'la_active'))\n";
  const before = definition(previous);
  assert.ok(before.includes(anchor));
  assert.equal(definition(migration), before.replace(anchor, `${anchor}${clause}`));
  assert.match(migration, /raise exception 'list_transfer_inbox still treats "Claimed" as one status'/);
});

test("the helpers classify the lifecycle the way the filter does", () => {
  for (const status of WITH_AGENT_STATUSES) assert.ok(isWithAgent(status) && isOpenTransfer(status), status);
  assert.ok(!isWithAgent("unclaimed") && isOpenTransfer("unclaimed"));
  for (const status of ["completed", "closed", "dropped", "expired"]) assert.ok(!isWithAgent(status) && !isOpenTransfer(status), status);
});
