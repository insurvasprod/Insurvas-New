// Run with: npm test
//
// Loading ahead what the page on screen links to (owner 2026-11-12: open the page at once, then load "every button,
// sub-page" on it in the background; components/app/warm-page.tsx, lib/client/warm-page-plan.ts,
// lib/client/warm-queue.ts). DB-free and network-free.

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const { WARM_PAGE_MAX, warmPagePlan, warmable } = await import("../client/warm-page-plan.ts");
const { WARM_MEMORY_MS, beginPageWarm, endPageWarm, isCurrentPageWarm, markWarmed, pageWarmIdle, recentlyWarmed } = await import("../client/warm-queue.ts");

const ROOT = process.cwd();
const read = (path) => readFileSync(join(ROOT, path), "utf8");
const ORIGIN = "https://app.insurvas.test";

test("tabs first, then the rail, then the title line's buttons, then the page's other buttons", () => {
  const plan = warmPagePlan([
    { href: "/app/producers/invite", region: "header" },
    { href: "/app/agency/compare?metric=dials", region: "body" },
    { href: "/app/agency?tab=goals", region: "tabs" },
    { href: "/app/bank", region: "rail" },
  ], "/app/agency", ORIGIN);
  assert.deepEqual(plan, ["/app/agency?tab=goals", "/app/bank", "/app/producers/invite", "/app/agency/compare?metric=dials"]);
});

test("never this page, never twice, never a table's rows, never what opts out", () => {
  const plan = warmPagePlan([
    { href: "/app/agency", region: "tabs" },
    { href: "/app/producers", region: "header" },
    { href: `${ORIGIN}/app/producers`, region: "body" },
    { href: "/app/policies/abc", region: "body", inRow: true },
    { href: "/app/settings", region: "body", optOut: true },
  ], "/app/agency", ORIGIN);
  assert.deepEqual(plan, ["/app/producers"]);
});

test("another tab of the same page is loaded ahead (same path, other query)", () => {
  assert.deepEqual(warmPagePlan([{ href: "/app/bank?view=queue", region: "tabs" }], "/app/bank", ORIGIN), ["/app/bank?view=queue"]);
});

test("one page once: a chart's twelve filtered links are its page once; tabs keep each view", () => {
  const plan = warmPagePlan([
    { href: "/app/policies?from=2026-01-01", region: "body" },
    { href: "/app/policies?from=2026-02-01", region: "body" },
    { href: "/app/agency?range=week", region: "body" },
    { href: "/app/bank?view=queue", region: "tabs" },
    { href: "/app/bank?view=accounts", region: "tabs" },
  ], "/app/agency", ORIGIN);
  assert.deepEqual(plan, ["/app/bank?view=queue", "/app/bank?view=accounts", "/app/policies?from=2026-01-01"]);
});

test("only our own pages, and never one that acts by being opened", () => {
  assert.equal(warmable("https://example.com/app/x", ORIGIN), null, "another site");
  assert.equal(warmable("/pricing", ORIGIN), null, "not a portal page");
  assert.equal(warmable("/api/app/notifications", ORIGIN), null, "the API");
  assert.equal(warmable("/app/dialer", ORIGIN), null, "the dialer serves the next lead");
  assert.equal(warmable("/app/leads/1/disposition", ORIGIN), null, "a disposition walk starts on open");
  assert.equal(warmable("/app/tax/print?year=2026", ORIGIN), null, "a print builds a file");
  assert.equal(warmable("/app/logout", ORIGIN), null);
  assert.equal(warmable("/app/producers/invite#x", ORIGIN), "/app/producers/invite", "no hash");
  assert.equal(warmable("/admin/tenants?q=a", ORIGIN), "/admin/tenants?q=a");
  assert.equal(warmable("/partner/leads", ORIGIN), "/partner/leads");
});

test("it is capped", () => {
  const many = Array.from({ length: 40 }, (_, index) => ({ href: `/app/p${index}`, region: "body" }));
  assert.equal(warmPagePlan(many, "/app/x", ORIGIN).length, WARM_PAGE_MAX);
});

test("a page loaded ahead a moment ago is not asked for again", () => {
  markWarmed("/app/one", 1_000);
  assert.equal(recentlyWarmed("/app/one", 1_000 + WARM_MEMORY_MS - 1), true);
  assert.equal(recentlyWarmed("/app/one", 1_000 + WARM_MEMORY_MS), false);
  assert.equal(recentlyWarmed("/app/two", 1_000), false);
});

test("the page's run goes first: the app's warm-up waits for it, and a newer page ends the older run", async () => {
  const first = beginPageWarm();
  let resumed = false;
  const waiting = pageWarmIdle().then(() => { resumed = true; });
  const second = beginPageWarm();
  assert.equal(isCurrentPageWarm(first), false);
  endPageWarm(first);
  await Promise.resolve();
  assert.equal(resumed, false, "an old run ending does not release the app's warm-up");
  endPageWarm(second);
  await waiting;
  assert.equal(resumed, true);
});

test("warm-page runs after each navigation, idle and one at a time, in every shell", () => {
  const source = read("components/app/warm-page.tsx");
  assert.match(source, /^"use client";/);
  assert.match(source, /\[pathname, search, router\]/, "after every navigation");
  assert.match(source, /await pause\(WARM_PAGE_START_MS\)/, "the page's own entrance and reads go first");
  assert.match(source, /requestIdleCallback/);
  assert.match(source, /document\.hidden/);
  assert.match(source, /isSlowConnection\(/);
  assert.match(source, /await pause\(WARM_PAGE_GAP_MS\)/, "a gap after each link");
  assert.doesNotMatch(source, /Promise\.all\(plan/, "never all at once");
  assert.match(read("components/app/warm-app.tsx"), /await pageWarmIdle\(\)/, "the app's warm-up steps aside for the page's");
  for (const layout of ["app/app/(shell)/layout.tsx", "app/admin/(protected)/layout.tsx", "app/partner/(portal)/layout.tsx"]) {
    assert.match(read(layout), /<WarmPage \/>/, layout);
  }
});
