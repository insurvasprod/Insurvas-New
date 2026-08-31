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
  // 25: the Configuration Center hub was replaced by its ten sections as their own routes, all
  // under Platform, and Features moved there from Catalog.
  assert.equal(hrefs.length, 25);
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
    "Subscriptions", "Trials", "Invoices", "Refunds & credits", "Coupons",
    "Offers & discounts", "Credits & limits", "Revenue", "Setup",
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
  // Seven of nine. Offers is theirs; payment Setup and Credits & limits are not, because both
  // keep the section registry's stricter rule inside their new group.
  const billingLabels = labels(findGroup(nodes, "billing").links);
  assert.equal(billingLabels.length, 7);
  assert.ok(billingLabels.includes("Offers & discounts"));
  assert.ok(!billingLabels.includes("Setup"), "live provider credentials stay super_admin");
  assert.ok(!billingLabels.includes("Credits & limits"), "SA-4.9 is not a billing_admin screen");
  // No Plans, no Add-ons, and the section registry does not admit them to Features either.
  assert.equal(findGroup(nodes, "catalog"), undefined);
  assert.ok(!allLinks(nodes).some((l) => l.href === "/admin/features"));
});

test("payment Setup is filed under Billing, not Platform", () => {
  const nodes = buildAdminNav("super_admin");
  const billing = findGroup(nodes, "billing").links;
  assert.equal(billing.at(-1).label, "Setup");
  assert.equal(billing.at(-1).href, "/admin/payments");
  assert.ok(!findGroup(nodes, "platform").links.some((l) => l.href === "/admin/payments"));
  assert.equal(groupIdForPath(nodes, "/admin/payments"), "billing");
});

test("Features is filed under Catalog, not Platform", () => {
  // It is the list you tick against when building a plan, so it sits with Plans and Add-ons — while
  // still carrying the section registry's permission rather than canManagePlans.
  const nodes = buildAdminNav("super_admin");
  assert.deepEqual(
    labels(findGroup(nodes, "catalog").links),
    ["Plans", "Add-ons", "Features", "Products", "Templates"],
  );
  assert.ok(!findGroup(nodes, "platform").links.some((l) => l.href === "/admin/features"));
  assert.equal(groupIdForPath(nodes, "/admin/features"), "catalog");
  assert.equal(groupIdForPath(nodes, "/admin/products"), "catalog");
  assert.equal(groupIdForPath(nodes, "/admin/templates"), "catalog");
  assert.equal(groupIdForPath(nodes, "/admin/offers"), "billing");
  assert.equal(groupIdForPath(nodes, "/admin/credits-limits"), "billing");
});

test("the platform-configuration screens are gated by the section registry, not by group", () => {
  // Each section keeps the per-section role map the old Configuration Center hub used, so the link
  // and the page can never disagree about who may open it.
  const forBilling = allLinks(buildAdminNav("billing_admin")).map((l) => l.href);
  assert.ok(forBilling.includes("/admin/offers"), "a billing admin runs promotions");
  // In the Billing group, but still refused — placement is presentation, permission is the registry.
  assert.ok(!forBilling.includes("/admin/payments"), "live provider credentials stay super_admin");
  assert.ok(!forBilling.includes("/admin/compliance-sources"), forBilling.join(", "));

  const forSuper = allLinks(buildAdminNav("super_admin")).map((l) => l.href);
  for (const href of [
    "/admin/payments", "/admin/offers", "/admin/products", "/admin/templates",
    "/admin/compliance-sources", "/admin/credits-limits", "/admin/features",
    "/admin/email", "/admin/system", "/admin/advanced",
  ]) {
    assert.ok(forSuper.includes(href), `super_admin cannot reach ${href}`);
  }
});

test("the System screen is labelled Maintenance, at its original route", () => {
  // The label changed; the URL did not, so anything already linking to /admin/system still works.
  const platform = findGroup(buildAdminNav("super_admin"), "platform").links;
  const entry = platform.find((l) => l.href === "/admin/system");
  assert.equal(entry.label, "Maintenance");
  assert.ok(!platform.some((l) => l.label === "System"));
});

test("the Configuration Center hub is gone", () => {
  for (const role of ["super_admin", "billing_admin", "support_agent", "platform_config"]) {
    const hrefs = allLinks(buildAdminNav(role)).map((l) => l.href);
    assert.ok(!hrefs.includes("/admin/configuration"), `${role} still sees the removed hub`);
  }
});

test("a group with one visible child flattens to a plain link", () => {
  // platform_config reaches one Monitoring screen, so it collapses to a plain "Audit log" link
  // rather than a one-item accordion. Catalog stays a real group: they can open Features, Products
  // and Templates even though Plans and Add-ons are not theirs.
  const nodes = buildAdminNav("platform_config");
  // Credits & limits is the only Billing screen they can open, so that group flattens to it.
  assert.deepEqual(labels(nodes), ["Dashboard", "Credits & limits", "Catalog", "Audit log", "Platform"]);
  assert.equal(findGroup(nodes, "billing"), undefined, "one child should not be an accordion");
  assert.equal(findGroup(nodes, "monitoring"), undefined, "one child should not be an accordion");
  assert.deepEqual(labels(findGroup(nodes, "catalog").links), ["Features", "Products", "Templates"]);
});

test("a billing_admin's Platform group collapses to the one screen they can open", () => {
  // With Offers moved to Billing, Legal is all that is left of Platform for them — so it renders
  // as a plain link, not a group holding a single item.
  const nodes = buildAdminNav("billing_admin");
  assert.equal(findGroup(nodes, "platform"), undefined);
  assert.ok(labels(nodes).includes("Legal"));
});

test("a support_agent sees no platform-configuration screen at all", () => {
  // They may open no section, so Platform collapses to the single link they can reach — the same
  // "no link beats a link to a 403" rule the rest of the nav follows.
  const nodes = buildAdminNav("support_agent");
  assert.deepEqual(labels(nodes), ["Dashboard", "Customers", "Monitoring", "Legal"]);
  assert.equal(findGroup(nodes, "platform"), undefined);
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
