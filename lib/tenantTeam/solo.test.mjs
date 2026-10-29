// Solo mode (owner decisions 2026-10-29): an individual agent working alone does not see the pages that
// hand leads to other people. Run with: npm test
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import { isCaller, soloFrom } from "./soloRule.ts";
import { allMenuItems, buildAgentMenu } from "../menu/definition.ts";
import { visibleDashboardTiles } from "../dashboard/tiles.ts";
import { applicableSetupSteps } from "../dashboard/checklist.ts";
import { resolveRoleHome } from "../dashboard/roleHome.ts";

const read = (path) => readFileSync(new URL(`../../${path}`, import.meta.url), "utf8");
const owner = { role: "owner", status: "active" };

test("an agency plan is never solo, even while the owner is alone", () => {
  assert.equal(soloFrom("agency", [owner]), false);
  assert.equal(soloFrom("agency", []), false);
});

test("a plan with no audience (management, none, a failed read) is not solo: nothing hidden on a guess", () => {
  for (const audience of [null, undefined, "management", ""]) assert.equal(soloFrom(audience, [owner]), false, String(audience));
});

test("an individual plan with only the owner, or only non-callers, is solo", () => {
  assert.equal(soloFrom("individual", [owner]), true);
  assert.equal(soloFrom("individual", [owner, { role: "assistant", status: "active" }]), true);
  assert.equal(soloFrom("individual", [owner, { role: "bookkeeper", status: "active" }, { role: "retention", status: "active" }]), true);
  // A second owner is not a caller (callers are setters and producers only).
  assert.equal(soloFrom("individual", [owner, { role: "owner", status: "active" }]), true);
});

test("one setter or producer on an individual plan turns the team pages on", () => {
  assert.equal(soloFrom("individual", [owner, { role: "setter", status: "active" }]), false);
  assert.equal(soloFrom("individual", [owner, { role: "producer", status: "active" }]), false);
  // Inviting is enough: an invited setter holds a seat.
  assert.equal(soloFrom("individual", [owner, { role: "setter", status: "invited" }]), false);
  assert.equal(soloFrom("individual", [owner, { role: "setter", status: "pending_verification" }]), false);
  // An assistant who also holds the setter role (custom team access) is a caller.
  assert.equal(soloFrom("individual", [owner, { role: "assistant", extraRoles: ["setter"], status: "active" }]), false);
});

test("inactive, deleted and blocked members are ignored", () => {
  for (const status of ["inactive", "deactivated", "deleted", null]) {
    assert.equal(soloFrom("individual", [owner, { role: "setter", status }]), true, String(status));
  }
  assert.equal(soloFrom("individual", [owner, { role: "producer", status: "active", blocked: true }]), true);
  assert.equal(isCaller({ role: "producer", status: "active" }), true);
  assert.equal(isCaller({ role: "owner", extraRoles: ["setter"], status: "active" }), false);
});

test("the menu leaves the team-only pages out in solo mode, and only in solo mode", () => {
  const teamOnly = allMenuItems().filter((item) => item.teamOnly).map((item) => item.path).sort();
  assert.deepEqual(teamOnly, ["/app/assignments", "/app/inbound/team", "/app/lead-routing", "/app/setters"]);
  const every = allMenuItems().map((item) => item.required_feature).filter(Boolean);
  const keys = (options) => buildAgentMenu(every, "owner", options).flatMap((section) => section.items).map((item) => item.path);
  for (const path of teamOnly) {
    assert.ok(keys({}).includes(path), `${path} is in a team's menu`);
    assert.ok(!keys({ solo: true }).includes(path), `${path} is left out for a solo agent`);
  }
  // Nothing else moves.
  assert.equal(keys({}).length - keys({ solo: true }).length, teamOnly.length);
});

test("the dashboard drops the team-only tiles, the assign step and the team action in solo mode", () => {
  const every = allMenuItems().map((item) => item.required_feature).filter(Boolean);
  const paths = (solo) => visibleDashboardTiles(every, "owner", { solo }).map((tile) => tile.path);
  assert.ok(paths(false).includes("/app/assignments") && paths(false).includes("/app/inbound/team"));
  assert.ok(!paths(true).includes("/app/assignments") && !paths(true).includes("/app/inbound/team"));
  const steps = (solo) => applicableSetupSteps({ features: every, seats: null, solo }).map((step) => step.key);
  assert.ok(steps(false).includes("assign"));
  assert.ok(!steps(true).includes("assign"));
  // "Invite your team" stays: it is how a solo agent becomes a team.
  assert.ok(steps(true).includes("team"));
  const actions = (solo) => resolveRoleHome(every, "owner", null, { solo }).actions.map((action) => action.href);
  assert.ok(!actions(true).includes("/app/inbound/team"));
});

test("the rule reads the plan's audience, never a plan code", () => {
  const source = read("lib/tenantTeam/solo.ts") + read("lib/tenantTeam/soloRule.ts");
  assert.match(source, /getPlanAudience/);
  assert.doesNotMatch(source, /plan_code|planCode/);
  assert.match(read("lib/tenantTeam/solo.ts"), /cache\(/, "request-memoised");
});

test("menu, pages, rail and routing writes all ask the one question", () => {
  assert.match(read("app/app/(shell)/layout.tsx"), /isSoloWorkspace\(session\.tenantId\)/);
  assert.match(read("app/app/(shell)/layout.tsx"), /<SoloProvider solo=\{solo\}>/);
  for (const page of ["assignments", "lead-routing", "setters", "inbound/team"]) {
    const source = read(`app/app/(shell)/${page}/page.tsx`);
    assert.match(source, /isSoloWorkspace\(guard\.context\.tenantId\)/, page);
    assert.match(source, /reason="solo"/, page);
  }
  assert.match(read("components/app/lead-sources/leads-in.tsx"), /&& !solo\) open\.add\("route"\)/);
  const assignments = read("app/api/app/assignments/route.ts");
  assert.equal((assignments.match(/await refuseRoutingWrite\(auth\.context\)/g) ?? []).length, 4, "assign_list, POST, PUT and PATCH refuse a solo workspace");
  assert.match(read("app/api/app/search/route.ts"), /solo: await isSoloWorkspace/);
});
