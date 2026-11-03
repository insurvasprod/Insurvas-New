import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import { leadPhoneValue, phoneEditNeedsScreening, phoneEditVerdict } from "./phoneEdit.ts";

test("only a changed number needs screening; a reformat or a cleared number does not", () => {
  assert.equal(phoneEditNeedsScreening({ phone: "(555) 201-0000" }, { phone: "(555) 201-0001" }), true);
  assert.equal(phoneEditNeedsScreening({ phone: "5552010000" }, { phone: "+1 555-201-0000" }), false);
  assert.equal(phoneEditNeedsScreening({ phone: "5552010000" }, { phone: "" }), false);
  assert.equal(phoneEditNeedsScreening({ phone: "5552010000" }, { phone: null }), false);
  assert.equal(phoneEditNeedsScreening({}, { phone_number: "5552010000" }), true);
  // An unparseable new number is still screened, so it is refused as invalid_phone.
  assert.equal(phoneEditNeedsScreening({ phone: "5552010000" }, { phone: "12" }), true);
  assert.equal(leadPhoneValue({ phone_number: "x" }), "x");
});

test("the outcomes the import rejects a row for refuse the edit; an outage refuses it as 503", () => {
  for (const outcome of ["dnc", "tcpa_litigator", "invalid_phone"]) {
    const verdict = phoneEditVerdict({ outcome, message: "Listed" });
    assert.equal(verdict.allowed, false);
    assert.equal(verdict.status, 422);
    assert.equal(verdict.code, `phone_${outcome}`);
  }
  const outage = phoneEditVerdict({ outcome: "unavailable", message: "" });
  assert.equal(outage.allowed, false);
  assert.equal(outage.status, 503);
  assert.deepEqual(phoneEditVerdict({ outcome: "clear" }), { allowed: true });
  assert.deepEqual(phoneEditVerdict({ outcome: "internal_dq" }), { allowed: true });
});

test("the lead edit screens through screenPartnerPhone before it writes, and stamps the result", () => {
  const service = readFileSync(new URL("../agentTemplates/service.ts", import.meta.url), "utf8");
  const start = service.indexOf("export async function updateAgentLead");
  const body = service.slice(start, service.indexOf("function ageInYears", start));
  const screen = body.indexOf("screenPartnerPhone({ tenantId, partnerId: null, userId: actorId");
  const write = body.indexOf('.from("agent_leads")\r\n    .update(') >= 0 ? body.indexOf('.from("agent_leads")\r\n    .update(') : body.indexOf('.from("agent_leads")\n    .update(');
  assert.ok(screen > 0, "the edit screens the new number");
  assert.ok(write > screen, "screening happens before the write");
  assert.match(body, /throw new LeadPhoneScreeningError\(verdict\)/);
  assert.match(body, /screening_outcome: screening\.outcome/);

  const route = readFileSync(new URL("../../app/api/app/leads/[id]/route.ts", import.meta.url), "utf8");
  assert.match(route, /requestedStage, auth\.context\.userId\)/);
  assert.match(route, /error instanceof LeadPhoneScreeningError/);
});
