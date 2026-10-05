import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { dialerSource } from "../dialerScripts/dialerSource.mjs";

const root = process.cwd();
const read = (path) => readFileSync(join(root, path), "utf8");
const limitsSql = read("supabase/migrations/20260913470000_la_2_22_outbound_limits.sql");
const scriptsSql = read("supabase/migrations/20260913480000_la_2_23_scripts_rebuttals_disclosures.sql");
const outbound = read("lib/metering/outbound.ts");
const panel = dialerSource();
const dialerService = read("lib/dialerScripts/service.ts");
const searchRoute = read("app/api/app/dialer/search/route.ts");
const leadService = read("lib/agentTemplates/service.ts");

test("LA-2.22 declares every outbound cap and meter", () => {
  for (const key of ["max_setter_seats", "max_active_campaigns", "monthly_leads_imported", "consent_cert_claims"]) assert.match(limitsSql, new RegExp(key));
  assert.match(limitsSql, /create constraint trigger tenant_users_outbound_setter_limit/);
  assert.match(limitsSql, /create constraint trigger tenant_campaigns_outbound_active_limit/);
  assert.match(limitsSql, /consume_meter_capacity/);
  assert.match(outbound, /getEntitlement\(tenantId\)/);
  assert.match(outbound, /OutboundLimitError/);
  assert.match(outbound, /upgrade: true/);
});

test("LA-2.22 import is batch-preflighted and records usage idempotently", () => {
  const service = read("lib/agentTemplates/service.ts");
  const route = read("app/api/app/leads/import/route.ts");
  assert.match(service, /assertOutboundLimit\(tenantId, "monthly_leads_imported", rows\.length\)/);
  assert.match(service, /assertOutboundLimit\(tenantId, "dnc_scrub_lookups", rows\.length\)/);
  assert.match(service, /screenPartnerPhone/);
  assert.match(read("lib/compliance/screening.ts"), /consumeMeterCapacity/);
  assert.match(route, /recordOutboundUsage/);
  assert.match(route, /outboundLimitResponse/);
});

test("LA-2.23 stores script, rebuttal and platform disclosure data", () => {
  for (const table of ["tenant_scripts", "tenant_rebuttals", "state_disclosures"]) assert.match(scriptsSql, new RegExp(`create table if not exists public\\.${table}`));
  for (const section of ["opening", "qualifying_questions", "transition_to_quote", "close"]) assert.match(dialerService, new RegExp(section));
  assert.match(scriptsSql, /confirm_call_disclosure/);
  assert.match(scriptsSql, /disclosure_confirmed_at/);
  assert.match(scriptsSql, /DISCLOSURE_MISMATCH/);
  assert.match(scriptsSql, /DISCLOSURE_NOT_CONFIGURED/);
  assert.match(panel, /Required disclosure/);
  assert.match(panel, /Rebuttals/);
  assert.match(panel, /Save new version/);
  assert.match(panel, /disabled=\{!confirmed \|\| !eligibility\?\.allowed \|\| !panel\.lead\.phone \|\| working\}/);
  assert.match(panel, /aria-describedby="dial-status"/);
  assert.match(panel, /Dialing blocked/);
  assert.match(panel, /server will repeat compliance checks/);
  assert.match(dialerService, /Read and confirm the required disclosure before dialing/);
  assert.match(dialerService, /Lead not found for this tenant/);
});

test("LA-2.23 resolves supported lead variables before rendering", () => {
  assert.match(dialerService, /replace\(\/\\\{\\\{/);
  assert.match(dialerService, /first_name/);
  assert.match(dialerService, /ageFrom/);
  assert.match(dialerService, /DEFAULT_REBUTTALS/);
});

test("LA-2.8 provides a tenant-scoped non-serving lead search", () => {
  assert.match(searchRoute, /requireFeatureRole\("outbound_dialing", \["owner", "producer"\]\)/);
  assert.match(searchRoute, /mode: "non_serving_search"/);
  assert.match(leadService, /searchAgentLeads/);
  assert.match(leadService, /tenant_template_id/);
  assert.doesNotMatch(searchRoute, /serve_next_lead/);
  assert.match(panel, /Search results are read-only; opening one does not serve or claim the lead/);
  assert.match(panel, /Back to queue/);
});
