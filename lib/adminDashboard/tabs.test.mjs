import test from "node:test";
import assert from "node:assert/strict";

import { dashboardTabHref, dashboardTabsFor, pickDashboardTab } from "./tabs.ts";

test("a super admin gets every tab, Overview first", () => {
  assert.deepEqual(dashboardTabsFor("super_admin"), ["overview", "needs", "money", "customers", "health", "security"]);
});

test("a support agent sees no money tab", () => {
  assert.ok(!dashboardTabsFor("support_agent").includes("money"));
  assert.ok(dashboardTabsFor("support_agent").includes("customers"));
});

test("platform config sees no customer or money tab (Basic Idea doc §2.5)", () => {
  const tabs = dashboardTabsFor("platform_config");
  assert.ok(!tabs.includes("money") && !tabs.includes("customers"));
  assert.equal(tabs[0], "overview");
});

test("a tab the role lacks falls back to Overview", () => {
  assert.equal(pickDashboardTab("support_agent", "money"), "overview");
  assert.equal(pickDashboardTab("super_admin", "money"), "money");
  assert.equal(pickDashboardTab("super_admin", "nonsense"), "overview");
});

test("Overview is the bare /admin", () => {
  assert.equal(dashboardTabHref("overview"), "/admin");
  assert.equal(dashboardTabHref("needs"), "/admin?tab=needs");
});
