// Run with: node --experimental-strip-types --test lib/dashboard/views.test.mjs
//
// The dashboard's views (owner 2026-11-06): Overview always, then one view per module this reader may open
// under the plan; the view is in the address. A view never appears for a module with no open page.
import { test } from "node:test";
import assert from "node:assert/strict";

import { DASHBOARD_VIEWS, dashboardViews, pickDashboardView } from "./views.ts";
import { allMenuItems, menuFeatureKeys } from "../menu/definition.ts";

const EVERY_FEATURE = [...new Set(menuFeatureKeys())];
const keys = (views) => views.map((view) => view.key);

test("every view opens from real, built menu pages", () => {
  const items = new Map(allMenuItems().map((item) => [item.key, item]));
  for (const view of DASHBOARD_VIEWS) for (const key of view.opens) assert.ok(items.get(key)?.built, `${view.key}: ${key}`);
});

test("an owner with every module sees every view, Overview first", () => {
  assert.deepEqual(keys(dashboardViews(EVERY_FEATURE, "owner")), ["overview", "leads", "retention", "book", "accounting", "compliance"]);
});

test("a plan without a module has no view for it", () => {
  const noMoney = EVERY_FEATURE.filter((feature) => feature !== "profit_and_loss" && feature !== "true_cpa");
  assert.ok(!keys(dashboardViews(noMoney, "owner")).includes("accounting"));
  assert.deepEqual(keys(dashboardViews([], "owner")), ["overview"]);
});

test("a role sees only its modules: no Accounting for a producer, no Leads for a bookkeeper", () => {
  assert.ok(!keys(dashboardViews(EVERY_FEATURE, "producer")).includes("accounting"));
  assert.ok(!keys(dashboardViews(EVERY_FEATURE, "bookkeeper")).includes("leads"));
  assert.ok(keys(dashboardViews(EVERY_FEATURE, "bookkeeper")).includes("accounting"));
});

test("the view comes from the address, and a view the reader lacks falls back to Overview", () => {
  const offered = dashboardViews(EVERY_FEATURE, "producer");
  assert.equal(pickDashboardView("retention", offered), "retention");
  assert.equal(pickDashboardView("accounting", offered), "overview");
  assert.equal(pickDashboardView("nonsense", offered), "overview");
  assert.equal(pickDashboardView(undefined, offered), "overview");
  assert.equal(offered.find((view) => view.key === "leads").href, "/app/dashboard?view=leads");
});

// Owner rules 2026-11-06 for the dashboard, held in source so a later change cannot quietly undo them.
import { readFileSync } from "node:fs";
import { join } from "node:path";
const read = (path) => readFileSync(join(process.cwd(), path), "utf8");

test("full width: the dashboard has no width cap, and the kit's grid takes every column the sidebar leaves", () => {
  const page = read("app/app/(shell)/dashboard/page.tsx");
  assert.doesNotMatch(page, /max-w-\[/, "no max-width on the dashboard");
  const kit = read("components/app/home/dash/dash-kit.tsx");
  assert.match(kit, /xl:grid-cols-\[minmax\(0,1fr\)_300px\] 2xl:grid-cols-\[minmax\(0,1fr\)_340px\]/);
});

test("views: the page reads ?view= through the registry and draws one view per module", () => {
  const page = read("app/app/(shell)/dashboard/page.tsx");
  assert.match(page, /dashboardViews\(available, context\.role, solo\)/);
  assert.match(page, /pickDashboardView\(asked, views\)/);
  for (const name of ["LeadsView", "RetentionView", "BookView", "AccountingView", "ComplianceView"]) assert.match(page, new RegExp(`<${name} \{\.\.\.viewProps\} />`), name);
});

test("everything clickable: every kit card that shows a figure, row or item renders it as a link", () => {
  const kit = read("components/app/home/dash/dash-kit.tsx");
  for (const piece of ["DashList", "DashHero", "DashModules"]) {
    const body = kit.slice(kit.indexOf(`export function ${piece}`), kit.indexOf("\nexport ", kit.indexOf(`export function ${piece}`) + 10));
    assert.match(body, /<Link\b/, `${piece} renders links`);
  }
});

test("Needs you is the standard figure strip, each tile a link (owner 2026-11-06: like the cards on other pages)", () => {
  const kit = read("components/app/home/dash/dash-kit.tsx");
  const body = kit.slice(kit.indexOf("export function DashNeeds"), kit.indexOf("/* ── Cards"));
  assert.match(body, /<StatStrip label="Needs you">/);
  assert.match(body, /<StatTile key=\{item\.key\}[^>]*href=\{item\.href\}/);
});

test("a module view fits the screen; the Overview may scroll a little, with Today ending level with Lead to policy", () => {
  // Owner 2026-11-06: no scroll on the views; then, for the Overview, "you can make just a bit of scroll".
  const page = read("app/app/(shell)/dashboard/page.tsx");
  assert.equal((page.match(/lg:h-\[calc\(100dvh-var\(--top-bar-h\)-56px\)\] lg:overflow-hidden/g) ?? []).length, 1, "the module view's root keeps the screen's height");
  const kit = read("components/app/home/dash/dash-kit.tsx");
  assert.match(kit, /lg:\[&>\*\]:h-full lg:\[&>\*\]:min-h-0 lg:\[&>\*\]:overflow-hidden/, "every card fills its cell");
  const overview = read("components/app/home/views/overview-view.tsx");
  assert.match(overview, /xl:absolute xl:inset-0/, "the right column takes the main column's height, never sets it");
});

test("Your modules on the Overview is exactly the plan's modules, each opening its view", () => {
  const overview = read("components/app/home/views/overview-view.tsx");
  for (const [key, label] of [["leads", "Leads"], ["retention", "Retention"], ["book", "Book of business"], ["accounting", "Accounting"], ["compliance", "Compliance"]]) {
    assert.ok(overview.includes(`if (has("${key}")) add("${key}", "${label}",`), `${label} is a module`);
    assert.ok(overview.includes(`"/app/dashboard?view=${key}"`), `${label} opens its view`);
  }
  assert.ok(overview.includes('if (sales) add("sales", "Sales"'), "Sales is a module");
});
