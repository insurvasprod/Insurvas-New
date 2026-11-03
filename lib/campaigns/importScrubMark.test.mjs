import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import { importScrubDecision } from "./importScrubMark.ts";

const read = (path) => readFileSync(new URL(`../../${path}`, import.meta.url), "utf8").replace(/\r\n/g, "\n");

test("an import marks its campaign scrubbed only when it scrubbed every lead in it", () => {
  // Already scrubbed: the older leads passed a scrub, the new rows were screened now.
  assert.deepEqual(importScrubDecision({ scrubStatus: "scrubbed", hadLeadsBefore: true }), { mark: true });
  // A new list: nothing in the campaign but what this import screened.
  assert.deepEqual(importScrubDecision({ scrubStatus: "unscrubbed", hadLeadsBefore: false }), { mark: true });
  assert.deepEqual(importScrubDecision({ scrubStatus: null, hadLeadsBefore: false }), { mark: true });
});

test("a failed, running or pending re-scrub is never papered over by an import", () => {
  for (const [scrubStatus, hadLeadsBefore] of [["failed", true], ["failed", false], ["scrubbing", true], ["scrubbing", false], ["unscrubbed", true], [null, true]]) {
    const decision = importScrubDecision({ scrubStatus, hadLeadsBefore });
    assert.equal(decision.mark, false, `${scrubStatus} / had leads ${hadLeadsBefore}`);
    assert.match(decision.reason, /new rows were scrubbed/);
  }
});

test("both import paths ask the decision first and write the mark conditionally on the status they read", () => {
  const service = read("lib/agentTemplates/service.ts");
  const direct = service.slice(service.indexOf("export async function importAgentLeads"), service.indexOf("export async function updateAgentLead"));
  assert.ok(direct.indexOf("readImportCampaignState(") < direct.indexOf("const committed = await commit("), "the prior state is read before the commit");
  assert.ok(direct.indexOf("importScrubDecision(") < direct.indexOf('scrub_status: "scrubbed"'));
  assert.match(direct, /\.eq\("scrub_status", priorCampaign\?\.scrubStatus \?\? "unscrubbed"\)/);
  assert.match(read("app/api/app/leads/import/route.ts"), /warning: scrubWarning \?\?/);

  const preflight = read("lib/agentTemplates/importPreflight.ts");
  const commit = preflight.slice(preflight.indexOf("export async function commitImport"));
  assert.ok(commit.indexOf('from("agent_leads").select("id").eq("tenant_id", input.tenantId).eq("campaign_id", campaignId).limit(1)') < commit.indexOf("await commitLeadImport("));
  assert.ok(commit.indexOf("importScrubDecision(") < commit.indexOf('scrub_status: "scrubbed"'));
  assert.match(commit, /\.eq\("scrub_status", prior\?\.scrubStatus \?\? "unscrubbed"\)/);
});

test("the direct import dedupes by the file's numbers, never by loading the tenant's leads", () => {
  const service = read("lib/agentTemplates/service.ts");
  const direct = service.slice(service.indexOf("export async function importAgentLeads"), service.indexOf("export async function updateAgentLead"));
  // The old read: every lead the tenant has, unpaged, capped at PostgREST's 1,000 rows.
  assert.doesNotMatch(direct, /from\("agent_leads"\)\s*\.select\(\s*"id, values, product_line, pipeline_id, stage_id, created_at, updated_at",?\s*\)\s*\.eq\("tenant_id", tenantId\)\)/);
  assert.match(direct, /existingLeadsByPhone\(db, tenantId, filePhones\)/);
  // One helper for both paths.
  assert.match(read("lib/agentTemplates/importPreflight.ts"), /import \{ existingLeadsByPhone \} from "@\/lib\/agentTemplates\/existingLeadPhones";/);
  assert.match(read("lib/agentTemplates/existingLeadPhones.ts"), /db\.rpc\("import_existing_lead_phones", \{ p_tenant_id: tenantId, p_phones: chunk \}\)/);
});
