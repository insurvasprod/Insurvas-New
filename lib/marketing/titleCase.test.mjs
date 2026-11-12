// Run with: npm test
//
// The cases are the cards' own copy. The sample data in the flow diagrams is the part that must not
// change — a file name, a policy ID, an acronym, a person's initial — so most of the value here is in
// proving the helper leaves those alone.
import { test } from "node:test";
import assert from "node:assert/strict";

import { titleCase } from "./titleCase.ts";

test("capitalises each word, keeping the small ones lower case mid-phrase", () => {
  assert.equal(titleCase("Partnerships & lead flow"), "Partnerships & Lead Flow");
  assert.equal(titleCase("Commissions, book of business & automations"), "Commissions, Book of Business & Automations");
  assert.equal(titleCase("Interview and submit in one window"), "Interview and Submit in One Window");
  assert.equal(titleCase("Every dollar to a policy"), "Every Dollar to a Policy");
  assert.equal(titleCase("Cost on every lead"), "Cost on Every Lead");
});

test("keeps the words the owner named lower case: a, the, it", () => {
  assert.equal(titleCase("Every dial on the record."), "Every Dial on the Record.");
  assert.equal(titleCase("A person accepts it"), "A Person Accepts It"); // last word: always up
  assert.equal(titleCase("Buy a list. Dial it today."), "Buy a List. Dial it Today.");
});

test("the first and last word of a phrase are always capitalised, small or not", () => {
  assert.equal(titleCase("a year kept"), "A Year Kept");
  assert.equal(titleCase("the plan to stay on"), "The Plan to Stay On");
  assert.equal(titleCase("4 of 4 passed"), "4 of 4 Passed");
});

test("a new phrase starts after sentence punctuation and after the cards' separators", () => {
  assert.equal(titleCase("Queue scored by priority; leads recycled"), "Queue Scored by Priority; Leads Recycled");
  assert.equal(titleCase("Ruth A. · on the line"), "Ruth A. · On the Line");
  assert.equal(titleCase("0 blockers · 1 to confirm"), "0 Blockers · 1 to Confirm");
});

test("leaves sample data alone: acronyms, IDs, names, file names", () => {
  assert.equal(titleCase("TCPA, before every dial"), "TCPA, Before Every Dial");
  assert.equal(titleCase("Consent · DNC · window"), "Consent · DNC · Window");
  assert.equal(titleCase("SAMPLE-0482 · Ruth A."), "SAMPLE-0482 · Ruth A.");
  assert.equal(titleCase("cobalt-media.csv · 600 rows"), "cobalt-media.csv · 600 Rows");
  assert.equal(titleCase("Map a vendor’s CSV once"), "Map a Vendor’s CSV Once");
  assert.equal(titleCase("Lead · $38.00"), "Lead · $38.00");
  assert.equal(titleCase("Waiting 0:14"), "Waiting 0:14");
});

test("never lowercases anything that was written in capitals", () => {
  for (const s of ["TCPA / DNC", "True CPA", "Status moves to Paid", "IUL"]) {
    const out = titleCase(s);
    for (const ch of s) if (ch >= "A" && ch <= "Z") assert.ok(out.includes(ch), `${s} lost ${ch}`);
  }
});

test("both halves of a hyphenated word take a capital; a file name's hyphen does not", () => {
  assert.equal(titleCase("Partners with their own sign-in, chat and terms"), "Partners With Their Own Sign-In, Chat and Terms");
  assert.equal(titleCase("cobalt-media.csv"), "cobalt-media.csv");
});

test("an empty or spaces-only string comes back as it went in", () => {
  assert.equal(titleCase(""), "");
  assert.equal(titleCase("   "), "   ");
});
