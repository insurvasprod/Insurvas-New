/**
 * Pool concept audit (LA-2 §6, 2026-09-25): the contracts between the migrations and the screens,
 * made runnable without a database.
 *
 *   · repeats inside a file are ledgered, claimable, and not usable (703100 + importPreflight);
 *   · a removal can be claimed in the ledger, once, and never for the agency's own list (703200);
 *   · the pool card reads the gates Serve next applies (703000).
 */

import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";

const ROOT = process.cwd();
const read = (...parts) => readFileSync(join(ROOT, ...parts), "utf8");
const MIGRATIONS = join(ROOT, "supabase", "migrations");
const files = readdirSync(MIGRATIONS).sort();

/** The LAST migration that defines a thing is the one that is live. */
function latestDefining(pattern) {
  for (let index = files.length - 1; index >= 0; index--) {
    const body = readFileSync(join(MIGRATIONS, files[index]), "utf8");
    if (pattern.test(body)) return { name: files[index], body };
  }
  return null;
}

test("a repeat inside a file is recorded as its own occurrence, and every other outcome once", () => {
  const recorder = latestDefining(/create or replace function public\.record_campaign_scrub_rejections/);
  assert.ok(recorder);
  assert.match(recorder.body, /on conflict \(tenant_id, campaign_id, phone_digits, occurrence\) do nothing/);
  // No caller can record the same DNC number twice by passing an occurrence.
  assert.match(recorder.body, /if v_outcome = 'duplicate_in_file' then[\s\S]*?else\s+v_occurrence := 1;/);
  assert.match(recorder.body, /'duplicate_in_file'\)\)/, "the outcome check must admit the duplicate");
});

test("the commit ledgers in-file repeats with an occurrence, and survives a ledger without them", () => {
  const preflight = read("lib", "agentTemplates", "importPreflight.ts");
  const commit = preflight.slice(preflight.indexOf("for (const row of rows) {", preflight.indexOf("const appearances")));
  assert.match(commit, /outcome: "duplicate_in_file".*, occurrence \}\);/);
  // Before 703100 the whole payload would fail the check constraint; the repeats are dropped and
  // everything else is still recorded.
  assert.match(preflight, /rejection\.outcome !== "duplicate_in_file"/);
});

test("the lead list treats a repeat as creditable and knows where each removal stands", () => {
  const detail = read("lib", "leadLists", "detail.ts");
  assert.match(detail, /CREDITABLE: ReadonlySet<RemovalReason> = new Set\(\["tcpa_litigator", "dnc", "invalid", "duplicate_in_file"\]\)/);
  assert.match(detail, /"duplicate_in_file", "suppressed"\]/, "REASON_ORDER must list the repeat");
  assert.match(detail, /lead_list_pool_blockers/);
  assert.match(detail, /create_import_removal_claim/);
  const screen = read("components", "app", "lead-list-detail.tsx");
  assert.match(screen, /duplicate_in_file: \{ label:/, "REMOVAL must label the repeat");
  // The post-credit sentence divides net spend less the credit still able to land by usable rows —
  // not "back to the invoice price", which is only true when every removal is creditable.
  assert.match(screen, /\(netSpend - d\.claims\.pendingCents\) \/ d\.recordsUsable/);
  assert.doesNotMatch(screen, /goes back to \{perRecord\(d\.costPerRecordCents\)\}/);
});

test("a removal is claimed in the ledger once, never for the agency's own list, and audited", () => {
  // The table rules live where they were added; later files restate only the functions.
  const table = latestDefining(/create unique index if not exists lead_claim_items_scrub_rejection_key/);
  assert.ok(table);
  assert.match(table.body, /num_nonnulls\(lead_id, scrub_rejection_id\) = 1/);
  assert.match(table.body, /create unique index if not exists lead_claim_items_scrub_rejection_key/);
  const ledger = latestDefining(/create or replace function public\.create_import_removal_claim/);
  assert.ok(ledger);
  assert.match(ledger.body, /not \(r\.outcome = 'dnc' and coalesce\(r\.detail, ''\) ~\* 'your do-not-call list'\)/);
  assert.match(ledger.body, /'tenant\.vendor_claim_drafted_from_import'/);
  assert.match(read("lib", "audit", "actions.ts"), /"tenant\.vendor_claim_drafted_from_import": "/);

  // The lead-based candidates stop offering the agency's own list, and a number already claimed as
  // a removal. The disposition branch is kept exactly (the Dialer's 700100 check reads it).
  const claimable = latestDefining(/create or replace function public\.vendor_claimable_leads/);
  assert.equal(claimable.name, ledger.name);
  assert.match(claimable.body, /and not \(coalesce\(sr\.outcome, l\.screening_outcome\) = 'dnc' and l\.screening_result_id is null\)/);
  assert.match(claimable.body, /a\.disposition in \('wrong_number', 'disconnected'\)/);
  assert.match(claimable.body, /r\.id = ri\.scrub_rejection_id/);
});

test("the pool card asks the gates Serve next applies, once per state", () => {
  const pool = latestDefining(/create or replace function public\.lead_list_pool_blockers/);
  assert.ok(pool);
  for (const gate of ["campaigns_servable", "is_phone_suppressed(p_tenant_id", "tenant_can_dial_now(p_tenant_id", "agent_may_work_state(p_tenant_id", "calling_window_rules_stale"])
    assert.ok(pool.body.includes(gate), `lead_list_pool_blockers must apply ${gate}`);
  // The capacity helper belongs to the Dialer's migration and is only called when it exists.
  assert.match(pool.body, /to_regprocedure\('public\.agent_can_take_pool_lead\(uuid, uuid\)'\)/);
  assert.match(pool.body, /grant execute on function public\.lead_list_pool_blockers\(uuid, uuid, timestamptz\) to service_role;/);
  assert.doesNotMatch(pool.body, /to tenant_app/);
});
