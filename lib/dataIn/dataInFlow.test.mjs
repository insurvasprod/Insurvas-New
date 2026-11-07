// Book of business, one area (owner 2026-11-02, round 2; it was "Data in"): Files, Needs you, Policies and Setup
// are steps of one frame with a rail. Run with: node --experimental-strip-types --test lib/dataIn/dataInFlow.test.mjs

import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { AREA_LABELS, DATA_IN_STEPS, areaSteps, bookAreaOf, dataInAreaOf, dataInStepOf } from "./steps.ts";
import { AGENT_MENU } from "../menu/definition.ts";
import { buildSidebarTree } from "../menu/sidebar.ts";

const read = (p) => readFileSync(join(process.cwd(), p), "utf8").replace(/\r\n/g, "\n");
const ROUTES = { files: "carrier-files", "needs-you": "needs-you", policies: "policies", ledger: "ledger", "rate-card": "book-setup", "carrier-rules": "book-setup/carrier-rules", "pipeline-rules": "book-setup/pipeline-rules", "agent-codes": "book-setup/agent-codes", "files-in": "book-setup/how-files-arrive" };

test("two areas: Book of business is Carrier files, Policies and the Commission ledger; Carrier sync is Needs you and Setup (owner 2026-11-05)", () => {
  assert.deepEqual(areaSteps("book").map((step) => step.key), ["files", "policies", "ledger"]);
  // Setup's five tabs sit on the rail next to Needs you (owner 2026-11-05: "remove setup").
  assert.deepEqual(areaSteps("sync").map((step) => step.key), ["needs-you", "rate-card", "carrier-rules", "pipeline-rules", "agent-codes", "files-in"]);
  assert.equal(bookAreaOf("/app/book-setup/carrier-rules/abc"), "carrier-rules");
  assert.equal(bookAreaOf("/app/book-setup/pipeline-rules/new"), "pipeline-rules");
  assert.equal(AREA_LABELS.book, "Book of business");
  assert.equal(AREA_LABELS.sync, "Carrier sync");
  assert.equal(dataInAreaOf("/app/ledger"), "book");
  assert.equal(dataInAreaOf("/app/book-setup/pipeline-rules"), "sync");
  assert.equal(dataInAreaOf("/app/needs-you/match/1"), "sync");
  // Lapse risk is a Needs you view, so it lights Carrier sync.
  assert.equal(dataInStepOf("/app/lapse-risk"), "needs-you");
});

test("every step has its own address and renders inside the frame, under its own gate", () => {
  for (const step of DATA_IN_STEPS) {
    assert.equal(step.href, `/app/${ROUTES[step.key]}`);
    assert.equal(dataInStepOf(step.href), step.key);
    const page = read(`app/app/(shell)/${ROUTES[step.key]}/page.tsx`);
    assert.match(page, new RegExp(`<DataInPage\\s+step="${step.key}"`), step.key);
    assert.match(page, /guardPage\("(statement_ingestion|book_of_business|commission_ledger)"\)/, `${step.key} keeps its own gate`);
    assert.doesNotMatch(page, /<PageHeader\b/, `${step.key}: the frame draws the one title`);
  }
});

test("the older pages keep their addresses inside the new steps", () => {
  assert.equal(dataInStepOf("/app/policy-matching"), "needs-you");
  assert.equal(dataInStepOf("/app/exceptions"), "needs-you");
  assert.equal(dataInStepOf("/app/book-import"), "files-in");
  for (const [route, step] of [["policy-matching", "needs-you"], ["exceptions", "needs-you"], ["book-setup/how-files-arrive", "files-in"]]) {
    assert.match(read(`app/app/(shell)/${route}/page.tsx`), new RegExp(`<DataInPage step="${step}"`), route);
  }
  // Import your book is the "Bring your existing book" section of Setup › Files in (board 8): the old address renders it.
  assert.match(read("app/app/(shell)/book-import/page.tsx"), /import SetupFilesInPage from "\.\.\/book-setup\/how-files-arrive\/page";[\s\S]*if \(!actAsPagePermission\(guard, "statements\.view"\) \|\| !actAsPage\(guard, \["owner", "bookkeeper"\]\)\) return <RoleGateNotice [\s\S]*return <SetupFilesInPage \{\.\.\.props\} \/>;/);
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
  // The Rate card (Setup's first tab), Statements (open from Files) and the Attribution queue (Needs you's Credit) are
  // never sidebar links.
  for (const key of ["book.rate_card", "book.statements", "commissions.attribution"]) assert.equal(section.items.find((entry) => entry.key === key)?.sidebar, false, key);
  const items = section.items.filter((entry) => entry.sidebar !== false);
  for (const entry of items) assert.equal(entry.groupLink, true, entry.key);
  assert.deepEqual(items.map((entry) => entry.key), ["book.carrier_files", "book.policies", "book.ledger"]);
  assert.deepEqual(items.map((entry) => entry.sidebar_fallback_for ?? null), [null, "book.carrier_files", "book.policies"]);
  const owner = buildSidebarTree([{ id: "data", label: "Book of business", items }]);
  assert.deepEqual(owner.groups.find((g) => g.label === "Book of business").items.map((i) => i.key), ["book.carrier_files"]);
  // A producer opens Policies and the ledger, and still gets the one link.
  const producer = buildSidebarTree([{ id: "data", label: "Book of business", items: items.filter((i) => i.key === "book.ledger" || i.key === "book.policies") }]);
  assert.deepEqual(producer.groups.find((g) => g.label === "Book of business").items.map((i) => i.key), ["book.policies"]);
  assert.match(read("components/app/agent-sidebar.tsx"), /dataInStepOf\(href\) && bookAreaOf\(pathname\) && dataInAreaOf\(href\) === dataInAreaOf\(pathname\)/);
  assert.match(read("components/ui/page-trail.tsx"), /label: AREA_LABELS\[area\], href: areaSteps\(area\)\[0\]\?\.href/);
});

test("the sidebar shows one Carrier sync link: Needs you, then Setup, then Lapse risk for a retention rep", () => {
  const section = AGENT_MENU.find((entry) => entry.id === "sync");
  assert.equal(section.label, "Carrier sync");
  for (const entry of section.items) assert.equal(entry.groupLink, true, entry.key);
  assert.deepEqual(section.items.map((entry) => entry.key), ["book.needs_you", "book.setup", "retention.lapse-risk"]);
  assert.deepEqual(section.items.map((entry) => entry.sidebar_fallback_for ?? null), [null, "book.needs_you", "book.setup"]);
  const owner = buildSidebarTree([{ id: "sync", label: "Carrier sync", items: section.items }]);
  assert.deepEqual(owner.groups.find((g) => g.label === "Carrier sync").items.map((i) => i.key), ["book.needs_you"]);
  const rep = buildSidebarTree([{ id: "sync", label: "Carrier sync", items: section.items.filter((i) => i.key === "retention.lapse-risk") }]);
  assert.deepEqual(rep.groups.find((g) => g.label === "Carrier sync").items.map((i) => i.key), ["retention.lapse-risk"]);
});
