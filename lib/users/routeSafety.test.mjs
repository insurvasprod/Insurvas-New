import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const tenantRoute = await readFile(new URL("../../app/api/admin/tenants/route.ts", import.meta.url), "utf8");

test("SA tenant provisioning does not return raw Auth or database errors", () => {
  assert.doesNotMatch(tenantRoute, /`Could not create the owner account:\s*\$\{authError/);
  assert.doesNotMatch(tenantRoute, /`Could not create tenant:\s*\$\{error\.message/);
  assert.match(tenantRoute, /tenant_provisioning_failed/);
});
