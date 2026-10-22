// One-Path Plan, Phase 1 (in-spec items only): the back link (bug fix), verify once (LA-2.14 /
// LA-1.11), and the carrier's issue recorded on the application (LA-3.18 "later, by Module 4").
import test from "node:test";
import assert from "node:assert/strict";

const { backLink, withFrom, DEFAULT_BACK } = await import("./backLink.ts");
const { applicationKeysForLeadKeys } = await import("./prefill.ts");
const { carrierIssue } = await import("../ingestion/applicationIssue.ts");

test("the back link returns to where the agent came from, inside the app only", () => {
  assert.deepEqual(backLink("/app/inbound/abc/verification"), { href: "/app/inbound/abc/verification", label: "Verification" });
  assert.deepEqual(backLink("/app/leads/123"), { href: "/app/leads/123", label: "Lead" });
  assert.deepEqual(backLink("/app/pending"), { href: "/app/pending", label: "Pending" });
  assert.equal(backLink("/app/outbound/dialer").label, "Dialer");
  assert.equal(backLink("/app/settings").label, "Back");
  for (const bad of [null, "", "https://evil.example", "//evil.example", "/admin/x", "/app/\\evil", "/app/ x", "/app/applications/1"]) {
    assert.deepEqual(backLink(bad), DEFAULT_BACK, String(bad));
  }
  assert.equal(withFrom("/app/applications/1", "/app/leads/2"), "/app/applications/1?from=%2Fapp%2Fleads%2F2");
  assert.equal(withFrom("/app/applications/1?step=after", "/app/pending"), "/app/applications/1?step=after&from=%2Fapp%2Fpending");
});

test("fields confirmed on the call map to the application's keys", () => {
  const keys = applicationKeysForLeadKeys(["first_name", "last_name", "date_of_birth", "state"]);
  for (const key of ["insured.first_name", "insured.last_name", "insured.dob", "addr.state"]) assert.ok(keys.has(key), key);
  assert.ok(!keys.has("insured.ssn"));
  const full = applicationKeysForLeadKeys(["full_name"]);
  assert.ok(full.has("insured.first_name") && full.has("insured.last_name"));
  assert.equal(applicationKeysForLeadKeys(["favourite_colour"]).size, 0);
});

const candidate = (over = {}) => ({ applicationId: "a", applicationStatus: "submitted", statusNormalized: "active", policyNumber: "P1", issueDate: null, issuedOn: null, lastSnapshotDate: "2026-10-01", ...over });

test("the carrier's issue closes a waiting application as issued, and nothing else does", () => {
  for (const status of ["approved_unpaid", "active", "at_risk", "paid_up", "lapsed"]) assert.equal(carrierIssue(candidate({ statusNormalized: status })).issue, true, status);
  // A decline, withdrawal or not-taken needs the agent's reason (LA-3.7); submitted is not an issue.
  for (const status of ["submitted", "declined", "withdrawn", "not_taken", null]) assert.equal(carrierIssue(candidate({ statusNormalized: status })).issue, false, String(status));
  // Only an application still waiting on the carrier.
  for (const status of ["draft", "ready", "counteroffer_pending", "closed"]) assert.equal(carrierIssue(candidate({ applicationStatus: status })).issue, false, status);
  assert.equal(carrierIssue(candidate({ applicationStatus: "pending_carrier" })).issue, true);
});

test("the issue date is the carrier's own, then the day history saw it, then the file's date", () => {
  assert.equal(carrierIssue(candidate({ issueDate: "2026-09-20", issuedOn: "2026-09-25" })).issuedOn, "2026-09-20");
  assert.equal(carrierIssue(candidate({ issuedOn: "2026-09-25" })).issuedOn, "2026-09-25");
  assert.equal(carrierIssue(candidate()).issuedOn, "2026-10-01");
});
