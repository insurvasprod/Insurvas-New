// Walk 2026-11-20 (inbound call → application): verify once, Continue past a finished step, and the
// producer submit gate said before Record.
import test from "node:test";
import assert from "node:assert/strict";

const { confirmationOf } = await import("./verifyConfirm.ts");
const { applicationKeysForLeadKeys } = await import("./prefill.ts");
const { nextOpenStep } = await import("./stepFlow.ts");
const { gateBlocks, gateFromProducer, gateLine } = await import("./submitGateRules.ts");

const v = (value, reviewed = false) => ({ value, reviewed });
const items = {
  name: { key: "insured.first_name", shown: "Pat Example", keys: ["insured.first_name", "insured.last_name"] },
  dob: { key: "insured.dob", shown: "Jan 2, 1960", keys: ["insured.dob"] },
  address: { key: "addr.line1", shown: "1 Test St, Austin, TX 78701", keys: ["addr.line1", "addr.city", "addr.state", "addr.zip"] },
  phone: { key: "contact.phone", shown: "(555) 010-0000", keys: ["contact.phone"] },
};
const values = {
  "insured.first_name": v("Pat"), "insured.last_name": v("Example"), "insured.dob": v("1960-01-02"),
  "addr.line1": v("1 Test St"), "addr.city": v("Austin"), "addr.state": v("TX"), "addr.zip": v("78701"),
  "contact.phone": v("5550100000"),
};

test("what the call's Verification confirmed carries into the Verify step — phone included", () => {
  // The call's form: name, DOB, state, phone, email, coverage, tobacco (no street).
  const confirmedKeys = [...applicationKeysForLeadKeys(["first_name", "last_name", "date_of_birth", "state", "phone", "email", "coverage_amount", "tobacco"])];
  for (const complete of [false, true]) {
    const verification = { complete, confirmedKeys };
    assert.equal(confirmationOf(items.name, values, verification), "call");
    assert.equal(confirmationOf(items.dob, values, verification), "call");
    assert.equal(confirmationOf(items.phone, values, verification), "call", "phone was just confirmed on the call");
    // The state alone is not an address: still asked, even once the call's verification is complete.
    assert.equal(confirmationOf(items.address, values, verification), null, `address, complete=${complete}`);
  }
});

test("the address carries over only when its street was confirmed on the call", () => {
  const verification = { complete: false, confirmedKeys: [...applicationKeysForLeadKeys(["address", "state"])] };
  assert.equal(confirmationOf(items.address, values, verification), "call");
  // Without a street on the application the address is not confirmed, whatever the call said.
  const noStreet = { ...values, "addr.line1": undefined };
  assert.equal(confirmationOf({ ...items.address, shown: "Texas" }, noStreet, verification), null);
  // Checked by the agent here still counts.
  const reviewed = Object.fromEntries(Object.entries(values).map(([k, x]) => [k, { ...x, reviewed: true }]));
  assert.equal(confirmationOf(items.address, reviewed, null), "here");
});

test("nothing confirmed anywhere is still to ask; an empty value is never confirmed", () => {
  assert.equal(confirmationOf(items.phone, values, null), null);
  assert.equal(confirmationOf({ ...items.phone, shown: "" }, values, { complete: true, confirmedKeys: ["contact.phone"] }), null);
});

const ORDER = ["verify", "interview", "quote", "application", "beneficiaries", "payment", "disclosures", "review", "submit", "after"];

test("Payment's Continue goes to the next step that still needs work, else Review", () => {
  assert.equal(nextOpenStep(ORDER, "payment", "review", (s) => s !== "disclosures"), "disclosures");
  assert.equal(nextOpenStep(ORDER, "payment", "review", () => true), "review", "Disclosures done: straight to Review");
  assert.equal(nextOpenStep(ORDER, "review", "review", () => false), "review");
  assert.equal(nextOpenStep(ORDER, "nowhere", "review", () => false), "review");
});

test("the producer gate is part of the pre-check, worded with who fixes it", () => {
  assert.deepEqual(gateFromProducer({ can_submit: true, can_submit_reason: null }), { canSubmit: true, code: null, reason: null });
  const missing = gateFromProducer({ can_submit: false, can_submit_reason: "State licence number and expiry missing" });
  assert.equal(missing.code, "cannot_submit");
  assert.ok(gateBlocks(missing));
  assert.equal(gateLine(missing), "You can't submit yet: state licence number and expiry missing. Ask your agency owner to fix it on your producer record.");
  assert.equal(gateFromProducer({ can_submit: false, can_submit_reason: null }).reason, "Onboarding is not complete");
  assert.equal(gateLine(gateFromProducer({ can_submit: false, can_submit_reason: "NPN missing." })), "You can't submit yet: NPN missing. Ask your agency owner to fix it on your producer record.");
  const none = gateFromProducer(null);
  assert.equal(none.code, "not_a_producer");
  assert.match(gateLine(none), /add you as a producer/);
  // A solo agent (no gate read) is never blocked here; the server still decides on Record.
  assert.equal(gateBlocks(null), false);
  assert.equal(gateBlocks(undefined), false);
});
