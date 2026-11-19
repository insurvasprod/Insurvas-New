import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

process.env.APPLICATION_DATA_ENCRYPTION_KEY ??= "test-only-application-data-key-0123456789";

const {
  hasUnsealedSensitive,
  isSealed,
  openLeadValue,
  openLeadValues,
  sealLeadValue,
  sealLeadValues,
  sealedFieldKeys,
  sealedLastFour,
  sealedLookup,
  ssnLookup,
} = await import("./seal.ts");
const { maskLeadValues, restoreMaskedLeadValues } = await import("./sensitive.ts");
const { maskLastFour } = await import("../verification/sensitive.ts");

const T1 = "11111111-1111-4111-8111-111111111111";
const T2 = "22222222-2222-4222-8222-222222222222";
const fields = [
  { field_key: "first_name", type: "text" },
  { field_key: "social", type: "ssn" },
  { field_key: "aba", type: "bank_routing" },
  { field_key: "acct", type: "bank_account" },
];

test("SSN and bank values are sealed; nothing else is touched", () => {
  const values = { first_name: "Quinn", social: "123-45-6789", aba: "021000021", acct: "000123456789", ssn: "987654321", policy_number: "P123", bank_name: "Chase" };
  const sealed = sealLeadValues(T1, values, fields);
  assert.equal(sealed.first_name, "Quinn");
  assert.equal(sealed.policy_number, "P123", "policy numbers are masked on screen, not sealed");
  assert.equal(sealed.bank_name, "Chase");
  for (const key of ["social", "aba", "acct", "ssn"]) assert.ok(isSealed(sealed[key]), key);
  const text = JSON.stringify(sealed);
  for (const secret of ["123-45-6789", "123456789", "021000021", "000123456789", "987654321"]) assert.ok(!text.includes(secret), secret);
  assert.equal(sealedLastFour(sealed.social), "6789");
  assert.equal(sealedLastFour(sealed.acct), "6789");
  assert.equal(values.social, "123-45-6789", "input not mutated");
});

test("a sealed value opens back to the number, only for its tenant and its key", () => {
  const sealed = sealLeadValue(T1, "ssn", "123456789");
  assert.equal(openLeadValue(T1, "ssn", sealed), "123456789");
  assert.equal(openLeadValue(T2, "ssn", sealed), null, "another tenant cannot open it");
  assert.equal(openLeadValue(T1, "bank_account", sealed), null, "moved under another key it does not open");
  assert.equal(openLeadValue(T1, "ssn", "123456789"), "123456789", "plaintext from before the backfill passes through");
  assert.deepEqual(openLeadValues(T1, { ssn: sealed, phone: "5555550101" }), { ssn: "123456789", phone: "5555550101" });
  assert.deepEqual(openLeadValues(T2, { ssn: sealed, phone: "5555550101" }), { phone: "5555550101" }, "a value that does not open is dropped, never shown sealed");
});

test("sealing is idempotent and never seals a mask or a scrubbed SSN", () => {
  const once = sealLeadValues(T1, { ssn: "123456789" });
  assert.deepEqual(sealLeadValues(T1, once), once);
  for (const placeholder of ["•••• 6789", "[Masked]", "***-**-6789", "", null]) {
    assert.deepEqual(sealLeadValues(T1, { ssn: placeholder }), { ssn: placeholder }, String(placeholder));
  }
  assert.equal(hasUnsealedSensitive({ ssn: "***-**-6789", phone: "5555550101" }), false);
  assert.equal(hasUnsealedSensitive({ ssn: "123456789" }), true);
  assert.equal(hasUnsealedSensitive(once), false);
});

test("the SSN lookup matches the same number in one tenant only", () => {
  const a = sealLeadValue(T1, "ssn", "123-45-6789");
  const b = sealLeadValue(T1, "ssn_number", "123456789");
  assert.equal(sealedLookup(a), sealedLookup(b));
  assert.equal(sealedLookup(a), ssnLookup(T1, "123 45 6789"));
  assert.notEqual(ssnLookup(T1, "123456789"), ssnLookup(T2, "123456789"));
  assert.equal(sealedLookup(sealLeadValue(T1, "bank_account", "000123456789")), "", "bank values carry no lookup");
  assert.equal(ssnLookup(T1, "1234"), null);
  // Two seals of one SSN differ (random IV) but carry the same lookup.
  assert.notEqual(a, sealLeadValue(T1, "ssn", "123-45-6789"));
});

test("screens mask a sealed value from its stored last four, never from the ciphertext", () => {
  const sealed = sealLeadValues(T1, { ssn: "123456789", first_name: "Q" });
  assert.equal(maskLastFour(sealed.ssn), "•••• 6789");
  assert.deepEqual(maskLeadValues(sealed), { ssn: "•••• 6789", first_name: "Q" });
});

test("a sealed value sent in from the browser is treated as a mask, not stored", () => {
  const planted = sealLeadValue(T1, "ssn", "999999999");
  assert.deepEqual(restoreMaskedLeadValues({ ssn: planted }, { ssn: "123456789" }, fields), { ssn: "123456789" });
});

test("sealed field keys come from the type and the narrower key rule", () => {
  assert.deepEqual([...sealedFieldKeys([...fields, { field_key: "routing_number", type: "text" }, { field_key: "policy_number", type: "text" }])].sort(), ["aba", "acct", "routing_number", "social"]);
});

// Every writer of agent_leads.values that can carry an SSN seals it. Guarded by reading the source, so a
// new write path that skips the seal fails here.
test("every lead write path seals, and every plaintext reader opens", () => {
  const read = (path) => readFileSync(new URL(path, import.meta.url), "utf8");
  const service = read("../agentTemplates/service.ts");
  const fn = (name) => { const start = service.indexOf(`export async function ${name}(`); return service.slice(start, service.indexOf("\nexport ", start + 10)); };
  assert.match(fn("createAgentLead"), /values: sealLeadValues\(tenantId, normalized\.values/);
  assert.match(fn("updateAgentLead"), /values: sealLeadValues\(tenantId, normalized\.values/);
  assert.match(fn("updateAgentLead"), /openLeadValues\(tenantId, before\.data\.values\)/);
  assert.match(fn("createPartnerLead"), /values: sealLeadValues\(tenantId, normalized\.values/);
  assert.doesNotMatch(fn("createPartnerLead"), /values: normalized\.values as Json/);
  assert.match(fn("findPartnerLeadDuplicates"), /p_ssn_lookup: lookup/);
  assert.match(read("../agentTemplates/importCommit.ts"), /values: sealLeadValues\(input\.tenantId, item\.values/);
  assert.match(read("../leadPost/service.ts"), /values: sealLeadValues\(keyRow\.tenant_id, \{/);
  assert.match(read("../leadDuplicates/service.ts"), /incoming: sealIncoming\(tenantId,/);
  const verification = read("../verification/service.ts");
  assert.match(verification, /values: openLeadValues\(tenantId, jsonRecord\(leadData\.values\)\)/);
  assert.match(verification, /sealLeadValue\(params\.tenantId, params\.fieldKey, newValue\)/);
  assert.match(read("../applications/service.ts"), /const values = openLeadValues\(input\.tenantId, lead\.data\?\.values \?\? \{\}\);/);
});
