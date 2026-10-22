// A transfer that goes back in the queue gets the whole SLA ladder again (2026-10-16). Before,
// tenant_lead_sla_events was UNIQUE (work_item_id, rung): the second wait's events hit the conflict,
// so nobody was alerted, emailed or told, and no nurture followed a second expiry.
// Run with: node --experimental-strip-types --test lib/queueSla/cycle.test.mjs

import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { slaKey, slaKeyBase, nobodyClaimedKeyFromPartnerEvent } from "./keys.ts";

const read = (p) => readFileSync(join(process.cwd(), p), "utf8").replace(/\r\n/g, "\n");
const WI = "3f2b9c1e-0000-4000-8000-000000000001";

test("the first wait keeps the original keys, so nothing already sent repeats", () => {
  assert.equal(slaKeyBase(WI, 0), `unclaimed-sla:${WI}`);
  assert.equal(slaKeyBase(WI, null), `unclaimed-sla:${WI}`);
  assert.equal(slaKey(WI, undefined, "escalated"), `unclaimed-sla:${WI}:escalated`);
});

test("from the second wait on, every key names the wait", () => {
  assert.equal(slaKey(WI, 1, "offered"), `unclaimed-sla:${WI}~1:offered`);
  assert.equal(slaKey(WI, 2, "partner"), `unclaimed-sla:${WI}~2:partner`);
  assert.notEqual(slaKey(WI, 1, "escalated"), slaKey(WI, 0, "escalated"));
});

test("the agency's 'nobody claimed' alert follows the partner rung's wait", () => {
  assert.equal(nobodyClaimedKeyFromPartnerEvent(`unclaimed-sla:${WI}:partner`), `unclaimed-sla:${WI}:nobody-claimed`);
  assert.equal(nobodyClaimedKeyFromPartnerEvent(`unclaimed-sla:${WI}~3:partner`), `unclaimed-sla:${WI}~3:nobody-claimed`);
  assert.equal(nobodyClaimedKeyFromPartnerEvent("partner-card:abc"), null);
  assert.match(read("lib/partnerChat/service.ts"), /const fromLadder = nobodyClaimedKeyFromPartnerEvent\(input\.eventKey\);\n\s+if \(fromLadder\) return fromLadder;/);
});

test("the app builds every ladder key through the helper, never by hand", () => {
  const service = read("lib/queueSla/service.ts");
  assert.doesNotMatch(service, /`unclaimed-sla:\$\{/);
  for (const what of ["partner", "escalated", "offered"]) assert.match(service, new RegExp(`slaKey\\((event|row)\\.work_item_id, (event|row)\\.cycle, "${what}"\\)`));
  assert.match(service, /email_due_at, cycle"\)\.eq\("rung", "escalate"\)/);
});

test("the database keys each event to its wait and starts a new wait on every return to the queue", () => {
  const sql = read("supabase/migrations/20261016400000_sla_ladder_runs_each_queue_cycle.sql");
  assert.match(sql, /add constraint tenant_lead_sla_events_work_item_cycle_rung_key unique \(work_item_id, rung, cycle\)/);
  assert.match(sql, /drop constraint if exists tenant_lead_sla_events_work_item_id_rung_key/);
  assert.equal((sql.match(/'[a-z]+', p_now, item\.sla_cycle\)/g) ?? []).length, 4);
  assert.equal((sql.match(/on conflict on constraint tenant_lead_sla_events_work_item_cycle_rung_key do nothing/g) ?? []).length, 4);
  assert.equal((sql.match(/'unclaimed-sla:' \|\| e\.work_item_id::text \|\| case when e\.cycle > 0 then '~' \|\| e\.cycle::text else '' end \|\| ':/g) ?? []).length, 4);
  assert.equal((sql.match(/sla_cycle = sla_cycle \+ 1/g) ?? []).length, 2 + 2, "both return paths, and their self-checks");
});
