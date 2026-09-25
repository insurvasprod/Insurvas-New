/**
 * LA-2.2 criteria 4, 5 and 6, made runnable without a database.
 *
 * These three criteria were the module's remaining import gaps, and each one failed for a reason
 * that a DB-free test can pin:
 *
 *   c5 "Cost per usable lead is correct after scrub rejections" — nothing computed usable rows at
 *      all. Every cost divided by `records_purchased`.
 *   c4 "The preview shows exactly what will be imported, rejected and suppressed" — a scrub hit
 *      threw and aborted the whole file, so "imported" and "rejected" could never both be non-zero.
 *   c6 "A 20,000-row file imports without the browser running out of memory" — the parser refused
 *      anything over 2,000 rows.
 *
 * The migration carries a self-verifying DO block that asserts the task's own worked example
 * against live data. This file asserts the same contract from the other side: that the SQL and the
 * TypeScript still agree about it, so the two cannot drift apart between deploys.
 */

import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";

const { previewLeadCsv, MAX_LEAD_IMPORT_ROWS } = await import("./csv.ts");

const MIGRATIONS = join(process.cwd(), "supabase", "migrations");
const files = readdirSync(MIGRATIONS).sort();

/** Resolves the LAST migration that defines a thing, which is the one that is live. */
function latestDefining(pattern) {
  for (let index = files.length - 1; index >= 0; index--) {
    const body = readFileSync(join(MIGRATIONS, files[index]), "utf8");
    if (pattern.test(body)) return { name: files[index], body };
  }
  return null;
}

const fields = [
  { field_key: "full_name", label: "Full name", type: "text", is_required: true, options: [], sort_order: 0 },
];
const stages = [{ id: "stage-new", name: "New" }];

test("the usable-row cost basis exists and divides by usable rows, not purchased rows", () => {
  const costs = latestDefining(/create or replace view public\.tenant_campaign_costs/);
  assert.ok(costs, "no migration defines public.tenant_campaign_costs");

  // The two numbers the task asks to be recorded side by side.
  assert.match(costs.body, /records_purchased/, "the purchased basis must still be reported");
  assert.match(costs.body, /as records_usable/, "usable rows must be reported");
  assert.match(costs.body, /as records_rejected/, "the rejection count must be reported");

  // The honest cost divides by usable rows. Asserting the divisor rather than the column name is
  // the point: a column called cost_per_usable_record that divided by records_purchased would pass
  // a name check and still understate every lead Ray buys.
  const usableCost = /cost_per_usable_record_cents/.exec(costs.body);
  assert.ok(usableCost, "cost_per_usable_record_cents is missing");
  const expression = costs.body.slice(0, usableCost.index);
  assert.match(
    expression.slice(-400),
    /nullif\(greatest\(c\.records_purchased - coalesce\(r\.rejected_count, 0\), 0\), 0\)/,
    "cost per usable record must divide by purchased minus rejected",
  );

  // Net of credits, like the effective purchased-basis column. A campaign that got money back has
  // a lower true cost, and criterion 2 of LA-2.1 depends on that being visible.
  assert.match(expression.slice(-400), /total_spend_cents - c\.credits_received_cents/);
});

test("rejections are append-only evidence, idempotent per phone, and service-only", () => {
  const ledger = latestDefining(/create table if not exists public\.tenant_campaign_scrub_rejections/);
  assert.ok(ledger, "no migration defines the rejection ledger");

  // Idempotent on the fact itself. An import retried after a network failure must not bill the
  // vendor twice for the same number.
  assert.match(ledger.body, /unique \(tenant_id, campaign_id, phone_digits\)/);
  assert.match(ledger.body, /on conflict \(tenant_id, campaign_id, phone_digits\) do nothing/);

  // Ten digits, the same normalized form the suppression tables use, so a rejection can be matched
  // back to the entry that caused it.
  assert.match(ledger.body, /phone_digits text not null check \(phone_digits ~ '\^\[0-9\]\{10\}\$'\)/);

  // A tenant session may READ its rejections and must never write one: a tenant that could insert
  // rejections could manufacture a credit claim against a vendor.
  assert.match(ledger.body, /for select to tenant_app/);
  assert.match(ledger.body, /grant select on public\.tenant_campaign_scrub_rejections to tenant_app/);
  assert.doesNotMatch(
    ledger.body,
    /grant[^;]*insert[^;]*on public\.tenant_campaign_scrub_rejections[^;]*to tenant_app/,
    "tenant_app must never be able to write a rejection",
  );

  // Both views must run as the caller. A create-or-replace does not carry security_invoker
  // forward, so replacing the vendor rollup without re-setting it would expose every tenant's
  // spend to every other tenant.
  assert.match(ledger.body, /alter view public\.tenant_campaign_costs set \(security_invoker = on\)/);
  assert.match(ledger.body, /alter view public\.tenant_vendor_rollup set \(security_invoker = on\)/);
});

test("the vendor rollup sums usable rows and divides once, not per campaign", () => {
  const rollup = latestDefining(/create or replace view public\.tenant_vendor_rollup/);
  assert.ok(rollup);
  assert.match(rollup.body, /sum\(c\.records_usable\)/);
  assert.match(rollup.body, /cost_per_usable_record_cents/);
  // Summed then divided. An average of averages would let a 10-record campaign count as much as a
  // 10,000-record one, which is how a vendor with one cheap test batch looks better than it is.
  assert.match(
    rollup.body,
    /sum\(c\.total_spend_cents\), 0\) - coalesce\(sum\(c\.credits_received_cents\), 0\)\)::numeric\s*\/ nullif\(coalesce\(sum\(c\.records_usable\), 0\), 0\)/,
  );
});

test("the import records rejections before it commits leads, and fails closed if it cannot", () => {
  const service = readFileSync(join(process.cwd(), "lib", "agentTemplates", "service.ts"), "utf8");
  const body = service.slice(
    service.indexOf("export async function importAgentLeads"),
    service.indexOf("export async function updateAgentLead"),
  );

  const recordAt = body.indexOf("record_campaign_scrub_rejections");
  const commitAt = body.indexOf("import_agent_lead_batch");
  assert.ok(recordAt > 0, "the import must record scrub rejections");
  assert.ok(commitAt > 0, "the import must commit through the atomic batch function");

  // Ordering is the contract. Two RPCs cannot share a transaction, so evidence goes first: a crash
  // between them then leaves the cost per usable lead too HIGH rather than too low, and an
  // overstated lead cost makes Ray buy less of a list rather than more of a bad one.
  assert.ok(
    recordAt < commitAt,
    "rejections must be recorded before the leads are committed, so a crash overstates cost rather than understating it",
  );

  // The cost stamped on each lead comes from the usable basis.
  assert.match(body, /from\("tenant_campaign_costs"\)/);
  assert.match(body, /cost_per_usable_record_cents/);

  // An outage still fails the whole file. LA-2.3 criterion 4: a vendor outage blocks dialing rather
  // than passing numbers through, so an `unavailable` answer must never become a dialable lead.
  assert.match(body, /outcome === "unavailable"/);
  assert.match(body, /if \(outage >= 0\)\s*\n?\s*throw new Error/);

  // A definite hit rejects the row and is counted. These three outcomes are rows Ray paid for and
  // can never dial, which is exactly what a vendor credit covers.
  assert.match(body, /REJECTING_OUTCOMES = new Set\(\["dnc", "tcpa_litigator", "invalid_phone"\]\)/);

  // internal_dq must NOT be a rejection: it means the number matches a lead Ray already has, which
  // the duplicate pass resolves by reusing that lead. Counting it would claim a vendor credit for
  // Ray's own duplicate.
  assert.doesNotMatch(body, /REJECTING_OUTCOMES[^\n]*internal_dq/);

  // O(n) per row, not O(n²). indexOf inside the map was roughly two billion comparisons at 20,000
  // rows, and it also stamped two identical vendor rows with the same screening result.
  //
  // Comments are stripped first: this file explains the defect it fixed, and a prose mention of
  // `rows.indexOf(row)` must not read as the defect itself.
  const code = body.replace(/\/\/[^\n]*/g, "");
  assert.doesNotMatch(code, /rows\.indexOf\(row\)/, "indexOf inside the row map is O(n^2) on the file");
});

test("a file whose every row is rejected returns a complete result, not an error", () => {
  const service = readFileSync(join(process.cwd(), "lib", "agentTemplates", "service.ts"), "utf8");
  const body = service.slice(
    service.indexOf("export async function importAgentLeads"),
    service.indexOf("export async function updateAgentLead"),
  );
  // The commit function rejects an empty batch by design, so it must not be called at all. Every
  // row being suppressed is a real outcome with a provable vendor claim attached, not a failure.
  assert.match(body, /if \(pending\.length === 0\)/);
  const guardAt = body.indexOf("pending.length === 0");
  assert.ok(guardAt < body.indexOf("import_agent_lead_batch"), "the empty-batch guard must precede the commit");
});

test("the row cap is 20,000 in the parser and in the commit function alike", () => {
  assert.equal(MAX_LEAD_IMPORT_ROWS, 20_000, "criterion 6 asks for a 20,000-row file");

  const batch = latestDefining(/create or replace function public\.import_agent_lead_batch/);
  assert.ok(batch);
  const size = /jsonb_array_length\(p_items\) > (\d+)/.exec(batch.body);
  assert.ok(size, "the commit function must bound its batch size");
  assert.equal(
    Number(size[1]),
    MAX_LEAD_IMPORT_ROWS,
    "the database guard and the parser cap must agree, or the server accepts a file the database refuses",
  );
});

test("the preview reports every bad row, bounded, instead of only the first exception", () => {
  // Four unreadable rows among six. The old preview threw on row 2 and reported validRows 0, so
  // Ray fixed one row, re-uploaded, and met the next one.
  const csv = [
    "stage,full_name",
    "New,Ada",
    "Nope,Bad One",
    "New,Grace",
    "Nope,Bad Two",
    "Nope,Bad Three",
    "Nope,Bad Four",
  ].join("\n");
  const preview = previewLeadCsv(csv, fields, stages, undefined, 2);

  assert.equal(preview.error, null, "bad rows are row problems, not a whole-file problem");
  assert.equal(preview.totalRows, 6);
  assert.equal(preview.validRows, 2, "the two good rows must still be counted as importable");
  assert.equal(preview.rejectedRows, 4);
  assert.equal(preview.rowErrors.length, 2, "the displayed list is bounded");
  assert.equal(preview.moreRowErrors, 2, "and says how many it did not show");
  assert.match(preview.rowErrors[0].message, /Row 3/);
});

test("unmapped vendor columns do not block a structurally valid import", () => {
  const preview = previewLeadCsv("stage,unknown\nNew,value\n", fields, stages);
  assert.equal(preview.error, null);
  assert.equal(preview.validRows, 1);
  assert.equal(preview.rejectedRows, 0);
  assert.deepEqual(preview.rowErrors, []);
});

test("the preview parses the file once and does not materialise its rows", () => {
  const csv = readFileSync(join(process.cwd(), "lib", "agentTemplates", "csv.ts"), "utf8");
  const preview = csv.slice(csv.indexOf("export function previewLeadCsv"));

  // The old preview called parseCsv itself and then called parseLeadCsv, which called parseCsv
  // again: two full passes per invocation, in a component that invoked it on every render.
  assert.doesNotMatch(
    preview.slice(0, preview.indexOf("\n}")),
    /parseLeadCsv\(/,
    "the preview must not call the write parser, which would parse the whole file a second time",
  );
  // Counting, not collecting. Retaining 20,000 typed objects to render three of them is where the
  // browser actually runs out of memory.
  assert.match(preview, /validRows\+\+/);
});

test("the import screen memoises its file parsing", () => {
  const workspace = readFileSync(
    join(process.cwd(), "components", "app", "lead-import-workspace.tsx"),
    "utf8",
  );
  // Unmemoised, these walked the whole file on every render — including a keystroke in an
  // unrelated control. This is most of what criterion 6 actually needed.
  assert.match(workspace, /const preview = useMemo\(\(\) => previewCsv\(csv\), \[csv\]\)/);
  // Through `useLeadPreview`, which memoises the same whole-file read (and a second, date-ordered
  // read only for files with slash dates) on the file and the mapping.
  assert.match(workspace, /const validation = useLeadPreview\(/);
  assert.match(workspace, /function useLeadPreview\([\s\S]{0,400}return useMemo\(/);
  assert.match(workspace, /const suggestions = useMemo\(/);

  // The advertised cap comes from the server, which reads it from the parser's constant, so the
  // screen can never promise a limit the parser does not enforce.
  assert.doesNotMatch(workspace, /Maximum 2,000 leads/);
  assert.match(workspace, /info\?\.maxRows/);
});
