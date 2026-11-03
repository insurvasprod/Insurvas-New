// AG-0.5 · the producer isolation audit — RELEASE GATE (the CI half).
//
// This test blocks a merge that ADDS a hole: a route a producer/assistant/setter can reach that reads
// producer-scoped data without the AG-0.4 helper, beyond the known list in isolationBaseline.json (which may
// only shrink). The gate itself — zero holes, plus the live check against a seeded agency — is
// `npm run agency:gate` and scripts/agency/verify-producer-isolation.mjs.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";

import { analyse, OWN_ONLY, pageReachableByNarrowRole, reachableByNarrowRole } from "./isolationAudit.mjs";

const ROOT = new URL("../../", import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, "$1");
const baseline = JSON.parse(readFileSync(join(ROOT, "lib/agency/isolationBaseline.json"), "utf8")).holes ?? {};
const results = analyse(ROOT);

const router = (dir) => readdirSync(dir).flatMap((n) => {
  const p = join(dir, n);
  return statSync(p).isDirectory() ? router(p) : n === "route.ts" ? [relative(ROOT, p).replace(/\\/g, "/")] : [];
});

test("the audit covers 100% of routes, compared against the router at test time", () => {
  const live = router(join(ROOT, "app/api/app")).sort();
  assert.deepEqual(results.map((r) => r.route).filter((r) => r.endsWith("route.ts")).sort(), live);
});

test("no NEW isolation hole: every unscoped route is already on the shrinking baseline", () => {
  const added = [];
  for (const r of results) {
    const known = new Set(baseline[r.route] ?? []);
    for (const leak of r.leaks) if (!known.has(leak.module)) added.push(`${r.route} → ${leak.module} (${leak.touches.join(", ")})`);
  }
  assert.deepEqual(added, [], `new routes read producer-scoped data without lib/agency/visibility:\n${added.join("\n")}`);
});

test("a role list is read conservatively: unknown lists count as reachable", () => {
  assert.equal(reachableByNarrowRole(`await requireTenant(["owner"]);`), false);
  assert.equal(reachableByNarrowRole(`await requireFeatureRole("x", ["owner", "bookkeeper"]);`), false);
  assert.equal(reachableByNarrowRole(`await requireFeatureRole("x", ["owner", "producer"]);`), true);
  assert.equal(reachableByNarrowRole(`await requireTenant();`), true);
  assert.equal(reachableByNarrowRole(`await requireFeatureRole("x", SOMETHING_ELSE);`), true);
  assert.equal(reachableByNarrowRole(`const R = ["owner"] as const; await requireFeatureRole("x", R);`), false);
});

test("passing producer_id as a parameter, body field or header changes nothing: the helper never reads the request", () => {
  for (const file of ["lib/agency/visibility.ts", "lib/agency/guards.ts", "lib/agency/visibilityCore.ts"]) {
    // code only — the comments explain this very rule and name producer_id while doing so
    const text = readFileSync(join(ROOT, file), "utf8").replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/[^\n]*/g, "");
    assert.doesNotMatch(text, /searchParams|headers\(|request\.json|producer_id\s*[:=]/, file);
  }
});

test("the gate's resource guards answer 404, not 403: B's record must not be confirmed to exist", () => {
  const guards = readFileSync(join(ROOT, "lib/agency/guards.ts"), "utf8");
  assert.match(guards, /status: 404/);
  assert.doesNotMatch(guards, /status: 403/);
});

test("every own-only exemption still holds: each proof is still in its file", () => {
  const broken = [];
  for (const [page, { proofs }] of Object.entries(OWN_ONLY)) {
    for (const [file, text] of proofs) if (!readFileSync(join(ROOT, file), "utf8").includes(text)) broken.push(`${page}: ${file} no longer contains ${text}`);
  }
  assert.deepEqual(broken, [], "an own-only page lost what made it safe; scope it instead");
});

test("server pages are walked too, and a page's role gate is read conservatively", () => {
  assert.ok(results.some((r) => r.route.endsWith("page.tsx")), "pages are part of the audit");
  assert.equal(pageReachableByNarrowRole(`if (!["owner", "bookkeeper"].includes(guard.role)) return x;`), false);
  // Custom team access: the shared page gate reads the same way.
  assert.equal(pageReachableByNarrowRole(`if (!actAsPage(guard, ["owner", "bookkeeper"])) return x;`), false);
  assert.equal(pageReachableByNarrowRole(`if (!(actAsPage(guard, ["owner", "bookkeeper"]) || manager)) return x;`), false);
  assert.equal(pageReachableByNarrowRole(`if (!actAsPage(guard, ["owner", "producer"])) return x;`), true);
  assert.equal(pageReachableByNarrowRole(`if (!["owner", "producer"].includes(guard.role)) return x;`), true);
  assert.equal(pageReachableByNarrowRole(`if (guard.role !== "owner") return x;`), false);
  assert.equal(pageReachableByNarrowRole(`if (!hasTenantPermission(guard.role, "statements.view")) return x;`), false);
  assert.equal(pageReachableByNarrowRole(`if (!hasTenantPermission(guard.role, "policies.view")) return x;`), true);
  assert.equal(pageReachableByNarrowRole(`if (!actAsPagePermission(guard, "statements.view")) return x;`), false);
  assert.equal(pageReachableByNarrowRole(`if (!actAsPagePermission(guard, "policies.view")) return x;`), true);
  assert.equal(pageReachableByNarrowRole(`const data = await read();`), true, "no gate = reachable");
});
