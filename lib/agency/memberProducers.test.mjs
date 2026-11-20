// Agency members who joined before their agency record existed get producer rows (owner 2026-11-20, manager walk).
// Run with: node --experimental-strip-types --test lib/agency/memberProducers.test.mjs
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const read = (p) => readFileSync(join(process.cwd(), p), "utf8").replace(/\r\n/g, "\n");

test("Finish agency setup also gives every producer member (managers included) a producer row", () => {
  const store = read("lib/agency/upgradeStore.ts");
  assert.match(store, /rpc\("agency_add_member_producers", \{ p_tenant_id: tenantId \}\)/);
  assert.match(store, /const members = await addMemberProducers\(tenantId\);/, "after the owner's own upgrade");
  assert.match(store, /return \(await membersWithoutProducer\(tenantId\)\)\.length > 0;/, "the button stays while a member has no row");
  assert.match(store, /\.eq\("role", "producer"\)/, "a manager is a producer with a title");
});

test("the database sets status and can_submit, never the app", () => {
  const sql = read("supabase/migrations/20261120200000_agency_member_producers.sql");
  assert.match(sql, /when tu\.accepted_at is null then 'invited'/);
  assert.match(sql, /else 'onboarding' end/, "the checklist moves him to active (AG-1.10)");
  assert.match(sql, /perform public\.producer_refresh_can_submit\(p_tenant_id, v\.id\);/);
  assert.match(sql, /on conflict on constraint producer_one_per_member do nothing/, "idempotent");
  assert.match(sql, /grant execute on function public\.agency_add_member_producers\(uuid\) to service_role;/);
  assert.match(sql, /raise exception 'agency_add_member_producers: a producer member still has no producer row'/);
});

test("saving a member's licensed states re-runs his submit gate (manager walk 2026-11-20)", () => {
  const service = read("lib/tenantTeam/service.ts");
  assert.match(service, /const saved = await saveMemberLicensedStates\(tenantId, userId, states, expiries\);\n  await refreshProducerGate\(tenantId, userId\);/);
  assert.match(service, /rpc\("producer_refresh_can_submit" as never, \{ p_tenant_id: tenantId, p_producer_id: producer\.data\.id \}/);
});
