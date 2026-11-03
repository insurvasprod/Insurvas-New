import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import { isSensitiveFieldKey, maskLastFour, maskSensitivePanel } from "./sensitive.ts";

const read = (path) => readFile(new URL(`../../${path}`, import.meta.url), "utf8");

test("banking, SSN and policy numbers are sensitive; ordinary fields are not", () => {
  for (const key of ["ssn", "social_security_number", "bank_routing", "routing_number", "bank_account", "account_number", "bank_institution", "policy_number"]) assert.ok(isSensitiveFieldKey(key), key);
  for (const key of ["first_name", "last_name", "date_of_birth", "street_address", "beneficiary", "phone"]) assert.ok(!isSensitiveFieldKey(key), key);
});

test("a masked value shows the last four and nothing else", () => {
  assert.equal(maskLastFour("021000021"), "•••• 0021");
  assert.equal(maskLastFour("123-45-6789"), "•••• 6789");
  assert.equal(maskLastFour(4021), "••••");
  assert.equal(maskLastFour(""), "");
  assert.equal(maskLastFour(null), "");
});

test("the panel is masked everywhere a value appears, and the input is not mutated", () => {
  const panel = {
    lead: { values: { first_name: "Grace", bank_routing: "021000021", ssn: "123456789" } },
    sections: [{ fields: [
      { field_key: "first_name", old_value: "Grace", new_value: "Grace" },
      { field_key: "bank_routing", old_value: "021000021", new_value: "021000021" },
      { field_key: "bank_account", old_value: null, new_value: null },
    ] }],
  };
  const masked = maskSensitivePanel(panel);
  assert.deepEqual(masked.sensitiveKeys.sort(), ["bank_account", "bank_routing", "ssn"]);
  assert.equal(masked.lead.values.first_name, "Grace");
  assert.equal(masked.lead.values.bank_routing, "•••• 0021");
  assert.equal(masked.lead.values.ssn, "•••• 6789");
  assert.equal(masked.sections[0].fields[1].old_value, "•••• 0021");
  assert.equal(masked.sections[0].fields[1].new_value, "•••• 0021");
  assert.equal(masked.sections[0].fields[2].old_value, null);
  assert.equal(panel.lead.values.bank_routing, "021000021", "the unmasked panel was mutated");
  assert.ok(!JSON.stringify(masked).includes("021000021"));
  assert.ok(!JSON.stringify(masked).includes("123456789"));
});

test("the inbound screen only ever sends the masked panel, and a reveal is audited before the value leaves", async () => {
  const route = await read("app/api/app/inbound/verification/route.ts");
  assert.match(route, /maskSensitivePanel\(panel\)/);
  // Both the GET and the POST response go through the same masking helper.
  assert.equal((route.match(/screenPanel\(/g) ?? []).length, 3);
  assert.doesNotMatch(route, /NextResponse\.json\(await getVerificationPanel\(/);
  assert.doesNotMatch(route, /NextResponse\.json\(await updateVerificationField\(/);

  const reveal = await read("app/api/app/inbound/verification/reveal/route.ts");
  const auditAt = reveal.indexOf("action: \"tenant.verification_field_revealed\"");
  const returnAt = reveal.indexOf("return NextResponse.json({ field_key: parsed.data.field_key, value })");
  assert.ok(auditAt > 0 && returnAt > auditAt, "the value is returned before the audit row is written");
  assert.match(reveal, /isSensitiveFieldKey\(parsed\.data\.field_key\)/);
  assert.match(reveal, /getVerificationPanel\(auth\.context\.tenantId, auth\.context\.userId, parsed\.data\.work_item_id\)/);

  const actions = await read("lib/audit/actions.ts");
  assert.match(actions, /"tenant\.verification_field_revealed",/);
  assert.match(actions, /"tenant\.verification_field_revealed": "Sensitive verification field revealed"/);
});
