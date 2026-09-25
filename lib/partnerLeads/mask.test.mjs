// Run with: npm test
//
// LA-1.17 acceptance criterion 2: "SSN and banking fields are masked in every partner view and in
// the CSV export." The ticket files it under "What the partner must NOT see" and calls that list the
// task — "Get it wrong and the platform leaks."
//
// `scripts/verify-partner-lead-pipeline.mjs` proves both surfaces mask today. What it cannot prove
// is that the pattern still covers a field nobody has added yet, and today that is most of them:
// across every template in the live project there are **11 distinct field keys, of which exactly one
// (`ssn`) is sensitive**. No template has a banking field at all, so the banking half of the mask
// has never been exercised by real data.
//
// A pre-emptive pattern has to match the names the product will actually use, so these are keyed to
// LA-1.4's own specification of the form's Banking section: "institution, routing number, account
// number".
import { test } from "node:test";
import assert from "node:assert/strict";

import { maskSensitiveValues, MASKED_PLACEHOLDER, SENSITIVE_PARTNER_KEY } from "./mask.ts";

test("the three categories the ticket names are masked", () => {
  const masked = maskSensitiveValues({
    ssn: "123-45-6789",
    social_security_number: "123456789",
    routing_number: "021000021",
    account_number: "000123456789",
    bank_name: "First National",
    institution: "First National",
    iban: "GB33BUKB20201555555555",
    swift: "BUKBGB22",
    policy_number: "POL-99182",
    policy_no: "POL-99182",
    credit_card: "4111111111111111",
  });

  for (const [key, value] of Object.entries(masked)) {
    assert.equal(value, MASKED_PLACEHOLDER, `${key} reached the partner unmasked`);
  }
});

test("`institution` is masked — the gap that widened this pattern", () => {
  // LA-1.4 names the Banking section as "institution, routing number, account number". The original
  // pattern caught the last two and missed the first: `bank` only matches when someone happens to
  // write `bank_institution`.
  assert.equal(maskSensitiveValues({ institution: "First National" }).institution, MASKED_PLACEHOLDER);
  assert.ok(SENSITIVE_PARTNER_KEY.test("institution"));
});

test("ordinary lead fields are not masked", () => {
  // Over-masking is a regression too: a partner who cannot read a field their own closer collected
  // has lost the screen's purpose. Date of birth is deliberately NOT in the ticket's list.
  const values = {
    first_name: "Ada",
    last_name: "Lovelace",
    date_of_birth: "1972-03-24",
    phone: "2052336644",
    email: "ada@example.com",
    state: "FL",
    coverage_amount: 25000,
    tobacco_use: false,
  };
  assert.deepEqual(maskSensitiveValues(values), values);
});

test("masking follows the key through nesting and arrays", () => {
  // The values column is jsonb, so a form can nest. Masking only the top level would leak the same
  // number one object deeper.
  const masked = maskSensitiveValues({
    applicant: { first_name: "Ada", ssn: "123-45-6789" },
    banking: [{ routing_number: "021000021" }, { routing_number: "111000025" }],
    beneficiaries: [{ name: "Byron", relationship: "child" }],
  });

  assert.equal(masked.applicant.ssn, MASKED_PLACEHOLDER);
  assert.equal(masked.applicant.first_name, "Ada");
  assert.equal(masked.banking, MASKED_PLACEHOLDER, "a sensitive key masks the whole array");
  assert.deepEqual(masked.beneficiaries, [{ name: "Byron", relationship: "child" }]);
});

test("an array under a neutral key masks its sensitive members individually", () => {
  const masked = maskSensitiveValues({
    people: [
      { name: "Ada", ssn: "123-45-6789" },
      { name: "Byron", ssn: "987-65-4321" },
    ],
  });
  assert.deepEqual(masked.people, [
    { name: "Ada", ssn: MASKED_PLACEHOLDER },
    { name: "Byron", ssn: MASKED_PLACEHOLDER },
  ]);
});

test("masking keys on the field name, never on the value's shape", () => {
  // A routing number and a quoted premium are both nine-ish digits. Guessing from the value would
  // either leak the first or mask the second.
  const masked = maskSensitiveValues({ monthly_premium_cents: 714000000, routing_number: "021000021" });
  assert.equal(masked.monthly_premium_cents, 714000000);
  assert.equal(masked.routing_number, MASKED_PLACEHOLDER);
});
