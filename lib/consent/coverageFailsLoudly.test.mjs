// Run with: npm test
//
// The consent locker told the truth about everything except itself.
//
// `coverageAvailable: !coverage.error` turned EVERY failure into "the reporting view has not been
// created on this deployment yet" — a calm, plausible sentence that sends the reader off to check
// a migration. The actual fault was a typo in the select list: `claimed_pct` where the view has
// `claimed_coverage_pct`. The view was deployed. It held six rows. The screen said it did not
// exist, and would have kept saying so forever.
//
// This is the defect the whole LA audit is about — an error collapsed into a reassuring message —
// written into the screen built to catch it. Worth a guard of its own, because the fix is one
// character of difference from the bug: `!error` versus `error is the missing-table error`.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const source = readFileSync(join(process.cwd(), "lib", "consent", "locker.ts"), "utf8");

test("only a genuinely missing view counts as an unavailable view", () => {
  assert.doesNotMatch(
    source,
    /coverageAvailable:\s*!\s*coverage\.error/,
    "any error is being reported as 'the view is not deployed' again — a wrong column name would read as a missing migration",
  );
  assert.match(
    source,
    /PGRST205/,
    "the missing-table code is no longer checked, so 'unavailable' is not grounded in anything",
  );
});

test("an error that is not a missing view is raised rather than swallowed", () => {
  assert.match(
    source,
    /if \(coverage\.error && !coverageMissing\)\s*\n?\s*throw new Error/,
    "a real coverage fault no longer throws, so it would disappear into an empty list",
  );
});

test("the coverage select names the columns the view actually has", () => {
  // Checked as a literal because the names are the whole bug. `claimed_pct` and `any_pct` do not
  // exist on `tenant_vendor_consent_coverage`; the real names carry `_coverage_`.
  assert.match(source, /claimed_coverage_pct/, "the coverage percentage column name has drifted back");
  assert.doesNotMatch(
    source,
    /["'\s,]claimed_pct\b/,
    "`claimed_pct` is back in the query — that column does not exist on the view",
  );
});
