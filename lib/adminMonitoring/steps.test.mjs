import test from "node:test";
import assert from "node:assert/strict";

import { monitoringStepsFor } from "./steps.ts";

const keys = (role) => monitoringStepsFor(role).map((step) => step.key);

test("a super admin gets every Monitoring step, Workspace first", () => {
  assert.deepEqual(keys("super_admin"), ["workspace", "logins", "lockouts", "sessions", "audit", "jobs"]);
});

test("lockouts and staff sessions stay super admin only", () => {
  for (const role of ["support_agent", "billing_admin", "platform_config"]) {
    const steps = keys(role);
    assert.ok(!steps.includes("lockouts") && !steps.includes("sessions"), role);
    assert.ok(steps.includes("workspace") && steps.includes("audit") && steps.includes("jobs"), role);
  }
});
