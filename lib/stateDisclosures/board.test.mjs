// Run with: npm test
//
// The Disclosures board's model: coverage by state x product, the placeholder flag the seed's
// marker produces, the pack importer, and the structural promises of the review workflow (a second
// admin approves, the dialer's read is untouched, and nothing in the product writes wording).
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import {
  buildCoverageRows,
  coverageCsv,
  formatEffectiveDate,
  parseCsv,
  parsePack,
  productScope,
  summarize,
  wordingPreview,
} from "./board.ts";
import { isPlaceholderDisclosure } from "./constants.ts";

const read = (path) => readFileSync(new URL(`../../${path}`, import.meta.url), "utf8");

// The seed script's own marker, read from the script rather than retyped, so the two cannot drift.
const seed = read("scripts/seed-state-disclosures.mjs");
const MARKER = /const MARKER = "([^"]+)"/.exec(seed)[1];

const row = (state, product, date, text, status = "live") => ({
  id: `${state}-${product}-${date}`,
  state,
  product_code: product,
  required_text: text,
  effective_from: date,
  created_at: `${date}T12:00:00Z`,
  live: status === "live",
  status,
});

test("the seed's placeholder marker is detected, and real wording is not", () => {
  assert.equal(isPlaceholderDisclosure(`${MARKER}\n\nHello`), true);
  assert.equal(isPlaceholderDisclosure(`  \n${MARKER}`), true);
  assert.equal(isPlaceholderDisclosure("This call may be recorded."), false);
  assert.equal(isPlaceholderDisclosure(null), false);
  assert.equal(wordingPreview(`${MARKER}\n\nFirst line\nSecond`), "First line Second");
});

test("coverage is one row per state and product, and an uncovered pair has no wording", () => {
  const disclosures = [
    row("TX", "term_life", "2026-09-23", `${MARKER}\nx`),
    row("TX", "term_life", "2026-01-01", "old", "superseded"),
    row("TX", "term_life", "2026-12-01", "next", "scheduled"),
    row("AZ", "annuity", "2026-01-01", "approved"),
  ];
  const scope = productScope([{ code: "term_life", name: "Term Life" }, { code: "final_expense", name: "Final Expense" }], disclosures);
  assert.deepEqual(scope.map((entry) => entry.code), ["term_life", "final_expense", "annuity"]);
  assert.equal(scope[2].inCatalog, false);

  const pending = [{ id: "p1", product_code: "final_expense", states: ["TX"], status: "pending" }];
  const rows = buildCoverageRows(disclosures, scope, pending);
  assert.equal(rows.length, 51 * 3);

  const tx = rows.find((entry) => entry.key === "TX|term_life");
  assert.equal(tx.live.effective_from, "2026-09-23");
  assert.equal(tx.placeholder, true);
  assert.equal(tx.scheduled[0].effective_from, "2026-12-01");
  assert.deepEqual(tx.versions.map((version) => version.effective_from), ["2026-12-01", "2026-09-23", "2026-01-01"]);

  const fe = rows.find((entry) => entry.key === "TX|final_expense");
  assert.equal(fe.live, null);
  assert.equal(fe.pending.length, 1);

  const all = summarize(rows, scope.length);
  assert.equal(all.combinationsLive, 2);
  assert.equal(all.placeholders, 1);
  assert.equal(all.uncovered, 51 * 3 - 2);
  assert.equal(all.statesCovered, 0, "no state has every product covered");

  const termOnly = summarize(rows.filter((entry) => entry.productCode === "term_life"), 1);
  assert.equal(termOnly.statesCovered, 1);
});

test("CSV parsing handles quotes, doubled quotes, newlines in a cell and a BOM", () => {
  const rows = parseCsv('﻿a,b\r\n"x, y","say ""hi""\nthere"\n\n');
  assert.deepEqual(rows, [["a", "b"], ["x, y", 'say "hi"\nthere']]);
});

test("a pack groups identical wording, skips blank rows, and refuses bad rows whole", () => {
  const good = [
    "state,product_code,effective_from,required_text",
    'TX,final_expense,2026-10-01,"Line one\nLine two"',
    'FL,final_expense,2026-10-01,"Line one\nLine two"',
    "AZ,final_expense,2026-10-01,Different",
    "GA,final_expense,,",
  ].join("\n");
  const pack = parsePack(good, "2026-09-26");
  assert.equal(pack.errors.length, 0);
  assert.equal(pack.rows, 4);
  assert.equal(pack.skipped, 1);
  assert.equal(pack.proposals.length, 2);
  assert.deepEqual(pack.proposals[0].states, ["TX", "FL"]);

  const bad = [
    "state,product_code,effective_from,required_text",
    "ZZ,final_expense,2026-10-01,a",
    "TX,Final Expense,2026-10-01,a",
    "TX,final_expense,2026-09-25,a",
    `TX,final_expense,2026-10-01,"${MARKER}"`,
    "FL,final_expense,2026-10-01,a",
    "FL,final_expense,2026-10-01,b",
  ].join("\n");
  const refused = parsePack(bad, "2026-09-26");
  assert.equal(refused.proposals.length, 0, "a pack with any bad row imports nothing");
  assert.deepEqual(refused.errors.map((issue) => issue.line), [2, 3, 4, 5, 7]);

  assert.match(parsePack("state,wording\nTX,a", "2026-09-26").errors[0].message, /missing product_code, effective_from, required_text/);
});

test("an export reads back as a pack (uncovered pairs skipped)", () => {
  const scope = productScope([{ code: "term_life", name: "Term Life" }], []);
  const rows = buildCoverageRows([row("TX", "term_life", "2026-11-01", 'He said "yes", then\nleft')], scope, []);
  const pack = parsePack(coverageCsv(rows), "2026-09-26");
  assert.equal(pack.errors.length, 0);
  assert.equal(pack.skipped, 50);
  assert.deepEqual(pack.proposals, [{ product_code: "term_life", states: ["TX"], effective_from: "2026-11-01", required_text: 'He said "yes", then\nleft' }]);
});

test("effective dates print as the board does, without a time zone", () => {
  assert.equal(formatEffectiveDate("2026-01-01"), "1 Jan 2026");
  assert.equal(formatEffectiveDate(null), "—");
});

test("approval is a second admin's, in one transaction, and the dialer's read is untouched", () => {
  const sql = read("supabase/migrations/20260925507000_state_disclosure_review.sql");
  assert.match(sql, /constraint state_disclosure_proposals_four_eyes/);
  assert.match(sql, /REVIEWER_IS_PROPOSER/);
  // Self-approval only with no other active eligible admin, and only with a 10-500 char attestation.
  assert.match(sql, /a\.id <> p_reviewer\s+and a\.is_active\s+and a\.role::text in \('super_admin', 'platform_config'\)/);
  assert.match(sql, /ATTESTATION_REQUIRED/);
  assert.match(sql, /between 10 and 500/);
  assert.match(sql, /or self_approval_attestation is not null/);
  assert.match(sql, /EFFECTIVE_DATE_NOT_IN_FUTURE/);
  assert.match(sql, /PLACEHOLDER_TEXT/);
  // The migration writes no wording of its own: its only insert into state_disclosures copies a proposal.
  assert.doesNotMatch(sql, /insert into public\.state_disclosures[^;]*values/i);
  assert.doesNotMatch(sql, /update public\.state_disclosures|delete from public\.state_disclosures/i);

  const review = read("app/api/admin/state-disclosures/proposals/[id]/route.ts");
  assert.match(review, /requireAdminRole\(\s*CAN_MANAGE_STATE_DISCLOSURES\s*\)/);
  assert.match(review, /\baudit\(/);
  assert.match(review, /selfApproved: true, attestation:/, "a self-approval is not flagged in the audit row");
  assert.match(read("app/api/admin/state-disclosures/proposals/route.ts"), /listProposalsFor\(auth\.session\.sub\)/, "GET no longer reports selfApprovalAllowed");
  for (const path of ["app/api/admin/state-disclosures/proposals/route.ts", "app/api/admin/state-disclosures/proposals/import/route.ts"]) {
    const source = read(path);
    assert.match(source, /requireAdminRole\(\s*CAN_MANAGE_STATE_DISCLOSURES\s*\)/, path);
    assert.match(source, /\baudit\(/, path);
    assert.match(source, /status: 503/, `${path} must say when the review schema is missing`);
  }

  const dialer = read("lib/dialerScripts/service.ts");
  assert.match(
    dialer,
    /from\("state_disclosures"\)\.select\("id, state, product_code, required_text, effective_from"\)\.eq\("state", state\)\.eq\("product_code", productCode\)\.lte\("effective_from"/,
    "the dialer's disclosure read changed shape",
  );
});
