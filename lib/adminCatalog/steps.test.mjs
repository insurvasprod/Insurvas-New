import test from "node:test";
import assert from "node:assert/strict";

import { catalogStepsFor } from "./steps.ts";

const keys = (role) => catalogStepsFor(role).map((step) => step.key);

test("a super admin gets every Catalog step, Workspace first", () => {
  assert.deepEqual(keys("super_admin"), ["workspace", "plans", "addons", "features", "products", "templates", "carriers", "rules", "layouts", "status", "fields", "guidance", "servicing", "reports"]);
});

test("platform config gets everything but Plans and Add-ons (as before)", () => {
  const steps = keys("platform_config");
  assert.ok(!steps.includes("plans") && !steps.includes("addons"));
  assert.equal(steps[0], "workspace");
  assert.ok(steps.includes("carriers") && steps.includes("features"));
});

test("billing ops and support get no Catalog", () => {
  assert.deepEqual(keys("billing_admin"), []);
  assert.deepEqual(keys("support_agent"), []);
});
