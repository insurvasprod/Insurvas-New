// LA-1.24-5: "Sold twice by 2 partners flagged distinctly."
import { test } from "node:test";
import assert from "node:assert/strict";

import { isSoldMatch, soldByMultiplePartners, soldByPartners } from "./soldBy.ts";

const lead = (partnerId, partnerName, outcome) => ({ sourceType: "lead", partnerId, partnerName, outcome });

test("two partners who each sold the person are flagged, once each", () => {
  const matches = [
    lead("p-apex", "Apex", "application_submitted"),
    lead("p-vertex", "Vertex", "sold"),
    lead("p-apex", "Apex", "sent_to_underwriting_approved"),
  ];
  assert.deepEqual(soldByPartners(matches), [{ partnerId: "p-apex", partnerName: "Apex" }, { partnerId: "p-vertex", partnerName: "Vertex" }]);
  assert.equal(soldByMultiplePartners(matches), true);
});

test("one partner selling twice is already a customer, not the two-partner flag", () => {
  const matches = [lead("p-apex", "Apex", "application_submitted"), lead("p-apex", "Apex", "sold")];
  assert.equal(soldByPartners(matches).length, 1);
  assert.equal(soldByMultiplePartners(matches), false);
});

test("a partner who only spoke to them, or a contact on file, is not a sale", () => {
  const matches = [
    lead("p-apex", "Apex", "application_submitted"),
    lead("p-vertex", "Vertex", "not_interested"),
    lead("p-north", "Northline", null),
    { sourceType: "contact", partnerId: "p-south", partnerName: "Southgate", outcome: "contact_on_file" },
  ];
  assert.equal(soldByMultiplePartners(matches), false);
  assert.equal(isSoldMatch(matches[3]), false);
  assert.equal(isSoldMatch(lead("p", "P", "call_dropped")), false);
});
