// Run with: npm test
//
// The lead list is inventory; the pipeline is what happened to it. The product owner drew that line
// explicitly — "the lead list is different from the pipelines" — and it is the reason this screen
// exists at all: before it, the only way to look at imported leads was `/app/leads`, which is
// organised by pipeline, so the only view of the inventory was through the thing it is not.
//
// Three things are pinned, and two of them are mistakes this screen already made once.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const ROOT = process.cwd();
const read = (...parts) => readFileSync(join(ROOT, ...parts), "utf8");
const service = read("lib", "leadLists", "service.ts");
const workspace = read("components", "app", "lead-list-workspace.tsx");

test("counting the inventory does not read the whole book", () => {
  // The first draft fetched every lead on the tenant and filtered for a campaign in memory. On the
  // demo tenant that was 28 rows and merely slow; on a tenant with a real book it is the difference
  // between a page and a timeout.
  assert.match(
    service,
    /\.not\("campaign_id", "is", null\)/,
    "the lead-list counts read every lead on the tenant again, not only the ones in a list",
  );
  // And the work items are fetched for those leads, not for the whole queue.
  //
  // Scoped to `listLeadLists` rather than the file: `listLeadsInList` further down makes the same
  // `from("lead_queue") … .in("lead_id")` call for one list, so a file-wide match passed even with
  // this function reading the entire queue. A guard satisfied by a different function than the one
  // it is about is not a guard.
  const start = service.indexOf("export async function listLeadLists");
  const end = service.indexOf("export async function listLeadsInList");
  assert.ok(start >= 0 && end > start, "listLeadLists is gone or reordered; this guard needs rewriting");
  const counting = service.slice(start, end);
  // The work item now rides along on the lead read itself (embedded through the unique
  // lead_queue_lead_id_fkey), so it can only ever be fetched for leads that read returned. A
  // standalone `from("lead_queue")` in this function would be the whole-queue read coming back.
  assert.match(
    counting,
    /lead_queue!lead_queue_lead_id_fkey\(/,
    "the work queue is being read whole rather than for the leads in the lists",
  );
  assert.doesNotMatch(
    counting,
    /from\("lead_queue"\)/,
    "the work queue is being read whole rather than for the leads in the lists",
  );
  assert.match(counting, /\.eq\("lead_queue\.tenant_id", tenantId\)/, "the embedded work item is no longer tenant-scoped");
});

test("the independent reads run together", () => {
  // Sequentially this screen took three to six seconds on 28 leads — four round trips at ~200ms
  // each, one after another, for data with no ordering between the parts.
  assert.match(
    service,
    // Later reads (licensed states, vendor returns) join the same batch rather than following it.
    /const \[campaigns, vendors, attributedLeads(?:, \w+)*\] = await Promise\.all\(/,
    "the campaigns, vendors and leads reads are sequential again",
  );
});

test("an empty list says which kind of empty it is", () => {
  // "Every lead is assigned" is a claim about leads that exist. Saying it about a list that received
  // none asserts something nothing measured — the exact empty-state defect this audit has removed
  // from the dashboard, the funnel and the dialer.
  assert.match(workspace, /open\.leadsReceived === 0/, "the three empty states have been collapsed into one");
  assert.match(workspace, /No leads have arrived against this list yet/);
  assert.match(workspace, /Every lead in this list is already assigned/);
  assert.match(workspace, /No leads match this filter/);
});

test("a partial assignment is reported as partial", () => {
  // The server skips a member at capacity, and skips a lead they cannot legally write. A partial
  // result is the expected outcome, so "12 assigned" when three were refused would be a lie the
  // screen tells on the server's behalf.
  assert.match(workspace, /of \$\{ids\.length\} assigned/, "the assignment result no longer reports how many of how many");
  assert.match(workspace, /could not be assigned/, "refusals are no longer surfaced");
});

test("the screen is reachable", () => {
  const menu = read("lib", "menu", "definition.ts");
  assert.match(menu, /key: "leads\.lists"[^}]*path: "\/app\/lead-lists"[^}]*built: true/);
  const sidebar = read("components", "app", "agent-sidebar.tsx");
  assert.match(sidebar, /"leads\.lists"/, "the lead list is not in a sidebar section, so the nav entry renders nowhere");
  const policy = read("lib", "entitlements", "agentApiPolicy.ts");
  assert.match(policy, /app\/api\/app\/lead-lists\/route\.ts/, "the route is not declared in the policy map");
});
