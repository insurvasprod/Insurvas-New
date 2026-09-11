// Run with: npm test
//
// SA-2.7's state machine exists twice — in availableActions() here, which decides what the admin
// UI offers, and in the SQL functions, which decide what the database permits. The UI half is
// only a convenience; the SQL half is the real guard. They have to agree, or an admin is shown a
// button that fails, or worse, is not shown one the database would have allowed.
//
// SA-2.6 adds a second invariant worth pinning: Notion says in bold "add-ons feed the entitlement
// exactly like plan features — do not build a parallel entitlement path for them". A parallel
// path is the kind of thing that gets added later by someone solving a narrow bug, so the shape
// is asserted rather than trusted.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

import { SUBSCRIPTION_STATUSES, availableActions } from "./access.ts";

const MIGRATIONS = join(process.cwd(), "supabase", "migrations");

/** The last migration to define a signature is the one that will be live. */
function latestDefining(signature) {
  const file = readdirSync(MIGRATIONS)
    .filter((name) => name.endsWith(".sql"))
    .sort()
    .reverse()
    .find((name) => readFileSync(join(MIGRATIONS, name), "utf8").includes(signature));
  assert.ok(file, `no migration defines ${signature}`);
  return readFileSync(join(MIGRATIONS, file), "utf8");
}

function functionBody(sql, signature) {
  const start = sql.indexOf(signature);
  assert.notEqual(start, -1, `${signature} not found`);
  return sql.slice(start, sql.indexOf("$$;", start));
}

const PAUSE_FN = "create or replace function public.admin_set_subscription_pause_state";
const CANCEL_FN = "create or replace function public.admin_cancel_subscription";
const CHANGE_FN = "create or replace function public.admin_change_subscription_plan";
const ENGINE_FN = "create or replace function public.refresh_tenant_entitlement";

// --- SA-2.7 -----------------------------------------------------------------

test("the pausable states in SQL match availableActions().canPause", () => {
  const body = functionBody(latestDefining(PAUSE_FN), PAUSE_FN);

  // The guard is written as a refusal, so the states it does NOT refuse are the pausable ones.
  const match = /status not in \(([^)]*)\)/.exec(body);
  assert.ok(match, "the pause guard should refuse by listing the states it allows");
  const allowedInSql = [...match[1].matchAll(/'([a-z_]+)'/g)].map(([, status]) => status).sort();

  const allowedInCode = SUBSCRIPTION_STATUSES.filter((status) => availableActions(status).canPause).sort();
  assert.deepEqual(allowedInSql, allowedInCode, "SQL and availableActions disagree about who can pause");
});

test("only a paused subscription can be resumed, in both halves", () => {
  const body = functionBody(latestDefining(PAUSE_FN), PAUSE_FN);
  assert.match(body, /status <> 'paused'/, "resume should refuse anything but paused");

  const resumable = SUBSCRIPTION_STATUSES.filter((status) => availableActions(status).canResume);
  assert.deepEqual(resumable, ["paused"]);
});

test("cancel refuses exactly the states availableActions() refuses", () => {
  const body = functionBody(latestDefining(CANCEL_FN), CANCEL_FN);
  assert.match(body, /status = 'cancelled'/, "cancel should refuse an already-cancelled subscription");

  const refused = SUBSCRIPTION_STATUSES.filter((status) => !availableActions(status).canCancel);
  assert.deepEqual(refused, ["cancelled"]);
});

test("changing a plan refuses exactly the states availableActions() refuses", () => {
  const body = functionBody(latestDefining(CHANGE_FN), CHANGE_FN);
  assert.match(body, /status = 'cancelled'/, "plan change should refuse a cancelled subscription");

  const refused = SUBSCRIPTION_STATUSES.filter((status) => !availableActions(status).canChangePlan);
  assert.deepEqual(refused, ["cancelled"]);
});

test("the lifecycle functions raise the error strings the route parses", () => {
  // app/api/admin/subscriptions/[id]/route.ts turns these into 409s with a readable message. A
  // renamed error string silently becomes a 500 instead.
  const change = functionBody(latestDefining(CHANGE_FN), CHANGE_FN);
  for (const token of ["plan_not_found", "plan_archived", "cycle_not_offered"]) {
    assert.match(change, new RegExp(token), `admin_change_subscription_plan should raise ${token}`);
  }

  const cancel = functionBody(latestDefining(CANCEL_FN), CANCEL_FN);
  assert.match(cancel, /subscription_state_not_cancellable/);
});

test("a queued plan change does not take effect early", () => {
  // The route only rebuilds the entitlement when applied_now is true, because "rebuilding early
  // would revoke access they still paid for". So the queued branch must park the change in
  // pending_plan_id and leave plan_id alone.
  const body = functionBody(latestDefining(CHANGE_FN), CHANGE_FN);
  const queued = body.slice(body.indexOf("else", body.indexOf("if p_apply_now")));
  assert.match(queued, /set pending_plan_id = p_new_plan_id/, "the queued branch should set pending_plan_id");
  assert.ok(
    !/set\s+plan_id\s*=/.test(queued),
    "the queued branch must not change plan_id — that is what applying now means",
  );
});

test("cancelling at the period boundary keeps full access until it expires", () => {
  // 'cancelling' maps to full access. Setting 'cancelled' immediately on a non-immediate cancel
  // would take away a term the customer has already paid for.
  const body = functionBody(latestDefining(CANCEL_FN), CANCEL_FN);
  const deferred = body.slice(body.indexOf("else", body.indexOf("if p_immediate")));
  assert.match(deferred, /status\s+= 'cancelling'/, "a deferred cancel should move to 'cancelling'");
  assert.ok(
    !/status\s+= 'cancelled'/.test(deferred),
    "a deferred cancel must not set 'cancelled' — the term is still paid for",
  );
});

// --- SA-2.6 -----------------------------------------------------------------

test("add-on features join the plan's own feature list, not a parallel one", () => {
  const body = functionBody(latestDefining(ENGINE_FN), ENGINE_FN);
  const featureBlock = body.slice(body.indexOf("into v_features"), body.indexOf("into v_meters"));

  assert.match(featureBlock, /addon_features/, "attached add-on features must reach the entitlement");
  assert.match(featureBlock, /\bunion\b/, "they should be unioned into the same feature array");
  assert.match(
    featureBlock,
    /detached_at is null/,
    "a detached add-on must stop granting its features",
  );
});

test("add-on credits stack with the plan's credits for the same meter", () => {
  // SA-2.6 criterion 3. Replacing rather than summing would silently shrink an allowance the
  // customer paid twice for.
  const body = functionBody(latestDefining(ENGINE_FN), ENGINE_FN);
  const meterBlock = body.slice(body.indexOf("with plan_m as"), body.indexOf("into v_meters"));

  assert.match(meterBlock, /addon_meters/, "add-on meters must reach the entitlement");
  assert.match(meterBlock, /sum\(am\.included_qty\)/, "add-on credits should be summed");
  assert.match(
    meterBlock,
    /coalesce\(p\.included_qty, 0\) \+ coalesce\(a\.qty, 0\)/,
    "the plan allowance and the add-on credits should be added together",
  );
  // An unlimited plan allowance must stay unlimited rather than becoming a finite number.
  assert.match(
    meterBlock,
    /p\.included_qty is null then null/,
    "adding credits to an unlimited allowance must leave it unlimited",
  );
});

test("attaching and detaching an add-on rebuild the entitlement immediately", () => {
  // "Attaching an add-on grants its features within seconds, on the next page load."
  for (const fn of [
    "create or replace function public.admin_attach_addon",
    "create or replace function public.admin_detach_addon_for_subscription",
  ]) {
    const body = functionBody(latestDefining(fn), fn);
    assert.match(body, /refresh_tenant_entitlement/, `${fn} should rebuild the entitlement`);
  }
});

test("a detached add-on is kept, not deleted", () => {
  // The attachment is part of the billing record: a past invoice has to stay explainable.
  const sql = latestDefining("create or replace function public.admin_detach_addon_for_subscription");
  const body = functionBody(sql, "create or replace function public.admin_detach_addon_for_subscription");
  assert.match(body, /set detached_at = now\(\)/, "detaching should be a soft delete");
  assert.ok(!/delete from public\.subscription_addons/.test(body), "detaching must not delete the row");
  assert.match(
    sql,
    /revoke delete on public\.subscription_addons from service_role;/,
    "delete should be revoked so the history cannot be removed by accident either",
  );
});
