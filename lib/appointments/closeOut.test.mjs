import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

test("close-out route keeps outcome access owner/producer only and audits the write", () => {
  const route = readFileSync(new URL("../../app/api/app/appointments/close-out/route.ts", import.meta.url), "utf8");
  assert.match(route, /requireFeatureRole\("outbound_dialing", OUTCOME_ROLES/);
  assert.match(route, /const OUTCOME_ROLES = \["owner", "producer"\]/);
  assert.match(route, /appointment_outcome_recorded/);
  assert.match(route, /z\.enum\(\["showed", "no_show", "cancelled", "rescheduled"\]\)/);
});

test("close-out service scopes the view and lead lookup to the authenticated tenant", () => {
  const service = readFileSync(new URL("./closeOut.ts", import.meta.url), "utf8");
  assert.match(service, /from\("tenant_appointment_close_out"\)/);
  assert.match(service, /\.eq\("tenant_id", tenantId\)/g);
  assert.match(service, /from\("agent_leads"\)/);
  assert.match(service, /rpc\("mark_appointment_outcome"/);
});
