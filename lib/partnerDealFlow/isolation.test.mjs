import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

import { PARTNER_DEAL_FLOW_COLUMNS, PARTNER_DEAL_FLOW_LEAD_COLUMNS } from "./types.ts";
import { narrowTo, visibleSubmitters } from "../partnerAuth/team.ts";
import { effectiveCloser } from "../partnerLeads/scope.ts";
import { sampleDealFlow, sampleDealFlowAudience } from "./fixtures.ts";

/**
 * The two ways this page could leak, held in place.
 *
 * 1. **The wrong rows.** A partner user seeing a colleague's deals, or an admin seeing another
 *    team's. Since 2 Nov this page is narrower than the rest of the portal: an admin sees their
 *    own team, not the whole organisation. The decision lives in `lib/partnerAuth/team.ts` and is
 *    proved there; what is proved here is that this page composes it exactly as written and that
 *    the result reaches the query, because a second copy of the rule is the thing that drifts.
 *
 *    These are not end-to-end tests. Nothing below runs a query — the service reads Supabase, so
 *    the rows themselves are only ever seen by a person. What is checked is the id list the query
 *    is built from, and, by source text, that the query is built from it.
 * 2. **The wrong columns.** `deal_flow` holds the agency's notes, the closer who worked the call,
 *    the buffer assistant, the campaign and the vendor. None of that is the partner's business, and
 *    the only thing standing between it and the page is a list in `types.ts`.
 */

const service = await readFile("lib/partnerDealFlow/service.ts", "utf8");
const route = await readFile("app/api/partner/deal-flow/route.ts", "utf8");

/* ── The rows ─────────────────────────────────────────────────────────────────────────────────── */

test("the service is handed the answer and never works out the role itself", () => {
  assert.match(service, /import \{ narrowTo \} from "@\/lib\/partnerAuth\/team"/);
  // The shapes a re-implementation would take. The list is built once, by the route, from the
  // session — not a second time here from whatever happens to be in scope.
  assert.doesNotMatch(service, /role === "partner_admin"/, "the service must not branch on the role itself");
  assert.doesNotMatch(service, /role === "partner_user"/, "the service must not branch on the role itself");
  assert.doesNotMatch(service, /access\.role/, "the access object carries ids, not a role");
  assert.doesNotMatch(service, /effectiveCloser/, "this page's scope is the team's, not scope.ts'");
});

test("the boundary reaches the query, and no branch can skip it", () => {
  assert.match(service, /\.in\("agent_leads\.created_by", visibleIds\)/);
  // `const`, so the builder cannot be reassigned further down — the way a conditional filter gets
  // added, and the way one gets accidentally dropped.
  assert.match(service, /const query = db\s*\n\s*\.from\("deal_flow"\)/);
  assert.doesNotMatch(service, /\bquery = query\b/, "the query is built once, not amended");
  assert.doesNotMatch(service, /if \([^)]*\) query/, "the boundary is never conditional");
  assert.match(service, /\.eq\("tenant_id", tenantId\)/);
  assert.match(service, /\.eq\("partner_id", partnerId\)/);
  // tenantId and partnerId are arguments taken from the session by the route, never read here.
  assert.doesNotMatch(service, /searchParams/, "the service never reads the request");
});

test("an empty list is refused rather than read as 'no filter'", () => {
  // `.in(col, [])` matches nothing, which fails closed — but the next person at that line could
  // as easily read an empty list as "unscoped" and drop the filter. So it never gets there.
  assert.match(service, /if \(!visibleIds\.length\) throw new Error/);
});

test("the route takes tenant and partner from the session and refuses another partner's", () => {
  assert.match(route, /auth\.context\.partnerId|context\.partnerId/);
  assert.match(route, /auth\.context\.tenantId|context\.tenantId/);
  assert.match(route, /checkPartnerParam/);
  assert.match(route, /status: 403/);
  assert.doesNotMatch(route, /userId:\s*(request|params)/, "the caller's identity never comes from the request");
});

test("the route builds the id list from the session, and the service composes it as written", () => {
  assert.match(route, /await partnerTeamMembers\(context\.tenantId, context\.partnerId\)/);
  assert.match(route, /visibleSubmitters\(\{ userId: context\.userId, role: context\.role \}, members\)/);
  assert.match(route, /\{ visibleIds \},/, "the service is given the list, nothing else");
  // The two halves this file reasons about, in the order the code applies them. If either moves,
  // the composition asserted in the cases below stops describing the page.
  assert.match(service, /const allowedIds = narrowTo\(visibleIds, filters\.submittedBy\)/);
  assert.doesNotMatch(route, /visibleIds\s*=\s*[^;]*params/, "the list never comes from the request");
});

test("submitted_by is a filter, never a way in", () => {
  // It is handed to narrowTo, which keeps it inside the list the session allows. The route does
  // not apply it itself.
  assert.match(route, /submittedBy: params\.get\("submitted_by"\) \|\| null/);
  assert.doesNotMatch(route, /eq\("agent_leads\.created_by"|in\("agent_leads\.created_by"/, "the route must not filter by submitter itself");
});

test("the CSV is narrowed identically to the table", () => {
  // One payload feeds both, so the export cannot carry a row the table would not show.
  assert.match(route, /partnerDealFlowCsv\(payload\.rows\)/);
});

/* ── The decision itself, composed the way the page composes it ───────────────────────────────── */

const ADMIN = { userId: "u-admin", role: "partner_admin" };
const OTHER_ADMIN = { userId: "u-admin-2", role: "partner_admin" };
const USER = { userId: "u-casey", role: "partner_user" };
const ORG = [
  { user_id: "u-admin", role: "partner_admin", partner_admin_user_id: null },
  { user_id: "u-admin-2", role: "partner_admin", partner_admin_user_id: null },
  { user_id: "u-casey", role: "partner_user", partner_admin_user_id: "u-admin" },
  { user_id: "u-devon", role: "partner_user", partner_admin_user_id: "u-admin" },
  { user_id: "u-remy", role: "partner_user", partner_admin_user_id: "u-admin-2" },
  { user_id: "u-orphan", role: "partner_user", partner_admin_user_id: null },
];

/** The ids the query is built from: what the route works out, narrowed by `?submitted_by=`. */
const inScope = (viewer, requested) => narrowTo(visibleSubmitters(viewer, ORG), requested).sort();

test("a partner user asking for a colleague's id gets their own rows only", () => {
  assert.deepEqual(inScope(USER, "u-devon"), ["u-casey"]);
  assert.deepEqual(inScope(USER, "u-admin"), ["u-casey"], "not even their own admin");
});

test("an admin asking for another team's member gets their own team, with no error", () => {
  assert.deepEqual(inScope(ADMIN, "u-remy"), ["u-admin", "u-casey", "u-devon"]);
});

test("an admin never sees another admin's own submissions", () => {
  assert.ok(!inScope(ADMIN, null).includes("u-admin-2"));
  assert.ok(!inScope(OTHER_ADMIN, null).includes("u-admin"));
});

test("an unassigned member's deals reach no admin", () => {
  assert.ok(!inScope(ADMIN, null).includes("u-orphan"));
  assert.ok(!inScope(OTHER_ADMIN, null).includes("u-orphan"));
});

test("an admin narrowing to one of their own people gets exactly them", () => {
  assert.deepEqual(inScope(ADMIN, "u-devon"), ["u-devon"]);
});

test("Pipeline and the rest of the portal are not rescoped by any of this", async () => {
  // The regression that caused the 1 Nov revert: changing scope.ts narrows five other surfaces at
  // once. An admin is still the whole organisation there, and scope.ts knows nothing about teams.
  assert.equal(effectiveCloser(ADMIN), null, "an admin still sees the organisation on Pipeline");
  assert.equal(effectiveCloser(ADMIN, { closerId: "u-remy" }), "u-remy", "and may still narrow to anyone in it");
  const scope = await readFile("lib/partnerLeads/scope.ts", "utf8");
  assert.doesNotMatch(scope, /partner_admin_user_id|visibleSubmitters/, "scope.ts has no idea teams exist");
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

/* ── The preview, the only place the rule can actually be looked at ───────────────────────────── */

test("the preview's sample day holds deals the viewing admin must not see", () => {
  // Without this the preview proves nothing. On a flat list of one team, a build that had lost the
  // rule entirely would render exactly the same page as one that kept it.
  const audience = sampleDealFlowAudience({ state: "busy", role: "partner_admin" });
  assert.ok(audience.totalDeals > audience.visibleDeals, "the sample day must include other teams");
  assert.deepEqual([...audience.hidden].sort(), ["Noor Haddad", "Orla Byrne", "Theo Lindqvist"]);
});

test("a quiet day narrows too, so 'quiet' and 'scoped wrong' cannot look the same", () => {
  const audience = sampleDealFlowAudience({ state: "quiet", role: "partner_admin" });
  assert.ok(audience.totalDeals > audience.visibleDeals);
  assert.ok(audience.visibleDeals > 0, "a quiet day is quiet, not empty");
});

test("the preview's admin sees their team's rows and nobody else's", () => {
  const payload = sampleDealFlow({ state: "busy", role: "partner_admin" });
  const names = [...new Set(payload.rows.map((row) => row.submittedBy.name))].sort();
  assert.deepEqual(names, ["Dana Whitfield", "Rion Test", "Sam Okafor"]);
  // The facet menu is built from those same rows, so it cannot offer a name the table would refuse.
  assert.deepEqual(payload.facets.submitters.map((person) => person.name), names);
});

test("the preview's partner user sees their own submissions only", () => {
  const payload = sampleDealFlow({ state: "busy", role: "partner_user" });
  assert.deepEqual([...new Set(payload.rows.map((row) => row.submittedBy.name))], ["Dana Whitfield"]);
  const audience = sampleDealFlowAudience({ state: "busy", role: "partner_user" });
  assert.deepEqual(audience.team, [], "a partner user is their own team");
});

test("the preview's figures describe the narrowed rows, not the whole organisation's day", () => {
  const payload = sampleDealFlow({ state: "busy", role: "partner_admin" });
  const audience = sampleDealFlowAudience({ state: "busy", role: "partner_admin" });
  assert.equal(payload.rows.length, audience.visibleDeals);
  assert.equal(payload.figures.worked, audience.visibleDeals);
  assert.equal(payload.stageCounts.open + payload.stageCounts.won + payload.stageCounts.lost, audience.visibleDeals);
});
