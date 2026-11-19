import test from "node:test";
import assert from "node:assert/strict";

import { needsTotal, platformNeeds, platformStepCounts } from "./needs.ts";

const NOW = Date.parse("2026-11-18T12:00:00Z");
const CLEAR = {
  compliance: { registered: 2, enabled: 2, unreachable: 0, blocked: false, demo: false },
  disclosures: { pending: 0, oldestPending: null, placeholders: 0, uncovered: 0, statesCovered: 51, available: true },
  calling: { stale: false, reviewedAt: "2026-11-17T12:00:00Z", staleAfterDays: 30 },
  mail: { smtp: true, missing: [] },
  maintenance: { on: null, scheduled: null, announcementsLive: 0 },
  advanced: { settings: 10, overridden: 1 },
  admins: { active: 3, noTwoFactor: 0, activeSuperAdmins: 2 },
  legal: { drafts: 0, docs: [], supported: true },
};
const ALL = new Set(["workspace", "compliance", "disclosures", "calling", "mail", "maintenance", "admins", "legal"]);

test("a clear platform needs nothing and every badge is 0", () => {
  assert.deepEqual(platformNeeds(CLEAR, NOW), []);
  assert.equal(needsTotal(CLEAR, NOW), 0);
  const counts = platformStepCounts(CLEAR, ALL, NOW);
  assert.ok(Object.values(counts).every((value) => value === 0), JSON.stringify(counts));
});

test("what blocks dialing comes first, and each row opens its page filtered", () => {
  const rows = platformNeeds({
    ...CLEAR,
    compliance: { ...CLEAR.compliance, unreachable: 1, blocked: true },
    disclosures: { ...CLEAR.disclosures, pending: 2, oldestPending: "2026-11-15T00:00:00Z", placeholders: 4, uncovered: 3 },
    legal: { drafts: 1, docs: ["privacy"], supported: true },
  }, NOW);
  assert.deepEqual(rows.map((row) => row.key), ["dialing-blocked", "vendors-unreachable", "disclosures-uncovered", "disclosures-review", "disclosures-placeholder", "legal-drafts"]);
  assert.equal(rows.find((row) => row.key === "disclosures-placeholder").href, "/admin/state-disclosures?show=placeholders");
  assert.equal(rows.find((row) => row.key === "disclosures-uncovered").href, "/admin/state-disclosures?show=not_covered");
  assert.equal(rows.find((row) => row.key === "legal-drafts").href, "/admin/legal?doc=privacy");
  assert.match(rows.find((row) => row.key === "disclosures-review").detail, /oldest 3 days/);
});

test("demo screening never reads as blocked dialing", () => {
  const rows = platformNeeds({ ...CLEAR, compliance: { ...CLEAR.compliance, blocked: true, demo: true } }, NOW);
  assert.ok(!rows.some((row) => row.key === "dialing-blocked"));
});

test("a queue that failed is a 'couldn't check' row and its badge is left out, never 0", () => {
  const queues = { ...CLEAR, admins: null };
  const rows = platformNeeds(queues, NOW);
  assert.equal(rows.at(-1).tone, "unknown");
  assert.equal(rows.at(-1).href, "/admin/admins");
  const counts = platformStepCounts(queues, ALL, NOW);
  assert.ok(!("admins" in counts));
  assert.equal(counts.workspace, 0);
});

test("a role's badges cover only the steps it may open; unread queues are never counted", () => {
  const counts = platformStepCounts({ legal: { drafts: 2, docs: ["tos"], supported: true } }, new Set(["workspace", "legal"]), NOW);
  assert.deepEqual(counts, { workspace: 1, legal: 2 });
});
