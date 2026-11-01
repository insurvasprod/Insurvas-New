import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

import { PARTNER_DEAL_FLOW_COLUMNS, PARTNER_DEAL_FLOW_LEAD_COLUMNS } from "./types.ts";

/**
 * The two ways this page could leak, held in place.
 *
 * 1. **The wrong rows.** A partner user seeing a colleague's deals. The rule itself is
 *    `lib/partnerLeads/scope.ts`' and is proved in `lib/partnerLeads/isolation.test.mjs`; what is
 *    proved here is that this page *calls* it rather than deciding for itself, because a second
 *    copy of the rule is the thing that drifts.
 * 2. **The wrong columns.** `deal_flow` holds the agency's notes, the closer who worked the call,
 *    the buffer assistant, the campaign and the vendor. None of that is the partner's business, and
 *    the only thing standing between it and the page is a list in `types.ts`.
 */

const service = await readFile("lib/partnerDealFlow/service.ts", "utf8");
const route = await readFile("app/api/partner/deal-flow/route.ts", "utf8");

/* ── The rows ─────────────────────────────────────────────────────────────────────────────────── */

test("the service calls the portal's access rule instead of restating it", () => {
  assert.match(service, /import \{ effectiveCloser, type PartnerLeadAccess \} from "@\/lib\/partnerLeads\/scope"/);
  assert.match(service, /const closerId = effectiveCloser\(access, \{ closerId: filters\.submittedBy \}\)/);
  // The shapes a re-implementation would take. If the rule ever needs to differ here, it changes
  // in scope.ts for every page at once, not in this file for this one.
  assert.doesNotMatch(service, /role === "partner_admin"/, "the service must not branch on the role itself");
  assert.doesNotMatch(service, /role === "partner_user"/, "the service must not branch on the role itself");
});

test("the scope reaches the query, and the request cannot replace the identity", () => {
  assert.match(service, /query\.eq\("agent_leads\.created_by", closerId\)/);
  assert.match(service, /\.eq\("tenant_id", tenantId\)/);
  assert.match(service, /\.eq\("partner_id", partnerId\)/);
  // tenantId and partnerId are arguments taken from the session by the route, never read here.
  assert.doesNotMatch(service, /searchParams/, "the service never reads the request");
});

test("the route takes tenant and partner from the session and refuses another partner's", () => {
  assert.match(route, /auth\.context\.partnerId|context\.partnerId/);
  assert.match(route, /auth\.context\.tenantId|context\.tenantId/);
  assert.match(route, /checkPartnerParam/);
  assert.match(route, /status: 403/);
  assert.doesNotMatch(route, /userId:\s*(request|params)/, "the caller's identity never comes from the request");
  assert.match(route, /userId: context\.userId, role: context\.role/, "access is built from the session");
});

test("submitted_by is a filter, never a way in", () => {
  // It is handed to effectiveCloser, which pins a partner user to themselves and lets an admin
  // narrow within their own organisation. The route does not apply it itself.
  assert.match(route, /submittedBy: params\.get\("submitted_by"\) \|\| null/);
  assert.doesNotMatch(route, /eq\("agent_leads\.created_by"/, "the route must not filter by submitter itself");
});

test("the page is read-only", () => {
  for (const method of ["POST", "PATCH", "PUT", "DELETE"]) {
    assert.doesNotMatch(route, new RegExp(`export async function ${method}\\b`), `no ${method} on this route`);
  }
});

/* ── The columns ──────────────────────────────────────────────────────────────────────────────── */

test("the allow-list is exactly the columns the page needs", () => {
  assert.deepEqual([...PARTNER_DEAL_FLOW_COLUMNS], [
    "lead_id",
    "product_line",
    "insured_name",
    "local_date",
    "call_result",
    "carrier",
    "product_type",
    "monthly_premium_cents",
    "face_amount_cents",
    "draft_date",
    "disposition_at",
    "updated_at",
  ]);
  assert.deepEqual([...PARTNER_DEAL_FLOW_LEAD_COLUMNS], ["created_by", "created_at", "stage_id"]);
});

test("no agency-internal column is in the allow-list", () => {
  // Every one of these is on deal_flow today. Adding one here must be a decision, not a merge.
  const theirs = [
    "notes", "worked_by", "buffer_agent", "campaign_id", "vendor_id", "source",
    "disposition_by", "tracking_id", "submission_id", "manual_entry", "phone", "initial_quote",
    "affiliate_link_id", "affiliate_campaign",
  ];
  for (const column of theirs) {
    assert.ok(!PARTNER_DEAL_FLOW_COLUMNS.includes(column), `${column} is the agency's, not the partner's`);
  }
});

test("the query is built from the allow-list, so the two cannot drift", () => {
  // The select string is the constant joined, not a hand-written copy that happens to agree today.
  assert.match(service, /PARTNER_DEAL_FLOW_COLUMNS\.join\(", "\)/);
  assert.match(service, /agent_leads!inner\(\$\{PARTNER_DEAL_FLOW_LEAD_COLUMNS\.join\(", "\)\}\)/);
  assert.match(service, /\.from\("deal_flow"\)\s*\.select\(SELECT\)/, "the deal_flow read uses the constant");
  // No literal select anywhere in the file names a deal_flow column — the stages and users reads
  // name their own tables' columns, which is why this checks the names rather than the shape.
  for (const column of [...PARTNER_DEAL_FLOW_COLUMNS, "notes", "worked_by", "buffer_agent", "vendor_id"]) {
    assert.doesNotMatch(service, new RegExp(`\\.select\\("[^"]*\\b${column}\\b`), `${column} named in a literal select`);
  }
});

test("the lead's value bag is never opened, so nothing on this page needs masking", () => {
  assert.ok(!PARTNER_DEAL_FLOW_LEAD_COLUMNS.includes("values"), "values is not read");
  assert.doesNotMatch(service, /\bvalues\b\s*:/, "no value bag is mapped onto a row");
  // The customer's name comes from deal_flow.insured_name and nowhere else.
  assert.match(service, /deal\.insured_name\?\.trim\(\)/);
});

test("the stage shown is the lead's, so this page and the Pipeline agree", () => {
  assert.match(service, /agent_leads\?\.stage_id/);
  assert.doesNotMatch(service, /deal\.stage_id/, "deal_flow's own stage is the agency's drift problem, not the partner's");
});
