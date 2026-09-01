import test from "node:test";
import assert from "node:assert/strict";

import { csvForContacts, parseContactCsv } from "./csv.ts";

const schema = [{ id: "field-1", tenant_id: "tenant-1", entity: "contact", field_key: "preferred_language", label: "Preferred language", field_type: "text", options: [], is_required: false, sort_order: 1, created_at: "2026-09-01T00:00:00Z", updated_at: "2026-09-01T00:00:00Z" }];

test("contact CSV round-trips custom fields and repeated phones/emails", () => {
  const csv = csvForContacts(schema, [{
    id: "contact-1", tenant_id: "tenant-1", household_id: null, first_name: "Ana", last_name: "O'Neil", dob: "1959-03-14", primary_phone: "6025550101", email: "ana@example.com", state: "AZ", address_line1: "12 Main St", city: "Phoenix", postal_code: "85001", custom_fields: { preferred_language: "Spanish" }, merged_into_id: null, created_at: "2026-09-01T00:00:00Z", updated_at: "2026-09-01T00:00:00Z", phones: [{ phone: "6025550101", type: "mobile", is_primary: true }, { phone: "6025550102", type: "home", is_primary: false }], emails: [{ email: "ana@example.com", is_primary: true }]
  }]);
  const [contact] = parseContactCsv(csv, schema);
  assert.equal(contact.last_name, "O'Neil");
  assert.equal(contact.custom_fields.preferred_language, "Spanish");
  assert.deepEqual(contact.phones.map((phone) => phone.phone), ["6025550101", "6025550102"]);
});

test("contact CSV export neutralizes spreadsheet formulas", () => {
  const csv = csvForContacts([], [{ id: "contact-1", tenant_id: "tenant-1", household_id: null, first_name: "=HYPERLINK(\"https://evil.test\")", last_name: "Safe", dob: null, primary_phone: null, email: null, state: null, address_line1: null, city: null, postal_code: null, custom_fields: {}, merged_into_id: null, created_at: "2026-09-01T00:00:00Z", updated_at: "2026-09-01T00:00:00Z", phones: [], emails: [] }]);
  assert.match(csv, /'="?HYPERLINK/);
});
