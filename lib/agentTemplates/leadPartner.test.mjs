// Run with: node --experimental-strip-types --test lib/agentTemplates/leadPartner.test.mjs
//
// Walk 2026-11-20: the Leads table's Partner column showed the partner's portal user (a person) for a lead
// Summit Transfers sent. It now names the company, the person only when no company sent it.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { leadPartnerLabel } from "./leadPartner.ts";

const read = (path) => readFileSync(join(process.cwd(), path), "utf8");

test("the company first, then the person, then Workspace", () => {
  assert.equal(leadPartnerLabel({ partner_name: "Summit Transfers", submitter_name: "Sam Portal" }), "Summit Transfers");
  assert.equal(leadPartnerLabel({ partner_id: "p1", partner_name: null, submitter_name: "Sam Portal" }), "Sam Portal");
  assert.equal(leadPartnerLabel({ partner_id: null, partner_name: null, submitter_name: "Demo Owner" }), "Workspace", "an imported list is not the importer's partner lead");
  assert.equal(leadPartnerLabel({ partner_name: "  ", submitter_name: null }), "Workspace");
  assert.equal(leadPartnerLabel({}), "Workspace");
});

test("partner names are read under the lead's tenant only", () => {
  const service = read("lib/agentTemplates/service.ts");
  const fn = service.slice(service.indexOf("export async function withSubmitterNames"));
  assert.match(fn, /from\("partners"\)\.select\("id, name"\)\.eq\("tenant_id", tenantId\)\.in\("id", partnerIds\)/);
  assert.match(service, /created_by, partner_id, screening_outcome/, "the leads read carries partner_id");
  assert.match(read("app/api/app/leads/route.ts"), /withSubmitterNames\(auth\.context\.tenantId, found\)/);
});

test("every Partner cell of the pipeline views names the company first", () => {
  const views = read("components/app/pipeline-views.tsx");
  assert.doesNotMatch(views, /submitter_name \?\? "Workspace"/);
  assert.ok((views.match(/leadPartnerLabel\(/g) ?? []).length >= 4);
});
