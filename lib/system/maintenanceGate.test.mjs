// SA-4.9: read_only and locked must reach every tenant and partner write, whatever guard the route
// uses. The gate sits in proxy.ts, so this proves (1) the proxy runs the gate for every /api/app and
// /api/partner path, and (2) every route file there that exports a write method is refused by it.
import assert from "node:assert/strict";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative, sep } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

import { maintenanceGateDecision, isWriteMethod } from "./maintenanceGateRules.ts";

const root = fileURLToPath(new URL("../../", import.meta.url));
const WRITE_EXPORT = /export\s+(?:async\s+)?(?:function|const)\s+(POST|PUT|PATCH|DELETE)\b|export\s*\{[^}]*\b(POST|PUT|PATCH|DELETE)\b[^}]*\}/g;

function walk(dir) {
  const out = [];
  for (const name of readdirSync(dir)) {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) out.push(...walk(full));
    else if (name === "route.ts") out.push(full);
  }
  return out;
}

/** app/api/app/team/[userId]/route.ts → /api/app/team/x (route groups dropped). */
function urlFor(file) {
  const parts = relative(join(root, "app"), file).split(sep).slice(0, -1);
  return "/" + parts.filter((p) => !/^\(.*\)$/.test(p)).map((p) => (p.startsWith("[") ? "x" : p)).join("/");
}

const writeRoutes = ["api/app", "api/partner"].flatMap((dir) =>
  walk(join(root, "app", ...dir.split("/"))).flatMap((file) => {
    const source = readFileSync(file, "utf8");
    const methods = new Set();
    for (const m of source.matchAll(WRITE_EXPORT)) methods.add(m[1] ?? m[2]);
    return [...methods].map((method) => ({ file: relative(root, file), url: urlFor(file), method }));
  }),
);

const ALLOWED_THROUGH_READ_ONLY = [/^\/api\/app\/auth\//, /^\/api\/partner\/auth\//, /^\/api\/app\/announcements\/x\/dismiss$/];

test("there are write routes to check (the walk found them)", () => {
  assert.ok(writeRoutes.length > 100, `only ${writeRoutes.length} write handlers found`);
});

test("proxy.ts matches /api/app and /api/partner and runs the gate before anything else there", () => {
  const proxy = readFileSync(join(root, "proxy.ts"), "utf8");
  const matcher = proxy.match(/matcher:\s*\[([^\]]*)\]/);
  assert.ok(matcher, "proxy config has a matcher");
  assert.ok(matcher[1].includes('"/api/app/:path*"'), "matcher covers /api/app");
  assert.ok(matcher[1].includes('"/api/partner/:path*"'), "matcher covers /api/partner");
  assert.match(proxy, /import \{ maintenanceGateResponse \} from "@\/lib\/system\/maintenanceGate";/);
  assert.match(proxy, /if \(pathname\.startsWith\("\/api\/"\)\) \{\s*const maintenance = await maintenanceGateResponse\(pathname, request\.method\);\s*if \(maintenance\) return maintenance;/);
});

test("read_only refuses every write route except sign-in/out and dismissing the banner", () => {
  const missed = [];
  for (const route of writeRoutes) {
    const block = maintenanceGateDecision(route.url, route.method, "read_only");
    const allowed = ALLOWED_THROUGH_READ_ONLY.some((re) => re.test(route.url));
    if (allowed) assert.equal(block, null, `${route.method} ${route.url} should stay open`);
    else if (!block || block.code !== "maintenance_read_only") missed.push(`${route.method} ${route.file}`);
  }
  assert.deepEqual(missed, []);
});

test("locked refuses every write and read except auth and the status read", () => {
  for (const route of writeRoutes) {
    const block = maintenanceGateDecision(route.url, route.method, "locked");
    if (/^\/api\/(app|partner)\/auth\//.test(route.url)) assert.equal(block, null);
    else assert.equal(block?.code, "maintenance_locked", `${route.method} ${route.file}`);
  }
  assert.equal(maintenanceGateDecision("/api/app/leads", "GET", "locked")?.code, "maintenance_locked");
  assert.equal(maintenanceGateDecision("/api/partner/leads", "GET", "locked")?.code, "maintenance_locked");
  assert.equal(maintenanceGateDecision("/api/app/announcements", "GET", "locked"), null);
  assert.equal(maintenanceGateDecision("/api/app/auth/login", "POST", "locked"), null);
  assert.equal(maintenanceGateDecision("/api/app/announcements/a1/dismiss", "POST", "locked")?.code, "maintenance_locked");
});

test("reads pass in read_only; nothing is gated when off or banner_only; admin is never gated", () => {
  assert.equal(maintenanceGateDecision("/api/app/leads", "GET", "read_only"), null);
  assert.equal(maintenanceGateDecision("/api/app/leads", "HEAD", "read_only"), null);
  for (const level of ["off", "banner_only"]) assert.equal(maintenanceGateDecision("/api/app/team", "POST", level), null);
  assert.equal(maintenanceGateDecision("/api/admin/system/maintenance", "PUT", "locked"), null);
  assert.equal(maintenanceGateDecision("/api/webhooks/whop", "POST", "locked"), null);
  assert.equal(isWriteMethod("patch"), true);
});
