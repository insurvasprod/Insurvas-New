// Run with: npm test
// LA-1.4-3: the six section-group switches (Personal, Medical, Insurance, Beneficiary, Banking,
// Signature). The partner form, its settings preview and server intake all read them through
// effectiveTemplateForm, and a commit is refused by sectionAvailabilityError.
import test from "node:test";
import assert from "node:assert/strict";

const { effectiveTemplateForm, sectionAvailability, sectionAvailabilityError, sectionGroup } = await import("./sectionAvailability.ts");

const field = (field_key, extra = {}) => ({ field_key, label: field_key, type: "text", is_required: false, ...extra });
const fields = [
  field("first_name", { is_required: true }),
  field("phone", { type: "phone", is_required: true }),
  field("beneficiary_name", { is_required: true }),
  field("bank_routing"),
  field("notes"),
];
const section = (section_key, label, keys) => ({ section_key, label, sort_order: 0, fields: keys.map((field_key) => ({ field_key })) });
const form = {
  sections: [
    section("applicant", "Applicant", ["first_name"]),
    section("contact", "Contact", ["phone"]),
    section("beneficiary", "Beneficiary", ["beneficiary_name"]),
    section("payment", "Bank draft", ["bank_routing"]),
    section("extra", "Additional information", ["notes"]),
  ],
};

test("sections belong to a group by key, then label; an unmatched section is not governed", () => {
  assert.equal(sectionGroup({ section_key: "applicant", label: "Applicant" }), "personal");
  assert.equal(sectionGroup({ section_key: "s3", label: "Health questions" }), "medical");
  assert.equal(sectionGroup({ section_key: "payment", label: "Bank draft" }), "banking");
  assert.equal(sectionGroup({ section_key: "esign", label: "E-sign" }), "signature");
  assert.equal(sectionGroup({ section_key: "extra", label: "Additional information" }), null);
});

test("all six groups are on unless switched off", () => {
  assert.deepEqual(sectionAvailability({}), { personal: true, medical: true, insurance: true, beneficiary: true, banking: true, signature: true });
  assert.equal(sectionAvailability({ section_availability: { banking: false } }).banking, false);
});

test("a switched-off group's sections leave the partner form; the phone section always stays", () => {
  const off = effectiveTemplateForm({ ...form, section_availability: { banking: false, personal: false } }, fields);
  assert.deepEqual(off.sections.map((s) => s.label), ["Contact", "Beneficiary", "Additional information"]);
});

test("a group holding a required field or the screening phone cannot be switched off", () => {
  assert.equal(sectionAvailabilityError({ ...form, section_availability: { banking: false } }, fields), null);
  assert.match(sectionAvailabilityError({ ...form, section_availability: { beneficiary: false } }, fields), /Beneficiary cannot be switched off: “beneficiary_name” in “Beneficiary” is required/);
  const optionalName = fields.map((f) => (f.field_key === "first_name" ? { ...f, is_required: false } : f));
  assert.match(sectionAvailabilityError({ ...form, section_availability: { personal: false } }, optionalName), /Personal cannot be switched off: “Contact” holds the phone number/);
  assert.equal(sectionAvailabilityError({ ...form, section_availability: { wallet: false } }, fields), "Section availability is invalid");
});
