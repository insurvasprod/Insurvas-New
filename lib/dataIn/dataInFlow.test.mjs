// Book of business, one area (owner 2026-11-02, round 2; it was "Data in"): Files, Needs you, Policies and Setup
// are steps of one frame with a rail. Run with: node --experimental-strip-types --test lib/dataIn/dataInFlow.test.mjs

import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { DATA_IN_STEPS, bookAreaOf, dataInStepOf } from "./steps.ts";
import { AGENT_MENU } from "../menu/definition.ts";
import { buildSidebarTree } from "../menu/sidebar.ts";

const read = (p) => readFileSync(join(process.cwd(), p), "utf8").replace(/\r\n/g, "\n");
const ROUTES = { files: "carrier-files", "needs-you": "needs-you", policies: "policies", setup: "book-setup" };

test("every step has its own address and renders inside the frame, under its own gate", () => {
  for (const step of DATA_IN_STEPS) {
    assert.equal(step.href, `/app/${ROUTES[step.key]}`);
    assert.equal(dataInStepOf(step.href), step.key);
    const page = read(`app/app/(shell)/${ROUTES[step.key]}/page.tsx`);
    assert.match(page, new RegExp(`<DataInPage\\s+step="${step.key}"`), step.key);
    assert.match(page, /guardPage\("(statement_ingestion|book_of_business)"\)/, `${step.key} keeps its own gate`);
    assert.doesNotMatch(page, /<PageHeader\b/, `${step.key}: the frame draws the one title`);
  }
});

test("the older pages keep their addresses inside the new steps", () => {
  assert.equal(dataInStepOf("/app/policy-matching"), "needs-you");
  assert.equal(dataInStepOf("/app/exceptions"), "needs-you");
  assert.equal(dataInStepOf("/app/book-import"), "setup");
  for (const [route, step] of [["policy-matching", "needs-you"], ["exceptions", "needs-you"], ["book-import", "setup"]]) {
    assert.match(read(`app/app/(shell)/${route}/page.tsx`), new RegExp(`<DataInPage step="${step}"`), route);
  }
});

test("a record is a detail page under its step: the area stays lit, but it is not a step of its own", () => {
  assert.equal(dataInStepOf("/app/carrier-files/file/abc"), null);
  assert.equal(bookAreaOf("/app/carrier-files/file/abc"), "files");
  assert.equal(bookAreaOf("/app/policies/carrier/c/AM-1"), "policies");
  assert.equal(bookAreaOf("/app/needs-you/match/1"), "needs-you");
  assert.equal(bookAreaOf("/app/dashboard"), null);
});

test("the frame opens each step by the rule its route applies", () => {
  const frame = read("components/app/data-in/data-in-page.tsx");
  assert.match(frame, /actAsPagePermission\(files, "statements\.view"\)/);
  assert.match(frame, /actAsPagePermission\(files, "policies\.view"\)/);
  assert.match(frame, /actAsPage\(book, \["owner", "producer", "bookkeeper"\]\)/);
  assert.match(read("app/app/(shell)/exceptions/page.tsx"), /actAsPagePermission\(guard, "policies\.view"\)/);
});

test("the rail's badges come from a registered, gated route that counts under each step's own rule", () => {
  const route = read("app/api/app/data-in/steps/route.ts");
  assert.match(route, /requireFeatureRole\("statement_ingestion", ROLES/);
  assert.match(route, /keeper \? head\(count\("file_registry"\)/);
  assert.match(route, /keeper \? head\(count\("policy_match_review"\)/);
  assert.match(route, /narrow \? null : head\(\(keeper \? count\("queue_item"\) : count\("queue_item"\)\.eq\("assigned_to_user_id", userId\)\)/);
  assert.match(read("lib/entitlements/agentApiPolicy.ts"), /app\/api\/app\/data-in\/steps\/route\.ts", featureKey: "statement_ingestion"/);
  assert.match(read("components/app/data-in/data-in-page.tsx"), /countsUrl: "\/api\/app\/data-in\/steps"/);
});

test("the sidebar shows one Book of business link; a later step stands in only for someone who cannot open the one before", () => {
  const section = AGENT_MENU.find((entry) => entry.id === "data");
  assert.equal(section.label, "Book of business");
  const items = section.items;
  for (const entry of items) assert.equal(entry.groupLink, true, entry.key);
  assert.deepEqual(items.map((entry) => entry.key), ["book.carrier_files", "book.needs_you", "book.policies", "book.setup"]);
  assert.deepEqual(items.map((entry) => entry.sidebar_fallback_for ?? null), [null, "book.carrier_files", "book.needs_you", "book.policies"]);
  const owner = buildSidebarTree([{ id: "data", label: "Book of business", items }]);
  assert.deepEqual(owner.groups.find((g) => g.label === "Book of business").items.map((i) => i.key), ["book.carrier_files"]);
  // A producer opens Needs you and Policies, and still gets the one link.
  const producer = buildSidebarTree([{ id: "data", label: "Book of business", items: items.filter((i) => i.key === "book.needs_you" || i.key === "book.policies") }]);
  assert.deepEqual(producer.groups.find((g) => g.label === "Book of business").items.map((i) => i.key), ["book.needs_you"]);
  assert.match(read("components/app/agent-sidebar.tsx"), /dataInStepOf\(href\) && bookAreaOf\(pathname\)/);
  assert.match(read("components/ui/page-trail.tsx"), /label: BOOK_AREA_LABEL, href: DATA_IN_STEPS\[0\]\?\.href/);
});
