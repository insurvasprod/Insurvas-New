import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const { claimAmountCents, costPerIssuedAfterCredit, costPerIssuedBeforeCredit, reasonEvidence, reasonTotals, isClaimReason } = await import("./returnModel.ts");
const { vendorReturnCsv, EVIDENCE_COLUMNS } = await import("./returnFormat.ts");

const root = new URL("../../", import.meta.url);
const read = (path) => readFile(new URL(path, root), "utf8");

test("the preview's total is rows x purchased rate rounded once, like the claim function", () => {
  // 636 rows at $0.35 a record (spend / records purchased) — not the usable-record rate.
  assert.equal(claimAmountCents(636, 35), 22260);
  assert.equal(claimAmountCents(3, 36.3333), 109);
  assert.equal(claimAmountCents(10, null), null);
});

test("reasons fold both sources together and keep which sources they came from", () => {
  const totals = reasonTotals([
    { reason: "dnc", source: "import", claimable_rows: 4, claimable_cents: 140, expired_rows: 1, expired_cents: 35, soonest_closes_at: null },
    { reason: "dnc", source: "lead", claimable_rows: 2, claimable_cents: 70, expired_rows: 0, expired_cents: 0, soonest_closes_at: null },
    { reason: "wrong_number", source: "lead", claimable_rows: 3, claimable_cents: 105, expired_rows: 0, expired_cents: 0, soonest_closes_at: null },
  ]);
  const dnc = totals.find((row) => row.reason === "dnc");
  assert.deepEqual({ rows: dnc.rows, cents: dnc.cents, expired: dnc.expiredRows, sources: dnc.sources.sort() }, { rows: 6, cents: 210, expired: 1, sources: ["import", "lead"] });
  assert.equal(totals.length, 2);
});

test("call evidence never names the agent", () => {
  for (const reason of ["wrong_number", "disconnected"]) assert.match(reasonEvidence(reason, ["lead"]), /attempt number and time \(no agent name\)/);
  assert.ok(!EVIDENCE_COLUMNS.some((column) => /agent/.test(column)));
  assert.ok(isClaimReason("duplicate_in_file"));
  assert.ok(!isClaimReason("internal_dnc"));
});

test("cost per issued policy before and after a credit uses the scorecard's own figure", () => {
  const cost = { issued_policies: 4, cost_per_issued_cents: 6250 };
  assert.equal(costPerIssuedAfterCredit(cost, 3300), 5425);
  assert.equal(costPerIssuedBeforeCredit({ issued_policies: 4, cost_per_issued_cents: 5425 }, 3300), 6250);
  assert.equal(costPerIssuedAfterCredit({ issued_policies: 0, cost_per_issued_cents: null }, 100), null);
  assert.equal(costPerIssuedAfterCredit({ issued_policies: 1, cost_per_issued_cents: 50 }, 500), 0);
});

test("the evidence CSV carries import removals and attempt numbers, keeping the original columns first", () => {
  assert.deepEqual(EVIDENCE_COLUMNS.slice(0, 11), ["lead_id", "reason", "source", "phone", "state", "screening_outcome", "screening_checked_at", "attempt_id", "attempted_at", "disposition", "lead_created_at"]);
  for (const column of ["scrub_rejection_id", "outcome", "detail", "source_row", "occurrence", "attempt_number", "screening_result_id"]) assert.ok(EVIDENCE_COLUMNS.includes(column), column);
  const csv = vendorReturnCsv({
    claim: { id: "claim-1", tenant_id: "t", campaign_id: "c", vendor_id: "v", reason: "mixed", lead_count: 2, amount_claimed_cents: 70, status: "draft", submitted_at: null, resolved_at: null, amount_credited_cents: 0, replacement_leads_count: 0, rejection_reason: null, notes: null, created_at: "2026-09-25T00:00:00Z" },
    items: [
      { id: "i1", lead_id: null, scrub_rejection_id: "rej-1", reason: "duplicate_in_file", evidence: { source: "import_removal", phone: "5550000001", outcome: "duplicate_in_file", detail: "repeat", source_row: "csv:17", occurrence: 2, rejected_at: "2026-09-20T00:00:00Z" }, created_at: "2026-09-25T00:00:00Z" },
      { id: "i2", lead_id: "lead-1", reason: "wrong_number", evidence: { source: "disposition", phone: "5550000002", attempt_number: 3, attempted_at: "2026-09-21T00:00:00Z", screening_result_id: null }, created_at: "2026-09-25T00:00:00Z" },
    ],
  });
  const lines = csv.split("\r\n");
  const header = lines.find((line) => line.startsWith('"lead_id"')).split(",");
  const removal = lines.find((line) => line.includes("rej-1")).split(",");
  assert.equal(removal[header.indexOf('"source_row"')], '"17"');
  assert.equal(removal[header.indexOf('"occurrence"')], '"2"');
  assert.equal(removal[header.indexOf('"lead_id"')], '""');
  const call = lines.find((line) => line.includes("lead-1")).split(",");
  assert.equal(call[header.indexOf('"attempt_number"')], '"3"');
});

test("the combined claim and the summary are one definition, and the page reads them", async () => {
  const sql = await read("supabase/migrations/20260925707500_vendor_returns_candidates_and_combined_claim.sql");
  assert.match(sql, /to_regprocedure\('public\.create_import_removal_claim\(uuid, uuid, uuid, text\)'\)/);
  assert.match(sql, /your do-not-call list/);
  assert.match(sql, /total_spend_cents::numeric \/ nullif\(c\.records_purchased, 0\)/);
  assert.match(sql, /'tenant\.vendor_claim_drafted'/);
  assert.doesNotMatch(sql, /create or replace function public\.vendor_claimable_leads/, "vendor_claimable_leads is Pool's — read, never restated here");
  const undialable = await read("supabase/migrations/20260925707800_vendor_undialable_rates.sql");
  assert.match(undialable, /nullif\(sum\(p\.purchased\), 0\)/);
  // A re-scrub's hit ('scrub:<run>') went onto a list after purchase: never claimed, never the vendor's.
  const rescrub = await read("supabase/migrations/20260925707900_rescrub_hits_are_never_claimable.sql");
  for (const source of [sql, undialable, rescrub]) assert.match(source, /not like 'scrub:%'/);
  assert.match(sql, /rs\.source_key like 'scrub:%'/);
  assert.match(rescrub, /'wrong_number', 'disconnected'/);
  // Nor a DNC a nurture reactivation's re-screen stamped on the lead (same screening_result_id).
  assert.match(rescrub, /nr\.screening_result_id = l\.screening_result_id/);
  for (const source of [sql, undialable]) assert.match(source, /tenant_nurture_reactivations/);
  assert.match(rescrub, /and not \(coalesce\(sr\.outcome, l\.screening_outcome\) = 'dnc' and l\.screening_result_id is null\)/);
  const service = await read("lib/vendorScorecard/returnsService.ts");
  assert.match(service, /vendor_returns_candidates_summary/);
  assert.match(service, /create_combined_vendor_return_claim/);
  assert.match(service, /PENDING_SCHEMA_MESSAGE, 503/);
  const page = await read("app/app/(shell)/vendor-returns/page.tsx");
  assert.match(page, /searchParams/);
  assert.match(page, /initialVendorId/);
});
