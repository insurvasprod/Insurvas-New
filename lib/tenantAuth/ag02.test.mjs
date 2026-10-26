// AG-0.2 · roles and the permission matrix, enforced in API middleware.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";

import { hasTenantPermission, rolePermissions, rolesWith, TENANT_PERMISSIONS, titleWithholds } from "./permissions.ts";
import { baseRoleOf, MEMBER_ROLES, memberRoleOf } from "./roles.ts";

const ROOT = new URL("../../", import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, "$1");
const sql = readFileSync(join(ROOT, "supabase/migrations/20261018110000_ag_0_2_agency_roles.sql"), "utf8");

test("the matrix, role by role, exactly as the spec table", () => {
  // owner: everything
  assert.deepEqual([...rolePermissions("owner")].sort(), [...TENANT_PERMISSIONS].sort());
  // admin: everything except billing and plan changes
  assert.deepEqual([...rolePermissions("admin")].sort(), TENANT_PERMISSIONS.filter((p) => p !== "billing.manage").sort());
  // manager: own + direct reports — leads, policies, scorecards; not agency accounting
  for (const p of rolePermissions("producer")) assert.ok(hasTenantPermission("manager", p), `manager has producer's ${p}`);
  assert.ok(hasTenantPermission("manager", "team.view.reports"));
  for (const p of ["money.view", "commission.view.all", "payouts.view", "statements.view", "billing.manage", "team.manage"]) {
    assert.equal(hasTenantPermission("manager", p), false, `manager lacks ${p}`);
  }
  // producer: own leads, applications, book, pay — not others' rows, agency accounting or lead costs
  for (const p of ["money.view", "commission.view.all", "team.view.reports", "billing.manage", "team.manage"]) {
    assert.equal(hasTenantPermission("producer", p), false, `producer lacks ${p}`);
  }
  assert.ok(hasTenantPermission("producer", "commission.view.own"));
  // assistant: whatever his producer sees, minus any money figure
  for (const p of rolePermissions("assistant")) assert.ok(!/commission|money|payout|statement|exposure/.test(p), `assistant holds no money: ${p}`);
  // bookkeeper: ledger, statements, payouts, P&L, exports — no dial, sell or client detail
  for (const p of ["money.view", "statements.view", "payouts.view", "exports.run", "commission.view.all"]) assert.ok(hasTenantPermission("bookkeeper", p), p);
  for (const p of ["dialer.use", "sales.use", "leads.manage", "recordings.listen"]) assert.equal(hasTenantPermission("bookkeeper", p), false, p);
  // retention: policies at risk, save queue, payment repair — no commission detail, no lead costs
  assert.ok(hasTenantPermission("retention", "retention.work"));
  for (const p of ["commission.view.own", "commission.view.all", "money.view"]) assert.equal(hasTenantPermission("retention", p), false, p);
});

test("a role the matrix does not name has no permissions (default deny)", () => {
  assert.deepEqual([...rolePermissions("ghost")], []);
  assert.equal(hasTenantPermission("ghost", "policies.view"), false);
});

test("titles ride on a base role and keep its authority; the matrix still withholds what it withholds", () => {
  assert.equal(baseRoleOf("admin"), "owner");
  assert.equal(baseRoleOf("manager"), "producer");
  assert.equal(memberRoleOf("owner", "admin"), "admin");
  assert.equal(memberRoleOf("producer", "manager"), "manager");
  assert.equal(memberRoleOf("assistant", "manager"), "assistant", "a title the base role cannot carry is ignored");
  assert.equal(titleWithholds("admin", "billing.manage"), true);
  assert.equal(titleWithholds("owner", "billing.manage"), false);
  assert.equal(titleWithholds("manager", "dialer.use"), false);
  // routes list base roles only
  for (const permission of TENANT_PERMISSIONS) {
    for (const role of rolesWith(permission)) assert.ok(!["admin", "manager"].includes(role), `${permission} lists ${role}`);
  }
  assert.equal(MEMBER_ROLES.length, 8);
});

test("billing and the payment method refuse an agency admin", () => {
  for (const file of ["app/api/app/billing/route.ts", "app/api/app/billing/payment-method/route.ts"]) {
    assert.match(readFileSync(join(ROOT, file), "utf8"), /refuseWithoutBilling\(auth\.context\)/, file);
  }
});

test("the database keeps a real owner and writes the title in one place", () => {
  assert.match(sql, /raise exception 'last_owner'/);
  assert.match(sql, /order by \(tu\.agency_role is not null\)/);
  assert.match(sql, /revoke insert, update on public\.tenant_users from service_role, authenticated;/);
  assert.doesNotMatch(sql.split("\n").filter((l) => /^grant (insert|update)/.test(l)).join("\n"), /agency_role/);
  assert.match(sql, /agency_role_needs_agency_plan/);
});

// ─── CI check: every API route declares its gate ────────────────────────────────────────────────────
// A route is declared when it calls a tenant gate (requireTenant / requireFeatureRole / requireFeature),
// or one of the named non-session gates for planes that are not a signed-in member (sign-in itself,
// signup, the browser extension's scoped token). A route that calls none of them fails the build.
const GATES = /\b(requireTenant|requireFeatureRole|requireFeature|resolveTenantContext|resolveSignupContext|authenticateExtension)\s*\(/;
const NON_SESSION_ALLOWED = new Set([
  // signing in and recovering an account happen before there is a session
  "app/api/app/auth/accept-invite/route.ts",
  "app/api/app/auth/confirm-email/route.ts",
  "app/api/app/auth/forgot-password/route.ts",
  "app/api/app/auth/sign-in-link/route.ts",
  "app/api/app/auth/login/route.ts",
  "app/api/app/auth/logout/route.ts",
  "app/api/app/auth/set-password/route.ts",
  "app/api/app/auth/verify-2fa/route.ts",
  "app/api/app/signup/route.ts",
]);

function routes(dir) {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return routes(path);
    return name === "route.ts" ? [path] : [];
  });
}

test("every /api/app route declares a gate; the list is read from the router, not written by hand", () => {
  const all = routes(join(ROOT, "app/api/app")).map((p) => relative(ROOT, p).replace(/\\/g, "/"));
  assert.ok(all.length > 300, `found ${all.length} routes`);
  const undeclared = all.filter((file) => !NON_SESSION_ALLOWED.has(file) && !GATES.test(readFileSync(join(ROOT, file), "utf8")));
  assert.deepEqual(undeclared, [], `routes with no gate:\n${undeclared.join("\n")}`);
  for (const file of NON_SESSION_ALLOWED) assert.ok(all.includes(file), `allow-list names a route that no longer exists: ${file}`);
});
