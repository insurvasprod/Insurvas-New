import test from "node:test";
import assert from "node:assert/strict";

import { catalogNeeds, catalogStepCounts, layoutGaps, reviewWaiting, waitedWords } from "./needs.ts";

const NOW = Date.parse("2026-11-17T12:00:00Z");

const full = {
  status: { words: 4, rows: 212, agencies: 3, oldest: "2026-11-10T00:00:00Z" },
  reports: { waiting: 3, oldest: "2026-11-11T09:00:00Z" },
  fields: { drafts: 1, inReview: 0, needsReview: 1 },
  rules: { missing: 9, carriers: 14 },
  layouts: { noCommission: 2, noPolicy: 0, noneLive: 1, carriers: 14 },
  guidance: { missing: 5, carriers: 14 },
  servicing: { missing: 6, carriers: 14 },
  templates: { drafts: 2 },
  features: { off: 1, beta: 1, unsold: 3 },
};

test("Needs review lists the review queues first, then the gaps, and leaves empty queues out", () => {
  const rows = catalogNeeds(full, NOW);
  assert.deepEqual(rows.map((row) => row.key), ["status", "reports", "fields", "rules", "no-commission", "unsold", "templates"]);
  assert.equal(rows[0].detail, "4 words · 212 rows held · 3 agencies affected");
  assert.equal(rows[1].detail, "3 waiting · oldest 6 days");
  assert.equal(rows[2].detail, "1 draft · 1 needs review after a miss");
  assert.equal(rows[3].detail, "9 of 14");
  assert.ok(rows.slice(0, 3).every((row) => row.tone === "review"));
  assert.ok(rows.slice(3).every((row) => row.tone === "fill"));
});

test("a failed read is listed as couldn't check and its badge is left out, never 0", () => {
  const queues = { ...full, status: null, templates: null };
  const rows = catalogNeeds(queues, NOW);
  assert.equal(rows.find((row) => row.key === "status")?.tone, "unknown");
  assert.equal(rows.find((row) => row.key === "templates")?.tone, "unknown");
  const counts = catalogStepCounts(queues, new Set(["workspace", "status", "templates", "reports"]));
  assert.deepEqual(counts, { reports: 3 });
  assert.equal(reviewWaiting(queues), null);
});

test("badges only for steps the role may open; a queue it may not open is never read", () => {
  const platform = { ...full, plans: undefined };
  const counts = catalogStepCounts(platform, new Set(["workspace", "features", "status", "fields", "reports"]));
  assert.deepEqual(counts, { workspace: 9, features: 1, status: 4, fields: 2, reports: 3 });
  const none = catalogStepCounts({}, new Set(["workspace"]));
  assert.deepEqual(none, { workspace: 0 });
  assert.deepEqual(catalogNeeds({}, NOW), []);
});

test("review waiting counts words, reports and field maps across the queues that hold any", () => {
  assert.deepEqual(reviewWaiting(full), { total: 9, queues: 3 });
  assert.deepEqual(reviewWaiting({ ...full, reports: { waiting: 0, oldest: null } }), { total: 6, queues: 2 });
});

test("a carrier needs a published version of its assigned layout to count as live", () => {
  const gaps = layoutGaps({
    carriers: [{ id: "a" }, { id: "b" }, { id: "c" }],
    assignments: [
      { carrierId: "a", fileType: "commissions", layoutKey: "a-com" },
      { carrierId: "a", fileType: "policies", layoutKey: "a-pol" },
      { carrierId: "b", fileType: "commissions", layoutKey: "b-com" },
    ],
    maps: [
      { layoutKey: "a-com", status: "published" },
      { layoutKey: "a-pol", status: "published" },
      { layoutKey: "b-com", status: "draft" },
    ],
  });
  assert.deepEqual(gaps, { noCommission: 2, noPolicy: 2, noneLive: 2, carriers: 3 });
});

test("waited words", () => {
  assert.equal(waitedWords(null, NOW), null);
  assert.equal(waitedWords("2026-11-17T08:00:00Z", NOW), "today");
  assert.equal(waitedWords("2026-11-16T08:00:00Z", NOW), "1 day");
});
