// Run with: npm test
//
// These tests pin the route-registry contract so adding a configuration section does not require
// changing the shell or accidentally widening access to live payment credentials.
import { test } from "node:test";
import assert from "node:assert/strict";

import {
  CONFIGURATION_SECTIONS,
  auditSection,
  accessibleConfigurationSections,
  canAccessConfigurationCenter,
  canAccessConfigurationSection,
} from "./sections.ts";

test("configuration sections are unique and route-ready", () => {
  const slugs = CONFIGURATION_SECTIONS.map((section) => section.slug);

  assert.equal(new Set(slugs).size, slugs.length, "section slugs must be unique");
  for (const section of CONFIGURATION_SECTIONS) {
    assert.match(section.slug, /^[a-z0-9]+(?:-[a-z0-9]+)*$/);
    assert.ok(section.label.length > 0);
    assert.ok(section.description.length > 0);
    assert.match(section.owner, /^(?:SA-4\.\d+|LA-0\.4)$/);
    assert.ok(section.keywords.length > 0);
  }
});

test("option 1 keeps the permission split explicit", () => {
  assert.equal(canAccessConfigurationSection("super_admin", "payments"), true);
  assert.equal(canAccessConfigurationSection("super_admin", "offers"), true);
  assert.equal(canAccessConfigurationSection("platform_config", "payments"), false);
  assert.equal(canAccessConfigurationSection("platform_config", "offers"), false);
  assert.equal(canAccessConfigurationSection("platform_config", "advanced"), true);
  assert.equal(canAccessConfigurationSection("billing_admin", "offers"), true);
  assert.equal(canAccessConfigurationSection("billing_admin", "payments"), false);
  assert.equal(canAccessConfigurationSection("billing_admin", "advanced"), false);

  assert.equal(canAccessConfigurationCenter("support_agent"), false);
  assert.deepEqual(accessibleConfigurationSections("support_agent"), []);
});

test("configuration audit strip excludes operational payment activity", () => {
  assert.equal(auditSection("setting.updated"), "advanced");
  assert.equal(auditSection("feature.updated"), "features");
  assert.equal(auditSection("coupon.created"), "offers");
  assert.equal(auditSection("plan.updated"), "products");
  assert.equal(auditSection("payment_provider.connection_tested"), null);
  assert.equal(auditSection("payment_provider.assigned"), null);
});
