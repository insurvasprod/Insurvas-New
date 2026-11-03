// Reports functional QA pass (2026-11-03, docs/qa/COMPLIANCE-REPORTS-QA.md): what was broken, held fixed.
// Run with: node --experimental-strip-types --test lib/reports/qaPass.test.mjs
//
// DB-free and network-free.

import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const read = (p) => readFileSync(join(process.cwd(), p), "utf8").replace(/\r\n/g, "\n");
const code = (s) => s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");

test("the sales report reads every row, not the API's first 1,000", () => {
  const store = code(read("lib/applications/report.ts"));
  // `.limit(20_000)` was cut to 1,000 by the API, so a book past 1,000 quotes or attempts lost figures silently.
  assert.doesNotMatch(store, /\.limit\(LIMIT\)/);
  assert.match(store, /const PAGE = 1_000;/);
  assert.match(store, /make\(\)\.order\("id", \{ ascending: true \}\)\.range\(from, Math\.min\(from \+ PAGE, LIMIT\) - 1\)/);
  for (const table of ["tenant_applications", "tenant_quotes", "tenant_application_cases", "tenant_application_counteroffers", "tenant_application_requirements"]) {
    assert.match(store, new RegExp(`everyRow\\(\\(\\) => [^\\n]*client\\.from\\("${table}"\\)`), table);
  }
});
