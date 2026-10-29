import assert from "node:assert/strict";
import test from "node:test";

import { parseLookup, statesStartingWith } from "./contractingLookup.ts";

const CARRIERS = [
  { id: "mo", name: "Mutual of Omaha" },
  { id: "ae", name: "Aetna / CVS" },
  { id: "am", name: "Americo" },
  { id: "fo", name: "Foresters" },
];

test("a state alone, by name or code", () => {
  assert.deepEqual(parseLookup("texas", CARRIERS), { state: { code: "TX", name: "Texas" }, carrierIds: null, nothing: false });
  assert.equal(parseLookup("tx", CARRIERS).state?.code, "TX");
  assert.equal(parseLookup("West Virginia", CARRIERS).state?.code, "WV");
  assert.equal(parseLookup("arkansas", CARRIERS).state?.code, "AR");
});

test("a carrier alone, even when its name has a filler word", () => {
  assert.deepEqual(parseLookup("aetna", CARRIERS).carrierIds, ["ae"]);
  assert.deepEqual(parseLookup("mutual of omaha", CARRIERS).carrierIds, ["mo"]);
  assert.deepEqual(parseLookup("am", CARRIERS).carrierIds, ["am"]);
});

test("a carrier and a state together answer the question", () => {
  const lookup = parseLookup("is aetna in texas?", CARRIERS);
  assert.equal(lookup.state?.code, "TX");
  assert.deepEqual(lookup.carrierIds, ["ae"]);
  const short = parseLookup("Americo TX", CARRIERS);
  assert.equal(short.state?.code, "TX");
  assert.deepEqual(short.carrierIds, ["am"]);
  const lower = parseLookup("aetna tx", CARRIERS);
  assert.equal(lower.state?.code, "TX");
  assert.deepEqual(lower.carrierIds, ["ae"]);
});

test("common words are not read as state codes", () => {
  const lookup = parseLookup("aetna in ohio", CARRIERS);
  assert.equal(lookup.state?.code, "OH");
  assert.deepEqual(lookup.carrierIds, ["ae"]);
});

test("a partial state name is a state search; nonsense matches nothing", () => {
  assert.equal(parseLookup("tex", CARRIERS).state?.code, "TX");
  assert.equal(parseLookup("zzz", CARRIERS).nothing, true);
  assert.deepEqual(statesStartingWith("new"), ["NH", "NJ", "NM", "NY"]);
});
