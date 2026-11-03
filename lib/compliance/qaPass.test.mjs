// Compliance functional QA pass (2026-11-03, docs/qa/COMPLIANCE-REPORTS-QA.md): what was broken, held fixed.
// Run with: node --experimental-strip-types --test lib/compliance/qaPass.test.mjs
//
// DB-free and network-free: source contracts for routes and screens, as the rest of lib/compliance does.

import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const read = (p) => readFileSync(join(process.cwd(), p), "utf8").replace(/\r\n/g, "\n");
const code = (s) => s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "").replace(/\{\/\*[\s\S]*?\*\/\}/g, "");

test("the consent export reads past the API's 1,000-row cap, page by page", () => {
  const route = code(read("app/api/app/consent/route.ts"));
  // Live it stopped at exactly 1,000 rows of 16,049: one read of 10,000 is cut to 1,000 by the API.
  assert.match(route, /const EXPORT_PAGE = 1_000;/);
  assert.match(route, /for \(let page = 1; view\.rows\.length < Math\.min\(view\.total, EXPORT_CAP\); page \+= 1\)/);
  assert.doesNotMatch(route, /pageSize: csv \? EXPORT_CAP/, "no single read asks for the whole cap");
  // Pages are only stable with a unique tie-break: an imported list shares one created_at.
  assert.match(code(read("lib/consent/evidenceService.ts")), /\.order\("created_at", \{ ascending: false \}\)\.order\("id", \{ ascending: false \}\)/);
});

test("the evidence CSV opens in Excel as UTF-8", () => {
  assert.match(code(read("app/api/app/compliance/evidence/route.ts")), /new NextResponse\(`\$\{String\.fromCharCode\(0xfeff\)\}\$\{evidenceCsv\(report\)\}`/);
});

test("the TCPA check's Yes / No is on the page, not only in the bell", () => {
  const ws = code(read("components/app/suppression-workspace.tsx"));
  const start = ws.indexOf("{check ? (");
  assert.ok(start > -1, "the answer is still drawn when a check comes back");
  const answer = ws.slice(start, ws.indexOf(") : ", start));
  // A Callout draws nothing outside a dialog (no-notice rule), so the verdict cannot be one.
  assert.doesNotMatch(answer, /<Callout/);
  assert.match(answer, /No — /);
  assert.match(answer, /Yes — no list here blocks/);
  // The reason's trailing dots and spaces are trimmed, not a trailing letter "s".
  assert.doesNotMatch(ws, /replace\(\/\[\.s\]\+\$\//);
});
