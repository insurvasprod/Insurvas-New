/**
 * LA-2.5 and LA-2.6, pinned without a database.
 *
 * Both tasks had a criterion scored PASS on the existence of a view that nothing read:
 *
 *   LA-2.5 c4 "Speed-to-lead is computed per vendor and **visible**"
 *   LA-2.6 c3 "Coverage per vendor is **reported** as a percentage"
 *
 * A view is not a report. LA-2.5 says why in its own words — the number is "shown to Ray as his own
 * number, because it is a number he can improve" — and a median nobody sees improves nothing. These
 * tests assert that the numbers are computed correctly AND that something reads them, because the
 * second half is the half that kept being skipped.
 */

import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";

const MIGRATIONS = join(process.cwd(), "supabase", "migrations");
const files = readdirSync(MIGRATIONS).sort();

function latestDefining(pattern) {
  for (let index = files.length - 1; index >= 0; index--) {
    const body = readFileSync(join(MIGRATIONS, files[index]), "utf8");
    if (pattern.test(body)) return { name: files[index], body };
  }
  return null;
}

const read = (...parts) => readFileSync(join(process.cwd(), ...parts), "utf8");

test("speed to lead is computed per vendor over its own leads, not averaged from campaigns", () => {
  const view = latestDefining(/create or replace view public\.tenant_vendor_speed_to_lead/);
  assert.ok(view, "LA-2.5 criterion 4 needs a vendor-level speed view");

  // A median cannot be averaged. The per-campaign view groups by campaign, so a vendor-level
  // number taken from it would be the mean of three medians — a number that is not the median of
  // anything, and one a single tiny fast campaign would flatter.
  assert.match(view.body, /percentile_cont\(0\.5\) within group/);
  assert.match(view.body, /group by l\.tenant_id, c\.vendor_id/);
  assert.doesNotMatch(view.body, /avg\(median_seconds\)/);

  // An undialled lead has no speed-to-lead and must not count as zero seconds, which would make a
  // vendor look better the more of its leads went uncalled.
  assert.match(view.body, /filter \(where l\.first_dial_at is not null\)/);

  // The share under a minute is over leads POSTED. Over leads DIALLED it would report 100% for a
  // vendor whose one answered lead was fast and whose other nine hundred were never called.
  const pct = view.body.slice(view.body.indexOf("dialled_within_60s_pct") - 400, view.body.indexOf("dialled_within_60s_pct"));
  assert.match(pct, /nullif\(count\(\*\), 0\)/);

  // Only real-time posts have a speed-to-lead. A list imported at 2am has an arrival time that
  // means nothing.
  assert.match(view.body, /where l\.posted_at is not null/);

  // Runs as the caller, or every tenant reads every other tenant's numbers.
  assert.match(view.body, /alter view public\.tenant_vendor_speed_to_lead set \(security_invoker = on\)/);
});

test("the vendor page actually reads speed and consent coverage", () => {
  // The whole point. Both views existed and were correct before this pass and a repository search
  // found no reader for either outside the audit document that scored them PASS.
  const route = read("app", "api", "app", "vendors", "route.ts");
  assert.match(route, /from\("tenant_vendor_speed_to_lead"\)/);
  assert.match(route, /from\("tenant_vendor_consent_coverage"\)/);
  assert.match(route, /median_seconds/);
  assert.match(route, /claimed_coverage_pct/);

  // Every query reports its own failure rather than rendering an empty table, because "this vendor
  // has no certificates" and "the query failed" need different answers.
  //
  // Speed now has a third case between those two: the view is not deployed yet. That is neither a
  // failure nor an empty result, and it is named on the page rather than shown as 0ms — so the
  // assertion is that a genuine error still 500s, not that the old `if (speed.error)` shape survived.
  assert.match(route, /Could not load speed to lead[\s\S]{0,120}status: 500/);
  assert.match(route, /isSchemaGap\(speed\.error\)/);
  assert.match(route, /if \(consent\.error\)/);

  // The vendor table moved into its own component (Vendors concept build, 2026-09-25).
  const workspace = read("components", "app", "vendor-roster.tsx");
  assert.match(workspace, /speedByVendor/);
  assert.match(workspace, /consentByVendor/);
  // Claimed coverage is the one shown first: an unclaimed certificate may not survive to be
  // produced, which is the only moment either number matters.
  assert.match(workspace, /claimed_coverage_pct/);
});

test("a vendor with no real-time posts shows no speed rather than zero seconds", () => {
  const workspace = read("components", "app", "vendor-roster.tsx");
  // A list vendor has no speed-to-lead. Rendering 0s would read as instant — the best possible
  // score — for a vendor that has never posted a lead in real time.
  assert.match(workspace, /fast\?\.posted_leads \? duration\(fast\.median_seconds\) : "—"/);
  assert.match(workspace, /fast\?\.posted_leads \? percent\(fast\.dialled_within_60s_pct\) : "—"/);
});

test("consent certificates are included in the lead export", () => {
  const service = read("lib", "agentTemplates", "service.ts");
  const route = read("app", "api", "app", "leads", "export", "route.ts");

  // LA-2.6 criterion 6. The export carried the stage and the template fields and nothing else, so
  // the one artefact the task exists to produce — what "a regulator or a plaintiff's lawyer asks
  // for" — was the one thing that could not be got out of the system.
  assert.match(route, /consentForLeads/);
  assert.match(service, /export async function consentForLeads/);

  for (const column of [
    "consent_provider",
    "consent_certificate_id",
    "consent_certificate_url",
    "consent_timestamp",
    "consent_claimed_at",
    "consent_capture_status",
    "consent_stored_copy",
  ]) {
    assert.match(service, new RegExp(`"${column}"`), `the export is missing ${column}`);
  }

  // "We have a URL" and "we have the evidence" are different facts — an unclaimed TrustedForm
  // certificate expires — so the export says which one this is.
  assert.match(service, /stored_ref \? "yes" : "no"/);

  // One row per lead, so a lead posted by two vendors reports the newest capture rather than an
  // arbitrary one.
  assert.match(service, /if \(!byLead\.has\(row\.lead_id\)\) byLead\.set/);
  assert.match(service, /\.order\("captured_at", \{ ascending: false \}\)/);
});

test("the export keeps its old shape when no consent evidence is requested", () => {
  const service = read("lib", "agentTemplates", "service.ts");
  // Appending columns unconditionally would change every existing export, including saved
  // spreadsheet templates pointed at the old column order.
  assert.match(service, /const withConsent = Boolean\(consentByLead\)/);
  assert.match(service, /\.\.\.\(withConsent \? consentColumns\.map/);
});

test("a posted lead is rejected with a reason code a vendor can act on", () => {
  const service = read("lib", "leadPost", "service.ts");
  // LA-2.5 criterion 2, and the task's own framing: "Rejections are the billing mechanism." A
  // vendor reconciling an invoice needs to know lead 4821 was refused as a litigator hit rather
  // than that something went wrong.
  for (const code of [
    "suppressed_litigator",
    "suppressed_dnc",
    "suppressed_internal",
    "duplicate",
    "invalid_phone",
    "rate_limited",
    "scrub_unavailable",
  ]) {
    assert.match(service, new RegExp(`"${code}"`), `the post API cannot answer with ${code}`);
  }
  // Criterion 6: an outage rejects rather than accepting unscrubbed. Same rule as the dialer and
  // the importer — an unknown answer never becomes a dialable lead.
  assert.match(service, /scrub_unavailable/);
});

test("a vendor hammering the endpoint is limited per key, not globally", () => {
  const limits = read("lib", "rateLimit", "index.ts");
  const service = read("lib", "leadPost", "service.ts");
  // Criterion 5 is "without dropping legitimate posts". A global limit would let one vendor's
  // runaway retry loop lock out every other vendor, which is the failure the criterion names.
  assert.match(limits, /LEAD_POST_PER_KEY[^\n]*name: "lead_post_key"/);
  assert.match(service, /claim\(LEAD_POST_PER_KEY, keyRow\.id\)/);
  // 429 with retry-after, so a well-behaved poster backs off instead of guessing.
  assert.match(service, /status: 429/);
  assert.match(service, /retryAfterSeconds/);
});

test("real-time leads outrank list leads before scoring is consulted", () => {
  const scoring = latestDefining(/create or replace function public\.serve_next_lead/);
  assert.ok(scoring);
  // LA-2.5 criterion 3: "served ahead of every list lead regardless of scoring". A freshly posted
  // lead gets the top priority tier.
  assert.match(scoring.body, /posted_at is not null and l\.posted_at >= v_now - interval '5 minutes' then 1/);

  // And the tier is settled before anything else is consulted, so a high-scoring list lead cannot
  // overtake a lead that arrived thirty seconds ago.
  //
  // Asserted as a property rather than as one implementation: an earlier version filtered with
  // `priority = (select min(priority) from eligible)` and the current one sorts by priority first,
  // because naming a CTE twice materialises it and walked the queue a second time. Both settle the
  // tier first, which is the criterion — so this matches either shape and fails a version that
  // ranks by score across tiers.
  assert.ok(
    /order by e\.priority\b/.test(scoring.body) ||
      /e\.priority = \(select min\(e2\.priority\) from eligible e2/.test(scoring.body),
    "the serving order must settle the priority tier before ranking within it",
  );
});

test("a lead with no certificate is flagged, not suppressed", () => {
  const service = read("lib", "leadPost", "service.ts");
  // LA-2.6 is explicit that this is out of scope: "Automatic suppression of leads without a
  // certificate; flag, do not block — many legitimate lists have none." So the absence of a
  // certificate must never appear among the rejection reasons.
  //
  // Consent TEXT and the consent IP are a different thing — the consent itself, not a certificate
  // of it — and the Lead posting board refuses a post without them (missing_consent_text,
  // missing_consent_ip). So the assertion is on certificates by name, and on the capture staying
  // after acceptance, where it cannot refuse anything.
  const validation = read("lib", "leadPost", "validation.ts");
  const codes = validation.slice(validation.indexOf("VALIDATION_REASON_CODES"), validation.indexOf("] as const"));
  assert.doesNotMatch(codes, /certificate|trusted|jornaya/i, "a missing certificate must not be a rejection reason");
  const reasonCodes = service.slice(service.indexOf("| \"rate_limited\"") - 600, service.indexOf("| \"rate_limited\"") + 200);
  assert.doesNotMatch(reasonCodes, /certificate|trusted|jornaya/i, "a missing certificate must not be a rejection reason");
  assert.ok(
    service.indexOf("await captureConsentArtefact(") > service.indexOf('.from("lead_queue").insert('),
    "the certificate is filed after the lead is accepted, so it can never be why a post is refused",
  );
});

test("a failed load is not reported as an empty vendor list", () => {
  // Found in the browser pass. The load threw correctly and toasted the reason, but the body went on
  // rendering "No vendors yet. Add one to start attributing lead cost." — the same sentence a tenant
  // who has genuinely bought nothing sees. Once the toast faded, the screen was confidently wrong.
  const workspace = read("components", "app", "campaign-workspace.tsx");
  const code = workspace.replace(/\/\/[^\n]*/g, "").replace(/\/\*[\s\S]*?\*\//g, "");
  assert.match(code, /setLoadError\(message\)/);
  // Both sections check the failure BEFORE falling through to their empty state.
  assert.match(code, /\{loadError[\s\S]{0,260}:\s*rollup\.length === 0/);
  assert.match(code, /\{loadError[\s\S]{0,260}:\s*campaigns\.length === 0/);
  // And the "start with a vendor" nudge does not fire when we simply could not look.
  assert.match(code, /vendors\.length === 0 && !loading && !loadError/);
});
