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
  /^vendor-returns\//,
  /^persistency\//,
  // Campaigns and vendors were neutral while they returned only a name and a status. They now
  // return what a list cost, what it cost after credits, and what a usable lead cost after scrub
  // rejections — which is the money Ray spends to fill his own pipeline. An assistant or a setter
  // must not see it, and reclassifying is cheaper than discovering later that they could.
  /^campaigns\//,
  /^vendors\//,
  // The day funnel adds up what the served leads cost and the premium the day wrote.
  /^deal-flow\/funnel\//,
];

/**
 * Quoting and application routes: anything that can produce a quote, open or submit an
 * application, or read the book of business those applications land in. A `setter` must never
 * reach these — "Cannot: Sell, quote, or submit an application" is the first line of the role's
 * own table in LA-2.12.
 *
 * The book of business is here rather than in NEUTRAL_ROUTES because a lead record carries the
 * premium and the quote; "he can only read it" is not a defence when reading it is the leak.
 */
const QUOTE_OR_APPLICATION_PATTERNS = [
  /^leads\/route\.ts$/,
  /^leads\/draft\//,
  /^leads\/export\//,
  /^leads\/import\//,
  /^outbound\/application\//,
  /^deal-flow\//,
  /^products\//,
  /^carrier-library\//,
];

// NOT in that list, deliberately: leads/[id]/notes, leads/[id]/disposition and leads/[id] itself.
// "Record dispositions" and "Add notes on a lead" are both in the setter's CAN column, so barring
// the whole /leads tree would have implemented the opposite of the role. The single lead a setter
// may open is scoped to the one they were served, in getLeadWorkspace, because the question there
// is WHICH lead rather than whether the route exists.

/** Dialing and call-recording routes: a `bookkeeper` must never reach these. */
const DIAL_OR_RECORDING_PATTERNS = [/^dial\//, /^dialer\//, /recording/];

/**
 * Everything else. Listed explicitly rather than matched by a catch-all, so that a newly added
 * route is unclassified until someone decides which side of the money boundary it sits on.
 */
const NEUTRAL_ROUTES = new Set([
  "assignments/route.ts",
  "compliance/consent/claim/route.ts",
  "activity/route.ts",
  "agent-floor/route.ts",
  "announcements/[id]/dismiss/route.ts",
  "announcements/route.ts",
  "nurture/route.ts",
  "agency-profile/route.ts", // legal identity; owner only, no money
  "partner-support-contact/route.ts", // support email and phone partners see; owner only, no money
  "appointment-vault/appointments/route.ts",
  "appointment-vault/carrier-training/route.ts", // carrier trainings; owner only, no money
  "appointment-vault/ce-records/route.ts",
  "appointment-vault/eo-policies/route.ts",
  "appointment-vault/licenses/route.ts",
  "appointment-vault/route.ts",
  "auth/confirm-email/route.ts",
  // Signed out: the same answer for every address; the link goes to the account holder's inbox.
  "auth/forgot-password/route.ts",
  "auth/login/route.ts",
  "auth/logout/route.ts",
  "auth/set-password/route.ts",
  // Switching workspace: names and roles of the caller's own memberships, and a re-issued session.
  // No figure crosses it; every role may switch, because every role may belong to two agencies.
  "auth/switch-workspace/route.ts",
  "auth/workspaces/route.ts",
  // The caller's own name, phone and producer numbers. Every role edits their own; no money.
  "profile/route.ts",
  "callbacks/route.ts",
  // Dialer configuration, all of it: when a lead comes back, which hours the agency will dial in,
  // and which numbers must never be called. None of it returns a figure. A setter reaching the
  // read side is intended — "why can I not call this lead yet" is answered by exactly this data,
  // and the write side is owner-only in each route rather than here.
  "cadence/route.ts",
  "calling-windows/route.ts",
  "suppression/route.ts",
  // Consent evidence: a certificate, an IP, a timestamp and the copy we hold. It touches the lead
  // record, which does carry premium, but this route selects the artefact columns only and never
  // joins a quote or a commission. Read-only by design, so there is nothing here to widen.
  "consent/route.ts",
  // Posting keys are a credential, not a price. A key's row carries a prefix, a field map and a
  // last-used stamp; what the vendor charges lives on the campaign, which is a money route. Owner
  // only in the route regardless, because minting one lets an outside party write billable leads.
  "lead-post-keys/route.ts",
  "lead-post-keys/[id]/route.ts",
  "appointments/close-out/route.ts",
  // Booking is neutral, and a setter reaching it is correct rather than a leak: LA-2.12's role
  // table says a setter CAN "book appointments into Ray's slots". The money boundary is elsewhere —
  // they still cannot reach a money, quoting or application route, which the assertions below walk
  // every route to prove.
  "appointments/route.ts",
  // Working hours, blocked time and the daily cap. No money, and a setter is kept out of it by the
  // other half of the same role-table line — "cannot change availability or configuration".
  "availability/route.ts",
  // Linking an agent's Google or Outlook calendar, and the OAuth callback (20260924230200). Busy
  // intervals and connection state only — no money, and the same roles as availability.
  "calendar-connections/route.ts",
  "calendar-connections/callback/route.ts",
  // The appointment diary. Customers, times and setter notes — no money, and nothing about what
  // anybody earned.
  "calendar/route.ts",
  // The lead-list inventory. It carries campaign SPEND — what a list cost and what was credited
  // back — which is money the tenant paid out, not commission the agent earned. The boundary this
  // file guards is commission: what a producer may see about their own and other people's earnings.
  // Bookkeeper is excluded here anyway, and a setter is excluded by the route's role list.
  "lead-lists/route.ts",
  "carrier-library/advance-rules/route.ts",
  "carrier-library/commission-schedules/route.ts",
  "carrier-library/route.ts",
  "carrier-library/tenant-carriers/route.ts",
  "checkout/coupon/route.ts",
  "checkout/start/route.ts",
  // Confirms a returned checkout with the provider and reports confirmed/pending/done. No figures.
  "checkout/verify/route.ts",
  "contacts/export/route.ts",
  "contacts/field-schema/route.ts",
  "contacts/import/route.ts",
  "contacts/merge/route.ts",
  "contacts/merge/undo/route.ts",
  "contacts/reviews/route.ts",
  "contacts/route.ts",
  "deal-flow/[id]/route.ts",
  "deal-flow/route.ts",
  "dispositions/config/route.ts",
  "inbound/claim/route.ts",
  "inbound/claim-next/route.ts",
  "inbound/disposition/route.ts",
  "inbound/handoff/route.ts",
  "inbound/route.ts",
  // Screening ladder for one transfer, and lost transfers / today-by-partner counts. No premium or
  // money: customer names, partner names, counts and screening outcomes.
  "inbound/screening/route.ts",
  "inbound/today/route.ts",
  "inbound/transfer/route.ts",
  "inbound/verification/route.ts",
  // Reads one masked verification value back for the agent on the call, and audits the read.
  // SSN and banking details, not money: no commission, premium or ledger figure.
  "inbound/verification/reveal/route.ts",
  "leads/[id]/disposition/route.ts",
  "leads/[id]/notes/route.ts",
  "leads/[id]/preflight/route.ts",
  "leads/[id]/record/route.ts",
  // Six yes/no answers about whether the customer can sign today. No premium, quote or money.
  "leads/[id]/signature-readiness/route.ts",
  "leads/[id]/reopen/route.ts",
  "leads/[id]/route.ts",
  // Pipeline views: a lead's stage history, the stage/disposition context, and the move-by-disposition.
  // Stage and outcome names only — no premium, quote or cost crosses them.
  "leads/[id]/stage-history/route.ts",
  "leads/move/route.ts",
  "leads/pipeline-context/route.ts",
  "leads/pipeline-rules/route.ts",
  "leads/draft/route.ts",
  "leads/export/route.ts",
  "leads/import/route.ts",
  "leads/import/mappings/route.ts",
  // The preflight stages a file for review and writes no lead. It is in the same quoting/
  // application family as the import itself, which the setter assertion below already bars them
  // from; it is neutral for the assistant, who does the importing.
  "leads/import/preflight/route.ts",
  "leads/route.ts",
  "legal/accept/route.ts",
  "me/route.ts",
  "notes/search/route.ts",
  "notifications/route.ts",
  // Workspace search. Each group is gated inside lib/search/service.ts on the feature and roles of
  // the page it opens, and no group carries a commission figure — policies show premium, the
  // customer's number, and lead lists show counts, not cost.
  "search/route.ts",
  "onboarding/business-profile/route.ts",
  "onboarding/status/route.ts",
  "onboarding/verification/route.ts",
  "partner-chat/attachments/[id]/route.ts",
  "partner-chat/route.ts",
  "partners/[id]/affiliate-links/[linkId]/route.ts",
  "partners/[id]/affiliate-links/route.ts",
  "partners/[id]/form-catalog/route.ts",
  "partners/[id]/form-presets/route.ts",
  "partners/[id]/form-profile/route.ts",
  "partners/[id]/market-access/route.ts",
  "partners/[id]/products/route.ts",
  "partners/[id]/route.ts",
  "partners/[id]/submission-setup/route.ts",
  "partners/[id]/users/[userId]/admin-assignment/route.ts",
  "partners/[id]/users/[userId]/form-profile/route.ts",
  "partners/[id]/users/[userId]/market-access/route.ts",
  "partners/[id]/users/[userId]/resend-invite/route.ts",
  "partners/[id]/users/[userId]/route.ts",
  "partners/[id]/users/route.ts",
  "partners/route.ts",
  "partners/export/route.ts",
  "pipelines/[id]/route.ts",
  "pipelines/[id]/stages/[stageId]/route.ts",
  "pipelines/[id]/stages/reorder/route.ts",
  "pipelines/[id]/stages/route.ts",
  "pipelines/dispositions/route.ts",
  "pipelines/route.ts",
  "products/[code]/route.ts",
  "products/route.ts",
  "outbound/application/route.ts",
  // The outbound twin of inbound/verification/reveal: one masked value, audited. Not money.
  "outbound/application/reveal/route.ts",
  "queue-sla-settings/route.ts",
  "scorecard/route.ts",
  // Queue scoring carries no cost figure. `vendor_contact_rate` is a quality signal — what share of
  // a vendor's leads answered — not what they were paid, so it does not cross the money boundary.
  // The preview is the same surface read-only: tiers, reasons, the score and the calling window.
  "scoring/preview/route.ts",
  "scoring/route.ts",
  "signup/route.ts",
  "team/[userId]/invite/route.ts",
  "team/[userId]/licensed-states/route.ts",
  "team/[userId]/resend-invite/route.ts",
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
  return [...fragment.matchAll(/['"`](owner|producer|assistant|bookkeeper|setter)['"`]/g)].map((match) => match[1]);
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

test("a setter cannot reach any money, quoting or application route", () => {
  // LA-2.12 criterion 1: "A setter calling any money, quoting or application route gets 403 —
  // asserted by test across every route." This reuses the classifier above rather than listing
  // endpoints by hand, for the same reason the assistant test does: a hand-written list stops
  // being true the moment somebody adds the next route.
  const routes = agentRoutes();
  if (!routes) return;

  const forbidden = routes.filter(
    (routeId) =>
      classify(routeId) === "money" ||
      QUOTE_OR_APPLICATION_PATTERNS.some((pattern) => pattern.test(routeId)),
  );
  assert.ok(forbidden.length > 0, "no money/quote/application routes found — the classifier is broken, not the app");

  const leaks = [];
  for (const routeId of forbidden) {
    const sets = guardedRoleSets(sourceFor(routeId));
    if (sets.length === 0) {
      leaks.push(`${routeId}: no guard at all, so every role including setter reaches it`);
      continue;
    }
    for (const roles of sets) {
      if (roles === null) leaks.push(`${routeId}: role argument is not statically readable`);
      else if (roles.includes("setter")) leaks.push(`${routeId}: allows setter`);
    }
  }

  assert.deepEqual(leaks, [], `money/quote/application routes reachable by a setter:\n  ${leaks.join("\n  ")}`);
});

test("the permission map denies a setter every money, sales and configuration capability", () => {
  // The route test above proves the doors are shut. This one proves the product agrees about why,
  // so a future route that reads permissions.ts instead of an allowedRoles list reaches the same
  // answer. The absences ARE the role, so they are asserted rather than assumed.
  for (const permission of [
    "money.view",
    "commission.view.own",
    "commission.view.all",
    "statements.view",
    "payouts.view",
    "policies.view",
    "sales.use",
    "exports.run",
    "settings.manage",
    "team.manage",
    "calendar.manage",
    "scorecard.view.all",
  ]) {
    assert.equal(
      hasTenantPermission("setter", permission),
      false,
      `a setter must not have ${permission}`,
    );
  }

  // And the things the role exists to do.
  for (const permission of ["dialer.use", "appointments.book", "scorecard.view.own"]) {
    assert.equal(hasTenantPermission("setter", permission), true, `a setter must have ${permission}`);
  }
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
  // LA-2.12 added `setter`, and this assertion is what told us so on the first run. Both roles
  // are denied every money permission, and both are therefore checked against every money route
  // below.
  assert.deepEqual(deniedRoles, ["assistant", "setter"], "the set of money-denied roles changed; revisit this test");

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

test("the ledger cannot start returning rows without scoping them to the producer", () => {
  // LA-0.2 criterion 3: "A producer cannot see another producer's commission figures."
  //
  // That rule is implemented and unit-tested as `roleCanViewCommission` in permissions.ts, and on
  // 2026-09-22 it had **no callers anywhere in the codebase**. It is unenforced rather than wrong:
  // the ledger route is still a frame that answers `entries: []` to everyone, so there is no
  // commission figure for the rule to protect.
  //
  // What stood between that and a leak was a comment in the route — "Producers must be filtered to
  // their own producer_id when ledger rows are added". This audit has found several comments that
  // had quietly stopped being true, so this turns that one into something that fails.
  //
  // The moment the stub is replaced with a real query, the route must reference the scoping helper
  // or this test fails and names the criterion.
  const source = readFileSync(join(API_ROOT, "ledger", "route.ts"), "utf8");

  const isStillAStub = /entries:\s*\[\s*\]/.test(source);
  if (isStillAStub) {
    assert.ok(
      !/roleCanViewCommission/.test(source),
      "the ledger now scopes commissions — delete the stub branch of this test, it has done its job",
    );
    return;
  }

  assert.ok(
    /roleCanViewCommission/.test(source),
    "app/api/app/ledger/route.ts returns ledger rows but never calls roleCanViewCommission — " +
      "LA-0.2 criterion 3 requires a producer to see only their own commission figures",
  );
});

test("carrier statement routes are money routes, open only to the roles that hold statements.view", () => {
  // A statement is every producer's commission in one file, so the import and review routes are
  // narrower than the ledger: owner and bookkeeper only. A producer sees the accepted lines for
  // their own policies on the ledger, scoped by roleCanViewCommission, and nothing else.
  const routes = agentRoutes();
  if (!routes) return;

  const statementRoutes = routes.filter((routeId) => routeId.startsWith("statements/"));
  assert.ok(statementRoutes.length >= 4, "the statement import routes are missing — the classifier is reading the wrong tree");

  const holders = TENANT_ROLES.filter((role) => hasTenantPermission(role, "statements.view")).sort();
  assert.deepEqual(holders, ["bookkeeper", "owner"], "who holds statements.view changed; revisit the statement routes");

  for (const routeId of statementRoutes) {
    assert.equal(classify(routeId), "money", `${routeId} must be classified as a money route`);
    const sets = guardedRoleSets(sourceFor(routeId));
    assert.ok(sets.length > 0, `${routeId} has no role guard`);
    for (const roles of sets) {
      assert.ok(roles !== null, `${routeId}: role argument is not statically readable`);
      assert.deepEqual([...roles].sort(), holders, `${routeId} must admit exactly the roles that hold statements.view`);
    }
  }
});
