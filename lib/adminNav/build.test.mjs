// Run with: npm test
import { test } from "node:test";
import assert from "node:assert/strict";

import { buildAdminNav } from "./build.ts";
import { group, groupIdForPath, isLinkActive, link } from "./types.ts";

const labels = (nodes) => nodes.map((n) => n.label);
const findGroup = (nodes, id) => nodes.find((n) => n.kind === "group" && n.id === id);
const allLinks = (nodes) => nodes.flatMap((n) => (n.kind === "group" ? n.links : [n]));

test("a super_admin sees every screen, and none of them twice", () => {
  const nodes = buildAdminNav("super_admin");
  const hrefs = allLinks(nodes).map((l) => l.href);
  assert.equal(hrefs.length, new Set(hrefs).size, "a screen appears in two places");
  assert.equal(hrefs.length, 16);
});

test("Dashboard stays a top-level link, never buried in a group", () => {
  const nodes = buildAdminNav("super_admin");
  assert.equal(nodes[0].kind, "link");
  assert.equal(nodes[0].href, "/admin");
});

test("Subscriptions and Trials are grouped with Billing, not with Customers", () => {
  // They read like customer data but are gated by canManageSubscriptions — the same permission as
  // Invoices and Revenue. Filing them by how they read would leave both groups showing gaps to the
  // role that uses them most.
  const billing = findGroup(buildAdminNav("super_admin"), "billing");
  assert.deepEqual(labels(billing.links), [
    "Subscriptions", "Trials", "Invoices", "Refunds & credits", "Coupons", "Revenue",
  ]);
});

test("a support_agent sees Customers and Monitoring, and no billing group at all", () => {
  const nodes = buildAdminNav("support_agent");
  assert.deepEqual(labels(findGroup(nodes, "customers").links), ["Tenants", "Users"]);
  assert.equal(findGroup(nodes, "billing"), undefined, "a 403 waiting to happen");
  assert.equal(findGroup(nodes, "catalog"), undefined);
  assert.deepEqual(labels(findGroup(nodes, "monitoring").links), ["Login activity", "Audit log"]);
});

test("a billing_admin gets the whole billing group but not the catalog", () => {
  const nodes = buildAdminNav("billing_admin");
  assert.equal(findGroup(nodes, "billing").links.length, 6);
  assert.equal(findGroup(nodes, "catalog"), undefined);
});

test("a group with one visible child flattens to a plain link", () => {
  // platform_config can reach four screens in total. Four one-item accordions would be absurd.
  const nodes = buildAdminNav("platform_config");
  assert.deepEqual(labels(nodes), ["Dashboard", "Features", "Audit log", "Legal"]);
  assert.ok(nodes.every((n) => n.kind === "link"), "nothing should be a group for this role");
});

test("a group with nothing visible is not rendered at all", () => {
  assert.deepEqual(group("empty", "Empty", "platform", [null, null]), []);
});

test("Legal and the audit log are reachable by every role", () => {
  for (const role of ["super_admin", "billing_admin", "support_agent", "platform_config"]) {
    const hrefs = allLinks(buildAdminNav(role)).map((l) => l.href);
    assert.ok(hrefs.includes("/admin/legal"), `${role} cannot reach Legal`);
    assert.ok(hrefs.includes("/admin/audit-log"), `${role} cannot reach the audit log`);
  }
});

test("Dashboard is active only on /admin, not on every page beneath it", () => {
  assert.equal(isLinkActive("/admin", "/admin"), true);
  assert.equal(isLinkActive("/admin", "/admin/trials"), false);
  assert.equal(isLinkActive("/admin/trials", "/admin/trials"), true);
  assert.equal(isLinkActive("/admin/invoices", "/admin/invoices/abc-123"), true);
});

test("the group owning the current route is identifiable, so it can be forced open", () => {
  const nodes = buildAdminNav("super_admin");
  assert.equal(groupIdForPath(nodes, "/admin/trials"), "billing");
  assert.equal(groupIdForPath(nodes, "/admin/tenants"), "customers");
  assert.equal(groupIdForPath(nodes, "/admin/audit-log"), "monitoring");
  assert.equal(groupIdForPath(nodes, "/admin"), null, "Dashboard belongs to no group");
});

test("every group id is unique and every node carries an icon", () => {
  const nodes = buildAdminNav("super_admin");
  const ids = nodes.filter((n) => n.kind === "group").map((n) => n.id);
  assert.equal(ids.length, new Set(ids).size);
  assert.ok(allLinks(nodes).every((l) => typeof l.icon === "string" && l.icon.length > 0));
});

test("link() and group() produce the shapes the renderer expects", () => {
  const one = link("/admin/x", "X", "plans");
  assert.equal(one.kind, "link");
  const grouped = group("g", "G", "catalog", [one, link("/admin/y", "Y", "addons")]);
  assert.equal(grouped.length, 1);
  assert.equal(grouped[0].kind, "group");
  assert.equal(grouped[0].links.length, 2);
});
