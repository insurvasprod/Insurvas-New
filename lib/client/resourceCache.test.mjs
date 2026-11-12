// Run with: npm test
//
// lib/client/resource-cache.ts (speed pass 2026-11-09): show the last answer, refresh behind it, one request per
// address, an older answer never overwrites a newer one, and signing out or another person forgets everything.

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const cache = await import("./resource-cache.ts");
const read = (path) => readFileSync(join(process.cwd(), path), "utf8");

function deferred() {
  let resolve, reject;
  const promise = new Promise((res, rej) => { resolve = res; reject = rej; });
  return { promise, resolve, reject };
}

test("the last answer stays to be shown while a fresh one is asked for", async () => {
  cache.setResourceScope("user-a:tenant-1");
  cache.clearResources();
  let calls = 0;
  cache.setFetcher(async () => ({ n: ++calls }));
  await cache.load("/api/app/x");
  assert.deepEqual(cache.peek("/api/app/x").data, { n: 1 });
  const again = cache.load("/api/app/x");
  assert.deepEqual(cache.peek("/api/app/x").data, { n: 1 }, "the old answer is still there while the new one is on its way");
  assert.ok(cache.peek("/api/app/x").pending);
  await again;
  assert.deepEqual(cache.peek("/api/app/x").data, { n: 2 });
});

test("one request per address: a second asker joins the first", async () => {
  cache.clearResources();
  const gate = deferred();
  let calls = 0;
  cache.setFetcher(() => { calls++; return gate.promise; });
  const a = cache.load("/api/app/y");
  const b = cache.load("/api/app/y");
  assert.equal(a, b);
  gate.resolve({ ok: true });
  await a;
  assert.equal(calls, 1);
});

test("a failed refresh keeps the last good answer and records the error", async () => {
  cache.clearResources();
  cache.setFetcher(async () => ({ v: 1 }));
  await cache.load("/api/app/z");
  cache.setFetcher(async () => { throw new Error("down"); });
  await assert.rejects(cache.load("/api/app/z"));
  assert.deepEqual(cache.peek("/api/app/z").data, { v: 1 });
  assert.equal(cache.peek("/api/app/z").error, "down");
});

test("mutate puts an answer in at once; subscribers hear every change", async () => {
  cache.clearResources();
  let heard = 0;
  const off = cache.subscribe("/api/app/m", () => heard++);
  cache.mutate("/api/app/m", { rows: [1] });
  cache.mutate("/api/app/m", (current) => ({ rows: [...current.rows, 2] }));
  assert.deepEqual(cache.peek("/api/app/m").data, { rows: [1, 2] });
  assert.ok(heard >= 2);
  off();
});

test("another person, or signing out, starts with nothing", async () => {
  cache.setResourceScope("user-a:tenant-1");
  cache.setFetcher(async () => ({ secret: "a" }));
  await cache.load("/api/app/s");
  cache.setResourceScope("user-b:tenant-1");
  assert.equal(cache.peek("/api/app/s"), undefined, "a new scope drops the last person's answers");
  cache.setResourceScope("user-a:tenant-1");
  await cache.load("/api/app/s");
  cache.clearResources();
  assert.equal(cache.peek("/api/app/s"), undefined);
});

test("prefetch warms only what is not fresh already", async () => {
  cache.clearResources();
  let calls = 0;
  cache.setFetcher(async () => ({ n: ++calls }));
  cache.prefetch("/api/app/p");
  await cache.peek("/api/app/p").pending;
  cache.prefetch("/api/app/p");
  assert.equal(calls, 1, "a fresh answer is not asked for again");
});

test("the pages that read from the browser keep reading through the cache", () => {
  const migrated = [
    "lead-workspace", "callback-calendar", "appointment-calendar", "partner-chat-workspace", "partners-workspace", "campaign-workspace",
    "contact-workspace", "assignment-workspace", "nurture-workspace", "scoring-workspace", "deal-flow-workspace", "suppression-workspace",
    "consent-locker-workspace", "lead-import-workspace", "partner-quality-workspace", "partner-quality-detail", "partner-quality-leads",
    "true-cpa-leads", "true-cpa-workspace", "activity-agent-detail", "activity-log-workspace", "carrier-bucket",
  ];
  for (const name of migrated) assert.match(read(`components/app/${name}.tsx`), /from "@\/lib\/client\/resource-cache"/, `${name} reads through the cache`);
  for (const hook of ["components/app/dialer/use-dialer.ts", "components/app/agency/use-agency-data.ts", "components/app/assignment/use-assignment-workspace.ts"]) {
    assert.match(read(hook), /from "@\/lib\/client\/resource-cache"/, `${hook} reads through the cache`);
  }
  // A first render must match the server's HTML: kept answers seed state only through seed(), never peek() in render.
  assert.doesNotMatch(read("components/app/lead-workspace.tsx"), /useState<[^>]+>\(\(\) => peek/, "seed, not peek, in a useState initialiser");
});

test("the app is wired: router cache, background refresh, scope, clearing, prefetch on intent", () => {
  assert.match(read("next.config.ts"), /staleTimes: \{ dynamic: 30, static: 180 \}/);
  const layout = read("app/app/(shell)/layout.tsx");
  assert.match(layout, /<ResourceScope id=\{`\$\{context\.userId\}:\$\{context\.tenantId\}`\} \/>/);
  assert.match(layout, /<BackgroundRefresh \/>/);
  const topBar = read("components/app/app-top-bar.tsx");
  assert.equal((topBar.match(/clearResources\(\);/g) ?? []).length, 2, "sign-out and workspace switch both forget");
  assert.match(read("components/app/shell-entrance.tsx"), /clearResources\(\);/, "a new sign-in starts empty");
  assert.match(read("components/ui/nav-pending.tsx"), /prefetchRoute\(props\.href\)/);
});
