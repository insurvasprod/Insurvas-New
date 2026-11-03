import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

test("LA-1.10 inbox subscribes to the tenant-scoped floor invalidation topic", async () => {
  const component = await readFile("components/app/transfer-inbox.tsx", "utf8");
  const route = await readFile("app/api/app/inbound/route.ts", "utf8");
  const verifier = await readFile("scripts/verify-transfer-inbox.mjs", "utf8");
  assert.match(component, /getSupabaseBrowserClient/);
  assert.match(component, /\.on\("broadcast",\s*\{\s*event:\s*"floor_changed"\s*\}/);
  assert.match(component, /void\s+load\(\)/);
  assert.match(component, /removeChannel/);
  assert.match(route, /agent-floor:\$\{auth\.context\.tenantId\}/);
  assert.match(verifier, /claim broadcasts the tenant-scoped inbox invalidation within one second/);
  assert.match(verifier, /agent-floor:\$\{tenantId\}/);
});
