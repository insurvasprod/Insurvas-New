import test from "node:test";
import assert from "node:assert/strict";

import { carrierSetup, FACETS, needsLook, setUpCount } from "./setup.ts";

const full = {
  facts: new Map([["a", { portalOrigin: "https://agents.a.com", referencePattern: "^A\\d+$", billingDescriptor: "A LIFE" }]]),
  rules: new Map([["a", { set: 5, unverified: 0 }]]),
  layouts: new Map([["a", { assigned: [{ fileType: "policies", layoutKey: "a_pol", liveVersion: 2 }] }]]),
  status: new Map([["a", { approved: 4, waiting: 0, rowsHeld: 0 }]]),
  fields: new Map([["a", { published: 1, open: 0 }]]),
  guide: new Set(["a"]),
  servicing: new Map([["a", 4]]),
  reports: new Map(),
};

test("a carrier with everything is set up on all eight", () => {
  const setup = carrierSetup("a", full);
  assert.equal(setUpCount(setup), FACETS.length);
  assert.ok(FACETS.every((key) => !needsLook(setup[key])));
});

test("a carrier nobody has touched is missing everything but reports", () => {
  const setup = carrierSetup("b", full);
  for (const key of ["facts", "rules", "layouts", "status", "fields", "guide", "servicing"]) assert.equal(setup[key].state, "missing", key);
  assert.equal(setup.reports.state, "set");
});

test("partial and waiting read as waiting, with what is there", () => {
  const setup = carrierSetup("a", {
    ...full,
    rules: new Map([["a", { set: 5, unverified: 2 }]]),
    status: new Map([["a", { approved: 4, waiting: 1, rowsHeld: 212 }]]),
    servicing: new Map([["a", 2]]),
    reports: new Map([["a", 1]]),
  });
  assert.equal(setup.rules.state, "waiting");
  assert.equal(setup.rules.detail, "5 of 5 · 3 verified");
  assert.equal(setup.status.detail, "1 waiting · 212 rows held");
  assert.equal(setup.servicing.detail, "2 of 4");
  assert.equal(setup.reports.count, 1);
});

test("a failed read is unknown, never missing", () => {
  const setup = carrierSetup("a", { ...full, rules: null, facts: null });
  assert.equal(setup.rules.state, "unknown");
  assert.equal(setup.facts.state, "unknown");
  assert.equal(needsLook(setup.rules), false);
});
