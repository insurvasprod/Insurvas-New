import test from "node:test";
import assert from "node:assert/strict";

import { buildAdminNav } from "../adminNav/build.ts";
import { PLATFORM_STEPS, platformStepsFor } from "./steps.ts";

const keys = (role) => platformStepsFor(role).map((step) => step.key);
const ROLES = ["super_admin", "billing_admin", "support_agent", "platform_config"];

test("a super admin gets every Platform step, Workspace first", () => {
  assert.deepEqual(keys("super_admin"), ["workspace", "compliance", "disclosures", "calling", "mail", "maintenance", "advanced", "admins", "legal"]);
});

test("the rail offers exactly what the role's Platform menu offers", () => {
  for (const role of ROLES) {
    const group = buildAdminNav(role).find((node) => node.kind === "group" && node.id === "platform");
    const menu = group ? group.links.map((link) => link.href) : [];
    assert.deepEqual(platformStepsFor(role).map((step) => step.href), menu, role);
  }
});

test("Calling rules and Admin users stay super admin only; Legal and the workspace are every admin's", () => {
  for (const role of ["support_agent", "billing_admin", "platform_config"]) {
    const steps = keys(role);
    assert.ok(!steps.includes("calling") && !steps.includes("admins"), role);
    assert.ok(steps.includes("workspace") && steps.includes("legal"), role);
  }
  assert.deepEqual(keys("support_agent"), ["workspace", "legal"]);
  assert.deepEqual(keys("platform_config"), ["workspace", "compliance", "disclosures", "mail", "maintenance", "advanced", "legal"]);
});

test("every step names a group and an icon, and the groups run in rail order", () => {
  assert.ok(PLATFORM_STEPS.every((step) => step.group && step.icon));
  assert.deepEqual([...new Set(PLATFORM_STEPS.map((step) => step.group))], ["Overview", "Rules", "Communication", "System", "People & records"]);
});
