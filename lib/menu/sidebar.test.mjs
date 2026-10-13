// UX-3 · the data-driven sidebar, regrouped by job (2026-10-13, One-Path Plan Phase 2).
//
// The rail is Home, then one heading per job group (Today, Leads, Sales, Book, Money, Data in,
// Partners, Setup), then Settings. Every screen a person can open appears exactly once; a screen not
// built yet does not appear at all (LA-0.3: no placeholders) but stays in the menu definition.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const { AGENT_MENU, buildAgentMenu, menuFeatureKeys } = await import("./definition.ts");
const { buildSidebarTree, initialOpenGroups, NAV_GROUPS, NAV_STANDALONE } = await import("./sidebar.ts");

const ROLES = ["owner", "producer", "assistant", "bookkeeper", "setter"];
const FEATURES = [...new Set(menuFeatureKeys())];
function seeded(seed) {
  let state = seed;
  return () => { state = (state * 1_103_515_245 + 12_345) % 2 ** 31; return state / 2 ** 31; };
}
const random = seeded(20261013);
const featureSets = [
  FEATURES,
  [],
  ...FEATURES.map((feature) => [feature]),
  ...FEATURES.map((feature) => FEATURES.filter((other) => other !== feature)),
  ...Array.from({ length: 60 }, () => FEATURES.filter(() => random() < 0.5)),
];
const keysOf = (tree) => [...tree.home, ...tree.groups.flatMap((group) => group.items), ...tree.settings].map((item) => item.key);

test("every built screen a person may open is in the rail exactly once, and nothing unbuilt is", () => {
  let cases = 0;
  for (const role of ROLES) {
    for (const features of featureSets) {
      const menu = buildAgentMenu(features, role);
      const tree = buildSidebarTree(menu);
      const shown = keysOf(tree);
      const expected = menu.flatMap((section) => section.items).filter((item) => item.built).map((item) => item.key);
      assert.deepEqual([...shown].sort(), [...expected].sort(), `role ${role}, features [${features.join(",")}]`);
      assert.equal(new Set(shown).size, shown.length, "a screen appears twice");
      cases += 1;
    }
  }
  assert.ok(cases > 100, `${cases} cases`);
});

test("the groups run in the job order, Home first and Settings last", () => {
  const tree = buildSidebarTree(buildAgentMenu(FEATURES, "owner"));
  assert.deepEqual(tree.home.map((item) => item.key), ["home.dashboard"]);
  assert.deepEqual(tree.groups.map((group) => group.label), NAV_GROUPS.map((group) => group.section));
  assert.deepEqual(tree.settings.map((item) => item.key), ["settings.root"]);
  // Each group keeps the definition's order inside it.
  const today = tree.groups.find((group) => group.label === "Today");
  assert.deepEqual(today.items.map((item) => item.key), ["leads.floor", "leads.inbound", "leads.dialer", "sell.callbacks", "sell.calendar", "sell.setters"]);
});

test("every section of the definition has a place in the rail", () => {
  const placed = new Set([...NAV_GROUPS.map((group) => group.section), ...Object.values(NAV_STANDALONE)]);
  for (const section of AGENT_MENU) assert.ok(placed.has(section.label), `${section.label} has no group in lib/menu/sidebar.ts`);
});

test("a new menu section appears after the listed groups by data alone", () => {
  const menu = [...AGENT_MENU, { id: "team", label: "Team", items: [{ key: "team.producers", label: "Producers", path: "/app/team", icon: "users", section: "Team", built: true }] }];
  const tree = buildSidebarTree(menu);
  assert.equal(tree.groups.at(-1).label, "Team");
  assert.deepEqual(tree.groups.at(-1).items.map((item) => item.key), ["team.producers"]);
});

test("the group holding the page opens; otherwise the first group does", () => {
  const tree = buildSidebarTree(buildAgentMenu(FEATURES, "owner"));
  const at = (path) => initialOpenGroups(tree, (item) => path === item.path || path.startsWith(`${item.path}/`));
  assert.deepEqual(at("/app/policies"), ["Book"]);
  assert.deepEqual(at("/app/applications/123"), ["Sales"]);
  assert.deepEqual(at("/app/carrier-files"), ["Data in"]);
  assert.deepEqual(at("/app/dashboard"), ["Today"]);
});

test("the sidebar is a renderer: no grouping maps in the component, and every group icon resolves", () => {
  const sidebar = readFileSync(new URL("../../components/app/agent-sidebar.tsx", import.meta.url), "utf8");
  for (const name of ["MODULE_FEATURES", "MODULE_ITEM_ORDER", "NAV_LABELS", "BUSINESS_SECTION_ORDER", "LA1_SHARED_KEYS", "LA2_SHARED_KEYS"]) {
    assert.doesNotMatch(sidebar, new RegExp(`\\b${name}\\b`), `${name} is back in the component`);
  }
  assert.match(sidebar, /buildSidebarTree\(menu, moduleAccess\)/);
  const block = sidebar.slice(sidebar.indexOf("const ICONS = {"), sidebar.indexOf("} as const;", sidebar.indexOf("const ICONS = {")));
  const available = new Set([...block.matchAll(/^\s*"?([a-z-]+)"?:/gm)].map((m) => m[1]));
  assert.deepEqual(NAV_GROUPS.map((group) => group.icon).filter((icon) => !available.has(icon)), []);
});
