import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

import { canSeeLead, effectiveCloser } from "./scope.ts";

/**
 * "A partner sees only their own leads" (owner, 30 Oct). It was already true in four places before
 * the Pipeline redesign; these tests are here so it stays true, and so a change that weakens it
 * fails the build instead of being noticed by a partner.
 */

const ME = { userId: "u-me", role: "partner_user" };
const ADMIN = { userId: "u-admin", role: "partner_admin" };

/* ── The rule, tested for what it promises ───────────────────────────────────────────────────── */

test("a partner user is scoped to their own submissions", () => {
  assert.equal(effectiveCloser(ME), "u-me");
  assert.equal(effectiveCloser(ME, {}), "u-me");
});

test("a partner user cannot widen the scope by asking", () => {
  // The attack this guards: ?closer_id=<a colleague> on the pipeline route.
  assert.equal(effectiveCloser(ME, { closerId: "u-someone-else" }), "u-me");
  assert.equal(effectiveCloser(ME, { closerId: null }), "u-me");
  assert.equal(effectiveCloser(ME, { closerId: "" }), "u-me");
});

test("an admin sees the organisation, or one person when they ask for one", () => {
  assert.equal(effectiveCloser(ADMIN), null, "null is the partner scope, which still applies");
  assert.equal(effectiveCloser(ADMIN, { closerId: "u-dana" }), "u-dana");
});

test("no access at all is never treated as a partner user's own scope", () => {
  // An unauthenticated caller must not quietly become "everyone": the route rejects it first, and
  // this stays null so a missing check cannot read as a narrow one.
  assert.equal(effectiveCloser(undefined), null);
  assert.equal(effectiveCloser(undefined, { closerId: "u-dana" }), "u-dana");
});

test("a partner user may open only a record they submitted", () => {
  assert.equal(canSeeLead(ME, { created_by: "u-me" }), true);
  assert.equal(canSeeLead(ME, { created_by: "u-someone-else" }), false);
  assert.equal(canSeeLead(ME, { created_by: null }), false, "an unattributed lead is not theirs");
  assert.equal(canSeeLead(ADMIN, { created_by: "u-someone-else" }), true);
});

/* ── The boundaries the rule depends on ──────────────────────────────────────────────────────── */

test("the scope is taken from the session, never from the request", async () => {
  const route = await readFile("app/api/partner/leads/pipeline/route.ts", "utf8");
  // partnerId and tenantId come off the resolved context.
  assert.match(route, /auth\.context\.partnerId/);
  assert.match(route, /auth\.context\.tenantId/);
  // A partner_id in the query that is not the caller's is refused outright.
  assert.match(route, /checkPartnerParam/);
  assert.match(route, /status: 403/);
  // The route reads closer_id only as a filter; whether it is honoured is effectiveCloser's
  // decision, proven above. What matters here is that the identity itself is never read from it.
  assert.doesNotMatch(route, /userId:\s*(request|params)/, "the caller's identity never comes from the request");
});

test("every read on the page carries the narrowed closer, not just the rows", async () => {
  const service = await readFile("lib/partnerLeads/service.ts", "utf8");
  assert.match(service, /const effectiveCloserId = effectiveCloser\(access, filters\)/);
  for (const read of ["p_closer_id: effectiveCloserId", "oldestOpenQueuedAt(db, tenantId, partnerId, effectiveCloserId)", "partnerLaneFigures(db, tenantId, partnerId, effectiveCloserId", "submittedSince(db, tenantId, partnerId, effectiveCloserId"]) {
    assert.ok(service.includes(read), `narrowed read missing: ${read}`);
  }
  assert.match(service, /if \(!canSeeLead\(access, lead\)\) throw new Error\("Lead not found"\)/);
});

test("the redesign reads no identity from the browser", async () => {
  // view.ts, the fixtures and the page decide nothing about who may see what; the server does.
  for (const file of ["lib/partnerLeads/view.ts", "lib/partnerLeads/fixtures.ts", "components/partner/partner-lead-pipeline.tsx"]) {
    const source = await readFile(file, "utf8");
    assert.doesNotMatch(source, /partner_id=/, `${file} must not send a partner_id`);
    assert.doesNotMatch(source, /(effectiveCloser|canSeeLead)\s*\(/, `${file} must not re-decide access client-side`);
  }
});
