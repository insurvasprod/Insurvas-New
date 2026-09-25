import test from "node:test";
import assert from "node:assert/strict";

import { listStatus, matchesTenantSearch, onboardingLabel, onboardingTone, tenantListStats } from "./present.ts";

const DAY = 86_400_000;
const NOW = Date.parse("2026-09-24T12:00:00Z");

function row(overrides) {
  return {
    id: "t",
    name: "Northline Insurance",
    tenantStatus: "active",
    status: "active",
    onboardingState: "complete",
    createdAt: "2026-03-12T10:00:00Z",
    suspendedAt: null,
    owner: { name: "Ray Northline", email: "ray@northline.example" },
    plan: null,
    subscriptionStatus: null,
    trialEndsAt: null,
    ...overrides,
  };
}

test("the tenant's own state wins over its subscription; only an active tenant reads as Trial", () => {
  assert.equal(listStatus("suspended", "trialing"), "suspended");
  assert.equal(listStatus("cancelled", "active"), "cancelled");
  assert.equal(listStatus("provisioning", "trialing"), "provisioning");
  assert.equal(listStatus("active", "trialing"), "trial");
  assert.equal(listStatus("active", "past_due"), "active");
  assert.equal(listStatus("active", null), "active");
});

test("both spellings of a finished onboarding read as Complete, in grey; anything else is amber", () => {
  assert.equal(onboardingLabel("complete"), "Complete");
  assert.equal(onboardingLabel("completed"), "Complete");
  assert.equal(onboardingTone("completed"), "neutral");
  assert.equal(onboardingLabel("ready_for_checkout"), "Ready for checkout");
  assert.equal(onboardingTone("pending"), "warning");
});

test("the figures add up and count trials and suspensions from real dates", () => {
  const stats = tenantListStats(
    [
      row({ status: "active" }),
      row({ status: "trial", trialEndsAt: new Date(NOW + 3 * DAY).toISOString() }),
      row({ status: "trial", trialEndsAt: new Date(NOW + 10 * DAY).toISOString() }),
      row({ status: "trial", trialEndsAt: new Date(NOW - DAY).toISOString() }),
      row({ status: "suspended", suspendedAt: new Date(NOW - 41 * DAY).toISOString() }),
      row({ status: "suspended", suspendedAt: new Date(NOW - 2 * DAY).toISOString() }),
      row({ status: "provisioning" }),
    ],
    NOW,
  );
  assert.equal(stats.total, 7);
  assert.equal(stats.active + stats.trial + stats.suspended + stats.provisioning + stats.cancelled, stats.total);
  assert.equal(stats.trial, 3);
  assert.equal(stats.trialsEndingSoon, 1);
  assert.equal(stats.trialsPastEnd, 1);
  assert.equal(stats.oldestSuspendedDays, 41);
});

test("no suspension date means no 'oldest' figure, not zero days", () => {
  assert.equal(tenantListStats([row({ status: "suspended", suspendedAt: null })], NOW).oldestSuspendedDays, null);
});

test("search matches the tenant name and the owner's name and email", () => {
  const r = row({});
  assert.equal(matchesTenantSearch(r, "northline"), true);
  assert.equal(matchesTenantSearch(r, "RAY@"), true);
  assert.equal(matchesTenantSearch(r, "cobalt"), false);
  assert.equal(matchesTenantSearch(row({ owner: null }), "ray"), false);
  assert.equal(matchesTenantSearch(r, "  "), true);
});
