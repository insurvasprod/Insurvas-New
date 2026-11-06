// Run with: node --experimental-strip-types --test lib/dashboard/views/agency.test.mjs
//
// The agency dashboard (owner 2026-11-06, round 2 screens 1–2): the shaping behind its cards.
import { test } from "node:test";
import assert from "node:assert/strict";

import { daysLeft, leadToPolicy, issuedIn, issuedYearToDate, monthOf, pctChange, placementOf, premiumByMonth, premiumByState, producerGoals, submittedIn } from "./agency.ts";

const ZONE = "America/New_York";
const policy = (issueDate, annualCents, agentUserId = "u1", agentName = "Ana") => ({ issueDate, annualCents, carrierId: "c", agentUserId, agentName });
const app = (extra) => ({ updatedAt: "2026-11-03T15:00:00Z", outcome: null, status: "submitted", state: "TX", monthlyPremiumCents: 5000, submittedAt: null, ...extra });

test("months step across a year end, and days left count today", () => {
  assert.equal(monthOf("2026-01-15", -1), "2025-12");
  assert.equal(monthOf("2026-11-06"), "2026-11");
  assert.equal(daysLeft("2026-11-06"), 25);
  assert.equal(daysLeft("2026-02-28"), 1);
});

test("change is whole percent, and nothing to compare is null", () => {
  assert.equal(pctChange(112, 100), 12);
  assert.equal(pctChange(5, 0), null);
});

test("issued in a month counts by issue date and adds the annual premium", () => {
  const rows = [policy("2026-11-02", 120000), policy("2026-11-20", null), policy("2026-10-30", 50000)];
  assert.deepEqual(issuedIn(rows, "2026-11"), { count: 2, cents: 120000 });
});

test("submitted is counted in the workspace's zone", () => {
  const apps = [app({ submittedAt: "2026-12-01T03:00:00Z" }), app({ submittedAt: "2026-11-10T15:00:00Z" }), app({})];
  assert.equal(submittedIn(apps, "2026-11", ZONE), 2);
});

test("premium by month runs January to this month, issued and submitted", () => {
  const rows = [policy("2026-02-10", 100000), policy("2025-02-10", 999)];
  const apps = [app({ submittedAt: "2026-02-05T15:00:00Z", monthlyPremiumCents: 1000 })];
  const months = premiumByMonth(rows, apps, "2026-03-04", ZONE);
  assert.deepEqual(months.map((m) => m.key), ["2026-01", "2026-02", "2026-03"]);
  assert.deepEqual(months[1], { key: "2026-02", label: "Feb", issued: 100000, submitted: 12000 });
  assert.equal(issuedYearToDate(rows, "2025", "2026-03-04"), 999);
});

test("producer goals: last month stands in for the goal, biggest share first", () => {
  const rows = [policy("2026-11-02", 600, "a", "Ana"), policy("2026-10-02", 1000, "a", "Ana"), policy("2026-11-03", 800, "b", "Ben"), policy("2026-10-03", 800, "b", "Ben"), policy("2026-09-03", 800, "c", "Cy")];
  assert.deepEqual(producerGoals(rows, "2026-11", "2026-10").map((r) => [r.name, r.cents, r.goalCents, r.count]), [["Ben", 800, 800, 1], ["Ana", 600, 1000, 1]]);
});

test("premium by state: issued this month, top states named, the rest as Other, arrows against last month", () => {
  const issued = (state, updatedAt, monthly = 1000) => app({ outcome: "issued", status: "closed", state, updatedAt, monthlyPremiumCents: monthly });
  const apps = [
    issued("TX", "2026-11-02T15:00:00Z", 3000), issued("TX", "2026-11-03T15:00:00Z", 3000),
    issued("FL", "2026-11-02T15:00:00Z", 2000), issued("FL", "2026-10-02T15:00:00Z"), issued("FL", "2026-10-03T15:00:00Z"),
    issued("OH", "2026-11-02T15:00:00Z"), issued("GA", "2026-11-02T15:00:00Z", 500),
    app({ state: "TX" }),
  ];
  const rows = premiumByState(apps, "2026-11", "2026-10", ZONE, 2);
  assert.deepEqual(rows.map((r) => [r.label, r.policies, r.cents, r.trend]), [["TX", 2, 72000, "up"], ["FL", 1, 24000, "down"], ["Other (2)", 2, 18000, "up"]]);
});

test("placement is issued over submitted among one month's applications", () => {
  const apps = [app({ submittedAt: "2026-11-02T15:00:00Z", outcome: "issued" }), app({ submittedAt: "2026-11-03T15:00:00Z" }), app({ submittedAt: "2026-11-04T15:00:00Z" }), app({ submittedAt: "2026-10-04T15:00:00Z", outcome: "issued" })];
  assert.deepEqual(placementOf(apps, "2026-11", ZONE), { issued: 1, submitted: 3, pct: 33 });
  assert.equal(placementOf(apps, "2026-09", ZONE), null);
});

test("lead to policy: leads, called, quoted, apps, issued in the month; an uncounted zero is left out", () => {
  const quotes = [{ caseId: "a", createdAt: "2026-11-02T15:00:00Z", outcome: "presented" }, { caseId: "a", createdAt: "2026-11-03T15:00:00Z", outcome: "selected" }, { caseId: "b", createdAt: "2026-11-03T15:00:00Z", outcome: "discarded" }];
  const apps = [app({ submittedAt: "2026-11-04T15:00:00Z", outcome: "issued", updatedAt: "2026-11-05T15:00:00Z" }), app({ submittedAt: "2026-11-04T15:00:00Z" })];
  const out = leadToPolicy({ leads: 10, called: 0, quotes, apps }, "2026-11", ZONE);
  assert.deepEqual(out.steps.map((s) => [s.label, s.count]), [["Leads", 10], ["Quoted", 1], ["Apps", 2], ["Issued", 1]]);
  assert.equal(out.rate, 10);
  assert.equal(leadToPolicy({ leads: 0, called: null, quotes: null, apps: null }, "2026-11", ZONE), null);
});

test("an issued application is dated by the day it closed, not by a later edit", () => {
  const apps = [app({ outcome: "issued", status: "closed", state: "TX", updatedAt: "2026-11-06T15:00:00Z", closedAt: "2026-03-10T15:00:00Z" })];
  assert.deepEqual(premiumByState(apps, "2026-11", "2026-10", ZONE), []);
  assert.equal(premiumByState(apps, "2026-03", "2026-02", ZONE).length, 1);
});

test("issued in a month can stop at a day, for a like-for-like month so far", () => {
  const rows = [policy("2026-10-03", 1000), policy("2026-10-20", 5000)];
  assert.deepEqual(issuedIn(rows, "2026-10", 6), { count: 1, cents: 1000 });
});
