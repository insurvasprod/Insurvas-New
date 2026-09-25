// Run with: npm test
//
// LA-0.1 acceptance criterion 3: "Adding a new menu item is one entry in the menu data file, with
// no per-plan branching."
//
// Notion states the rule twice and in italics — "Menu defined once, as data. Never write one menu
// per plan." The existing definition.test.mjs proves the menu *renders* by filtering. This file
// proves the stronger, negative claim: that nothing in the shell's decision path knows a plan
// exists, so the only way to add a destination is to add data.
//
// It also covers the in-scope requirement that tenant scope is resolved from the session and
// "never from a request parameter".
import { test } from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync, existsSync, statSync } from "node:fs";
import { join, extname } from "node:path";

import { AGENT_MENU, allMenuItems, buildAgentMenu } from "./definition.ts";
import { TENANT_ROLES } from "../tenantAuth/roles.ts";

const ROOT = process.cwd();

/** The modules that decide what a signed-in agent may see and reach. */
const DECISION_PATH = [
  "lib/menu",
  "lib/entitlements",
  "lib/tenantAuth",
  "lib/dashboard",
  "proxy.ts",
];

function sourceFiles(target) {
  const absolute = join(ROOT, target);
  if (!existsSync(absolute)) return [];
  if (statSync(absolute).isFile()) return [target];

  const found = [];
  for (const entry of readdirSync(absolute, { withFileTypes: true })) {
    const child = `${target}/${entry.name}`;
    if (entry.isDirectory()) found.push(...sourceFiles(child));
    else if ([".ts", ".tsx"].includes(extname(entry.name))) found.push(child);
  }
  return found;
}

function decisionPathSources() {
  return DECISION_PATH.flatMap(sourceFiles).map((path) => [path, readFileSync(join(ROOT, path), "utf8")]);
}

test("the decision path never branches on a plan", () => {
  // Reporting a plan code back to the client (so the upgrade prompt can name it) is fine. Making
  // a decision from it is the thing Notion forbids.
  const branching = [
    /\bplan_code\s*(===|!==|==|!=)/,
    /\bplanCode\s*(===|!==|==|!=)/,
    /\bplan_version\s*(===|!==|==|!=)/,
    /switch\s*\(\s*[A-Za-z0-9_.]*plan/i,
    /\bplan_code\s*\)?\s*\.\s*(includes|startsWith|match)\s*\(/,
    /\[\s*['"`]plan_code['"`]\s*\]\s*(===|!==)/,
  ];

  const offenders = [];
  for (const [path, source] of decisionPathSources()) {
    for (const pattern of branching) {
      const match = source.match(pattern);
      if (match) offenders.push(`${path}: ${match[0].trim()}`);
    }
  }

  assert.deepEqual(
    offenders,
    [],
    `per-plan branching in the shell decision path — the menu must filter on feature keys only:\n  ${offenders.join("\n  ")}`,
  );
});

test("no menu item is special-cased by key in the decision path", () => {
  // If a module names a menu key in a conditional, that key's visibility no longer comes from the
  // data file, and "add one entry" stops being true.
  const keys = allMenuItems().map((item) => item.key);
  const offenders = [];

  for (const [path, source] of decisionPathSources()) {
    if (path === "lib/menu/definition.ts") continue; // the data file itself
    for (const key of keys) {
      // A key inside a conditional or comparison, rather than as plain data.
      const pattern = new RegExp(`(===|!==|includes\\(|if\\s*\\()[^\\n]{0,40}['"\`]${key.replace(".", "\\.")}['"\`]`);
      const match = source.match(pattern);
      if (match) offenders.push(`${path}: ${key}`);
    }
  }

  assert.deepEqual(offenders, [], `menu keys hard-coded into logic:\n  ${offenders.join("\n  ")}`);
});

test("a new menu item needs data only — the filter is total over the definition", () => {
  // Every item must be reachable purely by granting its feature and holding an allowed role. An
  // item that cannot be shown that way is one that needs code to appear.
  const unreachable = [];

  for (const item of allMenuItems()) {
    const features = item.required_feature ? [item.required_feature] : [];
    const roles = item.required_roles ?? TENANT_ROLES;
    const shown = roles.some((role) =>
      buildAgentMenu(features, role)
        .flatMap((section) => section.items)
        .some((candidate) => candidate.key === item.key),
    );
    if (!shown) unreachable.push(item.key);
  }

  assert.deepEqual(unreachable, [], `menu items no feature/role combination can reveal: ${unreachable.join(", ")}`);
});

test("adding an item to the data changes the menu with no change to the filter", () => {
  // The mechanical form of the criterion: append one entry-shaped object, run the same exported
  // filter, and see it appear. Nothing here touches the renderer or the filter.
  const before = buildAgentMenu(["a_brand_new_feature"], "owner").flatMap((section) => section.items).length;

  const synthetic = {
    key: "test.synthetic",
    label: "Synthetic",
    path: "/app/synthetic",
    icon: "beaker",
    section: "Home",
    required_feature: "a_brand_new_feature",
  };
  const home = AGENT_MENU.find((section) => section.id === "home");
  home.items.push(synthetic);

  try {
    const after = buildAgentMenu(["a_brand_new_feature"], "owner").flatMap((section) => section.items);
    assert.equal(after.length, before + 1);
    assert.ok(after.some((item) => item.key === "test.synthetic"));
    // And it stays hidden without the feature, on the same code path.
    assert.ok(
      !buildAgentMenu([], "owner").flatMap((section) => section.items).some((item) => item.key === "test.synthetic"),
    );
  } finally {
    home.items.pop();
  }
});

test("no agent API route takes its tenant scope from the request", () => {
  // Notion: "Session with tenant scope resolved from the session, never from a request
  // parameter." A route that reads a tenant id off the wire is a cross-tenant hole regardless of
  // what the menu shows.
  const apiRoot = join(ROOT, "app", "api", "app");
  if (!existsSync(apiRoot)) return;

  const routes = [];
  const walk = (dir, prefix) => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const id = prefix ? `${prefix}/${entry.name}` : entry.name;
      if (entry.isDirectory()) walk(join(dir, entry.name), id);
      else if (entry.name === "route.ts") routes.push([id, readFileSync(join(dir, entry.name), "utf8")]);
    }
  };
  walk(apiRoot, "");

  const fromRequest = [
    /searchParams\.get\(\s*['"`](tenant|tenant_id|tenantId|org|organization_id)['"`]/,
    /params\.get\(\s*['"`](tenant|tenant_id|tenantId)['"`]/,
    /headers\(\)\.get\(\s*['"`]x-tenant/i,
    /body\??\.\s*tenant_?[Ii]d/,
    /\btenantId\s*[:=]\s*body/,
  ];

  const offenders = [];
  for (const [routeId, source] of routes) {
    for (const pattern of fromRequest) {
      const match = source.match(pattern);
      if (match) offenders.push(`${routeId}: ${match[0].trim()}`);
    }
  }

  assert.deepEqual(
    offenders,
    [],
    `routes reading tenant scope from the request rather than the session:\n  ${offenders.join("\n  ")}`,
  );
});

test("every menu item names a feature key or is deliberately ungated", () => {
  // Dashboard and Settings are the only two Notion leaves ungated; anything else without a
  // feature key is a destination that no plan controls, which is almost always a mistake.
  const ungated = allMenuItems().filter((item) => !item.required_feature).map((item) => item.key).sort();
  assert.deepEqual(ungated, ["home.dashboard", "settings.root"]);
});
