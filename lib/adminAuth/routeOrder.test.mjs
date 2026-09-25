/**
 * Every admin route authenticates before it reads a request body.
 *
 * ## Why this test exists
 *
 * `POST /api/admin/users/[id]/suspend` validated its body first and authenticated second. The
 * effect was small but real: an anonymous caller received `400 "A reason is required"` where all
 * 44 other dynamic admin routes answer `401`. So the one route on the whole admin surface that did
 * not refuse a stranger outright was the one that suspends accounts, and it disclosed its input
 * contract to anybody who asked.
 *
 * It was found by probing the routes (`npm run qa:sa-dynamic`), which needs a running app and a
 * database. This test needs neither, so it runs in `npm test` on every change — which is the only
 * way an ordering rule survives the next route somebody adds.
 *
 * ## What it does not claim
 *
 * Source order is not proof of runtime order. A route could authenticate inside a branch, or in a
 * helper this scan cannot see. It is a floor, not a ceiling: it catches the mistake that was
 * actually made, cheaply, everywhere.
 */
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { join, sep } from "node:path";
import { fileURLToPath } from "node:url";

const ADMIN_API = join(fileURLToPath(new URL("../../", import.meta.url)), "app", "api", "admin");

/** Anything that establishes who the caller is before the handler does real work. */
const AUTH = /requireAdminRole\s*\(|resolveAdminContext\s*\(|getCurrentAdmin\s*\(|getAdminSession\s*\(/;
/** Anything that reads the caller's payload. */
const BODY = /request\.json\s*\(|req\.json\s*\(|request\.formData\s*\(/;

function routeFiles(dir, found = []) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) routeFiles(path, found);
    else if (entry.name === "route.ts") found.push(path);
  }
  return found;
}

const routes = routeFiles(ADMIN_API)
  .map((path) => ({
    route: path.slice(path.indexOf(`app${sep}api${sep}admin`)).split(sep).join("/"),
    source: readFileSync(path, "utf8"),
  }))
  .sort((a, b) => a.route.localeCompare(b.route));

/**
 * Routes that legitimately read a body before authenticating, because authenticating is what they
 * are for. Any addition here needs the same kind of reason.
 */
const PRE_AUTH_ROUTES = {
  "app/api/admin/auth/login/route.ts": "the credentials are the body",
  "app/api/admin/auth/verify-2fa/route.ts": "the TOTP code is the body; the session is still at stage 'pending'",
};

/**
 * Routes with no auth call of their own because they delegate the whole operation — including its
 * authorization — to one helper. They parse no body, so there is no ordering question.
 */
const DELEGATED_AUTH_ROUTES = {
  "app/api/admin/users/[id]/activate/route.ts": "setUserStatus() authorizes first",
  "app/api/admin/users/[id]/deactivate/route.ts": "setUserStatus() authorizes first",
  "app/api/admin/users/[id]/unsuspend/route.ts": "setUserStatus() authorizes first",
};

/**
 * Asserts a list is exactly the set found — so the test fails both when a new violation appears
 * and when an entry is fixed but left behind. A stale allowlist is how a guard stops guarding.
 */
function assertExactly(found, known, what) {
  assert.deepEqual(
    found.filter((route) => !(route in known)),
    [],
    `NEW ${what}. An admin route must establish who the caller is before it reads their input.`,
  );
  assert.deepEqual(
    Object.keys(known).filter((route) => !found.includes(route)),
    [],
    `${what} listed as known but no longer present — delete these entries from this test.`,
  );
}

test("no admin route reads a request body before it authenticates", () => {
  const violations = routes
    .filter(({ source }) => BODY.test(source))
    .filter(({ source }) => {
      const body = source.search(BODY);
      const auth = source.search(AUTH);
      return auth === -1 || auth > body;
    })
    .map(({ route }) => route);

  assertExactly(violations, PRE_AUTH_ROUTES, "admin route(s) parsing a body before authenticating");
});

test("every admin route either authenticates or delegates to something that does", () => {
  const unauthenticated = routes.filter(({ source }) => !AUTH.test(source)).map(({ route }) => route);
  const known = { ...DELEGATED_AUTH_ROUTES, ...PRE_AUTH_ROUTES };

  assertExactly(unauthenticated, known, "admin route(s) with no authentication call");
});

test("the scan actually found the admin surface", () => {
  // A regex that matches nothing passes every assertion above. Pin the shape of the input so a
  // refactor that moves or renames the admin API cannot turn this file into a no-op.
  assert.ok(routes.length > 50, `expected the admin API to have >50 routes, found ${routes.length}`);
  assert.ok(
    routes.some((r) => AUTH.test(r.source)),
    "no route matched the auth pattern — the helper was probably renamed, so this guard is blind",
  );
  assert.ok(
    routes.some((r) => BODY.test(r.source)),
    "no route matched the body pattern — the ordering assertion is vacuous",
  );
});
