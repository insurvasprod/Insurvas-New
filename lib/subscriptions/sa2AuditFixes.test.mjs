// Run with: node --experimental-strip-types --test lib/subscriptions/sa2AuditFixes.test.mjs
//
// SA-2 audit (2026-10-15): the server decides when a plan change applies, the entitlement rebuild
// happens inside the change's own transaction, every subscription action carries a reason, and the
// refusals the database makes on purpose answer 4xx, not 500.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

import { assignErrorResponse, changePlanErrorResponse, queuedAsDowngrade } from "./mutationErrors.ts";

const ROOT = process.cwd();
const read = (path) => readFileSync(join(ROOT, path), "utf8");
const MIGRATIONS = join(ROOT, "supabase", "migrations");

function latestDefining(signature) {
  const file = readdirSync(MIGRATIONS).filter((n) => n.endsWith(".sql")).sort().reverse()
    .find((n) => readFileSync(join(MIGRATIONS, n), "utf8").includes(signature));
  assert.ok(file, `no migration defines ${signature}`);
  const sql = readFileSync(join(MIGRATIONS, file), "utf8");
  const start = sql.indexOf(signature);
  return sql.slice(start, sql.indexOf("$$;", start));
}

const CHANGE = latestDefining("create or replace function public.admin_change_subscription_plan");
const CANCEL = latestDefining("create or replace function public.admin_cancel_subscription");

test("fix 1: a downgrade is queued whatever the browser asks; the request only matters otherwise", () => {
  assert.match(CHANGE, /v_apply_now := coalesce\(p_apply_now, true\)\s+and not \(v_old_cents is not null and v_new_cents < v_old_cents\)/);
  assert.match(CHANGE, /if v_apply_now then/);
  assert.doesNotMatch(CHANGE, /if p_apply_now then/, "the caller's flag must not decide on its own");
  // Both prices are read on the subscription's own cycle.
  assert.match(CHANGE, /from public\.plan_prices pp\s+where pp\.plan_id = v_sub\.plan_id/);
  assert.equal(queuedAsDowngrade(true, false), true);
  assert.equal(queuedAsDowngrade(true, true), false);
  assert.equal(queuedAsDowngrade(false, false), false);
});

test("fix 1: the schema treats apply_now as a request and the dialog never offers 'now' for a downgrade", () => {
  const schemas = read("lib/subscriptions/schemas.ts");
  assert.match(schemas, /apply_now: z\.boolean\(\)\.default\(true\)/);
  const dialog = read("components/admin/subscription-panel.tsx");
  assert.match(dialog, /const canApplyNow = direction !== "downgrade";/);
  assert.match(dialog, /const applyNow = canApplyNow && \(override \?\? inferredUpgrade\);/);
});

test("fix 2: change-now and cancel-now rebuild the entitlement inside their own transaction", () => {
  const nowBranch = CHANGE.slice(CHANGE.indexOf("if v_apply_now then"), CHANGE.indexOf("else", CHANGE.indexOf("if v_apply_now then")));
  assert.match(nowBranch, /perform public\.refresh_tenant_entitlement\(v_sub\.tenant_id\)/);
  const immediate = CANCEL.slice(CANCEL.indexOf("if p_immediate then"), CANCEL.indexOf("else", CANCEL.indexOf("if p_immediate then")));
  assert.match(immediate, /perform public\.refresh_tenant_entitlement\(v_sub\.tenant_id\)/);
  // Assign and pause/resume already rebuilt inside (20260912510000, 20260911137000).
  assert.match(latestDefining("create or replace function public.admin_assign_subscription"), /perform public\.refresh_tenant_entitlement\(p_tenant_id\)/);
  assert.match(latestDefining("create or replace function public.admin_set_subscription_pause_state"), /perform public\.refresh_tenant_entitlement\(v_sub\.tenant_id\)/);
});

test("fix 2: nothing after the commit can leave the idempotency claim pending", () => {
  for (const path of ["app/api/admin/subscriptions/route.ts", "app/api/admin/subscriptions/[id]/route.ts"]) {
    const route = read(path);
    assert.doesNotMatch(route, /rebuildEntitlement\(/, `${path}: the rebuild belongs to the database transaction now`);
  }
  const action = read("app/api/admin/subscriptions/[id]/route.ts");
  assert.doesNotMatch(action, /await audit\(\{/, "a post-commit audit must go through recordAudit, which catches");
  assert.match(action, /const recordAudit = async[\s\S]{0,120}try \{\s+await audit\(params\);\s+\} catch/);
  assert.match(action, /catch \(settleError\)/, "a failed proration is reported, not thrown");
  const assign = read("app/api/admin/subscriptions/route.ts");
  assert.match(assign, /catch \(offerError\)/);
  assert.match(assign, /catch \(auditError\)/);
});

test("fix 5: assign answers 409/404/409 for archived plan, missing tenant and the concurrent-assign race", () => {
  assert.equal(assignErrorResponse({ message: "plan_archived" }).status, 409);
  assert.equal(assignErrorResponse({ message: "tenant_not_found", code: "23503" }).status, 404);
  assert.equal(assignErrorResponse({ message: "duplicate key value violates unique constraint", code: "23505" }).status, 409);
  assert.equal(assignErrorResponse({ message: "already_subscribed" }).status, 409);
  assert.equal(assignErrorResponse({ message: "plan_not_found" }).status, 404);
  assert.equal(assignErrorResponse({ message: "cycle_not_offered" }).status, 400);
  assert.equal(assignErrorResponse({ message: "connection reset" }).status, 500);
});

test("fix 5: changing the plan of a cancelled subscription is a 409", () => {
  assert.match(CHANGE, /status = 'cancelled'[\s\S]{0,80}subscription_state_not_cancellable/);
  assert.equal(changePlanErrorResponse({ message: "subscription_state_not_cancellable", code: "23514" }).status, 409);
  assert.equal(changePlanErrorResponse({ message: "subscription_not_found" }).status, 404);
  assert.equal(changePlanErrorResponse({ message: "plan_archived" }).status, 409);
  assert.equal(changePlanErrorResponse({ message: "boom" }).status, 500);
});

test("fix 6: assign, change plan, pause and resume all require a reason and record it", () => {
  const schemas = read("lib/subscriptions/schemas.ts");
  for (const name of ["assignSubscriptionSchema", "changePlanSchema", "cancelSubscriptionSchema", "pauseSubscriptionSchema", "resumeSubscriptionSchema"]) {
    const block = schemas.slice(schemas.indexOf(`export const ${name}`), schemas.indexOf("});", schemas.indexOf(`export const ${name}`)));
    assert.match(block, /reason: reasonField/, `${name} must require a reason`);
  }
  assert.match(read("app/api/admin/subscriptions/route.ts"), /action: "subscription\.assigned",[\s\S]{0,120}reason,/);
  const action = read("app/api/admin/subscriptions/[id]/route.ts");
  assert.match(action, /action: "subscription\.plan_changed",[\s\S]{0,120}reason: parsed\.data\.reason,/);
  assert.match(action, /\(pausing \? pauseSubscriptionSchema : resumeSubscriptionSchema\)\.safeParse\(body\)/);
  // The UI sends one, entered by the admin — no hard-coded "Paused by administrator".
  for (const path of ["components/admin/subscription-panel.tsx", "components/admin/tenant-record/subscription-cards.tsx"]) {
    assert.doesNotMatch(read(path), /Paused by administrator/, path);
  }
});
