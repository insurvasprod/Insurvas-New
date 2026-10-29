// LA-8.1 (Notion sprint, Module 8 — Settings) · the settings shell, registry and search.
// Run with: node --experimental-strip-types --test lib/settings/registry.test.mjs

import test from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

import { SETTINGS_SECTIONS } from "./sections.ts";
import { groupSections, itemHref, parseSettingsHash, searchSettings, sectionHref, SETTINGS_GROUPS, visibleSections } from "./registry.ts";

const root = process.cwd();
const read = (p) => readFileSync(join(root, p), "utf8").replace(/\r\n/g, "\n");
const EVERY_FEATURE = [...new Set(SETTINGS_SECTIONS.map((s) => s.required_feature).filter(Boolean))];
const ids = (list) => list.map((s) => s.id);

// The files that make up LA-8.1 itself. Registering a section must touch none of them.
const SHELL_FILES = ["lib/settings/registry.ts", "components/app/agent-settings-tabs.tsx", "app/app/(shell)/settings/page.tsx", "components/app/settings/settings-trail.tsx", "lib/settings/revealAnchor.ts"];

test("a section registered anywhere appears, grouped and searchable, with no change to the shell", () => {
  const made = { id: "made-up-hub", label: "Made-up hub", group: "Platform", route: "/app/made-up", sort_order: 5, owned_by_module: "LA-99.1", description: "A section no LA-8 file knows.", search_keywords: ["zebra"], items: [{ label: "Stripe width", anchor: "stripe-width", keywords: ["stripes"] }] };
  const list = [...SETTINGS_SECTIONS, made];
  const visible = visibleSections(list, EVERY_FEATURE, "owner");
  assert.ok(visible.some((s) => s.id === "made-up-hub"));
  // LA-8.7 put the first section in Platform; the made-up one joins it, in sort order.
  assert.deepEqual(groupSections(visible).at(-1), { group: "Platform", items: [made, ...["integrations", "settings-history"].map((id) => SETTINGS_SECTIONS.find((s) => s.id === id))] }, "it lands in its group, in sort order");
  assert.equal(searchSettings(list, EVERY_FEATURE, "owner", "zebra")[0].href, "/app/made-up");
  assert.equal(searchSettings(list, EVERY_FEATURE, "owner", "stripes")[0].href, "/app/made-up#stripe-width");
  for (const file of SHELL_FILES) assert.doesNotMatch(read(file), /made-up-hub/, file);
  // The shell draws what it is handed: it imports the section type, never the list.
  assert.doesNotMatch(read("components/app/agent-settings-tabs.tsx"), /import \{[^}]*SETTINGS_SECTIONS/);
  assert.doesNotMatch(read("lib/settings/registry.ts"), /import \{[^}]*SETTINGS_SECTIONS/);
});

test("LA-8.1 reads and writes no setting value: the shell only knows where settings live", () => {
  for (const file of ["lib/settings/registry.ts", "lib/settings/sections.ts", "components/app/agent-settings-tabs.tsx", "components/app/settings/settings-trail.tsx", "lib/settings/revealAnchor.ts"]) {
    const src = read(file);
    assert.doesNotMatch(src, /fetch\(|\/api\/|getSupabase|\.from\(/, `${file} touches settings data`);
  }
  // One home per setting: no two sections claim the same screen.
  const homes = SETTINGS_SECTIONS.map(sectionHref);
  assert.equal(new Set(homes).size, homes.length);
});

test("absent, not greyed out: gating is the menu's, and an empty group renders nothing", () => {
  const producer = visibleSections(SETTINGS_SECTIONS, EVERY_FEATURE, "producer");
  assert.deepEqual(ids(producer), ["my-profile"]);
  assert.deepEqual(groupSections(producer).map((g) => g.group), ["Your account"], "no bare Agency, Carriers or Money heading");
  assert.deepEqual(ids(visibleSections(SETTINGS_SECTIONS, EVERY_FEATURE, "bookkeeper")), ["my-profile", "accounting"]);
  const owner = visibleSections(SETTINGS_SECTIONS, EVERY_FEATURE, "owner");
  assert.equal(owner.length, SETTINGS_SECTIONS.length);
  assert.deepEqual([...new Set(owner.map((s) => s.group))], ["Your account", "Agency", "Contracting", "Sales process", "Leads & dialing", "Money & compliance", "Platform"], "groups in their fixed order");
  // Owner decision 2026-10-15: no group long enough to push the last sections off the screen.
  for (const run of groupSections(owner)) assert.ok(run.items.length <= 8, `${run.group} has ${run.items.length}`);
  // A plan without the feature has no section for it — not a disabled one.
  const noAccounting = visibleSections(SETTINGS_SECTIONS, EVERY_FEATURE.filter((f) => f !== "profit_and_loss"), "owner");
  assert.ok(!noAccounting.some((s) => s.id === "accounting"));
  assert.ok(visibleSections([{ ...SETTINGS_SECTIONS[0], disabled: "off" }], [], "owner").length === 0);
  assert.deepEqual(SETTINGS_GROUPS, ["Your account", "Agency", "Contracting", "Sales process", "Leads & dialing", "Money & compliance", "Platform"]);
  // The shared frame draws registry groups rather than adding a second set to the tab component.
  assert.match(read("components/app/settings/settings-page-frame.tsx"), /const groups = groupSections\(sections\);/);
  assert.match(read("components/app/agent-settings-tabs.tsx"), /const visible = useMemo\(\(\) => visibleSections\(tabs, granted, role\), \[tabs, granted, role\]\);/);
});

test("plan & billing, integrations and the audit log are the owner's", () => {
  for (const id of ["billing", "integrations", "audit-log"]) {
    const section = SETTINGS_SECTIONS.find((s) => s.id === id);
    if (section) assert.deepEqual([...section.required_roles], ["owner"], id);
  }
  assert.ok(SETTINGS_SECTIONS.some((s) => s.id === "billing"));
  // Settings itself opens for every role; what is inside it is gated per section.
  const menu = read("lib/menu/definition.ts");
  assert.match(menu, /key: "settings\.root", label: "Settings", path: "\/app\/settings", icon: "settings", built: true \}\)/);
  assert.doesNotMatch(read("app/app/(shell)/settings/page.tsx"), /guardPage\(|RoleGateNotice/);
});

test("search matches labels, descriptions, keywords and single settings, and lands on the setting", () => {
  const owner = (q) => searchSettings(SETTINGS_SECTIONS, EVERY_FEATURE, "owner", q);
  // The spec's three examples.
  assert.equal(owner("draft date")[0].href, "/app/settings#sales-preferences/qa-buffer");
  assert.equal(owner("DNC")[0].href, "/app/compliance/settings#gate");
  assert.equal(owner("what do I owe Apex")[0].href, "/app/accounting-settings#partner-payouts");
  // A label, a description word, a keyword.
  assert.equal(owner("Dispositions")[0].href, "/app/settings#pipelines", "Dispositions joined Pipelines & outcomes (2026-10-27)");
  assert.ok(owner("retry").some((h) => h.href === "/app/settings#cadence"));
  assert.ok(owner("narrowing").some((h) => h.href === "/app/settings#calling-windows"), "a description word");
  assert.ok(owner("1099").some((h) => h.href === "/app/accounting-settings#tax"));
  assert.deepEqual(owner("   "), []);
  assert.equal(owner("draft date")[0].title, "Settings › Quote & QA rules › Draft-date buffer");
});

test("search never offers a setting the person cannot open", () => {
  const as = (role, q, features = EVERY_FEATURE) => searchSettings(SETTINGS_SECTIONS, features, role, q).map((h) => h.href);
  assert.deepEqual(as("producer", "draft date"), []);
  assert.deepEqual(as("producer", "DNC"), []);
  assert.deepEqual(as("setter", "owe"), []);
  assert.ok(as("bookkeeper", "owe").includes("/app/accounting-settings#partner-payouts"));
  assert.deepEqual(as("owner", "owe", EVERY_FEATURE.filter((f) => f !== "profit_and_loss")), []);
  assert.ok(as("producer", "phone number").includes("/app/settings#my-profile"));
});

test("every anchor exists on the screen it points at", () => {
  const walk = (dir) => readdirSync(join(root, dir)).flatMap((name) => {
    const path = `${dir}/${name}`;
    return statSync(join(root, path)).isDirectory() ? walk(path) : /\.tsx$/.test(name) ? [path] : [];
  });
  const components = walk("components/app").map(read).join("\n");
  const accounting = read("components/app/accounting/accounting-settings-board.tsx");
  const accountingIds = new Set([...accounting.matchAll(/section\("([^"]+)"/g)].map((m) => m[1].toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "")));
  for (const m of accounting.matchAll(/, "([a-z-]+)"\)\}/g)) accountingIds.add(m[1]);
  const compliance = read("components/app/compliance/compliance-settings.tsx");
  const complianceTabs = JSON.parse(compliance.match(/const SECTIONS = (\[[^\]]+\]) as const;/)[1]);
  // LA-5.11: each hub section is drawn by section("<id>", …), whose id is the anchor.
  const retentionIds = new Set([...read("components/app/retention/retention-settings-board.tsx").matchAll(/section\("([a-z-]+)"/g)].map((m) => m[1]));
  for (const section of SETTINGS_SECTIONS) {
    for (const item of section.items ?? []) {
      const where = `${section.id} › ${item.label} (#${item.anchor})`;
      if (!section.route) assert.ok(components.includes(`id="${item.anchor}"`), where);
      else if (section.route === "/app/accounting-settings") assert.ok(accountingIds.has(item.anchor), where);
      else if (section.route === "/app/compliance/settings") assert.ok(complianceTabs.includes(item.anchor), where);
      else if (section.route === "/app/profile") assert.ok(components.includes(`id="${item.anchor}"`), where);
      else if (section.route === "/app/retention-settings") assert.ok(retentionIds.has(item.anchor), where);
      else assert.fail(`${where}: add a check for ${section.route}`);
    }
  }
  assert.match(compliance, /<div id=\{tab\} className=/, "the compliance tab is the anchor's element");
  assert.equal(itemHref({ id: "sales-preferences" }, { anchor: "qa-buffer" }), "/app/settings#sales-preferences/qa-buffer");
  assert.equal(sectionHref({ id: "x", route: "/app/y" }), "/app/y");
  assert.deepEqual(parseSettingsHash("#sales-preferences/qa-buffer"), { tab: "sales-preferences", anchor: "qa-buffer" });
  assert.deepEqual(parseSettingsHash("cadence"), { tab: "cadence", anchor: null });
});

test("dedicated Settings screens use the shared frame and shell breadcrumb behind their own gate", () => {
  for (const section of SETTINGS_SECTIONS.filter((s) => s.route)) {
    const page = read(`app/app/(shell)${section.route.replace(/^\/app/, "")}/page.tsx`);
    assert.match(page, /<SettingsPageFrame\b/, `${section.route} has no shared Settings frame`);
    assert.match(page, new RegExp(`activeId="${section.id}"`), `${section.route} is not selected in the Settings rail`);
    if (section.required_feature) assert.match(page, new RegExp(`guardPage\\("${section.required_feature}"\\)`), `${section.id}: the registry's feature is not the page's`);
  }
  assert.match(read("app/app/(shell)/layout.tsx"), /<AppPageBreadcrumbs menu=\{menu\} \/>/, "the shared app shell supplies page breadcrumbs");
});

test("the active Settings section and its local tabs occupy the left rail", () => {
  const frame = read("components/app/settings/settings-page-frame.tsx");
  assert.match(frame, /<SettingsRailProvider slots=\{slots\}>/);
  assert.match(frame, /ref=\{attachHeading\}/);
  assert.match(frame, /ref=\{attachTabs\}/);
  assert.match(frame, /lg:-ml-8 lg:w-\[280px\].*lg:border-r/);
  assert.match(frame, /section\.id !== activeId/, "the selected section should be represented by its title instead of a duplicate menu item");
  assert.match(read("components/app/settings/primitives.tsx"), /createPortal\(heading, rail\.heading\)/);
  assert.match(read("components/app/profile/status-tabs.tsx"), /createPortal\(tabList, rail\.tabs\)/);
  assert.match(read("components/ui/settings-rail-tabs.tsx"), /createPortal\(/);
  assert.match(read("components/app/settings/settings-page-frame.tsx"), /<main className="min-w-0 flex-1 lg:pl-6">/, "settings cards remain in the right content column");
});

test("search is reachable by keyboard from every screen", () => {
  assert.match(read("components/app/app-top-bar.tsx"), /\(event\.key === "k" \|\| event\.key === "K"\) && \(event\.metaKey \|\| event\.ctrlKey\)/);
  // The registered sections, less any the plan hides on the settings page (LA-8 audit: same list as the rail).
  assert.match(read("lib/search/service.ts"), /const sections = hidden\.length \? SETTINGS_SECTIONS\.filter\(\(section\) => !hidden\.includes\(section\.id\)\) : SETTINGS_SECTIONS;\n\s+return searchSettings\(sections, granted, role, term\)/);
});
