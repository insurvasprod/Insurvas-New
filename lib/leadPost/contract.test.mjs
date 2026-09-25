import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const service = await readFile(new URL("./service.ts", import.meta.url), "utf8");

test("accepted vendor posts notify the agent surface with an idempotent source key", () => {
  assert.match(service, /import \{ notifyTenantAgents \} from "@\/lib\/agentAlerts\/service"/);
  assert.match(service, /kind:\s*"new_unclaimed_lead"/);
  assert.match(service, /sourceKey:\s*`lead-post:\$\{created\.id\}`/);
  assert.match(service, /roles:\s*\["owner",\s*"producer",\s*"assistant"\]/);
  assert.match(service, /\.catch\(\(error\) => \{/);
});
