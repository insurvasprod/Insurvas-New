// UX-3 · the data-driven sidebar renders the same tree the hand-written one did.
//
// `legacyTree` below is the grouping logic that lived in components/app/agent-sidebar.tsx until
// 2026-10-03, copied verbatim in behaviour. buildSidebarTree must agree with it for every role and a
// wide spread of entitlements; after that, the legacy copy is only a record and the data is the truth.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const { AGENT_MENU, buildAgentMenu, menuFeatureKeys } = await import("./definition.ts");
const { buildSidebarTree, initialOpenModule, NAV_MODULES, NAV_BUSINESS_GROUPS, NAV_BUSINESS_ICON, NAV_PARTNERS_ICON } = await import("./sidebar.ts");

// ── the old component's logic ────────────────────────────────────────────────────────────────
const MODULE_FEATURES = { la1: new Set(["inbound_transfers"]), la2: new Set(["outbound_dialing", "lead_import", "true_cpa"]) };
const MODULE_ITEM_ORDER = {
  la1: ["leads.floor", "leads.inbound", "leads.workspace", "sell.callbacks", "leads.partner-chat"],
  la2: ["leads.dialer", "leads.import", "leads.lists", "leads.nurture", "leads.assignments", "sell.calendar", "sell.deal-flow", "insight.true-cpa", "insight.vendor-returns", "insight.activity"],
  la3: ["sell.applications", "sell.quoting", "sell.pending", "sell.draft-dates", "insight.sales-performance"],
};
const LA1_SHARED_KEYS = new Set(["leads.workspace", "sell.callbacks"]);
const LA2_SHARED_KEYS = new Set(["sell.deal-flow"]);
const NAV_LABELS = { "home.dashboard": "Home", "leads.inbound": "Inbound inbox", "partners.publishers": "Publishers" };
const BUSINESS_SECTION_ORDER = ["Book of Business", "Leads", "Sell", "Retention", "Insight", "Partners", "Accounting", "Compliance"];
const BUSINESS_SECTION_ICONS = { "Book of Business": "book-open", Leads: "contact-round", Sell: "calculator", Retention: "rotate-ccw", Insight: "chart-no-axes-combined", Partners: "users", Accounting: "landmark", Compliance: "shield-check" };
const orderModuleItems = (items, id) => {
  const order = MODULE_ITEM_ORDER[id];
  return [...items].sort((a, b) => {
    const ai = order.indexOf(a.key); const bi = order.indexOf(b.key);
    return (ai === -1 ? order.length : ai) - (bi === -1 ? order.length : bi);
  });
};

function legacyTree(menu, moduleAccess) {
  const allItems = menu.flatMap((section) => section.items);
  const homeItems = allItems.filter((item) => item.section === "Home");
  const inboundEntitled = moduleAccess?.inbound ?? allItems.some((item) => item.required_feature && MODULE_FEATURES.la1.has(item.required_feature));
  const outboundEntitled = moduleAccess?.outbound ?? allItems.some((item) => item.required_feature && MODULE_FEATURES.la2.has(item.required_feature));
  const la1Items = orderModuleItems(allItems.filter((item) => (item.required_feature && MODULE_FEATURES.la1.has(item.required_feature)) || (inboundEntitled && LA1_SHARED_KEYS.has(item.key))), "la1");
  const la2Items = orderModuleItems(allItems.filter((item) => (item.required_feature && MODULE_FEATURES.la2.has(item.required_feature)) || (outboundEntitled && LA2_SHARED_KEYS.has(item.key))), "la2");
  const la3Items = orderModuleItems(allItems.filter((item) => MODULE_ITEM_ORDER.la3.includes(item.key)), "la3");
  const moduleKeys = new Set([...la1Items, ...la2Items, ...la3Items].map((item) => item.key));
  const partnerItems = allItems.filter((item) => item.section === "Partners" || item.key === "insight.partner-quality");
  const partnerKeys = new Set(partnerItems.map((item) => item.key));
  const settingsItems = allItems.filter((item) => item.section === "Settings");
  const businessItems = allItems.filter((item) => item.section !== "Home" && item.section !== "Settings" && !moduleKeys.has(item.key) && !partnerKeys.has(item.key));
  const entitlement = moduleAccess ?? { inbound: inboundEntitled, outbound: outboundEntitled };
  const moduleOf = (id, items, entitled) => {
    const visible = items.length > 0;
    return { id, keys: items.map((item) => item.key), entitled, status: !entitled ? "Not included" : visible ? "Enabled" : "Role restricted", disabled: !entitled || !visible };
  };
  const modules = [moduleOf("la1", la1Items, entitlement.inbound), moduleOf("la2", la2Items, entitlement.outbound)];
  if (la3Items.length > 0) modules.push(moduleOf("la3", la3Items, la3Items.length > 0));
  const groups = BUSINESS_SECTION_ORDER.map((label) => ({ label, icon: BUSINESS_SECTION_ICONS[label], keys: businessItems.filter((item) => item.section === label).map((item) => item.key) })).filter((group) => group.keys.length > 0);
  const open = (pathname) => {
    const active = (items) => items.some((item) => pathname === item.path || pathname.startsWith(`${item.path}/`));
    const activeModule = active(la1Items) ? "la1" : active(la2Items) ? "la2" : active(la3Items) ? "la3" : null;
    return activeModule ?? (la1Items.length > 0 ? "la1" : la2Items.length > 0 ? "la2" : null);
  };
  return {
    home: homeItems.map((item) => item.key),
    modules,
    business: groups,
    partners: partnerItems.map((item) => item.key),
    settings: settingsItems.map((item) => item.key),
    labels: Object.fromEntries(allItems.map((item) => [item.key, NAV_LABELS[item.key] ?? item.label])),
    open,
  };
}

// ── the new tree, in the same shape ──────────────────────────────────────────────────────────
function newTree(menu, moduleAccess) {
  const tree = buildSidebarTree(menu, moduleAccess);
  return {
    home: tree.home.map((item) => item.key),
    modules: tree.modules.map((module) => ({ id: module.id, keys: module.items.map((item) => item.key), entitled: module.entitled, status: module.status, disabled: module.disabled })),
    business: tree.business.map((group) => ({ label: group.label, icon: group.icon, keys: group.items.map((item) => item.key) })),
    partners: tree.partners.map((item) => item.key),
    settings: tree.settings.map((item) => item.key),
    labels: Object.fromEntries(menu.flatMap((section) => section.items).map((item) => [item.key, item.navLabel ?? item.label])),
    open: (pathname) => initialOpenModule(tree, (item) => pathname === item.path || pathname.startsWith(`${item.path}/`)),
  };
}

const ROLES = ["owner", "producer", "assistant", "bookkeeper", "setter"];
const FEATURES = [...new Set(menuFeatureKeys())];
function seeded(seed) {
  let state = seed;
  return () => { state = (state * 1_103_515_245 + 12_345) % 2 ** 31; return state / 2 ** 31; };
}
const random = seeded(20261003);
const featureSets = [
  FEATURES,
  [],
  ...FEATURES.map((feature) => [feature]),
  ...FEATURES.map((feature) => FEATURES.filter((other) => other !== feature)),
  ...Array.from({ length: 60 }, () => FEATURES.filter(() => random() < 0.5)),
];
const accesses = [undefined, { inbound: true, outbound: true }, { inbound: false, outbound: false }, { inbound: true, outbound: false }, { inbound: false, outbound: true }];
const paths = ["/app/dashboard", "/app/floor", "/app/dialer", "/app/applications/123", "/app/policies", "/app/callbacks", "/app/deal-flow"];

test("the data-driven tree equals the hand-written one for every role and entitlement", () => {
  let cases = 0;
  for (const role of ROLES) {
    for (const features of featureSets) {
      const menu = buildAgentMenu(features, role);
      for (const access of accesses) {
        const was = legacyTree(menu, access);
        const now = newTree(menu, access);
        const where = `role ${role}, features [${features.join(",")}], access ${JSON.stringify(access)}`;
        for (const part of ["home", "modules", "business", "partners", "settings", "labels"]) assert.deepEqual(now[part], was[part], `${part} differs for ${where}`);
        for (const path of paths) assert.equal(now.open(path), was.open(path), `open module on ${path} differs for ${where}`);
        cases += 1;
      }
    }
  }
  assert.ok(cases > 500, `${cases} cases`);
});

test("a new menu section appears under Business by data alone, and a module heading is one entry", () => {
  const menu = [...AGENT_MENU, { id: "team", label: "Team", items: [{ key: "team.producers", label: "Producers", path: "/app/team", icon: "users", section: "Team", built: false }] }];
  const tree = buildSidebarTree(menu);
  const team = tree.business.find((group) => group.label === "Team");
  assert.ok(team, "an unlisted section is not dropped");
  assert.deepEqual(team.items.map((item) => item.key), ["team.producers"]);
  assert.equal(tree.business.at(-1).label, "Team", "it follows the listed groups");
  assert.ok(NAV_MODULES.every((module) => module.id && module.label && module.fullName && module.icon && module.order.length), "every module entry is complete");
});

test("the sidebar is a renderer: no grouping maps left in the component", () => {
  const sidebar = readFileSync(new URL("../../components/app/agent-sidebar.tsx", import.meta.url), "utf8");
  for (const name of ["MODULE_FEATURES", "MODULE_ITEM_ORDER", "MODULE_COPY", "NAV_LABELS", "BUSINESS_SECTION_ORDER", "LA1_SHARED_KEYS", "LA2_SHARED_KEYS"]) {
    assert.doesNotMatch(sidebar, new RegExp(`\\b${name}\\b`), `${name} is back in the component`);
  }
  assert.match(sidebar, /buildSidebarTree\(menu, moduleAccess\)/);
  // Every icon this file names resolves in the sidebar's ICONS map (a missing one renders a blank circle).
  const block = sidebar.slice(sidebar.indexOf("const ICONS = {"), sidebar.indexOf("} as const;", sidebar.indexOf("const ICONS = {")));
  const available = new Set([...block.matchAll(/^\s*"?([a-z-]+)"?:/gm)].map((m) => m[1]));
  const named = [...NAV_MODULES.map((module) => module.icon), ...NAV_BUSINESS_GROUPS.map((group) => group.icon), NAV_BUSINESS_ICON, NAV_PARTNERS_ICON];
  assert.deepEqual(named.filter((icon) => !available.has(icon)), []);
});
