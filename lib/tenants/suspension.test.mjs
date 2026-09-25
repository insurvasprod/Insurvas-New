// Suspending an agency (decision 4) and the tenant record's tab routing: the pure rules, plus the
// structural checks that every session guard and sign-in route actually consults them.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import {
  TENANT_SUSPENDED_MESSAGE,
  confirmsTenantName,
  isTenantSuspended,
  membershipsOutsideSuspendedTenants,
  statusAfterUnsuspend,
  suspensionRefusal,
  validateSuspensionInput,
} from "./suspension.ts";
import { CAN_SUSPEND_TENANTS } from "./permissions.ts";
import { TENANT_TABS, tenantTabFrom } from "../../components/admin/tenant-record/types.ts";

const read = (path) => readFileSync(new URL(`../../${path}`, import.meta.url), "utf8");

test("only a suspended tenant is suspended", () => {
  assert.equal(isTenantSuspended("suspended"), true);
  for (const status of ["active", "provisioning", "cancelled", "", null, undefined]) assert.equal(isTenantSuspended(status), false);
});

test("suspend starts from active or provisioning; unsuspend only from suspended", () => {
  assert.equal(suspensionRefusal("active", "suspend"), null);
  assert.equal(suspensionRefusal("provisioning", "suspend"), null);
  assert.match(suspensionRefusal("suspended", "suspend"), /already suspended/);
  assert.match(suspensionRefusal("cancelled", "suspend"), /This one is cancelled/);
  assert.equal(suspensionRefusal("suspended", "unsuspend"), null);
  assert.match(suspensionRefusal("active", "unsuspend"), /Only a suspended agency/);
});

test("unsuspend returns the agency to the state it was suspended from", () => {
  assert.equal(statusAfterUnsuspend("provisioning"), "provisioning");
  assert.equal(statusAfterUnsuspend("active"), "active");
  // An old row, a hand-made suspension, or garbage: back to active.
  for (const value of [undefined, null, "suspended", "cancelled", 42, {}]) assert.equal(statusAfterUnsuspend(value), "active");
});

test("the typed confirmation is the tenant's name, forgiving only whitespace", () => {
  assert.equal(confirmsTenantName("Northline Insurance", "Northline Insurance"), true);
  assert.equal(confirmsTenantName("  Northline   Insurance ", "Northline Insurance"), true);
  assert.equal(confirmsTenantName("northline insurance", "Northline Insurance"), false);
  assert.equal(confirmsTenantName("Northline", "Northline Insurance"), false);
  assert.equal(confirmsTenantName("", ""), false);
  assert.equal(confirmsTenantName(undefined, "Northline Insurance"), false);
});

test("a reason of 5..500 characters is required; the name only to suspend", () => {
  const name = "Northline Insurance";
  assert.deepEqual(validateSuspensionInput({ action: "suspend", reason: "  Chargeback fraud  ", confirmName: name }, name), {
    ok: true,
    reason: "Chargeback fraud",
  });
  assert.equal(validateSuspensionInput({ action: "suspend", reason: "four", confirmName: name }, name).ok, false);
  assert.equal(validateSuspensionInput({ action: "suspend", reason: "x".repeat(501), confirmName: name }, name).ok, false);
  assert.equal(validateSuspensionInput({ action: "suspend", reason: "Chargeback fraud", confirmName: "Northline" }, name).ok, false);
  assert.equal(validateSuspensionInput({ action: "suspend", reason: "Chargeback fraud" }, name).ok, false);
  assert.equal(validateSuspensionInput({ action: "unsuspend", reason: "Balance settled" }, name).ok, true);
});

test("sign-in skips suspended agencies but keeps the person's other workspaces", () => {
  const rows = [{ tenant_id: "a" }, { tenant_id: "b" }, { tenant_id: "c" }];
  const status = new Map([["a", "suspended"], ["b", "active"]]);
  assert.deepEqual(membershipsOutsideSuspendedTenants(rows, status).map((r) => r.tenant_id), ["b", "c"]);
  assert.deepEqual(membershipsOutsideSuspendedTenants([{ tenant_id: "a" }], status), []);
});

test("suspending is super_admin only", () => {
  assert.deepEqual([...CAN_SUSPEND_TENANTS], ["super_admin"]);
});

test("every session guard and sign-in consults the agency's state", () => {
  const guard = read("lib/tenantAuth/requireTenant.ts");
  assert.match(guard, /from\("tenants"\)\.select\("status"\)/, "the agent session guard must read tenants.status");
  assert.match(guard, /isTenantSuspended\(tenant\.status\)/);
  assert.match(guard, /TENANT_SUSPENDED_MESSAGE/, "API callers must be told why, not just 401");

  const partner = read("lib/partnerAuth/requirePartner.ts");
  assert.match(partner, /isTenantSuspended\(tenant\.status\)/, "the partner session guard must refuse a suspended agency");

  const signup = read("lib/signup/context.ts");
  assert.match(signup, /isTenantSuspended\(tenant\.status\)/, "checkout and onboarding must refuse a suspended agency");

  for (const route of ["app/api/app/auth/login/route.ts", "app/api/partner/auth/login/route.ts", "app/api/app/auth/switch-workspace/route.ts"]) {
    assert.match(read(route), /TENANT_SUSPENDED_MESSAGE/, `${route} must refuse a suspended agency with the suspended message`);
  }
  assert.match(read("app/api/app/auth/login/route.ts"), /membershipsOutsideSuspendedTenants\(/);

  // The sign-in page sends a still-signed-in person from a suspended agency to the explanation.
  assert.match(read("app/app/login/page.tsx"), /redirect\("\/app\/suspended"\)/);
  const screen = read("app/app/suspended/page.tsx");
  assert.match(screen, /TENANT_SUSPENDED_MESSAGE/);
  assert.match(screen, /resolveTenantSuspended\(\)/, "the screen must only render for a suspended agency");
});

test("the suspension route is super_admin only, validates, writes conditionally and audits", () => {
  const route = read("app/api/admin/tenants/[id]/suspension/route.ts");
  assert.ok(route.indexOf("requireAdminRole(CAN_SUSPEND_TENANTS)") < route.indexOf("request.json("), "authenticate before reading the body");
  assert.match(route, /validateSuspensionInput\(/);
  assert.match(route, /\.eq\("status", from\)/, "the write must be conditional on the state the admin saw");
  assert.match(route, /"tenant\.suspended"/);
  assert.match(route, /"tenant\.unsuspended"/);
  assert.match(route, /\baudit\(/);
  // Billing is untouched: the route writes tenants and nothing else.
  assert.doesNotMatch(route, /from\("(subscriptions|platform_invoices|payments)"\)\s*\.update/);
});

test("the suspended message is the one sentence the user asked for", () => {
  assert.equal(TENANT_SUSPENDED_MESSAGE, "This agency's account is suspended. Contact support.");
});

test("tab parsing: known keys pass, anything else is the overview", () => {
  assert.deepEqual(TENANT_TABS.map((t) => t.key), ["overview", "subscription", "users", "features", "activity"]);
  for (const tab of TENANT_TABS) assert.equal(tenantTabFrom(tab.key), tab.key);
  assert.equal(tenantTabFrom(undefined), "overview");
  assert.equal(tenantTabFrom(""), "overview");
  assert.equal(tenantTabFrom("billing"), "overview");
  assert.equal(tenantTabFrom("Users"), "overview");
  assert.equal(tenantTabFrom(["features", "users"]), "features");
  assert.equal(tenantTabFrom([]), "overview");
});

test("the frame's tab strip is links with aria-current, in the board's order", () => {
  const frame = read("components/admin/tenant-record/frame.tsx");
  assert.match(frame, /TENANT_TABS\.map/);
  assert.match(frame, /aria-current=\{active \? "page" : undefined\}/);
  assert.match(frame, /\?tab=\$\{tab\.key\}/);
  assert.doesNotMatch(frame, /role="tab"/, "these are routes, not a JS tablist");
  const page = read("app/admin/(protected)/tenants/[id]/page.tsx");
  assert.match(page, /tenantTabFrom\(query\.tab\)/);
  assert.match(page, /canViewTenants\(admin\.role\)/);
});
