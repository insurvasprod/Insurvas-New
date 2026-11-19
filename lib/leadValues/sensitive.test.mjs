import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import {
  looksMasked,
  maskLead,
  maskLeadValues,
  restoreMaskedLeadValues,
  sensitiveLeadFieldKeys,
} from "./sensitive.ts";

const fields = [
  { field_key: "first_name", type: "text" },
  { field_key: "social", type: "ssn" },
  { field_key: "aba", type: "bank_routing" },
  { field_key: "acct", type: "bank_account" },
  { field_key: "phone", type: "phone" },
];

test("sensitive keys come from the field type and from the shared key-name rule", () => {
  const keys = sensitiveLeadFieldKeys([...fields, { field_key: "routing_number", type: "text" }]);
  assert.deepEqual([...keys].sort(), ["aba", "acct", "routing_number", "social"]);
});

test("SSN and bank values leave masked to their last four; other values are untouched", () => {
  const values = { first_name: "Quinn", social: "123-45-6789", aba: "021000021", acct: "000123456789", phone: "5555550101", ssn: "987654321" };
  const masked = maskLeadValues(values, fields);
  assert.equal(masked.first_name, "Quinn");
  assert.equal(masked.phone, "5555550101");
  assert.equal(masked.social, "•••• 6789");
  assert.equal(masked.aba, "•••• 0021");
  assert.equal(masked.acct, "•••• 6789");
  // A key named like an SSN is masked even when the template does not list it.
  assert.equal(masked.ssn, "•••• 4321");
  // No full number survives anywhere in the masked object.
  const text = JSON.stringify(masked);
  for (const secret of ["123-45-6789", "021000021", "000123456789", "987654321"]) assert.ok(!text.includes(secret), secret);
  // The input is not mutated.
  assert.equal(values.social, "123-45-6789");
});

test("empty sensitive values stay empty, and a lead keeps its other columns", () => {
  assert.deepEqual(maskLeadValues({ social: "", aba: null }, fields), { social: "", aba: null });
  assert.deepEqual(maskLeadValues(null, fields), {});
  const lead = maskLead({ id: "L1", stage_id: "S1", values: { social: "123456789" } }, fields);
  assert.equal(lead.id, "L1");
  assert.equal(lead.stage_id, "S1");
  assert.equal(lead.values.social, "•••• 6789");
});

test("a masked value sent back keeps the stored number; a typed new number is saved", () => {
  const stored = { first_name: "Quinn", social: "123456789", aba: "021000021" };
  const incoming = { first_name: "Quinn R", social: "•••• 6789", aba: "011000015" };
  assert.deepEqual(restoreMaskedLeadValues(incoming, stored, fields), { first_name: "Quinn R", social: "123456789", aba: "011000015" });
});

test("a mask with nothing stored behind it is dropped, never saved as the mask", () => {
  const restored = restoreMaskedLeadValues({ social: "••••", first_name: "Q" }, {}, fields);
  assert.deepEqual(restored, { first_name: "Q" });
  assert.deepEqual(restoreMaskedLeadValues({ acct: "[Masked]" }, { acct: "" }, fields), {});
});

test("only mask shapes count as masks", () => {
  assert.ok(looksMasked("•••• 4021"));
  assert.ok(looksMasked("••••"));
  assert.ok(looksMasked("[Masked]"));
  assert.ok(!looksMasked("123456789"));
  assert.ok(!looksMasked("4021"));
  assert.ok(!looksMasked(null));
});

test("a mask on a key that is not sensitive is saved as typed", () => {
  const incoming = { nickname: "••••" };
  assert.equal(restoreMaskedLeadValues(incoming, { nickname: "Q" }, fields), incoming);
});

// The routes that send lead values to the browser must mask them. Guarded by reading the source, so a
// new return path that drops the mask fails here rather than in production.
test("the lead APIs mask values before they leave the server", () => {
  const service = readFileSync(new URL("../agentTemplates/service.ts", import.meta.url), "utf8");
  // filterAgentLeads reads through filterAgentLeadsPage (the board's paged read, 2026-11-12), which masks.
  const filterStart = service.indexOf("export async function filterAgentLeads(");
  assert.match(service.slice(filterStart, service.indexOf("\nexport ", filterStart + 10)), /return \(await filterAgentLeadsPage\(/, "filterAgentLeads reads through the paged read");
  for (const name of ["filterAgentLeadsPage", "searchAgentLeads", "exportAgentLeads", "createAgentLead", "updateAgentLead"]) {
    const start = service.indexOf(`export async function ${name}(`);
    assert.ok(start >= 0, name);
    const next = service.indexOf("\nexport ", start + 10);
    const body = service.slice(start, next === -1 ? undefined : next);
    assert.match(body, /maskLead(Values)?\(/, `${name} masks lead values`);
  }
  const workspace = readFileSync(new URL("../leadWorkspace/service.ts", import.meta.url), "utf8");
  assert.match(workspace, /lead: maskLead\(/);
});

test("the duplicate review and the list mapping sample never carry a full SSN or bank number", () => {
  const duplicates = readFileSync(new URL("../leadDuplicates/service.ts", import.meta.url), "utf8");
  assert.match(duplicates, /if \(!COMPARED_KEYS\.has\(key\)\) continue;/, "duplicate review sends the compared keys only");
  const detail = readFileSync(new URL("../leadLists/detail.ts", import.meta.url), "utf8");
  assert.match(detail, /const sampleValues = maskLeadValues\(/, "mapping sample is masked");
  const workspace = readFileSync(new URL("../leadWorkspace/service.ts", import.meta.url), "utf8");
  assert.match(workspace, /fields: \(verificationFields\.data \?\? \[\]\)\.map\(maskField\)/, "verification rows are masked");
  assert.match(workspace, /for \(const change of corrections\)/, "the timeline is built from masked corrections");
});

test("a stage change from the lead page cannot overwrite the stored SSN with its mask", () => {
  const service = readFileSync(new URL("../agentTemplates/service.ts", import.meta.url), "utf8");
  const start = service.indexOf("export async function updateAgentLead(");
  const body = service.slice(start, service.indexOf("\nexport ", start + 10));
  // The stored values are read first, and validation runs on the restored values, not the raw input.
  const normalizeCall = body.slice(body.indexOf("normalizeFormValues("), body.indexOf("if (normalized.error)"));
  assert.ok(body.indexOf('.select("values")') < body.indexOf("normalizeFormValues("), "stored values read before validation");
  assert.match(normalizeCall, /restoreMaskedLeadValues\(values, openLeadValues\(tenantId, before\.data\.values\),/, "validation runs on the restored, opened values");
});
