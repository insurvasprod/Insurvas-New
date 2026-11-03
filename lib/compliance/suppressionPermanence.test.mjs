/**
 * LA-2.3 criteria 1, 2, 3 and 4, pinned without a database.
 *
 * LA-2.3 is the task whose own page calls it "the highest-priority task in the module", because the
 * failure it describes costs $500–$1,500 per call. These assertions are the ones that would notice
 * the gate being loosened again:
 *
 *   c1 only a scrubbed campaign serves leads
 *   c2 a litigator hit is never servable under any code path — the page asks for this by test
 *   c3 "do not call" is permanent
 *   c4 a vendor outage blocks dialing rather than passing numbers through
 */

import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";

const MIGRATIONS = join(process.cwd(), "supabase", "migrations");
const files = readdirSync(MIGRATIONS).sort();

/** Resolves the LAST migration that defines a thing, which is the one that is live. */
function latestDefining(pattern) {
  for (let index = files.length - 1; index >= 0; index--) {
    const body = readFileSync(join(MIGRATIONS, files[index]), "utf8");
    if (pattern.test(body)) return { name: files[index], body };
  }
  return null;
}

test("only a scrubbed, active campaign is servable — the gate is the view, not a badge", () => {
  const servable = latestDefining(/create or replace view public\.campaigns_servable/);
  assert.ok(servable, "campaigns_servable must exist");
  // Both halves. `status = 'active'` alone would serve an unscrubbed list; `scrub_status` alone
  // would serve a paused one. LA-2.3: "Only scrubbed campaigns serve leads. Not a badge, not a
  // warning — the queue returns nothing."
  assert.match(servable.body, /status = 'active'/);
  assert.match(servable.body, /scrub_status = 'scrubbed'/);
});

test("the serving function filters on suppression and the calling window, not just on the view", () => {
  const serve = latestDefining(/create or replace function public\.serve_next_lead/);
  assert.ok(serve, "serve_next_lead must exist");
  // Enforcement lives in the function the API calls, so a hand-crafted request cannot route around
  // it. LA-2.4 criterion 1 is exactly this, and the LA-2.4 page quotes the repo's own rule: "a
  // compliance rule checked solely in the browser is a rule that stops applying the moment
  // anything else calls the API."
  assert.match(serve.body, /is_phone_suppressed\(/);
  assert.match(serve.body, /tenant_can_dial_now\(/);
});

test("a litigator hit outranks every other list, so it can never be hidden behind one", () => {
  const check = latestDefining(/create or replace function public\.is_phone_suppressed/);
  assert.ok(check);
  // The function returns ONE row for a number that may be on several lists. If an internal note
  // outranked a litigator hit, a number would report as "internal" — which an operator may believe
  // is overridable — when it is in fact never dialable under any circumstance.
  // From the function's own definition: the migration that restates it may define others first.
  const fn = check.body.slice(check.body.indexOf("create or replace function public.is_phone_suppressed"));
  const order = fn.slice(fn.indexOf("order by"));
  const litigator = order.indexOf("tcpa_litigator");
  const internal = order.indexOf("'internal'");
  const federal = order.indexOf("federal_dnc");
  assert.ok(litigator > 0, "the ordering must rank tcpa_litigator explicitly");
  assert.ok(litigator < internal && litigator < federal, "a litigator hit must be reported first");
});

test("the internal do-not-call list cannot be deactivated, deleted or repointed", () => {
  const permanence = latestDefining(/create trigger tenant_do_not_call_permanent/);
  assert.ok(permanence, "the internal DNC list has no permanence guard");

  // DELETE and the true→false transition are the two ways a suppressed number becomes dialable
  // again. `is_phone_suppressed` filters this table on `is_active`, so clearing the flag is exactly
  // as effective as deleting the row.
  assert.match(permanence.body, /before delete or update of is_active, phone_digits, tenant_id/);
  assert.match(permanence.body, /if old\.is_active and not new\.is_active then/);

  // Re-suppression must still work, or the "do not call" disposition silently records nothing —
  // a worse failure than the one being fixed.
  assert.match(permanence.body, /on conflict \(tenant_id, phone_digits\) where is_active/);

  // The other suppression table has had this guard all along; the point of this test is that both
  // tables have it, because `is_phone_suppressed` reads both.
  const other = latestDefining(/create trigger tenant_suppression_list_permanent/);
  assert.ok(other, "the shared suppression list must keep its permanence guard too");
});

test("a vendor outage blocks import, not dialling: the dial reads our own tables only", () => {
  const service = readFileSync(join(process.cwd(), "lib", "dialerScripts", "service.ts"), "utf8");

  // Owner decision 3 ("Sixteen Open Questions, Answered", LA-2.3): the serve/dial-time check never
  // calls a vendor. It reads the internal DNC list, the stored scrub hits and the import's stored
  // litigator answers. LA-2.3's criterion now reads "a vendor outage blocks IMPORT; already-scrubbed
  // campaigns continue to serve."
  assert.doesNotMatch(service, /performDncDialPreflight|performDncVendorLookup|getDncDialingStatus|runWithComplianceFallback/);
  assert.doesNotMatch(service, /from "@\/lib\/compliance\/service"/);
  assert.doesNotMatch(readFileSync(join(process.cwd(), "lib", "compliance", "service.ts"), "utf8"), /export async function performDncDialPreflight/);

  // Our own lists unreadable is still "we could not tell" (503), never a pass; a hit is 422.
  assert.match(service, /return reason === "policy_unavailable" \? 503 : 422;/);
  assert.match(service, /db\.rpc\("tenant_phone_suppression_hits"/);
  assert.match(service, /from\("tenant_campaign_scrub_rejections"\)[\s\S]{0,200}\.eq\("outcome", "tcpa_litigator"\)/);

  // The fresh check happens at the click, not only when the panel was loaded. A panel rendered at
  // 9am and clicked at 2pm has a five-hour-old answer, and the lists change by the hour.
  const clicked = service.slice(service.indexOf("export async function markDialClicked"));
  assert.match(clicked.slice(0, 3000), /getDialerEligibility\(db, input\.tenantId, values, text\(lead\.campaign_id\) \|\| null, input\.agentId, text\(lead\.id\)\)/);
  assert.match(clicked, /DialGateError/);
});

test("the import treats an outage and a definite hit differently", () => {
  const service = readFileSync(join(process.cwd(), "lib", "agentTemplates", "service.ts"), "utf8");
  const body = service.slice(
    service.indexOf("export async function importAgentLeads"),
    service.indexOf("export async function updateAgentLead"),
  );
  // Same rule as the dialer, on the other side of the system: an unknown answer fails the whole
  // file, a known bad answer drops the row.
  assert.match(body, /outcome === "unavailable"/);
  assert.match(body, /REJECTING_OUTCOMES = new Set\(\["dnc", "tcpa_litigator", "invalid_phone"\]\)/);
});

test("every screening check is audited with the vendor's raw response", () => {
  // screening.ts binds the database; screeningCore.ts holds the decision and the audit entry it writes.
  const screening = ["screening.ts", "screeningCore.ts"].map((file) => readFileSync(join(process.cwd(), "lib", "compliance", file), "utf8")).join("\n");
  // LA-2.3 criterion 6. Without the raw response an audit record proves that a check happened but
  // not what the vendor actually said, which is the half that matters in a dispute.
  assert.match(screening, /rawResponse/);
  assert.match(screening, /writeAudit\(/);
  // Including the paths that answer without calling a vendor — a cached answer and a tenant
  // suppression hit are still checks, and a gap in the trail is indistinguishable from a skipped
  // check.
  assert.match(screening, /cached: true/);
  assert.match(screening, /vendor: "tenant_suppression"/);
});

test("a campaign can be re-scrubbed, which is how a list that has aged gets re-checked", () => {
  const rescrub = latestDefining(/function public\.request_campaign_rescrub/);
  assert.ok(rescrub, "LA-2.3 criterion 5 needs a re-scrub entry point");
  // Re-scrubbing must put the campaign back through the gate rather than quietly re-checking in
  // place: while it is being re-scrubbed it is not `scrubbed`, so it serves nothing.
  assert.match(rescrub.body, /scrub_status/);
});
