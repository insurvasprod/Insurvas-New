// Run with: npm test
//
// Loading ahead after sign-in (2026-11-12, "every page opens instantly"; components/app/warm-app.tsx and
// lib/client/warm-plan.ts): it warms only what this person's menu holds, it waits for an idle browser, it goes one
// thing at a time and it is capped. And every top-level area has its own loading frame. DB-free and network-free.

import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

const { AGENT_MENU, buildAgentMenu } = await import("../menu/definition.ts");
const { buildSidebarTree } = await import("../menu/sidebar.ts");
const { WARM_DATA_MAX, WARM_FRAMES_MAX, isSlowConnection, menuDestinations, warmPlan } = await import("../client/warm-plan.ts");

const ROOT = process.cwd();
const read = (path) => readFileSync(join(ROOT, path), "utf8");
const warmApp = read("components/app/warm-app.tsx");

const allFeatures = [...new Set(AGENT_MENU.flatMap((section) => section.items.map((item) => item.required_feature).filter(Boolean)))];

test("warm-app reads the server-filtered menu the sidebar draws, through the sidebar's own tree", () => {
  assert.match(warmApp, /buildSidebarTree\(menuRef\.current\)/);
  assert.match(warmApp, /warmPlan\(/);
  const layout = read("app/app/(shell)/layout.tsx");
  assert.match(layout, /<WarmApp menu=\{menu\}/, "mounted in the shell with the same `menu` the sidebar gets");
  assert.match(layout, /<AgentSidebar\s+menu=\{menu\}/);
});

test("only pages on this person's menu are warmed", () => {
  // A setter on a dialer-only plan: no Policies, no Accounting, no Settings sections they cannot open.
  const menu = buildAgentMenu(["outbound_dialing"], "setter");
  const tree = buildSidebarTree(menu);
  const allowed = new Set(menuDestinations(tree));
  const { frames, data } = warmPlan(tree, "/app/dashboard");
  for (const path of [...frames, ...data]) assert.ok(allowed.has(path), `${path} is not on this menu`);
  assert.ok(!data.includes("/app/policies"), "Policies is not this setter's");
  assert.ok(!frames.includes("/app/accounting"));
  // Nothing the shell hides (a settings-only page, an unbuilt one).
  const shown = new Set(menu.flatMap((section) => section.items).filter((item) => item.built && item.sidebar !== false).map((item) => item.path));
  for (const path of allowed) assert.ok(shown.has(path), `${path} is not a rail page of this menu`);
});

test("the page on screen is not warmed again, and the data warm-up is the most-used pages", () => {
  const tree = buildSidebarTree(buildAgentMenu(allFeatures, "owner"));
  const { frames, data } = warmPlan(tree, "/app/dashboard");
  assert.ok(!frames.includes("/app/dashboard"));
  assert.ok(!data.includes("/app/dashboard"));
  assert.deepEqual(data.slice(0, 4), ["/app/leads", "/app/callbacks", "/app/dialer", "/app/policies"]);
  assert.equal(data.length, 5, "the four above and the first Reports view");
  assert.equal(data[4], tree.groups.find((group) => group.label === "Reports").items[0].path);
});

test("it is capped", () => {
  assert.ok(WARM_DATA_MAX <= 6, "the 5–6 most-used pages, no more");
  assert.ok(WARM_FRAMES_MAX <= 64);
  const tree = buildSidebarTree(buildAgentMenu(allFeatures, "owner"));
  const { frames, data } = warmPlan(tree, "/app/settings");
  assert.ok(frames.length <= WARM_FRAMES_MAX);
  assert.ok(data.length <= WARM_DATA_MAX);
  assert.equal(new Set(frames).size, frames.length, "each page once");
});

test("it waits for an idle browser after hydration, goes one at a time and steps aside", () => {
  assert.match(warmApp, /^"use client";/);
  assert.match(warmApp, /useEffect\(/, "starts after hydration");
  assert.match(warmApp, /requestIdleCallback/, "idle-scheduled");
  assert.match(warmApp, /await pause\(WARM_START_MS\)/, "the first page's own reads go first");
  assert.match(warmApp, /await pause\(WARM_FRAME_GAP_MS\)/, "a gap after each frame");
  assert.match(warmApp, /await pause\(WARM_DATA_GAP_MS\)/, "a gap after each page's data");
  assert.match(warmApp, /Promise\.allSettled/, "a page's reads finish before the next page's start");
  assert.match(warmApp, /document\.hidden/, "paused while the tab is hidden");
  assert.match(warmApp, /isSlowConnection\(/, "not on data saver or 2G");
  assert.match(warmApp, /warmedFor === scope/, "once per person and workspace");
  // No fan-out: never all at once.
  assert.doesNotMatch(warmApp, /Promise\.all\((frames|data)/);
  assert.doesNotMatch(warmApp, /\.forEach\(/);
});

test("a slow connection is recognised", () => {
  assert.equal(isSlowConnection(undefined), false);
  assert.equal(isSlowConnection({ effectiveType: "4g" }), false);
  assert.equal(isSlowConnection({ saveData: true, effectiveType: "4g" }), true);
  assert.equal(isSlowConnection({ effectiveType: "2g" }), true);
  assert.equal(isSlowConnection({ effectiveType: "slow-2g" }), true);
});

test("every top-level area has its own loading frame", () => {
  const areas = ["dashboard", "leads", "applications", "policies", "retention", "statements", "accounting", "compliance", "sales-performance", "publishers", "partner-chat", "settings"];
  for (const area of areas) {
    const path = `app/app/(shell)/${area}/loading.tsx`;
    assert.ok(existsSync(join(ROOT, path)), `${path} is missing`);
    assert.match(read(path), /<AreaLoading \/>/, `${path} draws the area frame`);
  }
  const frame = read("components/app/area-loading.tsx");
  assert.match(frame, /<ShellLoading \/>/, "a remembered rail and title are redrawn as before");
  assert.match(frame, /PageLoading header=\{false\}/, "built from the one loading look");
});
