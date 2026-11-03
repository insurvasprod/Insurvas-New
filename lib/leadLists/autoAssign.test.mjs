// Run with: node --test lib/leadLists/autoAssign.test.mjs
//
// Lead sources › Lists › Auto-assign (owner 2026-10-29). It must go through the existing, gated bulk
// commit — the Lists panel's own dry run and assign_list — and never a path of its own.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const read = (...parts) => readFileSync(join(process.cwd(), ...parts), "utf8");
const auto = read("components", "app", "lead-list-auto-assign.tsx");
const route = read("app", "api", "app", "assignments", "route.ts");

test("auto-assign uses the existing dry run and bulk commit, by the published rules", () => {
  assert.match(auto, /view: "list_preview"/, "the dry run is not the assignments route's list_preview");
  assert.match(auto, /mode: "chain"/);
  assert.match(auto, /action: "assign_list", campaignId, mode: "chain", expected \}/, "the commit is not assign_list by the chain with the confirmed count");
  // The count it commits is the one its dry run just returned; a moved count is retried once, not forced.
  assert.match(auto, /commitList\(run\.id, preview\.result\.routable\)/);
  assert.match(auto, /body\?\.code === "list_changed"/);
  // No other endpoint: every request is /api/app/assignments.
  const urls = [...auto.matchAll(/["'`](\/api\/[^"'`?$]+)/g)].map((match) => match[1]);
  assert.ok(urls.length >= 2 && urls.every((url) => url === "/api/app/assignments"), `unexpected endpoints: ${urls.join(", ")}`);
});

test("household rest days hold: never a named-people mode, whose reason overrides them", () => {
  // assign_lead_list reads a named-people mode's required reason as a manager's rest-day override
  // (owner 2026-10-29: auto-assign must respect rest days).
  assert.doesNotMatch(auto, /mode: "round_robin"|mode: "owner"/);
  assert.doesNotMatch(auto, /reason:/);
});

test("a list too big to route at once is skipped, not failed", () => {
  assert.match(auto, /Too many to route at once — use Route › Hand out/);
  assert.match(auto, /status === 504 \|\| body\?\.code === "list_too_slow"/);
});

test("it asks first, with the kit's ConfirmDialog", () => {
  assert.match(auto, /<ConfirmDialog[\s\S]*title="Are you sure you want to auto-assign\?"/);
  assert.doesNotMatch(auto, /window\.confirm/);
});

test("the commit it calls stays owner/producer, write-gated and agency-refused", () => {
  assert.match(route, /async function assignList\(body: unknown\) \{\s*const auth = await requireFeatureRole\("outbound_dialing", managers, \{ write: true \}\);/);
  // The writes go through refuseRoutingWrite: the agency refusal, then solo mode (2026-10-29).
  assert.match(route, /async function assignList\(body: unknown\) \{[\s\S]{0,400}const agencyRefusal = await refuseRoutingWrite\(auth\.context\);/);
  assert.match(route, /async function refuseRoutingWrite\([^)]*\) \{\s*return \(await refuseRouting\(context\)\) \?\? \(await refuseRoutingWhenSolo\(context\)\);/);
  assert.match(route, /if \(mode !== "chain" && !reason\) return/, "a named-people mode no longer needs its reason");
});

test("the button is offered only to the people the commit lets through", () => {
  const page = read("components", "app", "lead-sources", "pages.tsx");
  assert.match(page, /const canAutoAssign = canDeleteLists && outbound\.entitled && \(outbound\.role === "owner" \|\| !\(await isAgencyTenant\(/);
  const workspace = read("components", "app", "lead-list-workspace.tsx");
  // Solo mode (2026-10-29): an agent working alone has nobody to auto-assign to, and the commit refuses them.
  assert.match(workspace, /autoAssign=\{canAutoAssign && !solo && lists\.length > 0 \? <LeadListAutoAssign /);
});
