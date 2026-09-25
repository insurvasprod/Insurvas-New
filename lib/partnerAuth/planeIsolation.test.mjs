// Run with: npm test
//
// LA-1.2 acceptance criterion 1 names its own artifact:
//
//   "A partner user calling any route outside their partner gets 403 — verified by an automated
//    test across every route."
//
// and criterion 4:
//
//   "No partner user can read or write pipeline, product, form or commission configuration."
//
// `scripts/verify-partner-users.mjs` proves both against **three hand-picked routes**
// (`/api/app/ledger`, `/api/app/carrier-library`, `/api/app/partners`). That is a real check and it
// is not what the criterion says: a sample of three stops being true the moment somebody adds the
// fourth. This file is the exhaustive half, in the same style as
// `lib/tenantAuth/moneyRoutes.test.mjs`.
//
// Why this task is tagged Security, in Notion's own words:
//
//   "In the current system, 224 of 280 user accounts are external call-centre staff, and the
//    pipeline configuration tables are readable — and deletable — by any authenticated user. Any
//    closer at any centre can delete a pipeline stage. This is the worst finding in the code
//    review."
//
// So the protection this asserts is the entire point of the task, and an unguarded new route is
// exactly how it comes back.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync, existsSync } from "node:fs";
import { join } from "node:path";

const ROOT = process.cwd();
const AGENT_API = join(ROOT, "app", "api", "app");
const PARTNER_API = join(ROOT, "app", "api", "partner");

function routes(dir, prefix = "") {
  if (!existsSync(dir)) return [];
  const found = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const id = prefix ? `${prefix}/${entry.name}` : entry.name;
    if (entry.isDirectory()) found.push(...routes(join(dir, entry.name), id));
    else if (entry.name === "route.ts") found.push(id);
  }
  return found.sort();
}

const read = (base, id) => readFileSync(join(base, id), "utf8");

/** Anything that resolves the caller from the TENANT session cookie. */
const TENANT_PLANE_GUARD = /requireTenant|requireFeatureRole|requireFeature|resolveTenantContext|getTenantSession|resolveSignupContext/;

/**
 * Agent-plane routes that are deliberately reachable without a tenant session, because they are
 * how one is obtained in the first place. Each is listed rather than pattern-matched so a new
 * unguarded route is a failure and not a silent addition.
 *
 * None of these can leak another partner's data: they authenticate, de-authenticate, or create an
 * account, and they read no partner-scoped table.
 */
const AGENT_PREAUTH = new Set([
  "auth/confirm-email/route.ts",
  // Emails a reset link to the account holder's own inbox; answers every address identically.
  "auth/forgot-password/route.ts",
  "auth/login/route.ts",
  "auth/logout/route.ts",
  "auth/set-password/route.ts",
  "checkout/coupon/route.ts",
  "signup/route.ts",
]);

/** The partner-plane equivalent. */
const PARTNER_PREAUTH = new Set([
  "auth/accept-invite/route.ts",
  "auth/login/route.ts",
  "auth/logout/route.ts",
  "auth/set-password/route.ts",
]);

test("every agent-plane route requires a tenant session, so a partner cookie cannot satisfy one", () => {
  const found = routes(AGENT_API);
  assert.ok(found.length > 50, `only ${found.length} agent routes found — the walker is broken, not the app`);

  const unguarded = found.filter(
    (id) => !AGENT_PREAUTH.has(id) && !TENANT_PLANE_GUARD.test(read(AGENT_API, id)),
  );
  assert.deepEqual(
    unguarded,
    [],
    `agent API route(s) with no tenant-plane guard. A partner session must not be able to reach ` +
      `these, and neither must an anonymous caller:\n  ${unguarded.join("\n  ")}`,
  );
});

test("the pre-auth allowlist has no entries for routes that no longer exist", () => {
  // Fails in the other direction too: a stale allowlist entry is how a route gets silently
  // exempted after being renamed.
  const onDisk = new Set(routes(AGENT_API));
  const stale = [...AGENT_PREAUTH].filter((id) => !onDisk.has(id));
  assert.deepEqual(stale, [], `AGENT_PREAUTH names routes that are gone: ${stale.join(", ")}`);

  const partnerOnDisk = new Set(routes(PARTNER_API));
  const stalePartner = [...PARTNER_PREAUTH].filter((id) => !partnerOnDisk.has(id));
  assert.deepEqual(stalePartner, [], `PARTNER_PREAUTH names routes that are gone: ${stalePartner.join(", ")}`);
});

test("every partner-plane route goes through requirePartner", () => {
  const found = routes(PARTNER_API);
  assert.ok(found.length > 5, `only ${found.length} partner routes found — the walker is broken, not the app`);

  const unguarded = found.filter(
    (id) => !PARTNER_PREAUTH.has(id) && !/requirePartner\s*\(/.test(read(PARTNER_API, id)),
  );
  assert.deepEqual(unguarded, [], `partner API route(s) with no requirePartner guard:\n  ${unguarded.join("\n  ")}`);
});

test("a partner route that accepts a partner id checks it against the session", () => {
  // The isolation rule's second wall: "they can never see another partner's leads, even within
  // Ray's tenant". This is criterion 2 ("cannot invite a user into a different partner, even by
  // editing the request") generalised from invitations to every route.
  //
  // Three routes do accept `?partner_id=`, and all three use it **only to refuse a mismatch** —
  // the query itself always uses `auth.context.partnerId`. That is better than ignoring the
  // parameter, because a client trying to scope to someone else gets an explicit 403 instead of
  // quietly receiving its own data. So the rule is not "never read it", it is "never TRUST it".
  const readsRequestPartner = [
    /searchParams\.get\(\s*['"`]partner(_id|Id)?['"`]/,
    /params\.get\(\s*['"`]partner(_id|Id)?['"`]/,
    /body\??\.\s*partner_?[Ii]d/,
    /headers\(\)\.get\(\s*['"`]x-partner/i,
  ];
  // The mismatch check, in either of the shapes the routes use: compared inline against the
  // session, or handed to a helper that takes the session's partner id.
  const comparesToSession =
    /!==\s*auth\.context\.partnerId|!==\s*partnerId\b|===\s*auth\.context\.partnerId|===\s*partnerId\b/;

  const offenders = [];
  for (const id of routes(PARTNER_API)) {
    const source = read(PARTNER_API, id);
    const reads = readsRequestPartner.find((pattern) => pattern.test(source));
    if (!reads) continue;
    if (!comparesToSession.test(source)) offenders.push(`${id}: ${source.match(reads)[0].trim()}`);
  }

  assert.deepEqual(
    offenders,
    [],
    `partner route(s) reading a partner id from the request without checking it against the ` +
      `session:\n  ${offenders.join("\n  ")}`,
  );
});

test("the partner plane never touches configuration or commission tables", () => {
  // Criterion 4: "No partner user can read or write pipeline, product, form or commission
  // configuration."
  //
  // The operative word is CONFIGURATION. An earlier draft of this test barred every route whose
  // name contained `products`, `forms` or `settings` and failed on five legitimate ones — the
  // partner's approved-product list (LA-1.3), the submission form they render (LA-1.6) and their
  // own profile. Reading the products you are approved to submit is not configuring products.
  //
  // So this asserts the thing that actually matters, at the table level: the partner plane does not
  // name a configuration or commission table at all. That is a stronger guarantee than guarding
  // those surfaces, because there is nothing there to guard — and it is the direct answer to the
  // finding that made this task a Security task, that "any closer at any centre can delete a
  // pipeline stage".
  const forbiddenTables = [
    "pipelines",
    "pipeline_stages",
    "dispositions",
    "disposition_config",
    "lead_templates",
    "template_fields",
    "plans",
    "plan_features",
    "commission_schedules",
    "advance_rules",
    "tenant_carriers",
    "appointments",
    "policies",
    "usage_totals",
  ];

  const offenders = [];
  for (const id of routes(PARTNER_API)) {
    const source = read(PARTNER_API, id);
    for (const table of forbiddenTables) {
      if (new RegExp(`from\\(\\s*['"\`]${table}['"\`]\\s*\\)`).test(source)) offenders.push(`${id}: ${table}`);
    }
  }

  assert.deepEqual(
    offenders,
    [],
    `partner route(s) reading or writing a configuration/commission table:\n  ${offenders.join("\n  ")}`,
  );
});

test("the partner plane deletes nothing from the database", () => {
  // Notion, on the legacy system: "the pipeline configuration tables are readable — and deletable —
  // by any authenticated user. Any closer at any centre can delete a pipeline stage. This is the
  // worst finding in the code review."
  //
  // LA-1.1 criterion 3 says it from the other side: "No partner action ever deletes a lead, a
  // deal-flow row or a message." The partner plane currently issues no database DELETE whatsoever,
  // which is the cleanest possible form of that guarantee, so it is pinned here.
  const offenders = [];
  for (const id of routes(PARTNER_API)) {
    const source = read(PARTNER_API, id);
    // `response.cookies.delete(...)` is a cookie, not a row.
    const withoutCookies = source.replace(/cookies\s*\.\s*delete\s*\(/g, "cookies.clear(");
    if (/\.delete\s*\(/.test(withoutCookies)) offenders.push(id);
  }

  assert.deepEqual(
    offenders,
    [],
    `partner route(s) issuing a database delete:\n  ${offenders.join("\n  ")}`,
  );
});

test("every submission-path route refuses a paused partner, and only those routes do", () => {
  // LA-1.1 criterion 1: "Pausing a partner blocks new submissions within seconds and leaves
  // existing leads workable."
  //
  // Both halves are one rule about WHERE the status check goes, so both are asserted here.
  // `requirePartner` re-reads `partners.status` from the database on every request, so "within
  // seconds" is really "on the next request", and an offboarded partner is rejected at the session.
  // Pause is softer by design: it has to stop new work without freezing the partner out of work
  // already in flight.
  //
  // `scripts/verify-partners.mjs` asserts only that the transition happens — "pausing is an atomic
  // lifecycle transition" — and never tries a submission afterwards, so this is the half that was
  // unproven.
  const SUBMISSION_PATH = ["leads/route.ts", "forms/[productCode]/draft/route.ts", "forms/[productCode]/duplicates/route.ts", "forms/[productCode]/screen/route.ts"];

  // Deliberately NOT gated on pause, because the ticket says existing leads stay workable and the
  // portal still opens: discussing a lead in chat, clearing a notification, and a partner admin
  // managing their own people are all still allowed while paused. Offboarding, which is the hard
  // stop, is enforced in `requirePartner` at the session instead.
  // A partner admin setting the organisation timezone (settings/route.ts PATCH) is housekeeping of
  // the same kind as managing their own people, so it stays open while paused too.
  const DELIBERATELY_UNGATED = ["chat/route.ts", "notifications/route.ts", "settings/route.ts", "users/route.ts", "users/[userId]/route.ts", "users/[userId]/resend-invite/route.ts"];

  const writes = routes(PARTNER_API).filter(
    (id) => !id.startsWith("auth/") && /export async function (POST|PATCH|PUT)/.test(read(PARTNER_API, id)),
  );

  const unclassified = writes.filter((id) => !SUBMISSION_PATH.includes(id) && !DELIBERATELY_UNGATED.includes(id));
  assert.deepEqual(
    unclassified,
    [],
    `partner write route(s) not classified against the pause rule. Decide whether each is a new ` +
      `submission (gate it on partnerStatus) or existing work (leave it open):\n  ${unclassified.join("\n  ")}`,
  );

  const missing = SUBMISSION_PATH.filter((id) => !/partnerStatus/.test(read(PARTNER_API, id)));
  assert.deepEqual(
    missing,
    [],
    `submission route(s) that never consult partnerStatus, so a paused partner could still ` +
      `submit:\n  ${missing.join("\n  ")}`,
  );

  const frozen = DELIBERATELY_UNGATED.filter((id) => /partnerStatus/.test(read(PARTNER_API, id)));
  assert.deepEqual(
    frozen,
    [],
    `route(s) now gated on partnerStatus that should stay open while paused — "existing leads ` +
      `still workable":\n  ${frozen.join("\n  ")}`,
  );
});
