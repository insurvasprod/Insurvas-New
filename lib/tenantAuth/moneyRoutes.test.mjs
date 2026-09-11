// Run with: npm test
//
// LA-0.2 acceptance criterion 1 names its own artifact:
//
//   "An `assistant` calling any commission or ledger endpoint gets 403 — verified by an
//    automated test across every money route."
//
// This is that test. It is deliberately a static assertion over the route tree rather than a
// list of hand-written HTTP cases, because the criterion says *every* money route: a test that
// enumerates cases by hand stops being true the moment someone adds the next one.
//
// The mechanism is exhaustive classification. Every `route.ts` under `app/api/app` must match
// exactly one classification rule. A new route that matches none fails this file — so the person
// adding a commission endpoint has to say so here before it can ship, and the assistant gate is
// checked from that moment on.
//
// Notion: LA-0.2 · In-tenant roles & permissions, and the $29-assistant-seat argument that makes
// hiding money a commercial requirement rather than a nicety.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync, existsSync } from "node:fs";
import { join } from "node:path";

import { AGENT_API_POLICIES } from "../entitlements/agentApiPolicy.ts";
import { TENANT_ROLES } from "./roles.ts";
import { hasTenantPermission } from "./permissions.ts";

const API_ROOT = join(process.cwd(), "app", "api", "app");

/** Route ids are posix-relative to app/api/app, e.g. "ledger/route.ts". */
function agentRoutes(dir = API_ROOT, prefix = "") {
  if (!existsSync(dir)) return null;
  const found = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const id = prefix ? `${prefix}/${entry.name}` : entry.name;
    if (entry.isDirectory()) found.push(...(agentRoutes(join(dir, entry.name), id) ?? []));
    else if (entry.name === "route.ts") found.push(id);
  }
  return found.sort();
}

// ---------------------------------------------------------------------------
// Classification
// ---------------------------------------------------------------------------

/**
 * Money routes: anything that can return a commission figure, a ledger entry, a payout, a
 * statement, a premium-derived amount, or a partner economic metric. An `assistant` must never
 * reach these.
 */
const MONEY_ROUTE_PATTERNS = [
  /^ledger\//,
  /^policies\//, // policy records carry premium and commission
  /^partner-quality\//, // cost-per-acquisition and payout quality metrics
  /^statements?\//,
  /^discrepancies\//,
  /^commissions?\//,
  /^payouts?\//,
  /^advances?\//,
  /^pnl\//,
  /^tax\//,
  /^true-cpa\//,
  /^persistency\//,
];

/** Dialing and call-recording routes: a `bookkeeper` must never reach these. */
const DIAL_OR_RECORDING_PATTERNS = [/^dial\//, /recording/];

/**
 * Everything else. Listed explicitly rather than matched by a catch-all, so that a newly added
 * route is unclassified until someone decides which side of the money boundary it sits on.
 */
const NEUTRAL_ROUTES = new Set([
  "agent-floor/route.ts",
  "announcements/[id]/dismiss/route.ts",
  "announcements/route.ts",
  "appointment-vault/appointments/route.ts",
  "appointment-vault/ce-records/route.ts",
  "appointment-vault/eo-policies/route.ts",
  "appointment-vault/licenses/route.ts",
  "appointment-vault/route.ts",
  "auth/confirm-email/route.ts",
  "auth/login/route.ts",
  "auth/logout/route.ts",
  "auth/set-password/route.ts",
  "callbacks/route.ts",
  "carrier-library/advance-rules/route.ts",
  "carrier-library/commission-schedules/route.ts",
  "carrier-library/route.ts",
  "carrier-library/tenant-carriers/route.ts",
  "checkout/coupon/route.ts",
  "checkout/start/route.ts",
  "contacts/export/route.ts",
  "contacts/field-schema/route.ts",
  "contacts/import/route.ts",
  "contacts/merge/route.ts",
  "contacts/merge/undo/route.ts",
  "contacts/route.ts",
  "deal-flow/[id]/route.ts",
  "deal-flow/route.ts",
  "dispositions/config/route.ts",
  "inbound/claim/route.ts",
  "inbound/disposition/route.ts",
  "inbound/handoff/route.ts",
  "inbound/route.ts",
  "inbound/transfer/route.ts",
  "inbound/verification/route.ts",
  "leads/[id]/disposition/route.ts",
  "leads/[id]/notes/route.ts",
  "leads/[id]/preflight/route.ts",
  "leads/[id]/reopen/route.ts",
  "leads/[id]/route.ts",
  "leads/draft/route.ts",
  "leads/export/route.ts",
  "leads/import/route.ts",
  "leads/route.ts",
  "legal/accept/route.ts",
  "me/route.ts",
  "notes/search/route.ts",
  "notifications/route.ts",
  "onboarding/business-profile/route.ts",
  "onboarding/status/route.ts",
  "onboarding/verification/route.ts",
  "partner-chat/attachments/[id]/route.ts",
  "partner-chat/route.ts",
  "partners/[id]/affiliate-links/[linkId]/route.ts",
  "partners/[id]/affiliate-links/route.ts",
  "partners/[id]/products/route.ts",
  "partners/[id]/route.ts",
  "partners/[id]/users/[userId]/resend-invite/route.ts",
  "partners/[id]/users/[userId]/route.ts",
  "partners/[id]/users/route.ts",
  "partners/route.ts",
  "pipelines/[id]/route.ts",
  "pipelines/[id]/stages/[stageId]/route.ts",
  "pipelines/[id]/stages/reorder/route.ts",
  "pipelines/[id]/stages/route.ts",
  "pipelines/dispositions/route.ts",
  "pipelines/route.ts",
  "products/[code]/route.ts",
  "products/route.ts",
  "queue-sla-settings/route.ts",
  "signup/route.ts",
  "team/[userId]/route.ts",
  "team/route.ts",
  "templates/[id]/route.ts",
  "templates/assignment/route.ts",
  "templates/preview/route.ts",
  "templates/route.ts",
]);

function classify(routeId) {
  if (MONEY_ROUTE_PATTERNS.some((pattern) => pattern.test(routeId))) return "money";
  if (DIAL_OR_RECORDING_PATTERNS.some((pattern) => pattern.test(routeId))) return "dial";
  if (NEUTRAL_ROUTES.has(routeId)) return "neutral";
  return "unclassified";
}

// ---------------------------------------------------------------------------
// Reading the guard out of a route's source
// ---------------------------------------------------------------------------

const GUARD_WITH_ROLES = /require(?:FeatureRole|Tenant)\(\s*(?:['"`][a-z0-9_]+['"`]\s*,\s*)?(\[[^\]]*\]|[A-Za-z_][A-Za-z0-9_]*)/g;
const UNGATED_GUARD = /requireFeature\(\s*['"`][a-z0-9_]+['"`]/g;
const ROLE_CONSTANT = /const\s+([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(\[[^\]]*\])\s*as\s+const/g;

function roleLiterals(fragment) {
  return [...fragment.matchAll(/['"`](owner|producer|assistant|bookkeeper)['"`]/g)].map((match) => match[1]);
}

/**
 * Every role set the route's guards allow, with in-file `as const` role constants resolved.
 * Returns null when the route applies no role gate at all.
 */
function guardedRoleSets(source) {
  const constants = new Map();
  for (const [, name, literal] of source.matchAll(ROLE_CONSTANT)) {
    const roles = roleLiterals(literal);
    if (roles.length > 0) constants.set(name, roles);
  }

  const sets = [];
  for (const [, target] of source.matchAll(GUARD_WITH_ROLES)) {
    if (target.startsWith("[")) {
      const roles = roleLiterals(target);
      if (roles.length > 0) sets.push(roles);
    } else if (constants.has(target)) {
      sets.push(constants.get(target));
    } else {
      // A role argument we cannot resolve statically is a failure, not a pass: an unreadable
      // gate is exactly the thing this test exists to refuse.
      sets.push(null);
    }
  }

  const ungated = [...source.matchAll(UNGATED_GUARD)].length;
  if (ungated > 0) sets.push([...TENANT_ROLES]); // no role gate == every role reaches it
  return sets;
}

function sourceFor(routeId) {
  return readFileSync(join(API_ROOT, routeId), "utf8");
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

test("every agent API route is classified on one side of the money boundary", () => {
  const routes = agentRoutes();
  if (!routes) return;

  const unclassified = routes.filter((routeId) => classify(routeId) === "unclassified");
  assert.deepEqual(
    unclassified,
    [],
    `unclassified agent API route(s). Decide whether each can expose a commission figure, then ` +
      `add it to MONEY_ROUTE_PATTERNS, DIAL_OR_RECORDING_PATTERNS, or NEUTRAL_ROUTES: ${unclassified.join(", ")}`,
  );
});

test("the neutral list has no entries for routes that no longer exist", () => {
  const routes = agentRoutes();
  if (!routes) return;

  const onDisk = new Set(routes);
  const stale = [...NEUTRAL_ROUTES].filter((routeId) => !onDisk.has(routeId));
  assert.deepEqual(stale, [], `NEUTRAL_ROUTES names routes that are gone: ${stale.join(", ")}`);
});

test("an assistant cannot reach any money route", () => {
  const routes = agentRoutes();
  if (!routes) return;

  const money = routes.filter((routeId) => classify(routeId) === "money");
  assert.ok(money.length > 0, "no money routes found — the classifier is broken, not the app");

  const leaks = [];
  for (const routeId of money) {
    const sets = guardedRoleSets(sourceFor(routeId));
    if (sets.length === 0) {
      leaks.push(`${routeId}: no guard at all`);
      continue;
    }
    for (const roles of sets) {
      if (roles === null) leaks.push(`${routeId}: role argument is not statically readable`);
      else if (roles.includes("assistant")) leaks.push(`${routeId}: allows assistant`);
    }
  }

  assert.deepEqual(leaks, [], `money routes reachable by an assistant:\n  ${leaks.join("\n  ")}`);
});

test("a bookkeeper cannot reach a dialer or recording route", () => {
  const routes = agentRoutes();
  if (!routes) return;

  const dial = routes.filter((routeId) => classify(routeId) === "dial");
  // Recording playback has no endpoint yet; the dialer preflight does. When a recording route is
  // added it matches DIAL_OR_RECORDING_PATTERNS and is covered here without further edits.
  assert.ok(dial.length > 0, "no dialer routes found — the classifier is broken, not the app");

  const leaks = [];
  for (const routeId of dial) {
    for (const roles of guardedRoleSets(sourceFor(routeId))) {
      if (roles === null) leaks.push(`${routeId}: role argument is not statically readable`);
      else if (roles.includes("bookkeeper")) leaks.push(`${routeId}: allows bookkeeper`);
    }
  }

  assert.deepEqual(leaks, [], `dialer/recording routes reachable by a bookkeeper:\n  ${leaks.join("\n  ")}`);
});

test("the route guard and the permission map agree about who sees money", () => {
  // permissions.ts is the product's own statement of who may see money. If a role that the
  // permission map denies every money permission can still reach a money route, one of the two
  // is lying — and the route is the one that decides what a customer actually gets.
  const routes = agentRoutes();
  if (!routes) return;

  const moneyPermissions = ["money.view", "commission.view.own", "commission.view.all", "statements.view", "payouts.view"];
  const deniedRoles = TENANT_ROLES.filter(
    (role) => !moneyPermissions.some((permission) => hasTenantPermission(role, permission)),
  );
  assert.deepEqual(deniedRoles, ["assistant"], "the set of money-denied roles changed; revisit this test");

  const money = routes.filter((routeId) => classify(routeId) === "money");
  for (const routeId of money) {
    for (const roles of guardedRoleSets(sourceFor(routeId))) {
      for (const role of deniedRoles) {
        assert.ok(
          !(roles ?? []).includes(role),
          `${routeId} admits ${role}, which permissions.ts denies every money permission`,
        );
      }
    }
  }
});

test("the policy registry records the roles the route source actually enforces", () => {
  // agentApiPolicy.ts is what the feature checker and the plan preview read. When it drifts from
  // the source, every consumer of it is reasoning about a guard that is not the deployed one.
  const routes = agentRoutes();
  if (!routes) return;

  const registry = new Map(
    AGENT_API_POLICIES.map((policy) => [policy.sourceFile.replace(/^app\/api\/app\//, ""), policy]),
  );

  const drift = [];
  for (const routeId of routes) {
    const policy = registry.get(routeId);
    if (!policy) {
      drift.push(`${routeId}: on disk but absent from AGENT_API_POLICIES`);
      continue;
    }
    const sets = guardedRoleSets(sourceFor(routeId));
    const enforced = new Set(sets.flatMap((roles) => roles ?? []));
    if (!policy.allowedRoles) {
      // The registry claims no role restriction. That is only honest if the source restricts
      // nothing either.
      if (enforced.size > 0 && enforced.size < TENANT_ROLES.length) {
        drift.push(`${routeId}: source restricts to [${[...enforced].sort().join(", ")}] but the registry records no allowedRoles`);
      }
      continue;
    }
    for (const role of policy.allowedRoles) {
      if (enforced.size > 0 && !enforced.has(role)) {
        drift.push(`${routeId}: registry allows ${role} but no guard in the source does`);
      }
    }
  }

  assert.deepEqual(drift, [], `agentApiPolicy.ts has drifted from the route sources:\n  ${drift.join("\n  ")}`);
});

test("every registry entry points at a route that exists", () => {
  const routes = agentRoutes();
  if (!routes) return;

  const onDisk = new Set(routes);
  const missing = AGENT_API_POLICIES.map((policy) => policy.sourceFile.replace(/^app\/api\/app\//, ""))
    .filter((routeId) => !onDisk.has(routeId));

  assert.deepEqual(missing, [], `AGENT_API_POLICIES names routes that do not exist: ${missing.join(", ")}`);
});
