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
      // A settings page (`sidebar: false`) opens from Settings, never the rail (owner decision 2026-10-15).
      const listed = menu.flatMap((section) => section.items).filter((item) => item.built && item.sidebar !== false);
      // A merged page's stand-in shows only when the page's own item is not there (2026-10-26).
      const expected = listed.filter((item) => !item.sidebar_fallback_for || !listed.some((other) => other.key === item.sidebar_fallback_for)).map((item) => item.key);
      assert.deepEqual([...shown].sort(), [...expected].sort(), `role ${role}, features [${features.join(",")}]`);
      assert.equal(new Set(shown).size, shown.length, "a screen appears twice");
      cases += 1;
    }
  }
  assert.ok(cases > 100, `${cases} cases`);
});

test("the groups run in the job order, Home first and Settings last", () => {
  const AGENCY_KEYS = ["agency_dashboard", "team_hierarchy", "lead_assignment", "producer_payouts", "producer_scorecards", "team_qa"];
  const tree = buildSidebarTree(buildAgentMenu(FEATURES.filter((key) => !AGENCY_KEYS.includes(key)), "owner"));
  assert.deepEqual(tree.home.map((item) => item.key), ["home.dashboard"]);
  // Team holds only agency features (Agency Module 0), so a solo plan has no Team group; an agency plan does.
  assert.deepEqual(tree.groups.map((group) => group.label), NAV_GROUPS.map((group) => group.section).filter((section) => section !== "Team"));
  const agency = buildSidebarTree(buildAgentMenu([...FEATURES, "agency_dashboard", "team_hierarchy", "lead_assignment", "producer_payouts", "producer_scorecards", "team_qa"], "owner"));
  assert.deepEqual(agency.groups.map((group) => group.label), NAV_GROUPS.map((group) => group.section));
  assert.deepEqual(agency.home.map((item) => item.key), ["home.dashboard", "home.agency"]);
  assert.deepEqual(tree.settings.map((item) => item.key), ["settings.root"]);
  // Each group keeps the definition's order inside it.
  const today = tree.groups.find((group) => group.label === "Today");
  // The Agent Floor is the Inbound page's second view since 2026-10-25, not its own rail entry.
  assert.deepEqual(today.items.map((item) => item.key), ["leads.inbound", "leads.dialer", "sell.callbacks", "sell.calendar", "sell.setters"]);
});

test("every section of the definition has a place in the rail", () => {
  const placed = new Set([...NAV_GROUPS.map((group) => group.section), ...Object.values(NAV_STANDALONE)]);
  for (const section of AGENT_MENU) assert.ok(placed.has(section.label), `${section.label} has no group in lib/menu/sidebar.ts`);
});

test("a new menu section appears after the listed groups by data alone", () => {
  const menu = [...AGENT_MENU, { id: "example", label: "Example", items: [{ key: "example.page", label: "Example", path: "/app/example", icon: "users", section: "Example", built: true }] }];
  const tree = buildSidebarTree(menu);
  assert.equal(tree.groups.at(-1).label, "Example");
  assert.deepEqual(tree.groups.at(-1).items.map((item) => item.key), ["example.page"]);
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

test("no rail group is long enough to overwhelm, and settings pages stay out of the rail (2026-10-15)", () => {
  for (const role of ROLES) {
    const tree = buildSidebarTree(buildAgentMenu(FEATURES, role));
    for (const group of tree.groups) assert.ok(group.items.length <= 8, `${role}: ${group.label} has ${group.items.length}`);
    const keys = keysOf(tree);
    assert.ok(!keys.includes("accounting.settings") && !keys.includes("book.carrier_rules"), `${role}: a settings page is in the rail`);
  }
  // Still menu destinations: search and page titles find them, under Settings.
  const all = AGENT_MENU.flatMap((section) => section.items);
  assert.equal(all.find((item) => item.key === "book.carrier_rules")?.section, "Settings");
  assert.equal(all.find((item) => item.key === "accounting.settings")?.section, "Settings");
});

test("AG-0.5: a narrowed session inside an agency is not offered the agency's own screens; solo is unchanged", async () => {
  const { AGENCY_OWNER_ONLY_KEYS } = await import("./definition.ts");
  const keys = (menu) => menu.flatMap((section) => section.items.map((item) => item.key));
  const solo = keys(buildAgentMenu(FEATURES, "producer"));
  const narrow = keys(buildAgentMenu(FEATURES, "producer", { agencyNarrow: true }));
  assert.ok([...AGENCY_OWNER_ONLY_KEYS].some((key) => solo.includes(key)), "a solo producer still sees some of them");
  assert.deepEqual(narrow.filter((key) => AGENCY_OWNER_ONLY_KEYS.has(key)), []);
  assert.deepEqual(narrow, solo.filter((key) => !AGENCY_OWNER_ONLY_KEYS.has(key)), "nothing else changes");
  assert.deepEqual(keys(buildAgentMenu(FEATURES, "owner", { agencyNarrow: false })), keys(buildAgentMenu(FEATURES, "owner")));
});

test("AG-0.5: every screen hidden from a narrowed session also refuses it when opened by URL", async () => {
  const { AGENCY_OWNER_ONLY_KEYS } = await import("./definition.ts");
  const hidden = AGENT_MENU.flatMap((section) => section.items).filter((item) => AGENCY_OWNER_ONLY_KEYS.has(item.key));
  assert.equal(hidden.length, AGENCY_OWNER_ONLY_KEYS.size);
  for (const item of hidden) {
    const page = readFileSync(new URL(`../../app/app/(shell)${item.path.replace(/^\/app/, "")}/page.tsx`, import.meta.url), "utf8");
    assert.match(page, /scopeFor\(guard\.context\)\) !== null\) return <RoleGateNotice/, `${item.path} renders for a narrowed session`);
  }
});
