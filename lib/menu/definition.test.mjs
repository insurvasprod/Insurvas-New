// Run with: npm test
//
// The menu promised thirty destinations and six existed. The other twenty-four rendered as ordinary
// links into Next's default 404, so a customer on a plan granting them saw a sidebar where most of
// it was broken — and nothing anywhere said so.
//
// `built: true` now marks the ones with a real screen, which fixes it exactly once. This test is
// what stops it happening again: the flag and the filesystem have to agree, so adding a screen and
// forgetting to flip the flag fails here rather than in front of a customer.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readdirSync, existsSync } from "node:fs";
import { join } from "node:path";

import {
  AGENT_MENU,
  allMenuItems,
  menuItemById,
  menuItemForFeature,
  featureLabel,
  grantedAndBuilt,
  buildAgentMenu,
} from "./definition.ts";

const SHELL = join(process.cwd(), "app", "app", "(shell)");

function routeIds() {
  if (!existsSync(SHELL)) return null;
  return new Set(
    readdirSync(SHELL, { withFileTypes: true })
      .filter((entry) => entry.isDirectory() && !entry.name.startsWith("["))
      .map((entry) => entry.name),
  );
}

test("every menu item marked built has a screen on disk", () => {
  const routes = routeIds();
  if (!routes) return; // running somewhere without the app tree

  const lying = allMenuItems()
    .filter((item) => item.built && !routes.has(item.path.split("/").filter(Boolean).at(-1)))
    .map((item) => item.key);

  assert.deepEqual(lying, [], `marked built but /app/<id> does not exist: ${lying.join(", ")}`);
});

test("every screen on disk is marked built", () => {
  const routes = routeIds();
  if (!routes) return;

  const menuIds = new Map(allMenuItems().map((item) => [item.path.split("/").filter(Boolean).at(-1), item]));
  const unmarked = [...routes].filter((id) => menuIds.has(id) && !menuIds.get(id).built);

  assert.deepEqual(
    unmarked,
    [],
    `a screen exists but the menu still says it is on the way: ${unmarked.join(", ")}`,
  );
});

test("an unbuilt item still reaches the catch-all rather than nowhere", () => {
  // The catch-all resolves by id, so an item whose id is not findable would 404 even though the
  // route exists — which is the original bug wearing a different hat.
  for (const item of allMenuItems()) {
    assert.equal(menuItemById(item.key)?.key, item.key, `${item.key} is not resolvable by key`);
  }
});

test("menu ids are unique — two sections cannot own the same route", () => {
  const ids = allMenuItems().map((item) => item.key);
  assert.equal(new Set(ids).size, ids.length);
});

test("every menu node carries the product contract shape", () => {
  for (const item of allMenuItems()) {
    assert.equal(typeof item.key, "string");
    assert.equal(typeof item.label, "string");
    assert.equal(typeof item.path, "string");
    assert.equal(typeof item.icon, "string");
    assert.equal(typeof item.section, "string");
    assert.equal(item.required_feature === undefined || typeof item.required_feature === "string", true);
  }
});

test("inbound is filtered by its entitlement key, not a plan name", () => {
  const withoutInbound = allMenuItems().filter((item) => item.key === "leads.inbound");
  assert.equal(withoutInbound.length, 1);
  assert.equal(buildAgentMenu(["book_of_business"]).flatMap((section) => section.items).some((item) => item.key === "leads.inbound"), false);
  assert.equal(buildAgentMenu(["inbound_transfers"]).flatMap((section) => section.items).some((item) => item.key === "leads.inbound"), true);
});

test("role filtering is independent from feature filtering", () => {
  const granted = ["book_of_business", "commission_ledger", "outbound_dialing", "settings"];
  const assistant = buildAgentMenu(granted, "assistant").flatMap((section) => section.items);
  const bookkeeper = buildAgentMenu(granted, "bookkeeper").flatMap((section) => section.items);
  assert.ok(!assistant.some((item) => item.key === "book.ledger"));
  assert.ok(!bookkeeper.some((item) => item.key === "leads.dialer"));
  assert.ok(buildAgentMenu(granted, "owner").flatMap((section) => section.items).some((item) => item.key === "settings.root"));
});

test("a feature key resolves to the words the menu uses for it", () => {
  assert.equal(featureLabel("outbound_dialing"), "Dialer");
  assert.equal(featureLabel("chargeback_radar"), "Lapse risk");
});

test("a feature with no menu node is tidied rather than shown raw or hidden", () => {
  assert.equal(featureLabel("some_backend_only_thing"), "Some backend only thing");
});

test("menuItemForFeature finds the item a feature key unlocks", () => {
  assert.equal(menuItemForFeature("outbound_dialing")?.key, "leads.dialer");
  assert.equal(menuItemForFeature("not_a_feature"), null);
});

test("grantedAndBuilt returns only screens that open today", () => {
  const items = grantedAndBuilt(["book_of_business", "outbound_dialing", "quoting"]);
  const ids = items.map((i) => i.key).sort();

  // quoting is granted but unbuilt, so it must not appear; dashboard and settings need no feature.
  assert.deepEqual(ids, ["book.policies", "home.dashboard", "leads.dialer", "leads.workspace", "settings.root"]);
});

test("grantedAndBuilt applies the role gate to built screens too", () => {
  const granted = ["book_of_business", "outbound_dialing"];
  const assistant = grantedAndBuilt(granted, "assistant").map((item) => item.key);
  assert.deepEqual(assistant, ["home.dashboard", "leads.workspace"]);
});

test("grantedAndBuilt with nothing granted still offers the ungated screens", () => {
  const ids = grantedAndBuilt([]).map((i) => i.key).sort();
  assert.deepEqual(ids, ["home.dashboard", "settings.root"]);
});

test("the sidebar still hides sections a plan does not reach at all", () => {
  const menu = buildAgentMenu(["book_of_business"]);
  const sections = menu.map((s) => s.id);
  assert.ok(!sections.includes("accounting"), "Accounting has no granted items and should vanish");
  assert.ok(sections.includes("book"));
});

test("every section has at least one item", () => {
  for (const section of AGENT_MENU) {
    assert.ok(section.items.length > 0, `${section.id} is empty`);
  }
});
