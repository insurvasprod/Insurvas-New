import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const read = (path) => readFile(new URL(path, import.meta.url), "utf8");

const [floor, sidebar, disposition, dealPage, dealFlow, resilienceMigration] = await Promise.all([
  read("../../components/app/agent-floor.tsx"),
  read("../../components/app/agent-sidebar.tsx"),
  read("../../components/app/disposition-wizard.tsx"),
  read("../../app/app/(shell)/deal-flow/page.tsx"),
  read("../../components/app/deal-flow-workspace.tsx"),
  read("../../supabase/migrations/20260917120000_la_1_disposition_chat_resilience.sql"),
]);

test("LA-1 Floor claim and handoff use the verification workflow", () => {
  assert.match(floor, /router\.push\(`\/app\/inbound\/\$\{workItemId\}\/verification`\)/);
  assert.match(floor, /body\?\.handoff\?\.work_item_id \?\? workItemId/);
  assert.doesNotMatch(sidebar, /pathname === ["']\/app\/floor["']/);
  assert.doesNotMatch(sidebar, /portal-agent-floor-nav/);
});

test("LA-1 disposition returns to a focused Daily deal flow row", () => {
  assert.match(disposition, /\/app\/deal-flow\?focus_lead_id=/);
  assert.match(dealPage, /<DealFlowWorkspace focusLeadId=\{focusLeadId\}/);
  assert.match(dealFlow, /portal-deal-flow-focused-row/);
});

test("LA-1 disposition isolates partner outcome-card failures", () => {
  assert.match(resilienceMigration, /exception\s+when\s+others\s+then\s+v_partner_card_error\s*:=\s*sqlerrm/i);
  assert.match(resilienceMigration, /'partner_card_posted'/i);
  assert.match(resilienceMigration, /update public\.tenant_verification_sessions[\s\S]*status = 'closed'/i);
  assert.match(resilienceMigration, /revoke all on function public\.complete_disposition/i);
  assert.match(resilienceMigration, /grant execute on function public\.complete_disposition[\s\S]*to service_role/i);
});
