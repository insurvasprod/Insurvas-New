// Run with: node --experimental-strip-types --test lib/dashboard/homeKinds.test.mjs
//
// Roles r1 (owner 2026-11-18, "Build 2"): the compact Home per role, its goals and the figures' arithmetic.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { HOME_GOAL, HOME_MONEY, homeKind, issuedByMonths, issuedByWeeks, lastMonths, ringOf } from "./homeKinds.ts";
import { GOAL_PERIOD, maySetGoal, ownGoalKind, parseGoalTarget } from "./goalRules.ts";
import { seesMoney } from "./access.ts";

test("each role gets its own home; an owner alone gets the solo home", () => {
  assert.equal(homeKind("owner", false), "owner");
  assert.equal(homeKind("owner", true), "solo");
  for (const role of ["manager", "producer", "setter", "assistant", "bookkeeper", "retention"]) assert.equal(homeKind(role, false), role);
});

test("a home that draws money is only ever a role with the money permission", () => {
  const roleOf = { owner: "owner", solo: "owner", manager: "manager", producer: "producer", setter: "setter", assistant: "assistant", bookkeeper: "bookkeeper", retention: "retention" };
  for (const [kind, money] of Object.entries(HOME_MONEY)) assert.equal(money, seesMoney([roleOf[kind]]), kind);
});

test("the goal rings: the agency's premium, a producer's own, the manager's team count, the setter's week, the rep's saves", () => {
  assert.deepEqual(HOME_GOAL.owner, { kind: "premium", whose: "agency" });
  assert.deepEqual(HOME_GOAL.producer, { kind: "premium", whose: "me" });
  assert.deepEqual(HOME_GOAL.manager, { kind: "policies", whose: "me" });
  assert.deepEqual(HOME_GOAL.setter, { kind: "booked", whose: "me" });
  assert.deepEqual(HOME_GOAL.retention, { kind: "saves", whose: "me" });
  assert.equal(HOME_GOAL.assistant, null);
  assert.equal(GOAL_PERIOD.booked, "week");
  assert.equal(GOAL_PERIOD.saves, "month");
});

test("who may set a goal: the owner and admins any; everyone else their own kind for themselves", () => {
  assert.ok(maySetGoal("owner", "premium", "agency"));
  assert.ok(maySetGoal("admin", "policies", "agency"));
  assert.ok(maySetGoal("owner", "booked", "me"));
  assert.ok(maySetGoal("producer", "premium", "me"));
  assert.ok(!maySetGoal("producer", "premium", "agency"), "a producer never sets the agency's goal");
  assert.ok(!maySetGoal("producer", "booked", "me"));
  assert.ok(maySetGoal("manager", "policies", "me"), "a manager sets his team's count");
  assert.ok(!maySetGoal("manager", "premium", "me"), "a manager has no money goal");
  assert.ok(maySetGoal("setter", "booked", "me"));
  assert.ok(maySetGoal("retention", "saves", "me"));
  assert.ok(!maySetGoal("retention", "premium", "me"));
  assert.ok(!maySetGoal("assistant", "premium", "me"));
  assert.ok(!maySetGoal("bookkeeper", "premium", "agency"));
  assert.equal(ownGoalKind("assistant"), null);
});

test("a typed goal is stored as cents for premium, a whole count otherwise; nonsense is refused", () => {
  assert.equal(parseGoalTarget("premium", "$15,500"), 1_550_000);
  assert.equal(parseGoalTarget("premium", 62000), 6_200_000);
  assert.equal(parseGoalTarget("booked", "25"), 25);
  assert.equal(parseGoalTarget("saves", "0"), null);
  assert.equal(parseGoalTarget("policies", "-3"), null);
  assert.equal(parseGoalTarget("policies", "lots"), null);
  assert.equal(parseGoalTarget("premium", 1e12), null, "past the table's limit");
});

test("months and weeks for the sparklines and the manager's chart", () => {
  assert.deepEqual(lastMonths("2026-02-10", 3), ["2025-12", "2026-01", "2026-02"]);
  const rows = [
    { issueDate: "2026-11-03", annualCents: 120_000 },
    { issueDate: "2026-11-17", annualCents: 80_000 },
    { issueDate: "2026-10-30", annualCents: 50_000 },
    { issueDate: "2026-11-25", annualCents: 999_999 },
    { issueDate: null, annualCents: 1 },
  ];
  const months = issuedByMonths(rows, "2026-11-18", 2);
  assert.deepEqual(months, [{ key: "2026-10", count: 1, cents: 50_000 }, { key: "2026-11", count: 2, cents: 200_000 }], "a future issue date is left out");
  const weeks = issuedByWeeks(rows, "2026-11-18", 3);
  assert.deepEqual(weeks.map((week) => week.key), ["2026-11-02", "2026-11-09", "2026-11-16"], "weeks start on Monday");
  assert.deepEqual(weeks.map((week) => week.count), [1, 0, 1]);
});

test("the ring: share capped at 100, reached at the goal, what is left", () => {
  assert.deepEqual(ringOf(75, 100), { pct: 75, reached: false, left: 25 });
  assert.deepEqual(ringOf(130, 100), { pct: 100, reached: true, left: 0 });
  assert.deepEqual(ringOf(0, 0), { pct: 0, reached: false, left: 0 });
});

const read = (path) => readFileSync(join(process.cwd(), path), "utf8");

test("the goals route checks the role, keeps to the session's tenant and audits every change", () => {
  const route = read("app/api/app/goals/route.ts");
  assert.match(route, /requireTenant\(\)/);
  assert.match(route, /maySetGoal\(heldRole\(context\), kind, whose\)/);
  assert.match(route, /tenantId: context\.tenantId/);
  assert.match(route, /action: "tenant\.goal_set"/);
  assert.match(route, /action: "tenant\.goal_cleared"/);
  assert.match(route, /needs_database_update/, "before the table exists the route says so");
  const migration = read("supabase/migrations/20261118610000_dashboard_goals.sql");
  assert.match(migration, /enable row level security/);
  assert.match(migration, /for select to tenant_app/);
  assert.match(migration, /revoke all on public\.tenant_dashboard_goal from public, anon, authenticated/);
});

test("every home links its daily pages and keeps the spec's blocks in Needs you", () => {
  const home = read("components/app/home/views/overview-view.tsx");
  for (const piece of ['kicker="My pay"', 'kicker="My scorecard"', 'kicker="Payouts to send"', 'title="My producers"', 'key: "setup"', 'pendingHref={pendingHref}', 'closeOutHref={closeOutHref}', 'key: "upgrade"']) {
    assert.ok(home.includes(piece), piece);
  }
});
