// Run with: npm test
//
// A freshly imported list was attributed and permanently undialable.
//
// `serve_next_lead` admits a lead when `campaign_id is null` OR its campaign appears in
// `campaigns_servable`, and that view requires `scrub_status = 'scrubbed'`. Nothing in the product
// ever set that column — the only SQL that wrote `'scrubbed'` was the suppression migration's own
// self-test and the LA-2.20 recycling path, neither reachable from an import.
//
// So attaching a lead to a campaign made it LESS dialable than leaving it unattributed, which is
// the opposite of what anyone would predict, and it stayed invisible only because no lead in the
// database carried a campaign at all.
//
// The gate itself is right: a list must be scrubbed before it is dialled. The import already does
// that scrub — every row goes through `screenPartnerPhone`, hits are dropped, and the rejections
// land in the ledger. It simply never recorded that it had. These assertions hold both halves in
// place: the scrub must still happen, and it must still be written down.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const root = process.cwd();
const read = (...parts) => readFileSync(join(root, ...parts), "utf8");
const service = read("lib", "agentTemplates", "service.ts");
const route = read("app", "api", "app", "leads", "import", "route.ts");

test("the import marks the campaign scrubbed", () => {
  assert.match(
    service,
    /scrub_status:\s*"scrubbed"/,
    "the import no longer records that it scrubbed the list, so every imported lead is undialable again",
  );
  assert.match(service, /scrubbed_at:/, "the scrub timestamp is no longer written");
});

test("it only claims a scrub it actually performed", () => {
  // The claim is only honest because this same function screens every row first. If the screening
  // goes, the mark becomes a lie told to a compliance gate — which is worse than the bug it fixed.
  assert.match(service, /screenPartnerPhone\(/, "the import no longer screens, so the scrub mark would be false");
  assert.match(
    service,
    /record_campaign_scrub_rejections/,
    "rejections are no longer recorded, so a scrub mark would claim a clean list that was never proven clean",
  );
});

test("the mark happens after the commit, so a crash fails closed", () => {
  // Marking first would leave a campaign advertising a scrub that never finished — undetectable.
  // Marking after leaves leads imported and unservable — visible, and recoverable by re-running.
  const commit = service.indexOf("import_agent_lead_batch");
  const mark = service.indexOf('scrub_status: "scrubbed"');
  assert.ok(commit > 0 && mark > 0, "the commit or the scrub mark has moved");
  assert.ok(
    mark > commit,
    "the campaign is marked scrubbed before the leads commit; a crash between the two would claim a scrub that never happened",
  );
});

test("a failed mark is reported rather than swallowed", () => {
  // The leads are committed by then, so throwing would report a successful import as a failure and
  // lose the row ids. Returning it lets the screen say "imported, but nothing will be served yet",
  // which is the distinction a row count cannot make.
  assert.match(service, /scrubMarked/, "the outcome of the scrub mark is no longer returned");
  assert.match(route, /servable/, "the import response no longer says whether the leads can be served");
});

// ── The reviewed import (/app/import → review → commit) ──────────────────────────────────────
//
// The same bug, one path over. The legacy direct import above was fixed; `commitImport`, which is
// the only path the import SCREEN uses, never marked the campaign scrubbed. Every campaign-
// attributed lead committed from Review was therefore invisible to `serve_next_lead`, because
// `campaigns_servable` needs `status = 'active'` AND `scrub_status = 'scrubbed'`.
const preflight = read("lib", "agentTemplates", "importPreflight.ts");
const commit = preflight.slice(preflight.indexOf("export async function commitImport"));
const preflightRoute = read("app", "api", "app", "leads", "import", "preflight", "route.ts");

test("the reviewed commit marks the campaign scrubbed", () => {
  assert.match(commit, /scrub_status: "scrubbed"/, "the reviewed import never tells the gate its list was scrubbed");
  assert.match(commit, /scrubbed_at:/);
  assert.match(commit, /\.eq\("id", campaignId\)/);
});

test("the reviewed commit only claims a scrub the preflight performed", () => {
  // The preflight screens every distinct number; the commit reuses exactly those answers and
  // records the hits in the ledger before it writes a lead.
  assert.match(preflight, /screenPartnerPhone\(/);
  assert.match(commit, /plan\.screened\[phone\]/);
  assert.match(commit, /record_campaign_scrub_rejections/);
});

test("the reviewed mark comes after the commit, so a crash fails closed", () => {
  const committed = commit.indexOf('rpc("import_agent_lead_batch"');
  const mark = commit.indexOf('scrub_status: "scrubbed"');
  assert.ok(committed > 0 && mark > 0, "the commit or the scrub mark has moved");
  assert.ok(mark > committed, "the campaign is marked scrubbed before the leads commit");
});

test("the reviewed commit says whether the campaign will actually serve", () => {
  // Scrubbed is half of it; a draft or paused campaign is scrubbed and still not served. The
  // screen needs both halves to tell the truth.
  assert.match(commit, /\.select\("id, status"\)/);
  assert.match(commit, /summary\.servable = summary\.campaignStatus === "active"/);
  // A failed mark is logged and reported, not thrown: the leads are already committed.
  assert.match(commit, /could not be marked scrubbed; they will not be served until it is/);
  assert.match(preflightRoute, /return NextResponse\.json\(\{ summary, redirect:/);
  const review = read("components", "app", "import-review-workspace.tsx");
  assert.match(review, /summary\.servable/);
  assert.match(review, /so the dialer will not serve these leads until it is active/);
});
