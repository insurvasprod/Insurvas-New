import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";

const component = await readFile(new URL("../../components/app/agent-floor.tsx", import.meta.url), "utf8");

test("Agent Floor keeps a bounded refresh fallback when Realtime is unavailable", () => {
  assert.match(component, /refreshInFlightRef/);
  assert.match(component, /document\.visibilityState === "visible"/);
  assert.match(component, /setInterval\(\(\) => \{/);
  assert.match(component, /}, 1000\)/);
  assert.match(component, /clearInterval\(timer\)/);
});
