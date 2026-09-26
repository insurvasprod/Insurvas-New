import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";

const component = await readFile(new URL("../../components/app/agent-floor.tsx", import.meta.url), "utf8");

test("LA-1.15-2: the Agent Floor is realtime, with no one-second poll", () => {
  // Every floor re-reads on the tenant's floor_changed broadcast.
  assert.match(component, /\.on\("broadcast",\s*\{\s*event:\s*"floor_changed"\s*\}/);
  // The old fallback re-read the whole floor every second on every open tab. It is gone.
  assert.doesNotMatch(component, /void load\(\);?\s*\}?,\s*1000\)/, "the floor still polls every second");
  // What is left is a slow safety re-read, skipped for hidden tabs.
  const live = Number(/SAFETY_RESYNC_LIVE_MS = ([\d_]+)/.exec(component)?.[1]?.replaceAll("_", ""));
  const offline = Number(/SAFETY_RESYNC_OFFLINE_MS = ([\d_]+)/.exec(component)?.[1]?.replaceAll("_", ""));
  assert.ok(live >= 30_000, `the live safety re-read runs every ${live} ms`);
  assert.ok(offline >= 10_000, `the offline safety re-read runs every ${offline} ms`);
  assert.match(component, /document\.visibilityState === "visible"/);
  assert.match(component, /clearInterval\(timer\)/);
});

test("a change that lands while a read is out is read once more, never dropped", () => {
  assert.match(component, /refreshInFlightRef/);
  assert.match(component, /refreshPendingRef\.current = true/);
  assert.match(component, /if \(refreshPendingRef\.current\)/);
});
