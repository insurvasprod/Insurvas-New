// Data in, one page (owner 2026-11-02, "like Reports and Compliance"): the four Data in pages are steps of one
// frame with a rail. Run with: node --experimental-strip-types --test lib/dataIn/dataInFlow.test.mjs

import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { DATA_IN_STEPS, dataInStepOf } from "./steps.ts";
import { AGENT_MENU } from "../menu/definition.ts";
import { buildSidebarTree } from "../menu/sidebar.ts";

const read = (p) => readFileSync(join(process.cwd(), p), "utf8").replace(/\r\n/g, "\n");
const ROUTES = { files: "carrier-files", import: "book-import", matching: "policy-matching", exceptions: "exceptions" };

test("every step keeps its old address and renders inside the frame, under its own gate", () => {
  for (const step of DATA_IN_STEPS) {
    assert.equal(step.href, `/app/${ROUTES[step.key]}`);
    assert.equal(dataInStepOf(step.href), step.key);
    const page = read(`app/app/(shell)/${ROUTES[step.key]}/page.tsx`);
    assert.match(page, new RegExp(`<DataInPage\\s+step="${step.key}"`), step.key);
    assert.match(page, /guardPage\("statement_ingestion"\)/, `${step.key} keeps its own gate`);
    assert.doesNotMatch(page, /<PageHeader\b/, `${step.key}: the frame draws the one title`);
  }
  // A file's own pages are records, not steps.
  assert.equal(dataInStepOf("/app/carrier-files/file/abc"), null);
});

test("the frame opens each step by the rule its route applies", () => {
  const frame = read("components/app/data-in/data-in-page.tsx");
  assert.match(frame, /actAsPagePermission\(guard, "statements\.view"\)/);
  assert.match(frame, /actAsPagePermission\(guard, "policies\.view"\) && \(await scopeFor\(guard\.context\)\) === null/);
  assert.match(read("app/app/(shell)/exceptions/page.tsx"), /actAsPagePermission\(guard, "policies\.view"\)/);
});

test("the rail's badges come from a registered, gated route that counts under each step's own rule", () => {
  const route = read("app/api/app/data-in/steps/route.ts");
  assert.match(route, /requireFeatureRole\("statement_ingestion", ROLES/);
  // Files and reviews are the owner's and bookkeepers'; a producer counts only their own exceptions; a narrow agency session none.
  assert.match(route, /keeper \? head\(count\("file_registry"\)/);
  assert.match(route, /keeper \? head\(count\("policy_match_review"\)/);
  assert.match(route, /narrow \? null : head\(\(keeper \? count\("queue_item"\) : count\("queue_item"\)\.eq\("assigned_to_user_id", userId\)\)/);
  assert.match(read("lib/entitlements/agentApiPolicy.ts"), /app\/api\/app\/data-in\/steps\/route\.ts", featureKey: "statement_ingestion"/);
  assert.match(read("components/app/data-in/data-in-page.tsx"), /countsUrl: "\/api\/app\/data-in\/steps"/);
});

test("the sidebar shows one Data in link; a later page stands in only for someone who cannot open the one before", () => {
  const items = AGENT_MENU.find((section) => section.id === "data").items;
  for (const entry of items) assert.equal(entry.groupLink, true, entry.key);
  assert.deepEqual(items.map((entry) => entry.sidebar_fallback_for ?? null), [null, "book.carrier_files", "book.import", "book.policy_matching"]);
  const owner = buildSidebarTree([{ id: "data", label: "Data in", items }]);
  assert.deepEqual(owner.groups.find((g) => g.label === "Data in").items.map((i) => i.key), ["book.carrier_files"]);
  // A producer opens Exceptions only, and still gets the one link.
  const producer = buildSidebarTree([{ id: "data", label: "Data in", items: items.filter((i) => i.key === "book.exceptions") }]);
  assert.deepEqual(producer.groups.find((g) => g.label === "Data in").items.map((i) => i.key), ["book.exceptions"]);
  assert.match(read("components/app/agent-sidebar.tsx"), /dataInStepOf\(href\) && dataInStepOf\(pathname\)/);
  assert.match(read("components/ui/page-trail.tsx"), /label: "Data in", href: DATA_IN_STEPS\[0\]\?\.href/);
});
