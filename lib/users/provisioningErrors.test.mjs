import test from "node:test";
import assert from "node:assert/strict";

const { classifyProvisioningError, TENANT_PROVISIONING_UNAVAILABLE_MESSAGE } = await import("./provisioningErrors.ts");

test("SA-1.2 missing provisioning RPC returns a safe unavailable response", () => {
  const result = classifyProvisioningError({ code: "PGRST202", message: "Could not find the function in the schema cache" });
  assert.deepEqual(result, { code: "tenant_provisioning_unavailable", message: TENANT_PROVISIONING_UNAVAILABLE_MESSAGE, status: 503 });
  assert.doesNotMatch(result.message, /schema cache|PGRST|postgres|tenant_id/i);
});

test("ordinary provisioning errors keep a neutral response", () => {
  assert.deepEqual(classifyProvisioningError({ code: "23505", message: "duplicate key" }), {
    code: "provisioning_failed",
    message: "Could not create user",
    status: 500,
  });
});
