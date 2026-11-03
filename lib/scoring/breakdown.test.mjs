// Run with: npm test
//
// LA-2.13-2 · the per-signal breakdown on /app/scoring's preview: score_lead's own factors times
// the weights it used, adding up to the score on the row.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { breakdownLine, signalBreakdown } from "./preview.ts";

const read = (...parts) => readFileSync(join(process.cwd(), ...parts), "utf8");

const LABELS = [
  { signal: "time_of_day_fit", label: "Time-of-day fit" },
  { signal: "slot_freshness", label: "Slot freshness" },
  { signal: "vendor_contact_rate", label: "Vendor contact rate" },
  { signal: "attempt_position", label: "Attempt number" },
  { signal: "completeness", label: "Data completeness" },
  { signal: "recency", label: "Lead age" },
  { signal: "consent_artefact", label: "Consent artefact present" },
];

test("each signal's points are weight × factor, and they add up to score_lead's score", () => {
  // score_lead's `signals` for one lead, as the function builds it.
  const weights = { recency: 25, attempt_position: 15, slot_freshness: 15, vendor_contact_rate: 15, time_of_day_fit: 15, completeness: 10, consent_artefact: 5 };
  const signals = { recency: 0.794, attempt_position: 0.75, slot_freshness: 1, vendor_contact_rate: 0.5, time_of_day_fit: 0.5, completeness: 0.25, consent_artefact: 0, slot: "late_morning", attempts_made: 0, weights };
  const rows = signalBreakdown(signals, LABELS);
  assert.deepEqual(rows.map((row) => row.signal), LABELS.map((label) => label.signal));
  const score = Object.keys(weights).reduce((sum, key) => sum + weights[key] * signals[key], 0);
  assert.equal(Math.round(rows.reduce((sum, row) => sum + row.points, 0) * 1000) / 1000, Math.round(score * 1000) / 1000);
  assert.equal(rows.find((row) => row.signal === "recency").points, 19.85);
  assert.equal(breakdownLine(rows.find((row) => row.signal === "recency")), "19.9 of 25 pts");
  assert.equal(breakdownLine(rows.find((row) => row.signal === "consent_artefact")), "0.0 of 5 pts");
});

test("a malformed or missing signal is left out, not guessed", () => {
  assert.deepEqual(signalBreakdown(null, LABELS), []);
  assert.deepEqual(signalBreakdown({ recency: 0.5 }, LABELS), []);
  assert.deepEqual(signalBreakdown({ recency: "x", weights: { recency: 10 } }, LABELS), []);
});

test("the preview asks score_lead at the preview's own instant, and the screen shows the rows", () => {
  const service = read("lib", "scoring", "service.ts");
  assert.match(service, /db\.rpc\("score_lead", \{ p_tenant_id: tenantId, p_lead_id: row\.leadId, p_at: at \}\)/);
  assert.match(service, /const at = preview\.generatedAt \|\| new Date\(\)\.toISOString\(\);/);
  const screen = read("components", "app", "scoring-workspace.tsx");
  assert.match(screen, /aria-controls=\{`breakdown-\$\{row\.workItemId\}`\}/);
  assert.match(screen, /\{breakdownLine\(part\)\}/);
});
